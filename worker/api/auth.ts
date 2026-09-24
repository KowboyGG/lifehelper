import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import { COOKIE, LOGIN_CODE_TTL, createSession, randomToken, sessionCookie, sha256 } from "../lib/auth";
import { first, run } from "../lib/db";
import { getSettings, ownerId, setSettings } from "../lib/settings";
import { botUsername, ensureWebhook } from "../bot/telegram";

export const auth = new Hono<AppEnv>();

const isSecure = (url: string) => url.startsWith("https://");

auth.get("/status", async (c) => {
  const s = await getSettings(c.env.DB);
  return c.json({
    botConfigured: !!c.env.TELEGRAM_BOT_TOKEN,
    ownerSet: !!ownerId(c.env, s),
    devLogin: c.env.DEV_LOGIN === "1",
  });
});

auth.post("/start", async (c) => {
  const body = await c.req.json<{ kind?: string }>().catch(() => ({}) as { kind?: string });
  const kind = body.kind === "ext" ? "ext" : "web";
  if (!c.env.TELEGRAM_BOT_TOKEN) {
    return c.json({ error: "Бот не настроен: добавь секрет TELEGRAM_BOT_TOKEN (см. README)" }, 400);
  }
  try {
    await ensureWebhook(c.env, new URL(c.req.url).origin);
    const username = await botUsername(c.env);
    const code = randomToken(18);
    await run(c.env.DB, "INSERT INTO login_codes(code, kind, status, created_at) VALUES (?, ?, 'pending', ?)", code, kind, Date.now());
    return c.json({ code, url: `https://t.me/${username}?start=login_${code}` });
  } catch (e) {
    return c.json({ error: `Telegram: ${(e as Error).message}` }, 502);
  }
});

auth.get("/poll", async (c) => {
  const code = c.req.query("code") ?? "";
  const row = await first<{ kind: string; status: string; token: string | null; created_at: number }>(
    c.env.DB,
    "SELECT kind, status, token, created_at FROM login_codes WHERE code = ?",
    code,
  );
  if (!row || Date.now() - row.created_at > LOGIN_CODE_TTL || row.status === "used") return c.json({ status: "expired" });
  if (row.status === "denied") return c.json({ status: "denied" });
  if (row.status !== "approved" || !row.token) return c.json({ status: "pending" });

  await run(c.env.DB, "UPDATE login_codes SET status = 'used', token = NULL WHERE code = ?", code);
  if (row.kind === "ext") return c.json({ status: "ok", token: row.token });
  c.header("Set-Cookie", sessionCookie(row.token, isSecure(c.req.url)));
  return c.json({ status: "ok" });
});

/** Ссылка из команды /login в боте. GET не тратит код — вход делает JS страницы */
auth.post("/magic", async (c) => {
  const { code } = await c.req.json<{ code?: string }>().catch(() => ({ code: undefined }));
  const row = await first<{ status: string; token: string | null; created_at: number; kind: string }>(
    c.env.DB,
    "SELECT status, token, created_at, kind FROM login_codes WHERE code = ?",
    code ?? "",
  );
  if (!row || row.kind !== "magic" || row.status !== "approved" || Date.now() - row.created_at > LOGIN_CODE_TTL) {
    return c.json({ error: "Ссылка устарела. Отправь боту /login ещё раз." }, 400);
  }
  await run(c.env.DB, "UPDATE login_codes SET status = 'used' WHERE code = ?", code);
  const token = await createSession(c.env.DB, "web", "Сайт (ссылка из бота)");
  c.header("Set-Cookie", sessionCookie(token, isSecure(c.req.url)));
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await run(c.env.DB, "DELETE FROM sessions WHERE token_hash = ?", await sha256(token));
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** Только для локальной разработки (DEV_LOGIN=1 в .dev.vars) */
auth.post("/dev", async (c) => {
  if (c.env.DEV_LOGIN !== "1") return c.json({ error: "disabled" }, 404);
  const { kind } = await c.req.json<{ kind?: string }>().catch(() => ({ kind: undefined }));
  const token = await createSession(c.env.DB, kind === "ext" ? "ext" : "web", "dev");
  if (kind === "ext") return c.json({ status: "ok", token });
  c.header("Set-Cookie", sessionCookie(token, isSecure(c.req.url)));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- со стороны бота

export async function approveLogin(
  env: Env,
  code: string,
  from: { id: number; first_name?: string; username?: string },
): Promise<"ok" | "expired" | "denied"> {
  const row = await first<{ kind: string; status: string; created_at: number }>(
    env.DB,
    "SELECT kind, status, created_at FROM login_codes WHERE code = ?",
    code,
  );
  if (!row || row.status !== "pending" || Date.now() - row.created_at > LOGIN_CODE_TTL) return "expired";
  const s = await getSettings(env.DB);
  const owner = ownerId(env, s);
  if (owner && owner !== String(from.id)) {
    await run(env.DB, "UPDATE login_codes SET status = 'denied' WHERE code = ?", code);
    return "denied";
  }
  if (!owner) {
    // Первый вход — этот Telegram-аккаунт становится владельцем навсегда
    await setSettings(env.DB, { owner_tg_id: String(from.id), owner_name: from.first_name ?? from.username ?? "" });
  }
  const token = await createSession(env.DB, row.kind === "ext" ? "ext" : "web", row.kind === "ext" ? "Chrome-расширение" : "Сайт");
  await run(env.DB, "UPDATE login_codes SET status = 'approved', token = ? WHERE code = ?", token, code);
  return "ok";
}

/** Для /login в боте: одноразовый код, сессия создаётся при переходе по ссылке */
export async function createMagicCode(env: Env): Promise<string> {
  const code = randomToken(24);
  await run(env.DB, "INSERT INTO login_codes(code, kind, status, created_at) VALUES (?, 'magic', 'approved', ?)", code, Date.now());
  return code;
}
