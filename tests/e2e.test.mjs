// Сквозной тест: поднимает воркер (wrangler dev) с чистой базой и фейковым Telegram,
// проходит вход, привычки, стрики, пропуски, бота, расширение и крон.
// Запуск: npm run build && npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { startMockTelegram } from "./mock-telegram.mjs";

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const TG_PORT = 8797;
const TOKEN = "123:TEST";
const SECRET = createHash("sha256").update(`lifehelper-webhook:${TOKEN}`).digest("hex").slice(0, 48);
const PERSIST = ".wrangler/test-state";
const OWNER = 555;

let worker;
let tg;
let cookie = "";

const kyivToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const kyivTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

async function api(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(auth ? { cookie, "x-lh": "1" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

function update(payload) {
  return fetch(`${BASE}/tg/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify({ update_id: Date.now(), ...payload }),
  });
}
const message = (text, from = OWNER) => update({ message: { message_id: 1, from: { id: from, first_name: "Тест" }, chat: { id: from, type: "private" }, text } });
const callback = (data, from = OWNER) =>
  update({ callback_query: { id: "cb", from: { id: from }, data, message: { message_id: 42, chat: { id: from, type: "private" } } } });
const sent = (method) => tg.calls.filter((c) => c.method === method);
const lastText = () => sent("sendMessage").at(-1)?.payload.text ?? "";

before(async () => {
  if (!existsSync("web/dist/index.html")) {
    mkdirSync("web/dist", { recursive: true });
    writeFileSync("web/dist/index.html", "<!doctype html><title>test</title>");
  }
  // чистая база без миграций — таблицы должен создать сам воркер (worker/lib/schema.ts)
  rmSync(PERSIST, { recursive: true, force: true });
  tg = await startMockTelegram(TG_PORT);
  worker = spawn(
    "npx",
    [
      "wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", PERSIST, "--test-scheduled",
      "--var", `TELEGRAM_BOT_TOKEN:${TOKEN}`, "--var", `TELEGRAM_API:http://127.0.0.1:${TG_PORT}`, "--var", "DEV_LOGIN:0",
    ],
    { stdio: "ignore", detached: true },
  );
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/status`);
      if (r.ok) return;
    } catch {
      /* ещё стартует */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("wrangler dev не поднялся");
});

after(() => {
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch {
    /* уже остановлен */
  }
  tg?.close();
});

test("без входа API закрыт, dev-вход выключен", async () => {
  assert.equal((await api("/api/today", { auth: false })).status, 401);
  assert.equal((await api("/api/auth/dev", { method: "POST", body: {}, auth: false })).status, 404);
  const st = await api("/api/auth/status", { auth: false });
  assert.deepEqual(st.data, { botConfigured: true, ownerSet: false, devLogin: false });
});

test("вебхук с чужим секретом отклоняется", async () => {
  const r = await fetch(`${BASE}/tg/webhook`, { method: "POST", headers: { "x-telegram-bot-api-secret-token": "nope" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("вход через Telegram: первый вошедший становится владельцем", async () => {
  const start = await api("/api/auth/start", { method: "POST", body: { kind: "web" }, auth: false });
  assert.equal(start.status, 200);
  assert.match(start.data.url, /^https:\/\/t\.me\/test_lifehelper_bot\?start=login_/);
  assert.equal((await api(`/api/auth/poll?code=${start.data.code}`, { auth: false })).data.status, "pending");

  await message(`/start login_${start.data.code}`);
  assert.ok(sent("sendMessage").some((c) => /Вход подтверждён/.test(c.payload.text)));

  const poll = await api(`/api/auth/poll?code=${start.data.code}`, { auth: false });
  assert.equal(poll.data.status, "ok");
  cookie = poll.headers.get("set-cookie").split(";")[0];
  assert.match(cookie, /^lh_session=/);
  // код одноразовый
  assert.equal((await api(`/api/auth/poll?code=${start.data.code}`, { auth: false })).data.status, "expired");

  const me = await api("/api/me");
  assert.equal(me.data.ownerId, String(OWNER));
});

test("чужой Telegram-аккаунт войти не может", async () => {
  const start = await api("/api/auth/start", { method: "POST", body: { kind: "web" }, auth: false });
  await message(`/start login_${start.data.code}`, 777);
  assert.match(lastText(), /личный бот/);
  assert.equal((await api(`/api/auth/poll?code=${start.data.code}`, { auth: false })).data.status, "denied");
  await message("-100 взлом", 777);
  assert.equal((await api("/api/money")).data.transactions.length, 0);
});

test("CSRF: изменение без заголовка x-lh отклоняется", async () => {
  const r = await fetch(`${BASE}/api/tasks`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: '{"title":"x"}' });
  assert.equal(r.status, 403);
});

let mathId;
let readId;
const today = kyivToday();

test("цель + привычки, стрик считается по истории", async () => {
  const goal = await api("/api/goals", {
    method: "POST",
    body: { title: "Выучить математику", emoji: "📐", why: "Хочу поступить на CS", start_date: addDays(today, -5), deadline: addDays(today, 60) },
  });
  mathId = (
    await api("/api/habits", {
      method: "POST",
      body: { title: "Математика", type: "minutes", target_minutes: 60, goal_id: goal.data.id, start_date: addDays(today, -5), start_url: "khanacademy.org" },
    })
  ).data.id;
  readId = (await api("/api/habits", { method: "POST", body: { title: "Чтение", type: "check", blocking: false, start_date: addDays(today, -5) } })).data.id;

  // 3 последних дня всё сделано, 4 дня назад — провал
  for (let i = 1; i <= 3; i++) {
    await api(`/api/habits/${mathId}/minutes`, { method: "POST", body: { date: addDays(today, -i), add: 60 } });
    await api(`/api/habits/${readId}/toggle`, { method: "POST", body: { date: addDays(today, -i) } });
  }
  let t = await api("/api/today");
  assert.equal(t.data.total, 2);
  assert.equal(t.data.streak.current, 3);

  // сегодня всё сделано → +1
  await api(`/api/habits/${mathId}/minutes`, { method: "POST", body: { add: 60 } });
  await api(`/api/habits/${readId}/toggle`, { method: "POST", body: {} });
  t = await api("/api/today");
  assert.equal(t.data.done, 2);
  assert.equal(t.data.streak.current, 4);

  // нельзя отметить будущее
  assert.equal((await api(`/api/habits/${readId}/toggle`, { method: "POST", body: { date: addDays(today, 1) } })).status, 400);

  // правка прошлого дня пересчитывает стрик
  await api(`/api/habits/${readId}/toggle`, { method: "POST", body: { date: addDays(today, -2) } });
  t = await api("/api/today");
  assert.equal(t.data.streak.current, 2);
  await api(`/api/habits/${readId}/toggle`, { method: "POST", body: { date: addDays(today, -2) } });

  const g = t.data.goals[0];
  assert.equal(g.mode, "minutes");
  assert.ok(g.progress > 0 && g.progress < 1);
});

test("пропуск: осмысленный текст, лимит в неделю, стрик не сгорает", async () => {
  // снимаем сегодняшнее, чтобы было что пропускать
  await api(`/api/habits/${readId}/toggle`, { method: "POST", body: { done: false } });
  await api(`/api/habits/${mathId}/toggle`, { method: "POST", body: { done: false } });

  const p = await api(`/api/days/${today}/skip-preview`);
  assert.equal(p.data.allowed, true);
  assert.equal(p.data.countdown, 20);
  assert.ok(p.data.lines.length >= 2);
  assert.equal(p.data.why[0].text, "Хочу поступить на CS");

  assert.equal((await api(`/api/days/${today}/pass`, { method: "POST", body: { reason: "тест" } })).status, 200);
  let t = await api("/api/today");
  assert.equal(t.data.pass.usedToday, true);
  assert.equal(t.data.pass.left, 0);
  assert.equal(t.data.streak.current, 3, "пропуск замораживает, а не сжигает стрик");

  // второй пропуск на этой неделе — нельзя (если сегодня понедельник, вчера — уже другая неделя)
  const isMonday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  const yesterdayPass = await api(`/api/days/${addDays(today, -1)}/pass`, { method: "POST", body: {} });
  if (isMonday) await api(`/api/days/${addDays(today, -1)}/pass`, { method: "DELETE" });
  else assert.equal(yesterdayPass.status, 400);
  assert.equal((await api(`/api/days/${today}/pass`, { method: "POST", body: {} })).status, 400, "дважды в один день нельзя");

  await api(`/api/days/${today}/pass`, { method: "DELETE" });
  t = await api("/api/today");
  assert.equal(t.data.pass.usedToday, false);
});

test("бот: чек-лист с галочками и защита «Да» 20 секундами", async () => {
  tg.calls.length = 0;
  await message("/today");
  const kb = sent("sendMessage").at(-1).payload.reply_markup.inline_keyboard;
  assert.ok(kb.flat().some((b) => b.callback_data === `t:${today}:${readId}`));

  await callback(`t:${today}:${readId}`);
  assert.equal((await api("/api/today")).data.habits.find((h) => h.id === readId).done, true);
  assert.match(sent("editMessageText").at(-1).payload.text, /✅ Чтение/);

  await callback(`m:${today}:4`);
  assert.equal((await api("/api/today")).data.mood, 4);

  await callback(`sk:${today}`);
  assert.match(lastText(), /Точно пропустить/);
  tg.calls.length = 0;
  await callback(`sy:${today}`);
  const alert = sent("answerCallbackQuery").at(-1).payload;
  assert.equal(alert.show_alert, true);
  assert.match(alert.text, /Подожди ещё/);
  assert.equal((await api("/api/today")).data.pass.usedToday, false);
  await callback(`sn:${today}`);
});

test("бот: быстрые траты, задачи, вишлист, стикеры", async () => {
  await message("-250 кофе с другом");
  await message("+1000 подработка");
  const m = await api("/api/money");
  assert.equal(m.data.total, 750);
  assert.equal(m.data.transactions.length, 2);

  await message("Позвонить маме");
  const inbox = await api("/api/tasks?view=inbox");
  assert.equal(inbox.data[0].title, "Позвонить маме");

  await message("/wish Наушники Sony 3 500");
  const w = await api("/api/wishes");
  assert.equal(w.data.items[0].title, "Наушники Sony");
  assert.equal(w.data.items[0].price, 3500);
  assert.equal(w.data.items[0].cooldown_left, 7);

  await message("/note Не забыть про дедлайн");
  const note = (await api("/api/stickers")).data[0];
  assert.equal(note.text, "Не забыть про дедлайн");
  assert.equal(note.pinned, 0);
  // закрепить на «Сегодня» (миграция 0002 применена самим воркером)
  await api(`/api/stickers/${note.id}`, { method: "PUT", body: { pinned: true, color: "pink" } });
  const pinned = (await api("/api/stickers")).data[0];
  assert.equal(pinned.pinned, 1);
  assert.equal(pinned.color, "pink");
});

test("расширение: токен, блокировка, учёт времени и отвлечений", async () => {
  const { data } = await api("/api/tokens", { method: "POST", body: { label: "test" } });
  const ext = (path, body) =>
    fetch(BASE + path, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${data.token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

  let st = await ext("/api/ext/state");
  const math = st.habits.find((h) => h.id === mathId);
  assert.equal(math.done, false);
  assert.ok(st.blocklist.includes("youtube.com"));

  st = await ext("/api/ext/heartbeat", {
    sessions: [{ id: "s-1", habitId: mathId, seconds: 1800, clicks: 10, keys: 50, scrolls: 5 }],
    sites: { "www.youtube.com": 300 },
  });
  assert.equal(st.habits.find((h) => h.id === mathId).minutes, 90); // 60 ранее + 30
  assert.equal(st.habits.find((h) => h.id === mathId).done, true, "норма набрана — отмечено само");
  assert.deepEqual(st.completed, [{ id: mathId, title: "Математика" }]);
  assert.deepEqual(st.sites, [{ domain: "youtube.com", seconds: 300 }]);
  assert.equal(st.block.active, false, "всё блокирующее сделано — блок снят");

  const bad = await fetch(`${BASE}/api/ext/state`, { headers: { authorization: "Bearer wrong" } });
  assert.equal(bad.status, 401);
});

test("крон: вечерний чек-лист уходит ровно один раз", async () => {
  const now = kyivTime();
  await api("/api/settings", { method: "PUT", body: { evening_time: now, morning_enabled: false, reminder_enabled: false } });
  tg.calls.length = 0;
  await fetch(`${BASE}/__scheduled?cron=*+*+*+*+*`);
  await new Promise((r) => setTimeout(r, 1500));
  await fetch(`${BASE}/__scheduled?cron=*+*+*+*+*`);
  await new Promise((r) => setTimeout(r, 1500));
  const checkins = sent("sendMessage").filter((c) => /Итоги дня/.test(c.payload.text));
  assert.equal(checkins.length, 1);
  assert.equal(String(checkins[0].payload.chat_id), String(OWNER));
});

test("экспорт отдаёт все данные", async () => {
  const r = await api("/api/export");
  assert.equal(r.status, 200);
  assert.ok(r.data.habits.length === 2 && r.data.goals.length === 1);
  assert.ok(!("sessions" in r.data), "секреты сессий не экспортируются");
});
