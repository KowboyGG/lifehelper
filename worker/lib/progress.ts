// Ядро: расписание привычек, стрики, пропуски, прогресс целей, текст «а ты уверен?»
import { all, first, run, type GoalRow, type HabitRow, type LogRow, type TaskRow } from "./db";
import { getSettings, parseList, setSettings, type Settings } from "./settings";
import { addDays, diffDays, eachDay, fmtDate, fmtMinutes, nowInTz, plural, timeToMinutes, weekStart, weekday } from "./time";

export function isScheduled(h: HabitRow, date: string): boolean {
  if (date < h.start_date) return false;
  if (h.archived_at && date >= h.archived_at) return false;
  return h.days[weekday(date)] === "1";
}

/** Сколько минут засчитывается в цель: отмеченная вручную привычка = не меньше нормы */
export function credit(h: HabitRow, log: LogRow | undefined): number {
  if (!log) return 0;
  if (h.type !== "minutes") return log.done ? 1 : 0;
  return log.done ? Math.max(log.minutes, h.target_minutes ?? 0) : log.minutes;
}

// ---------------------------------------------------------------- история

export interface History {
  habits: HabitRow[];
  logs: Map<string, LogRow>;
  passes: Set<string>;
  earliest: string | null;
}

const key = (id: number, date: string) => `${id}|${date}`;

export async function loadHistory(db: D1Database, from = "0000-00-00"): Promise<History> {
  const [habits, logs, passes] = await Promise.all([
    all<HabitRow>(db, "SELECT * FROM habits ORDER BY sort, id"),
    all<LogRow>(db, "SELECT habit_id, date, done, minutes FROM habit_logs WHERE date >= ?", from),
    all<{ date: string }>(db, "SELECT date FROM days WHERE pass_used = 1 AND date >= ?", from),
  ]);
  const map = new Map<string, LogRow>();
  for (const l of logs) map.set(key(l.habit_id, l.date), l);
  const earliest = habits.reduce<string | null>((m, h) => (!m || h.start_date < m ? h.start_date : m), null);
  return { habits, logs: map, passes: new Set(passes.map((p) => p.date)), earliest };
}

export function logOf(hist: History, id: number, date: string): LogRow | undefined {
  return hist.logs.get(key(id, date));
}

export interface DaySummary {
  date: string;
  total: number;
  done: number;
  pass: boolean;
}

export function summarizeDay(hist: History, date: string): DaySummary {
  let total = 0;
  let done = 0;
  for (const h of hist.habits) {
    if (!isScheduled(h, date)) continue;
    total++;
    if (logOf(hist, h.id, date)?.done) done++;
  }
  return { date, total, done, pass: hist.passes.has(date) };
}

type Outcome = "success" | "fail" | "neutral";

function outcome(d: DaySummary, isToday: boolean): Outcome {
  if (d.total === 0) return "neutral";
  if (d.done >= d.total) return "success";
  if (d.pass || isToday) return "neutral"; // пропуск замораживает стрик, сегодня ещё не вечер
  return "fail";
}

/** Стрик, заканчивающийся вчера, и рекорд за всю историю */
export function computeStreakBase(hist: History, today: string): { base: number; best: number } {
  if (!hist.earliest) return { base: 0, best: 0 };
  let base = 0;
  for (let d = addDays(today, -1); d >= hist.earliest; d = addDays(d, -1)) {
    const o = outcome(summarizeDay(hist, d), false);
    if (o === "fail") break;
    if (o === "success") base++;
  }
  let run = 0;
  let best = 0;
  for (const d of eachDay(hist.earliest, addDays(today, -1))) {
    const o = outcome(summarizeDay(hist, d), false);
    if (o === "fail") run = 0;
    else if (o === "success") best = Math.max(best, ++run);
  }
  return { base, best };
}

export function habitStreak(hist: History, h: HabitRow, today: string): number {
  let n = logOf(hist, h.id, today)?.done ? 1 : 0;
  for (let d = addDays(today, -1); d >= h.start_date; d = addDays(d, -1)) {
    if (!isScheduled(h, d)) continue;
    if (logOf(hist, h.id, d)?.done) n++;
    else if (!hist.passes.has(d)) break;
  }
  return n;
}

/** Кэшируем стрик «до вчера», чтобы расширение не читало всю историю каждые 2 минуты */
export async function getStreak(db: D1Database, s: Settings, today: string, todayDone: DaySummary): Promise<{ current: number; best: number }> {
  let cache: { date: string; base: number; best: number } | null = null;
  try {
    cache = s.streak_cache ? JSON.parse(s.streak_cache) : null;
  } catch {
    cache = null;
  }
  if (!cache || cache.date !== today) {
    const hist = await loadHistory(db);
    const { base, best } = computeStreakBase(hist, today);
    cache = { date: today, base, best };
    await setSettings(db, { streak_cache: JSON.stringify(cache) });
  }
  const current = cache.base + (outcome(todayDone, true) === "success" ? 1 : 0);
  return { current, best: Math.max(cache.best, current) };
}

export async function invalidateStreak(db: D1Database): Promise<void> {
  await run(db, "DELETE FROM settings WHERE key = 'streak_cache'");
}

// ---------------------------------------------------------------- пропуски

export interface PassInfo {
  weekly: number;
  used: number;
  left: number;
  usedToday: boolean;
  reason: string | null;
}

export async function passInfo(db: D1Database, s: Settings, date: string): Promise<PassInfo> {
  const ws = weekStart(date);
  const rows = await all<{ date: string; pass_reason: string | null }>(
    db,
    "SELECT date, pass_reason FROM days WHERE pass_used = 1 AND date BETWEEN ? AND ?",
    ws,
    addDays(ws, 6),
  );
  const weekly = Math.max(0, Number(s.weekly_passes) || 0);
  const today = rows.find((r) => r.date === date);
  return {
    weekly,
    used: rows.length,
    left: Math.max(0, weekly - rows.length),
    usedToday: !!today,
    reason: today?.pass_reason ?? null,
  };
}

// ---------------------------------------------------------------- цели

export interface GoalView extends GoalRow {
  mode: "value" | "minutes" | "days" | "tasks" | "none";
  progress: number | null;
  done_amount: number;
  planned_total: number | null;
  expected: number | null;
  diff: number | null;
  days_left: number | null;
  required_factor: number | null;
  required_per_day: number | null;
  projected_finish: string | null;
  habits: { id: number; title: string; emoji: string | null; type: string; target_minutes: number | null }[];
  tasks_done: number;
  tasks_total: number;
}

export function computeGoal(g: GoalRow, hist: History, taskStats: { done: number; total: number }, today: string): GoalView {
  const linked = hist.habits.filter((h) => h.goal_id === g.id);
  const view: GoalView = {
    ...g,
    mode: "none",
    progress: null,
    done_amount: 0,
    planned_total: null,
    expected: null,
    diff: null,
    days_left: g.deadline ? Math.max(0, diffDays(today, g.deadline)) : null,
    required_factor: null,
    required_per_day: null,
    projected_finish: null,
    habits: linked.map((h) => ({ id: h.id, title: h.title, emoji: h.emoji, type: h.type, target_minutes: h.target_minutes })),
    tasks_done: taskStats.done,
    tasks_total: taskStats.total,
  };

  if (g.target_value && g.target_value > 0) {
    view.mode = "value";
    view.done_amount = g.current_value;
    view.planned_total = g.target_value;
    view.progress = Math.min(1, g.current_value / g.target_value);
    if (g.deadline) {
      const span = Math.max(1, diffDays(g.start_date, g.deadline));
      const elapsed = Math.min(span, Math.max(0, diffDays(g.start_date, today)));
      view.expected = (g.target_value * elapsed) / span;
      view.diff = g.current_value - view.expected;
      const left = Math.max(1, diffDays(today, g.deadline));
      view.required_per_day = Math.max(0, (g.target_value - g.current_value) / left);
    }
    return view;
  }

  const minuteHabits = linked.filter((h) => h.type === "minutes" && (h.target_minutes ?? 0) > 0);
  const tracked = minuteHabits.length ? minuteHabits : linked;
  if (tracked.length) {
    view.mode = minuteHabits.length ? "minutes" : "days";
    const unit = (h: HabitRow) => (view.mode === "minutes" ? h.target_minutes ?? 0 : 1);
    let doneBeforeToday = 0;
    let doneToday = 0;
    for (const h of tracked) {
      const from = h.start_date > g.start_date ? h.start_date : g.start_date;
      for (const [k, log] of hist.logs) {
        if (!k.startsWith(`${h.id}|`) || log.date < from) continue;
        const c = credit(h, log);
        if (log.date < today) doneBeforeToday += c;
        else if (log.date === today) doneToday += c;
      }
    }
    view.done_amount = doneBeforeToday + doneToday;

    if (g.deadline && g.deadline >= g.start_date) {
      let planned = 0;
      let expected = 0;
      let plannedFromToday = 0;
      for (const h of tracked) {
        const from = h.start_date > g.start_date ? h.start_date : g.start_date;
        for (const d of eachDay(from, g.deadline)) {
          if (!isScheduled(h, d)) continue;
          planned += unit(h);
          if (d < today) expected += unit(h);
          else plannedFromToday += unit(h);
        }
      }
      view.planned_total = planned;
      view.expected = expected;
      view.diff = doneBeforeToday - expected;
      view.progress = planned > 0 ? Math.min(1, view.done_amount / planned) : null;
      const remaining = planned - doneBeforeToday;
      if (plannedFromToday > 0) {
        view.required_factor = Math.max(0, remaining / plannedFromToday);
        if (tracked.length === 1 && view.mode === "minutes") {
          view.required_per_day = (tracked[0].target_minutes ?? 0) * view.required_factor;
        }
      }
      view.projected_finish = projectFinish(tracked, unit, today, remaining);
    }
    return view;
  }

  if (taskStats.total > 0) {
    view.mode = "tasks";
    view.done_amount = taskStats.done;
    view.planned_total = taskStats.total;
    view.progress = taskStats.done / taskStats.total;
  }
  return view;
}

/** Если делать строго по плану с сегодняшнего дня — когда закончим? */
function projectFinish(habits: HabitRow[], unit: (h: HabitRow) => number, from: string, remaining: number): string | null {
  if (remaining <= 0) return from;
  let acc = 0;
  for (let i = 0; i < 365 * 5; i++) {
    const d = addDays(from, i);
    for (const h of habits) if (isScheduled(h, d)) acc += unit(h);
    if (acc >= remaining) return d;
  }
  return null;
}

export async function loadGoals(db: D1Database, hist: History, today: string, statuses = ["active"]): Promise<GoalView[]> {
  const goals = await all<GoalRow>(
    db,
    `SELECT * FROM goals WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY status = 'active' DESC, sort, id`,
    ...statuses,
  );
  const stats = await all<{ goal_id: number; done: number; total: number }>(
    db,
    "SELECT goal_id, SUM(done_at IS NOT NULL) AS done, COUNT(*) AS total FROM tasks WHERE goal_id IS NOT NULL GROUP BY goal_id",
  );
  const byGoal = new Map(stats.map((s) => [s.goal_id, s]));
  return goals.map((g) => computeGoal(g, hist, byGoal.get(g.id) ?? { done: 0, total: 0 }, today));
}

// ---------------------------------------------------------------- день целиком

export interface HabitDay {
  id: number;
  title: string;
  emoji: string | null;
  type: "check" | "minutes";
  target_minutes: number | null;
  goal_id: number | null;
  goal_title: string | null;
  goal_why: string | null;
  start_url: string | null;
  focus_sites: string[];
  blocking: boolean;
  days: string;
  done: boolean;
  minutes: number;
  streak?: number;
}

export async function habitsForDay(db: D1Database, date: string): Promise<HabitDay[]> {
  const rows = await all<HabitRow & { goal_title: string | null; goal_why: string | null; done: number | null; minutes: number | null }>(
    db,
    `SELECT h.*, g.title AS goal_title, g.why AS goal_why, l.done AS done, l.minutes AS minutes
       FROM habits h
       LEFT JOIN goals g ON g.id = h.goal_id
       LEFT JOIN habit_logs l ON l.habit_id = h.id AND l.date = ?
      ORDER BY h.sort, h.id`,
    date,
  );
  return rows
    .filter((h) => isScheduled(h, date))
    .map((h) => ({
      id: h.id,
      title: h.title,
      emoji: h.emoji,
      type: h.type,
      target_minutes: h.target_minutes,
      goal_id: h.goal_id,
      goal_title: h.goal_title,
      goal_why: h.goal_why,
      start_url: h.start_url,
      focus_sites: parseList(h.focus_sites),
      blocking: !!h.blocking,
      days: h.days,
      done: !!h.done,
      minutes: h.minutes ?? 0,
    }));
}

export function summaryOf(date: string, habits: HabitDay[], pass: boolean): DaySummary {
  return { date, total: habits.length, done: habits.filter((h) => h.done).length, pass };
}

export async function localToday(db: D1Database): Promise<{ s: Settings; today: string; minutes: number; time: string }> {
  const s = await getSettings(db);
  const n = nowInTz(s.timezone);
  return { s, today: n.date, minutes: n.minutes, time: n.time };
}

export function isBlockWindow(s: Settings, minutes: number): boolean {
  const from = timeToMinutes(s.block_from || "00:00");
  const to = timeToMinutes(s.block_to || "23:59");
  return from <= to ? minutes >= from && minutes <= to : minutes >= from || minutes <= to;
}

// ---------------------------------------------------------------- «Точно пропустить?»

export interface SkipPreview {
  date: string;
  allowed: boolean;
  blocked_reason: "no_passes" | "already" | "nothing" | "too_old" | null;
  passes: PassInfo;
  headline: string;
  lines: string[];
  why: { goal: string; text: string }[];
  countdown: number;
}

const tracked1 = (g: GoalView) => g.habits.filter((h) => h.type === "minutes").length === 1;

export async function skipPreview(db: D1Database, date: string): Promise<SkipPreview> {
  const { s, today } = await localToday(db);
  const [passes, habits] = await Promise.all([passInfo(db, s, date), habitsForDay(db, date)]);
  const pending = habits.filter((h) => !h.done);

  const res: SkipPreview = {
    date,
    allowed: true,
    blocked_reason: null,
    passes,
    headline: "Пропустить можно. Но это значит — отложить свою цель ещё на один день.",
    lines: [],
    why: [],
    countdown: 20,
  };

  if (date > today || diffDays(date, today) > 1) {
    return { ...res, allowed: false, blocked_reason: "too_old", headline: "Пропуск можно взять только на сегодня или вчера." };
  }
  if (passes.usedToday) return { ...res, allowed: false, blocked_reason: "already", headline: "Этот день уже пропущен." };
  if (!pending.length) return { ...res, allowed: false, blocked_reason: "nothing", headline: "Всё уже сделано — пропускать нечего 🎉" };
  if (passes.left <= 0) {
    return {
      ...res,
      allowed: false,
      blocked_reason: "no_passes",
      headline: `Пропуски на этой неделе закончились (${passes.used} из ${passes.weekly}). Сегодня — только делать.`,
    };
  }

  const hist = await loadHistory(db);
  const goals = await loadGoals(db, hist, today);
  const seenGoals = new Set<number>();

  for (const h of pending) {
    const g = goals.find((x) => x.id === h.goal_id);
    const row = hist.habits.find((x) => x.id === h.id)!;
    if (g && g.deadline && (g.mode === "minutes" || g.mode === "days")) {
      const loss = g.mode === "minutes" ? Math.max(0, (h.target_minutes ?? 0) - h.minutes) : 1;
      let daysAfter = 0;
      for (const d of eachDay(addDays(date, 1), g.deadline)) if (isScheduled(row, d)) daysAfter++;
      const name = `${g.emoji ? g.emoji + " " : ""}«${g.title}»`;
      if (daysAfter > 0 && g.mode === "minutes" && tracked1(g) && g.planned_total !== null) {
        // сколько придётся делать каждый оставшийся день, если сегодня остановиться на достигнутом
        const need = Math.ceil(Math.max(0, g.planned_total - g.done_amount) / daysAfter);
        const behind = g.diff !== null && g.diff < -30 ? ` Ты и так уже отстаёшь на ${fmtMinutes(-g.diff)}.` : "";
        res.lines.push(
          `${name}: сегодня минус ${fmtMinutes(loss)}. Чтобы успеть к ${fmtDate(g.deadline)}, дальше придётся заниматься по ${need} мин в день вместо ${h.target_minutes}.${behind}`,
        );
      } else if (daysAfter > 0 && g.mode === "minutes") {
        const extra = Math.max(1, Math.ceil(loss / daysAfter));
        res.lines.push(`${name}: минус ${fmtMinutes(loss)} — это +${extra} мин к каждому из ${daysAfter} ${plural(daysAfter, "оставшегося дня", "оставшихся дней", "оставшихся дней")}.`);
      } else if (daysAfter > 0) {
        res.lines.push(`${name}: этот день придётся наверстать — до ${fmtDate(g.deadline)} осталось ${daysAfter} ${plural(daysAfter, "рабочий день", "рабочих дня", "рабочих дней")}.`);
      } else {
        res.lines.push(`${name}: дедлайн ${fmtDate(g.deadline)} — наверстать уже будет негде.`);
      }
      if (g.projected_finish) {
        let shifted = addDays(g.projected_finish, 1);
        while (!isScheduled(row, shifted) && diffDays(g.projected_finish, shifted) < 8) shifted = addDays(shifted, 1);
        res.lines.push(`Если не наверстать — финиш сдвинется с ${fmtDate(g.projected_finish)} на ${fmtDate(shifted)}.`);
      }
    } else {
      const st = habitStreak(hist, row, date);
      if (st > 1) res.lines.push(`«${h.title}»: ${st} ${plural(st, "день", "дня", "дней")} подряд. Цепочка замёрзнет.`);
      else res.lines.push(`«${h.title}» сегодня не будет сделано.`);
    }
    if (g && g.why && !seenGoals.has(g.id)) {
      seenGoals.add(g.id);
      res.why.push({ goal: g.title, text: g.why });
    }
  }

  const { base } = computeStreakBase(hist, today);
  if (base > 0) res.lines.push(`Стрик ${base} 🔥 не сгорит, но сегодня и не вырастет.`);
  const recent = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM days WHERE pass_used = 1 AND date BETWEEN ? AND ?",
    addDays(date, -30),
    addDays(date, -1),
  );
  const n = (recent?.n ?? 0) + 1;
  if (n > 1) res.lines.push(`Это будет ${n}-й пропуск за последние 30 дней.`);
  res.lines.push(`После этого на неделе останется пропусков: ${passes.left - 1}.`);
  return res;
}
