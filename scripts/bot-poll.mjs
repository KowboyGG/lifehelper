// Локальная проверка бота: забирает апдейты у Telegram (long polling) и отдаёт их в локальный вебхук.
// Нужен TELEGRAM_BOT_TOKEN в .dev.vars и запущенный `npm run dev`.
// Внимание: снимает вебхук продакшена. После проверки зайди на сайт и нажми
// «Настройки → Telegram → Переподключить», чтобы вернуть его.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split("\n")
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.split("=")[0].trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const token = vars.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Добавь TELEGRAM_BOT_TOKEN в .dev.vars");
const secret = createHash("sha256").update(`lifehelper-webhook:${token}`).digest("hex").slice(0, 48);
const tg = (m, body = {}) =>
  fetch(`https://api.telegram.org/bot${token}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

await tg("deleteWebhook");
const me = await tg("getMe");
console.log(`Слушаю @${me.result.username} → http://localhost:8787/tg/webhook (Ctrl+C — выход)`);
let offset = 0;
for (;;) {
  const r = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }).catch(() => ({ result: [] }));
  for (const u of r.result ?? []) {
    offset = u.update_id + 1;
    await fetch("http://localhost:8787/tg/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(u),
    }).catch((e) => console.error("webhook:", e.message));
    console.log("→", u.message?.text ?? u.callback_query?.data);
  }
}
