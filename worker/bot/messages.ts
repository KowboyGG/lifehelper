// Тексты и клавиатуры бота
import { all, first, type DayRow, type TaskRow } from "../lib/db";
import { getStreak, habitsForDay, loadGoals, loadHistory, localToday, passInfo, summarizeDay, summaryOf, type HabitDay } from "../lib/progress";
import { addDays, fmtDate, fmtMinutes, plural, weekStart } from "../lib/time";
import { moneySummary } from "../api/life";
import { esc, type Keyboard } from "./telegram";

export const MOODS = ["😣", "😕", "😐", "🙂", "🤩"];

const QUOTES = [
  "Мотивация приходит и уходит. Привычка остаётся.",
  "Маленький шаг каждый день сильнее рывка раз в месяц.",
  "Не разрывай цепочку.",
  "Ты не обязан хотеть. Ты обязан начать — дальше пойдёт.",
  "Дисциплина — это помнить, чего ты хочешь.",
  "Лучше 20 минут сегодня, чем идеальный час «когда-нибудь».",
  "Через год ты скажешь себе спасибо за сегодняшний вечер.",
  "Сравнивай себя только с собой вчерашним.",
  "Сложно — значит, растёшь.",
  "Скучные повторения и есть магия.",
];

export function quoteOfDay(date: string): string {
  const n = [...date].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return QUOTES[n % QUOTES.length];
}

function habitLabel(h: HabitDay): string {
  const name = `${h.emoji ? h.emoji + " " : ""}${h.title}`;
  if (h.type === "minutes") return `${name} — ${Math.round(h.minutes)}/${h.target_minutes} мин`;
  return name;
}

function bar(done: number, total: number): string {
  if (!total) return "";
  const n = 10;
  const full = Math.round((done / total) * n);
  return "▰".repeat(full) + "▱".repeat(n - full);
}

export async function checkinView(db: D1Database, date: string, closed = false): Promise<{ text: string; keyboard: Keyboard }> {
  const { s, today } = await localToday(db);
  const [habits, pass, day] = await Promise.all([
    habitsForDay(db, date),
    passInfo(db, s, date),
    first<DayRow>(db, "SELECT * FROM days WHERE date = ?", date),
  ]);
  const todayHabits = date === today ? habits : await habitsForDay(db, today);
  const todayPass = date === today ? pass.usedToday : (await passInfo(db, s, today)).usedToday;
  const streak = await getStreak(db, s, today, summaryOf(today, todayHabits, todayPass));
  const done = habits.filter((h) => h.done).length;

  const lines: string[] = [`🌙 <b>Итоги дня</b> · ${fmtDate(date, true)}`, ""];
  if (!habits.length) lines.push("На этот день ничего не запланировано.");
  for (const h of habits) lines.push(`${h.done ? "✅" : "⬜"} ${esc(habitLabel(h))}`);
  if (habits.length) lines.push("", `${bar(done, habits.length)}  <b>${done}/${habits.length}</b>`);
  lines.push(`🔥 Стрик: <b>${streak.current}</b>${streak.best > streak.current ? ` · рекорд ${streak.best}` : streak.current > 1 ? " · это рекорд!" : ""}`);
  if (pass.usedToday) lines.push("🎟 День взят как пропуск — стрик заморожен.");
  if (day?.mood) lines.push(`Настроение: ${MOODS[day.mood - 1]}`);

  const keyboard: Keyboard = [];
  if (closed) {
    lines.push("", `<i>${esc(quoteOfDay(date))}</i>`);
    keyboard.push([{ text: "✏️ Изменить", callback_data: `op:${date}` }]);
    return { text: lines.join("\n"), keyboard };
  }

  if (habits.length) lines.push("", "Отметь, что сделал 👇");
  for (const h of habits) keyboard.push([{ text: `${h.done ? "✅" : "⬜"} ${habitLabel(h)}`.slice(0, 60), callback_data: `t:${date}:${h.id}` }]);
  keyboard.push(MOODS.map((m, i) => ({ text: day?.mood === i + 1 ? `[${m}]` : m, callback_data: `m:${date}:${i + 1}` })));
  const last = [];
  if (pass.usedToday) last.push({ text: "↩ Отменить пропуск", callback_data: `un:${date}` });
  else if (done < habits.length && pass.left > 0) last.push({ text: `🎟 Пропуск (${pass.left})`, callback_data: `sk:${date}` });
  last.push({ text: "✔ Готово", callback_data: `cl:${date}` });
  keyboard.push(last);
  return { text: lines.join("\n"), keyboard };
}

export async function morningText(db: D1Database): Promise<string> {
  const { s, today } = await localToday(db);
  const habits = await habitsForDay(db, today);
  const pass = await passInfo(db, s, today);
  const streak = await getStreak(db, s, today, summaryOf(today, habits, pass.usedToday));
  const tasks = await all<TaskRow>(db, "SELECT * FROM tasks WHERE done_at IS NULL AND date <= ? ORDER BY date, time LIMIT 8", today);
  const hist = await loadHistory(db);
  const goals = (await loadGoals(db, hist, today)).filter((g) => g.deadline).sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1));

  const lines = [`☀️ <b>Доброе утро!</b> Сегодня ${fmtDate(today, true)}.`, ""];
  if (habits.length) {
    lines.push("<b>План на день:</b>");
    for (const h of habits) lines.push(`• ${esc(`${h.emoji ? h.emoji + " " : ""}${h.title}`)}${h.type === "minutes" ? ` — ${fmtMinutes(h.target_minutes ?? 0)}` : ""}`);
  } else lines.push("Привычек на сегодня нет — свободный день.");
  if (tasks.length) {
    lines.push("", "<b>Задачи:</b>");
    for (const t of tasks) lines.push(`• ${esc(t.title)}${t.date && t.date < today ? " <i>(просрочено)</i>" : t.time ? ` — ${t.time}` : ""}`);
  }
  lines.push("", `🔥 Стрик: ${streak.current} · 🎟 пропусков на неделе: ${pass.left}`);
  for (const g of goals.slice(0, 2)) {
    const pct = g.progress !== null ? ` · ${Math.round(g.progress * 100)}%` : "";
    lines.push(`🎯 ${esc(g.title)}: ${g.days_left} ${plural(g.days_left ?? 0, "день", "дня", "дней")} до дедлайна${pct}`);
  }
  lines.push("", `<i>${esc(quoteOfDay(today))}</i>`);
  return lines.join("\n");
}

export async function reminderText(db: D1Database): Promise<string | null> {
  const { s, today, minutes } = await localToday(db);
  const pass = await passInfo(db, s, today);
  if (pass.usedToday) return null;
  const pending = (await habitsForDay(db, today)).filter((h) => !h.done);
  if (!pending.length) return null;
  const left = 24 * 60 - minutes;
  const lines = [`⏰ <b>Ещё не сделано</b> — до конца дня ${fmtMinutes(left)}:`, ""];
  for (const h of pending) {
    const rest = h.type === "minutes" ? ` — осталось ${fmtMinutes(Math.max(0, (h.target_minutes ?? 0) - h.minutes))}` : "";
    lines.push(`• ${esc(`${h.emoji ? h.emoji + " " : ""}${h.title}`)}${rest}`);
  }
  lines.push("", "Начни с 10 минут. Дальше само пойдёт.");
  return lines.join("\n");
}

export async function weeklyText(db: D1Database): Promise<string> {
  const { s, today } = await localToday(db);
  const ws = weekStart(today);
  const hist = await loadHistory(db);
  let done = 0;
  let total = 0;
  let passes = 0;
  let perfect = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const sum = summarizeDay(hist, d);
    if (sum.pass) passes++;
    done += sum.done;
    total += sum.total;
    if (sum.total && sum.done >= sum.total) perfect++;
  }
  const minutes = new Map<number, number>();
  for (const [k, log] of hist.logs) {
    if (log.date < ws || log.date > today) continue;
    const id = Number(k.split("|")[0]);
    minutes.set(id, (minutes.get(id) ?? 0) + log.minutes);
  }
  const sites = await all<{ domain: string; seconds: number }>(
    db,
    "SELECT domain, SUM(seconds) AS seconds FROM site_time WHERE date BETWEEN ? AND ? GROUP BY domain ORDER BY seconds DESC LIMIT 3",
    ws,
    today,
  );
  const money = await moneySummary(db, s, today.slice(0, 7));
  const weekSpend = await first<{ v: number }>(db, "SELECT COALESCE(-SUM(amount),0) AS v FROM transactions WHERE amount < 0 AND category IS NOT 'Перевод' AND date BETWEEN ? AND ?", ws, today);
  const streak = await getStreak(db, s, today, summarizeDay(hist, today));

  const lines = [`📊 <b>Итоги недели</b> · ${fmtDate(ws)} — ${fmtDate(today)}`, ""];
  lines.push(`Выполнено: <b>${done}/${total}</b>${total ? ` (${Math.round((done / total) * 100)}%)` : ""} · идеальных дней: ${perfect}`);
  if (passes) lines.push(`Пропусков: ${passes}`);
  for (const h of hist.habits) {
    const m = minutes.get(h.id);
    if (m && m >= 1) lines.push(`⏱ ${esc(h.title)}: ${fmtMinutes(m)}`);
  }
  if (sites.length) lines.push(`📵 Отвлечения: ${sites.map((x) => `${esc(x.domain)} ${fmtMinutes(x.seconds / 60)}`).join(", ")}`);
  if (weekSpend?.v) lines.push(`💸 Потрачено за неделю: ${Math.round(weekSpend.v).toLocaleString("ru-RU")} ₴ (за месяц ${Math.round(money.month.expense).toLocaleString("ru-RU")})`);
  lines.push(`🔥 Стрик: ${streak.current} · рекорд ${streak.best}`);
  lines.push("", total && done / total >= 0.8 ? "Сильная неделя. Так держать 💪" : "Новая неделя — новый шанс. Начни с самого маленького шага.");
  return lines.join("\n");
}

export async function statsText(db: D1Database): Promise<string> {
  const { s, today } = await localToday(db);
  const hist = await loadHistory(db);
  const streak = await getStreak(db, s, today, summarizeDay(hist, today));
  const goals = await loadGoals(db, hist, today);
  const lines = [`🔥 Стрик: <b>${streak.current}</b> · рекорд ${streak.best}`, ""];
  let done = 0;
  let total = 0;
  for (let i = 1; i <= 7; i++) {
    const sum = summarizeDay(hist, addDays(today, -i));
    done += sum.done;
    total += sum.total;
  }
  if (total) lines.push(`За 7 дней: ${done}/${total} (${Math.round((done / total) * 100)}%)`);
  if (goals.length) lines.push("", "<b>Цели:</b>");
  for (const g of goals) {
    const pct = g.progress !== null ? `${Math.round(g.progress * 100)}%` : "—";
    let pace = "";
    if (g.required_factor !== null) pace = g.required_factor <= 1.001 ? " · идёшь по плану" : ` · нужно +${Math.round((g.required_factor - 1) * 100)}% к норме`;
    lines.push(`${g.emoji ?? "🎯"} ${esc(g.title)} — ${pct}${g.deadline ? `, до ${fmtDate(g.deadline)}` : ""}${pace}`);
  }
  return lines.join("\n");
}
