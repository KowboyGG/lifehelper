import type { Env } from "../env";
import { sha256 } from "../lib/auth";
import { getSettings, setSettings } from "../lib/settings";

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type Keyboard = InlineButton[][];

export class TgError extends Error {}

export async function tg<T = unknown>(env: Env, method: string, body: Record<string, unknown>): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new TgError("TELEGRAM_BOT_TOKEN не задан");
  const base = env.TELEGRAM_API || "https://api.telegram.org";
  const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!data.ok) throw new TgError(`${method}: ${data.description ?? res.status}`);
  return data.result as T;
}

export function sendMessage(env: Env, chatId: string | number, text: string, keyboard?: Keyboard) {
  return tg<{ message_id: number }>(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export async function editMessage(env: Env, chatId: string | number, messageId: number, text: string, keyboard?: Keyboard) {
  try {
    await tg(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  } catch (e) {
    // «message is not modified» — не ошибка
    if (!String(e).includes("not modified")) throw e;
  }
}

export function answerCallback(env: Env, id: string, text?: string, alert = false) {
  return tg(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: alert }).catch(() => undefined);
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Секрет вебхука выводим из токена — отдельный секрет заводить не нужно */
export async function webhookSecret(env: Env): Promise<string> {
  return (await sha256(`lifehelper-webhook:${env.TELEGRAM_BOT_TOKEN ?? ""}`)).slice(0, 48);
}

export async function botUsername(env: Env): Promise<string> {
  const s = await getSettings(env.DB);
  if (s.bot_username) return s.bot_username;
  const me = await tg<{ username: string }>(env, "getMe", {});
  await setSettings(env.DB, { bot_username: me.username });
  return me.username;
}

const COMMANDS = [
  { command: "today", description: "Чек-лист на сегодня" },
  { command: "stats", description: "Стрик, неделя, цели" },
  { command: "skip", description: "Взять пропуск на сегодня" },
  { command: "login", description: "Ссылка для входа на сайт" },
  { command: "wish", description: "Добавить в вишлист: /wish Кроссовки 3500" },
  { command: "note", description: "Стикер на стену: /note текст" },
  { command: "help", description: "Что умеет бот" },
];

/** Регистрирует вебхук на текущий адрес сайта (вызывается автоматически при входе) */
export async function ensureWebhook(env: Env, origin: string, force = false): Promise<void> {
  // Telegram принимает только https; локально бот работает через `npm run bot:poll`
  if (!env.TELEGRAM_BOT_TOKEN || !origin.startsWith("https://")) return;
  const url = `${origin.replace(/\/$/, "")}/tg/webhook`;
  const s = await getSettings(env.DB);
  if (!force && s.webhook_url === url) return;
  await tg(env, "setWebhook", {
    url,
    secret_token: await webhookSecret(env),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  await tg(env, "setMyCommands", { commands: COMMANDS }).catch(() => undefined);
  await setSettings(env.DB, { webhook_url: url, public_url: origin.replace(/\/$/, "") });
}
