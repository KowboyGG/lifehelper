import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { auth } from "./api/auth";
import { core } from "./api/core";
import { ext } from "./api/ext";
import { life } from "./api/life";
import { system } from "./api/system";
import { requireAuth } from "./lib/auth";
import { handleUpdate, type TgUpdate } from "./bot/handlers";
import { webhookSecret } from "./bot/telegram";
import { runCron } from "./cron";
import { ensureSchema } from "./lib/schema";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Ошибка сервера" }, 500);
});

// Telegram webhook
app.post("/tg/webhook", async (c) => {
  if (c.req.header("x-telegram-bot-api-secret-token") !== (await webhookSecret(c.env))) return c.text("forbidden", 403);
  const update = await c.req.json<TgUpdate>();
  try {
    await handleUpdate(c.env, update);
  } catch (e) {
    console.error("bot", e);
  }
  return c.text("ok"); // всегда 200, иначе Telegram будет повторять апдейт
});

app.route("/api/auth", auth);
app.use("/api/*", async (c, next) => (c.req.path.startsWith("/api/auth/") ? next() : requireAuth(c, next)));
app.route("/api/ext", ext);
app.route("/api", core);
app.route("/api", life);
app.route("/api", system);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ensureSchema(env.DB).then(() => runCron(env)));
  },
} satisfies ExportedHandler<Env>;
