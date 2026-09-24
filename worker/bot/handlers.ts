// Обработка входящих апдейтов Telegram (webhook)
import type { Env } from "../env";
import { approveLogin, createMagicCode } from "../api/auth";
import { addTransaction, deleteTransaction, defaultAccount } from "../api/life";
import { toggleHabit, undoPass, usePass } from "../lib/actions";
import { ensureDay, first, run } from "../lib/db";
import { localToday, skipPreview } from "../lib/progress";
import { getSettings, ownerId, publicUrl } from "../lib/settings";
import { fmtDate, isValidDate } from "../lib/time";
import { MOODS, checkinView, statsText, weeklyText } from "./messages";
import { answerCallback, editMessage, esc, sendMessage, type Keyboard } from "./telegram";

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

const HELP = [
  "<b>Что я умею</b>",
  "",
  "/today — чек-лист на сегодня (галочки)",
  "/stats — стрик и прогресс целей",
  "/week — итоги недели",
  "/skip — взять пропуск на сегодня",
  "/login — ссылка для входа на сайт",
  "/wish Наушники 3500 — в вишлист",
  "/note текст — стикер на стену",
  "",
  "<b>Быстрый ввод:</b>",
  "<code>-250 кофе</code> — расход",
  "<code>+15000 зарплата</code> — доход",
  "Любой другой текст — задача во «Входящие».",
  "",
  "Каждое утро пришлю план, вечером — чек-лист.",
].join("\n");

export async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  if (update.message?.text && update.message.from && update.message.chat.type === "private") return handleMessage(env, update.message);
}

async function siteButton(env: Env): Promise<Keyboard | undefined> {
  const url = publicUrl(env, await getSettings(env.DB));
  return url ? [[{ text: "🌐 Открыть сайт", url }]] : undefined;
}

async function sendCheckin(env: Env, chatId: number | string, date: string): Promise<void> {
  const view = await checkinView(env.DB, date);
  const msg = await sendMessage(env, chatId, view.text, view.keyboard);
  await ensureDay(env.DB, date);
  await run(env.DB, "UPDATE days SET checkin_msg_id = ? WHERE date = ?", msg.message_id, date);
}

async function handleMessage(env: Env, msg: TgMessage): Promise<void> {
  const db = env.DB;
  const from = msg.from!;
  const chatId = msg.chat.id;
  const text = msg.text!.trim();
  const s = await getSettings(db);
  const owner = ownerId(env, s);
  const isOwner = !!owner && owner === String(from.id);

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] ?? "";
    if (payload.startsWith("login_")) {
      const wasOwnerless = !owner;
      const r = await approveLogin(env, payload.slice(6), from);
      if (r === "ok") {
        const extra = wasOwnerless ? "\n\nТы теперь владелец этого бота — никто другой войти не сможет." : "";
        await sendMessage(env, chatId, `✅ <b>Вход подтверждён.</b> Возвращайся на сайт — он уже открылся.${extra}`);
        if (wasOwnerless) await sendMessage(env, chatId, HELP);
      } else if (r === "denied") {
        await sendMessage(env, chatId, "⛔ Это личный бот. Вход только для владельца.");
      } else {
        await sendMessage(env, chatId, "⌛ Код входа устарел. Нажми «Войти через Telegram» на сайте ещё раз.");
      }
      return;
    }
    if (!isOwner) {
      await sendMessage(
        env,
        chatId,
        owner
          ? `Это личный бот LifeHelper. Твой Telegram ID: <code>${from.id}</code>`
          : "Привет! Чтобы стать владельцем, открой сайт и нажми «Войти через Telegram».",
      );
      return;
    }
    await sendMessage(env, chatId, `Привет, ${esc(from.first_name ?? "")}! 👋\n\n${HELP}`, await siteButton(env));
    return;
  }

  if (!isOwner) {
    await sendMessage(env, chatId, "⛔ Это личный бот.");
    return;
  }

  const { today } = await localToday(db);
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, "");
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "/today":
    case "/day":
      return sendCheckin(env, chatId, today);
    case "/help":
      await sendMessage(env, chatId, HELP, await siteButton(env));
      return;
    case "/stats":
      await sendMessage(env, chatId, await statsText(db), await siteButton(env));
      return;
    case "/week":
      await sendMessage(env, chatId, await weeklyText(db));
      return;
    case "/login": {
      const base = publicUrl(env, s);
      if (!base) {
        await sendMessage(env, chatId, "Я пока не знаю адрес сайта — открой его один раз в браузере.");
        return;
      }
      const code = await createMagicCode(env);
      await sendMessage(env, chatId, "🔐 Одноразовая ссылка для входа (действует 10 минут):", [[{ text: "Войти на сайт", url: `${base}/login?code=${code}` }]]);
      return;
    }
    case "/skip":
      return sendSkipPrompt(env, chatId, today);
    case "/wish": {
      if (!arg) {
        await sendMessage(env, chatId, "Напиши так: <code>/wish Наушники 3500</code>");
        return;
      }
      const m = arg.match(/^(.*?)(?:\s+(\d[\d\s]*(?:[.,]\d+)?))?$/);
      const title = (m?.[1] || arg).trim();
      const price = m?.[2] ? Number(m[2].replace(/\s/g, "").replace(",", ".")) : null;
      const row = await first<{ id: number }>(db, "INSERT INTO wishes(title, price, created_at) VALUES (?, ?, ?) RETURNING id", title.slice(0, 160), price, Date.now());
      await sendMessage(env, chatId, `🎁 В вишлисте: <b>${esc(title)}</b>${price ? ` — ${price.toLocaleString("ru-RU")} ₴` : ""}\nКупить можно не раньше, чем через ${s.wish_cooldown_days} дн. — проверим, хочется ли ещё.`, [
        [{ text: "🗑 Удалить", callback_data: `del:wish:${row!.id}` }],
      ]);
      return;
    }
    case "/note": {
      if (!arg) {
        await sendMessage(env, chatId, "Напиши так: <code>/note мысль, которую нельзя забыть</code>");
        return;
      }
      const colors = ["yellow", "pink", "green", "blue", "purple", "orange"];
      const row = await first<{ id: number }>(
        db,
        "INSERT INTO stickers(kind, text, color, x, y, rot, z, created_at) VALUES ('note', ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(z),0)+1 FROM stickers), ?) RETURNING id",
        arg.slice(0, 2000),
        colors[Math.floor(Math.random() * colors.length)],
        40 + Math.round(Math.random() * 500),
        40 + Math.round(Math.random() * 300),
        Math.round((Math.random() * 6 - 3) * 10) / 10,
        Date.now(),
      );
      await sendMessage(env, chatId, "📌 Приклеил на стену.", [[{ text: "🗑 Удалить", callback_data: `del:sticker:${row!.id}` }]]);
      return;
    }
  }

  if (cmd.startsWith("/")) {
    await sendMessage(env, chatId, HELP);
    return;
  }

  // Быстрые деньги: «-250 кофе», «+15000 зарплата»
  const money = text.match(/^([+-])\s*(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(.*)$/s);
  if (money) {
    const amount = Number(money[2].replace(/\s/g, "").replace(",", ".")) * (money[1] === "-" ? -1 : 1);
    const note = money[3].trim();
    const category = note ? note.split(/\s+/)[0].toLowerCase().replace(/^./, (c) => c.toUpperCase()).slice(0, 40) : money[1] === "-" ? "Разное" : "Доход";
    const acc = await defaultAccount(db);
    const id = await addTransaction(db, { account_id: acc.id, amount, category, note: note || null, date: today });
    const after = await first<{ balance: number }>(db, "SELECT balance FROM accounts WHERE id = ?", acc.id);
    await sendMessage(
      env,
      chatId,
      `${amount < 0 ? "💸" : "💰"} ${amount < 0 ? "Расход" : "Доход"} <b>${Math.abs(amount).toLocaleString("ru-RU")} ${acc.currency === "UAH" ? "₴" : acc.currency}</b> · ${esc(category)}\n${esc(acc.emoji ?? "")} ${esc(acc.name)}: ${Math.round(after?.balance ?? 0).toLocaleString("ru-RU")}`,
      [[{ text: "↩ Отменить", callback_data: `del:tx:${id}` }]],
    );
    return;
  }

  // Всё остальное — задача во «Входящие»
  const row = await first<{ id: number }>(db, "INSERT INTO tasks(title, source, created_at) VALUES (?, 'bot', ?) RETURNING id", text.slice(0, 300), Date.now());
  await sendMessage(env, chatId, `📥 Во «Входящих»: ${esc(text.slice(0, 300))}`, [
    [
      { text: "📅 На сегодня", callback_data: `td:${row!.id}` },
      { text: "🗑 Удалить", callback_data: `del:task:${row!.id}` },
    ],
  ]);
}

async function skipPromptText(env: Env, date: string): Promise<{ text: string; allowed: boolean }> {
  const p = await skipPreview(env.DB, date);
  if (!p.allowed) return { text: `🎟 ${esc(p.headline)}`, allowed: false };
  const lines = [`🎟 <b>Точно пропустить ${fmtDate(date)}?</b>`, "", esc(p.headline), ""];
  for (const l of p.lines) lines.push(`• ${esc(l)}`);
  for (const w of p.why) lines.push("", `💬 Ты сам писал про «${esc(w.goal)}»:\n<i>«${esc(w.text)}»</i>`);
  lines.push("", `Кнопка «Да» сработает через ${p.countdown} секунд — подумай.`);
  return { text: lines.join("\n"), allowed: true };
}

async function sendSkipPrompt(env: Env, chatId: number | string, date: string): Promise<void> {
  const { text, allowed } = await skipPromptText(env, date);
  if (!allowed) {
    await sendMessage(env, chatId, text);
    return;
  }
  await ensureDay(env.DB, date);
  await run(env.DB, "UPDATE days SET skip_requested_at = ? WHERE date = ?", Date.now(), date);
  await sendMessage(env, chatId, text, [
    [{ text: "Нет, я сделаю 💪", callback_data: `sn:${date}` }],
    [{ text: "Да, пропустить", callback_data: `sy:${date}` }],
  ]);
}

async function refreshCheckin(env: Env, chatId: number, date: string): Promise<void> {
  const day = await first<{ checkin_msg_id: number | null }>(env.DB, "SELECT checkin_msg_id FROM days WHERE date = ?", date);
  if (!day?.checkin_msg_id) return;
  const view = await checkinView(env.DB, date);
  await editMessage(env, chatId, day.checkin_msg_id, view.text, view.keyboard).catch(() => undefined);
}

async function handleCallback(env: Env, q: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const db = env.DB;
  const s = await getSettings(db);
  if (ownerId(env, s) !== String(q.from.id)) {
    await answerCallback(env, q.id, "Это личный бот", true);
    return;
  }
  const msg = q.message;
  if (!msg || !q.data) return void (await answerCallback(env, q.id));
  const chatId = msg.chat.id;
  const [op, a, b] = q.data.split(":");
  const { today } = await localToday(db);

  const rerender = async (date: string, closed = false) => {
    const view = await checkinView(db, date, closed);
    await editMessage(env, chatId, msg.message_id, view.text, view.keyboard);
    await ensureDay(db, date);
    await run(db, "UPDATE days SET checkin_msg_id = ? WHERE date = ?", msg.message_id, date);
  };

  if (["t", "m", "sk", "sy", "sn", "un", "cl", "op"].includes(op) && !isValidDate(a)) return void (await answerCallback(env, q.id));

  switch (op) {
    case "t": {
      if (a > today) return void (await answerCallback(env, q.id, "Это ещё не наступило"));
      const done = await toggleHabit(db, Number(b), a, "bot");
      await rerender(a);
      await answerCallback(env, q.id, done ? "✅ Отмечено" : "Снято");
      return;
    }
    case "m": {
      await ensureDay(db, a);
      await run(db, "UPDATE days SET mood = ? WHERE date = ?", Number(b), a);
      await rerender(a);
      await answerCallback(env, q.id, `Настроение: ${MOODS[Number(b) - 1] ?? ""}`);
      return;
    }
    case "sk": {
      await answerCallback(env, q.id);
      await ensureDay(db, a);
      await run(db, "UPDATE days SET checkin_msg_id = ? WHERE date = ?", msg.message_id, a);
      await sendSkipPrompt(env, chatId, a);
      return;
    }
    case "sy": {
      const day = await first<{ skip_requested_at: number | null }>(db, "SELECT skip_requested_at FROM days WHERE date = ?", a);
      const elapsed = Date.now() - (day?.skip_requested_at ?? 0);
      if (!day?.skip_requested_at) return void (await answerCallback(env, q.id, "Запроси пропуск заново: /skip", true));
      if (elapsed < 20000) {
        return void (await answerCallback(env, q.id, `Подожди ещё ${Math.ceil((20000 - elapsed) / 1000)} сек. Точно хочешь отложить цель?`, true));
      }
      const r = await usePass(db, a, "из Telegram");
      if (!r.ok) return void (await answerCallback(env, q.id, r.error, true));
      await run(db, "UPDATE days SET skip_requested_at = NULL WHERE date = ?", a);
      await editMessage(env, chatId, msg.message_id, "🎟 Пропуск взят. Стрик заморожен, цель подождёт один день.\n\nЗавтра — без поблажек.");
      await refreshCheckin(env, chatId, a);
      await answerCallback(env, q.id, "Пропуск использован");
      return;
    }
    case "sn": {
      await run(db, "UPDATE days SET skip_requested_at = NULL WHERE date = ?", a);
      await editMessage(env, chatId, msg.message_id, "💪 Правильное решение. Поставь таймер на 10 минут и просто начни.");
      await answerCallback(env, q.id, "Вперёд!");
      return;
    }
    case "un": {
      await undoPass(db, a);
      await rerender(a);
      await answerCallback(env, q.id, "Пропуск возвращён");
      return;
    }
    case "cl":
      await rerender(a, true);
      await answerCallback(env, q.id, "День закрыт 🌙");
      return;
    case "op":
      await rerender(a);
      await answerCallback(env, q.id);
      return;
    case "td": {
      const t = await first<{ title: string }>(db, "UPDATE tasks SET date = ? WHERE id = ? RETURNING title", today, Number(a));
      if (t) await editMessage(env, chatId, msg.message_id, `📅 На сегодня: ${esc(t.title)}`);
      await answerCallback(env, q.id, t ? "Перенёс на сегодня" : "Задача уже удалена");
      return;
    }
    case "del": {
      const id = Number(b);
      let label = "";
      if (a === "task") label = (await first<{ title: string }>(db, "DELETE FROM tasks WHERE id = ? RETURNING title", id))?.title ?? "";
      else if (a === "wish") label = (await first<{ title: string }>(db, "DELETE FROM wishes WHERE id = ? RETURNING title", id))?.title ?? "";
      else if (a === "sticker") label = (await first<{ text: string }>(db, "DELETE FROM stickers WHERE id = ? RETURNING text", id))?.text ?? "";
      else if (a === "tx") label = (await deleteTransaction(db, id)) ? "операция" : "";
      await editMessage(env, chatId, msg.message_id, label ? `🗑 Удалено: ${esc(label.slice(0, 100))}` : "Уже удалено.");
      await answerCallback(env, q.id, "Удалено");
      return;
    }
  }
  await answerCallback(env, q.id);
}

export { sendCheckin };
