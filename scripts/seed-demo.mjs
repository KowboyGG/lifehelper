// Заполняет ЛОКАЛЬНУЮ базу демо-данными, чтобы посмотреть интерфейс.
// Запуск: npm run db:migrate:local && node scripts/seed-demo.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
const add = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const wd = (d) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = Date.now();
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const sql = [];
const ins = (table, row) => sql.push(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(q).join(",")});`);

for (const t of ["habit_logs", "habits", "goals", "days", "tasks", "focus_sessions", "site_time", "transactions", "accounts", "wishes", "stickers"]) sql.push(`DELETE FROM ${t};`);
sql.push("DELETE FROM settings WHERE key = 'streak_cache';");

const start = add(today, -75);
ins("goals", { id: 1, title: "Выучить математику", emoji: "📐", why: "Хочу поступить на CS и перестать бояться формул. Через год я хочу решать задачи, а не пролистывать их.", start_date: add(today, -60), deadline: "2026-12-31", sort: 1, created_at: now });
ins("goals", { id: 2, title: "Прочитать 12 книг", emoji: "📚", why: "Меньше ленты — больше мыслей.", start_date: "2026-01-01", deadline: "2026-12-31", target_value: 12, current_value: 7, unit: "книг", sort: 2, created_at: now });
ins("goals", { id: 3, title: "Подушка безопасности", emoji: "🛟", why: "Спокойствие, если что-то пойдёт не так.", start_date: "2026-06-01", deadline: "2027-03-01", target_value: 60000, current_value: 21500, unit: "₴", sort: 3, created_at: now });

const habits = [
  { id: 1, goal_id: 1, title: "Математика", emoji: "📐", type: "minutes", target_minutes: 60, days: "1111111", start_url: "https://www.khanacademy.org/math", focus_sites: '["khanacademy.org","youtube.com/@3blue1brown"]', blocking: 1, start_date: add(today, -60), p: 0.8 },
  { id: 2, goal_id: null, title: "Английский", emoji: "🇬🇧", type: "minutes", target_minutes: 20, days: "1111100", start_url: "https://www.duolingo.com", focus_sites: '["duolingo.com"]', blocking: 1, start_date: start, p: 0.85 },
  { id: 3, goal_id: null, title: "Чтение перед сном", emoji: "🌙", type: "check", target_minutes: null, days: "1111111", start_url: null, focus_sites: "[]", blocking: 0, start_date: start, p: 0.7 },
  { id: 4, goal_id: null, title: "Спорт", emoji: "💪", type: "check", target_minutes: null, days: "1010100", start_url: null, focus_sites: "[]", blocking: 0, start_date: start, p: 0.75 },
];
habits.forEach((h, i) => {
  const { p, ...row } = h;
  ins("habits", { ...row, sort: i + 1, created_at: now });
});

const passDay = add(today, -12);
for (let d = start; d < today; d = add(d, 1)) {
  const recent = d >= add(today, -9); // последние 9 дней — идеальные
  const isPass = d === passDay;
  for (const h of habits) {
    if (d < h.start_date || h.days[wd(d)] !== "1") continue;
    let done = recent || (!isPass && rnd() < h.p);
    if (isPass && h.id === 1) done = false;
    let minutes = 0;
    if (h.type === "minutes") minutes = done ? h.target_minutes + Math.round(rnd() * 25) : Math.round(rnd() * h.target_minutes * 0.6);
    if (done || minutes) ins("habit_logs", { habit_id: h.id, date: d, done: done ? 1 : 0, minutes, source: "seed", updated_at: now });
  }
  const mood = rnd() < 0.8 ? 2 + Math.floor(rnd() * 4) : null;
  ins("days", { date: d, pass_used: isPass ? 1 : 0, pass_reason: isPass ? "Температура 38" : null, mood, note: rnd() < 0.15 ? "Сложная тема, но разобрался." : null, morning_sent: 1, evening_sent: 1, reminder_sent: 1 });
  if (d >= add(today, -13)) {
    ins("site_time", { date: d, domain: "youtube.com", seconds: Math.round(1200 + rnd() * 4200) });
    ins("site_time", { date: d, domain: "tiktok.com", seconds: Math.round(300 + rnd() * 2400) });
    if (rnd() < 0.5) ins("site_time", { date: d, domain: "instagram.com", seconds: Math.round(200 + rnd() * 1200) });
    ins("focus_sessions", { id: `seed-${d}`, habit_id: 1, date: d, started_at: now, updated_at: now, seconds: 3600, clicks: 300, keys: 900, scrolls: 120, source: "ext" });
  }
}
// сегодня: математика наполовину, английский сделан
ins("habit_logs", { habit_id: 1, date: today, done: 0, minutes: 25, source: "seed", updated_at: now });
if (wd(today) < 5) ins("habit_logs", { habit_id: 2, date: today, done: 1, minutes: 22, source: "seed", updated_at: now });
ins("site_time", { date: today, domain: "youtube.com", seconds: 2460 });
ins("site_time", { date: today, domain: "tiktok.com", seconds: 780 });
ins("focus_sessions", { id: "seed-today", habit_id: 1, date: today, started_at: now, updated_at: now, seconds: 1500, clicks: 140, keys: 410, scrolls: 60, source: "ext" });

const tasks = [
  ["Записаться к стоматологу", today, null],
  ["Разобрать тему «Производные»", today, 1],
  ["Оплатить интернет", add(today, -1), null],
  ["Купить подарок маме", add(today, 3), null],
  ["Сдать пробный тест", add(today, 6), 1],
  ["Идея: сделать свой сайт-портфолио", null, null],
  ["Посмотреть курс по алгоритмам", null, 1],
];
tasks.forEach(([title, date, goal], i) => ins("tasks", { title, date, goal_id: goal, priority: i === 1 ? 2 : 0, source: i > 4 ? "bot" : "web", created_at: now - i * 1000 }));
ins("tasks", { title: "Выбросить старые конспекты", date: add(today, -2), done_at: now - 86400000, created_at: now });

ins("accounts", { id: 1, name: "Монобанк", emoji: "🐈‍⬛", currency: "UAH", balance: 14750, sort: 1, created_at: now });
ins("accounts", { id: 2, name: "Наличные", emoji: "💵", currency: "UAH", balance: 2300, sort: 2, created_at: now });
ins("accounts", { id: 3, name: "Копилка $", emoji: "🛟", currency: "USD", balance: 520, sort: 3, created_at: now });
const cats = [["Еда", 180, 650], ["Кафе", 90, 320], ["Транспорт", 30, 120], ["Подписки", 99, 299], ["Развлечения", 150, 700], ["Одежда", 600, 2200]];
for (let d = add(today, -110); d <= today; d = add(d, 1)) {
  if (d.endsWith("-05")) ins("transactions", { account_id: 1, amount: 18000, category: "Зарплата", note: null, date: d, created_at: now });
  if (rnd() < 0.6) {
    const [c, a, b] = cats[Math.floor(rnd() * (rnd() < 0.9 ? 4 : cats.length))];
    ins("transactions", { account_id: rnd() < 0.8 ? 1 : 2, amount: -Math.round(a + rnd() * (b - a)), category: c, note: null, date: d, created_at: now });
  }
}

ins("wishes", { id: 1, title: "Наушники Sony WH-1000XM5", emoji: "🎧", price: 12999, currency: "UAH", url: "https://rozetka.com.ua", priority: 2, created_at: now - 10 * 86400000 });
ins("wishes", { id: 2, title: "Графический планшет", emoji: "✍️", price: 3200, currency: "UAH", priority: 1, note: "Для конспектов по математике", created_at: now - 2 * 86400000 });
ins("wishes", { id: 3, title: "Поездка во Львов", emoji: "🚆", price: 150, currency: "USD", priority: 1, created_at: now - 20 * 86400000 });
ins("wishes", { id: 4, title: "Кроссовки для бега", emoji: "👟", price: 3500, currency: "UAH", priority: 0, status: "bought", bought_at: now, created_at: now - 40 * 86400000 });

ins("stickers", { kind: "goal", ref_id: 1, color: "yellow", x: 60, y: 60, rot: -2, z: 1, created_at: now });
ins("stickers", { kind: "countdown", text: "НМТ по математике", date: "2027-05-20", color: "blue", x: 330, y: 90, rot: 2.5, z: 2, created_at: now });
ins("stickers", { kind: "note", text: "Не жди мотивации.\nСядь на 10 минут — дальше пойдёт.", color: "pink", x: 600, y: 50, rot: -1.5, z: 3, created_at: now });
ins("stickers", { kind: "streak", color: "orange", x: 110, y: 330, rot: 1.5, z: 4, created_at: now });
ins("stickers", { kind: "wish", ref_id: 1, color: "purple", x: 400, y: 360, rot: -3, z: 5, created_at: now });
ins("stickers", { kind: "money", color: "green", x: 680, y: 330, rot: 2, z: 6, created_at: now });
ins("stickers", { kind: "note", text: "Книги: «Атомные привычки», «Думай медленно»", color: "white", x: 900, y: 120, rot: 3, z: 7, created_at: now });

mkdirSync(".wrangler", { recursive: true });
writeFileSync(".wrangler/seed.sql", sql.join("\n"));
execFileSync("npx", ["wrangler", "d1", "execute", "lifehelper", "--local", "--file", ".wrangler/seed.sql"], { stdio: "inherit" });
console.log(`\n✓ Демо-данные загружены (сегодня ${today}). Запусти npm run dev и открой http://localhost:5173`);
