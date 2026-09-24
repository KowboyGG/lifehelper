import { Hono } from "hono";
import type { AppEnv } from "../env";
import { addMinutes, setHabitDone, toggleHabit, undoPass, usePass } from "../lib/actions";
import { all, ensureDay, first, int, num, parseSites, run, str, type DayRow, type GoalRow, type HabitRow, type TaskRow } from "../lib/db";
import {
  getStreak,
  habitStreak,
  habitsForDay,
  invalidateStreak,
  isScheduled,
  loadGoals,
  loadHistory,
  localToday,
  logOf,
  passInfo,
  skipPreview,
  summarizeDay,
  summaryOf,
} from "../lib/progress";
import { getSettings, ownerId, setSettings } from "../lib/settings";
import { addDays, isValidDate, monthBounds } from "../lib/time";
import { moneySummary } from "./life";

export const core = new Hono<AppEnv>();

core.get("/me", async (c) => {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  if (origin.startsWith("https://") && s.public_url !== origin) {
    c.executionCtx.waitUntil(setSettings(c.env.DB, { public_url: origin }));
  }
  const { today } = await localToday(c.env.DB);
  const habits = await habitsForDay(c.env.DB, today);
  const pass = await passInfo(c.env.DB, s, today);
  const streak = await getStreak(c.env.DB, s, today, summaryOf(today, habits, pass.usedToday));
  return c.json({
    name: s.owner_name || "Я",
    ownerId: ownerId(c.env, s),
    botUsername: s.bot_username,
    botConfigured: !!c.env.TELEGRAM_BOT_TOKEN,
    timezone: s.timezone,
    today,
    done: habits.filter((h) => h.done).length,
    total: habits.length,
    passUsed: pass.usedToday,
    streak,
  });
});

// ---------------------------------------------------------------- день

core.get("/today", async (c) => {
  const db = c.env.DB;
  const { s, today } = await localToday(db);
  const q = c.req.query("date");
  const date = isValidDate(q) ? q : today;

  const hist = await loadHistory(db);
  const habits = await habitsForDay(db, date);
  for (const h of habits) {
    const row = hist.habits.find((x) => x.id === h.id);
    if (row) h.streak = habitStreak(hist, row, date <= today ? date : today);
  }
  const [pass, day, streak, goals, tasks, focus, distractions, money] = await Promise.all([
    passInfo(db, s, date),
    first<DayRow>(db, "SELECT * FROM days WHERE date = ?", date),
    getStreak(db, s, today, summarizeDay(hist, today)),
    loadGoals(db, hist, today),
    date === today
      ? all<TaskRow>(db, "SELECT * FROM tasks WHERE (date = ?) OR (date < ? AND done_at IS NULL) ORDER BY done_at IS NOT NULL, date, time, priority DESC, id", date, date)
      : all<TaskRow>(db, "SELECT * FROM tasks WHERE date = ? ORDER BY done_at IS NOT NULL, time, id", date),
    first<{ seconds: number; clicks: number; keys: number }>(
      db,
      "SELECT COALESCE(SUM(seconds),0) AS seconds, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(keys),0) AS keys FROM focus_sessions WHERE date = ?",
      date,
    ),
    all<{ domain: string; seconds: number }>(db, "SELECT domain, seconds FROM site_time WHERE date = ? ORDER BY seconds DESC LIMIT 8", date),
    moneySummary(db, s, date.slice(0, 7)),
  ]);

  const last = [];
  for (let i = 34; i >= 0; i--) {
    const d = addDays(today, -i);
    last.push(summarizeDay(hist, d));
  }

  return c.json({
    date,
    today,
    habits,
    done: habits.filter((h) => h.done).length,
    total: habits.length,
    pass,
    mood: day?.mood ?? null,
    note: day?.note ?? null,
    streak,
    goals,
    tasks,
    focus,
    distractions,
    money: { total: money.total, currency: money.currency, expense: money.month.expense, income: money.month.income },
    last,
  });
});

core.get("/calendar", async (c) => {
  const db = c.env.DB;
  const { today } = await localToday(db);
  const month = /^\d{4}-\d{2}$/.test(c.req.query("month") ?? "") ? c.req.query("month")! : today.slice(0, 7);
  const { start, end } = monthBounds(month);
  const from = addDays(start, -7);
  const to = addDays(end, 14);
  const hist = await loadHistory(db, from);
  const [days, tasks] = await Promise.all([
    all<DayRow>(db, "SELECT date, mood, note, pass_used FROM days WHERE date BETWEEN ? AND ?", from, to),
    all<{ date: string; total: number; done: number; titles: string }>(
      db,
      "SELECT date, COUNT(*) AS total, SUM(done_at IS NOT NULL) AS done, GROUP_CONCAT(title, ' · ') AS titles FROM tasks WHERE date BETWEEN ? AND ? GROUP BY date",
      from,
      to,
    ),
  ]);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const taskMap = new Map(tasks.map((t) => [t.date, t]));
  const out: Record<string, unknown> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const sum = summarizeDay(hist, d);
    const day = dayMap.get(d);
    const t = taskMap.get(d);
    out[d] = {
      total: sum.total,
      done: sum.done,
      pass: sum.pass,
      mood: day?.mood ?? null,
      hasNote: !!day?.note,
      tasks: t?.total ?? 0,
      tasksDone: t?.done ?? 0,
      taskTitles: t?.titles ?? "",
    };
  }
  return c.json({ month, today, days: out });
});

core.put("/days/:date", async (c) => {
  const date = c.req.param("date");
  if (!isValidDate(date)) return c.json({ error: "bad date" }, 400);
  const b = await c.req.json<{ mood?: number | null; note?: string | null }>();
  await ensureDay(c.env.DB, date);
  if (b.mood !== undefined) {
    const m = b.mood === null ? null : int(b.mood);
    await run(c.env.DB, "UPDATE days SET mood = ? WHERE date = ?", m && m >= 1 && m <= 5 ? m : null, date);
  }
  if (b.note !== undefined) await run(c.env.DB, "UPDATE days SET note = ? WHERE date = ?", str(b.note, 5000), date);
  return c.json({ ok: true });
});

core.get("/days/:date/skip-preview", async (c) => {
  const date = c.req.param("date");
  if (!isValidDate(date)) return c.json({ error: "bad date" }, 400);
  return c.json(await skipPreview(c.env.DB, date));
});

core.post("/days/:date/pass", async (c) => {
  const date = c.req.param("date");
  if (!isValidDate(date)) return c.json({ error: "bad date" }, 400);
  const b = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const r = await usePass(c.env.DB, date, str(b.reason, 300));
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 400);
});

core.delete("/days/:date/pass", async (c) => {
  const date = c.req.param("date");
  if (!isValidDate(date)) return c.json({ error: "bad date" }, 400);
  await undoPass(c.env.DB, date);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- привычки

function habitInput(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.title !== undefined) out.title = str(b.title, 120);
  if (b.emoji !== undefined) out.emoji = str(b.emoji, 16);
  if (b.goal_id !== undefined) out.goal_id = int(b.goal_id) || null;
  if (b.type !== undefined) out.type = b.type === "minutes" ? "minutes" : "check";
  if (b.target_minutes !== undefined) out.target_minutes = Math.max(1, Math.min(1440, int(b.target_minutes) ?? 30));
  if (b.days !== undefined) out.days = typeof b.days === "string" && /^[01]{7}$/.test(b.days) && b.days !== "0000000" ? b.days : "1111111";
  if (b.start_url !== undefined) {
    const u = str(b.start_url, 500);
    out.start_url = u ? (/^https?:\/\//.test(u) ? u : `https://${u}`) : null;
  }
  if (b.focus_sites !== undefined) out.focus_sites = JSON.stringify(parseSites(b.focus_sites));
  if (b.blocking !== undefined) out.blocking = b.blocking ? 1 : 0;
  if (b.start_date !== undefined && isValidDate(b.start_date)) out.start_date = b.start_date;
  return out;
}

core.get("/habits", async (c) => {
  const db = c.env.DB;
  const { today } = await localToday(db);
  const hist = await loadHistory(db);
  const goals = await all<{ id: number; title: string; emoji: string | null }>(db, "SELECT id, title, emoji FROM goals");
  const list = hist.habits
    .filter((h) => c.req.query("all") === "1" || !h.archived_at)
    .map((h) => {
      let scheduled = 0;
      let done = 0;
      let minutes = 0;
      const recent: (0 | 1 | 2 | 3)[] = []; // 0 не по плану, 1 не сделано, 2 сделано, 3 пропуск
      for (let i = 27; i >= 0; i--) {
        const d = addDays(today, -i);
        const log = logOf(hist, h.id, d);
        minutes += log?.minutes ?? 0;
        if (!isScheduled(h, d)) {
          recent.push(0);
          continue;
        }
        if (d < today || log?.done) scheduled++;
        if (log?.done) done++;
        recent.push(log?.done ? 2 : hist.passes.has(d) ? 3 : 1);
      }
      let totalMinutes = 0;
      for (const [k, log] of hist.logs) if (k.startsWith(`${h.id}|`)) totalMinutes += log.minutes;
      const g = goals.find((x) => x.id === h.goal_id);
      return {
        ...h,
        focus_sites: JSON.parse(h.focus_sites || "[]"),
        blocking: !!h.blocking,
        goal_title: g ? `${g.emoji ? g.emoji + " " : ""}${g.title}` : null,
        streak: habitStreak(hist, h, today),
        rate28: scheduled ? done / scheduled : null,
        minutes28: minutes,
        total_minutes: totalMinutes,
        recent,
      };
    });
  return c.json(list);
});

core.post("/habits", async (c) => {
  const db = c.env.DB;
  const { today } = await localToday(db);
  const b = habitInput(await c.req.json(), false);
  if (!b.title) return c.json({ error: "Нужно название" }, 400);
  const max = await first<{ m: number }>(db, "SELECT COALESCE(MAX(sort), 0) AS m FROM habits");
  const row = await first<{ id: number }>(
    db,
    `INSERT INTO habits(title, emoji, goal_id, type, target_minutes, days, start_url, focus_sites, blocking, start_date, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    b.title,
    b.emoji ?? null,
    b.goal_id ?? null,
    b.type ?? "check",
    b.type === "minutes" ? b.target_minutes ?? 30 : null,
    b.days ?? "1111111",
    b.start_url ?? null,
    b.focus_sites ?? "[]",
    b.blocking ?? 1,
    (b.start_date as string) ?? today,
    (max?.m ?? 0) + 1,
    Date.now(),
  );
  await invalidateStreak(db);
  return c.json({ id: row!.id });
});

core.put("/habits/:id", async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const raw = await c.req.json<Record<string, unknown>>();
  const b = habitInput(raw, true);
  if ("title" in b && !b.title) return c.json({ error: "Нужно название" }, 400);
  if (raw.archived !== undefined) {
    const { today } = await localToday(db);
    b.archived_at = raw.archived ? today : null;
  }
  if (raw.sort !== undefined) b.sort = int(raw.sort) ?? 0;
  const keys = Object.keys(b);
  if (keys.length) {
    await run(db, `UPDATE habits SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => b[k]), id);
    await invalidateStreak(db);
  }
  return c.json({ ok: true });
});

core.delete("/habits/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM habits WHERE id = ?", Number(c.req.param("id")));
  await invalidateStreak(c.env.DB);
  return c.json({ ok: true });
});

core.post("/habits/:id/toggle", async (c) => {
  const { date, done } = await c.req.json<{ date?: string; done?: boolean }>();
  const { today } = await localToday(c.env.DB);
  const d = isValidDate(date) ? date : today;
  if (d > today) return c.json({ error: "Нельзя отметить будущее" }, 400);
  const id = Number(c.req.param("id"));
  const r = typeof done === "boolean" ? ((await setHabitDone(c.env.DB, id, d, done, "web")) ? done : null) : await toggleHabit(c.env.DB, id, d, "web");
  return r === null ? c.json({ error: "not found" }, 404) : c.json({ done: r });
});

core.post("/habits/:id/minutes", async (c) => {
  const { date, add } = await c.req.json<{ date?: string; add?: number }>();
  const { today } = await localToday(c.env.DB);
  const d = isValidDate(date) ? date : today;
  const n = num(add);
  if (n === null || Math.abs(n) > 1440) return c.json({ error: "bad minutes" }, 400);
  const r = await addMinutes(c.env.DB, Number(c.req.param("id")), d, n, "web");
  return r ? c.json(r) : c.json({ error: "not found" }, 404);
});

// ---------------------------------------------------------------- цели

function goalInput(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.title !== undefined) out.title = str(b.title, 160);
  for (const k of ["emoji", "color", "unit"] as const) if (b[k] !== undefined) out[k] = str(b[k], 32);
  if (b.why !== undefined) out.why = str(b.why, 1000);
  if (b.start_date !== undefined && isValidDate(b.start_date)) out.start_date = b.start_date;
  if (b.deadline !== undefined) out.deadline = isValidDate(b.deadline) ? b.deadline : null;
  if (b.target_value !== undefined) out.target_value = num(b.target_value) || null;
  if (b.current_value !== undefined) out.current_value = num(b.current_value) ?? 0;
  if (b.status !== undefined && ["active", "done", "archived"].includes(b.status as string)) {
    out.status = b.status;
    out.done_at = b.status === "done" ? Date.now() : null;
  }
  if (b.sort !== undefined) out.sort = int(b.sort) ?? 0;
  return out;
}

core.get("/goals", async (c) => {
  const db = c.env.DB;
  const { today } = await localToday(db);
  const status = c.req.query("status");
  const statuses = status === "all" ? ["active", "done", "archived"] : status && ["done", "archived"].includes(status) ? [status] : ["active"];
  return c.json(await loadGoals(db, await loadHistory(db), today, statuses));
});

core.post("/goals", async (c) => {
  const db = c.env.DB;
  const { today } = await localToday(db);
  const b = goalInput(await c.req.json(), false);
  if (!b.title) return c.json({ error: "Нужно название" }, 400);
  const row = await first<{ id: number }>(
    db,
    `INSERT INTO goals(title, emoji, color, why, start_date, deadline, target_value, current_value, unit, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM goals), ?) RETURNING id`,
    b.title,
    b.emoji ?? null,
    b.color ?? null,
    b.why ?? null,
    b.start_date ?? today,
    b.deadline ?? null,
    b.target_value ?? null,
    b.current_value ?? 0,
    b.unit ?? null,
    Date.now(),
  );
  return c.json({ id: row!.id });
});

core.put("/goals/:id", async (c) => {
  const b = goalInput(await c.req.json(), true);
  if ("title" in b && !b.title) return c.json({ error: "Нужно название" }, 400);
  const keys = Object.keys(b);
  if (keys.length) await run(c.env.DB, `UPDATE goals SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => b[k]), Number(c.req.param("id")));
  return c.json({ ok: true });
});

core.post("/goals/:id/add", async (c) => {
  const { value } = await c.req.json<{ value?: number }>();
  const v = num(value);
  if (v === null) return c.json({ error: "bad value" }, 400);
  await run(c.env.DB, "UPDATE goals SET current_value = current_value + ? WHERE id = ?", v, Number(c.req.param("id")));
  const g = await first<GoalRow>(c.env.DB, "SELECT * FROM goals WHERE id = ?", Number(c.req.param("id")));
  return c.json({ current_value: g?.current_value ?? 0 });
});

core.delete("/goals/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM goals WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- задачи

core.get("/tasks", async (c) => {
  const db = c.env.DB;
  const { today } = await localToday(db);
  const view = c.req.query("view") ?? "all";
  const base = "SELECT t.*, g.title AS goal_title, g.emoji AS goal_emoji FROM tasks t LEFT JOIN goals g ON g.id = t.goal_id";
  let rows: TaskRow[];
  if (view === "inbox") rows = await all(db, `${base} WHERE t.date IS NULL AND t.done_at IS NULL ORDER BY t.priority DESC, t.id DESC`);
  else if (view === "today")
    rows = await all(db, `${base} WHERE (t.date = ?) OR (t.date < ? AND t.done_at IS NULL) ORDER BY t.done_at IS NOT NULL, t.date, t.time, t.priority DESC`, today, today);
  else if (view === "upcoming") rows = await all(db, `${base} WHERE t.date > ? AND t.done_at IS NULL ORDER BY t.date, t.time, t.id`, today);
  else if (view === "done") rows = await all(db, `${base} WHERE t.done_at IS NOT NULL ORDER BY t.done_at DESC LIMIT 100`);
  else rows = await all(db, `${base} WHERE t.done_at IS NULL ORDER BY t.date IS NULL, t.date, t.time, t.id`);
  return c.json(rows);
});

function taskInput(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (b.title !== undefined) out.title = str(b.title, 300);
  if (b.date !== undefined) out.date = isValidDate(b.date) ? b.date : null;
  if (b.time !== undefined) out.time = typeof b.time === "string" && /^\d{2}:\d{2}$/.test(b.time) ? b.time : null;
  if (b.goal_id !== undefined) out.goal_id = int(b.goal_id) || null;
  if (b.priority !== undefined) out.priority = Math.max(0, Math.min(2, int(b.priority) ?? 0));
  if (b.done !== undefined) out.done_at = b.done ? Date.now() : null;
  return out;
}

core.post("/tasks", async (c) => {
  const b = taskInput(await c.req.json());
  if (!b.title) return c.json({ error: "Нужно название" }, 400);
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO tasks(title, date, time, goal_id, priority, source, created_at) VALUES (?, ?, ?, ?, ?, 'web', ?) RETURNING id",
    b.title,
    b.date ?? null,
    b.time ?? null,
    b.goal_id ?? null,
    b.priority ?? 0,
    Date.now(),
  );
  return c.json({ id: row!.id });
});

core.put("/tasks/:id", async (c) => {
  const b = taskInput(await c.req.json());
  if ("title" in b && !b.title) return c.json({ error: "Нужно название" }, 400);
  const keys = Object.keys(b);
  if (keys.length) await run(c.env.DB, `UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => b[k]), Number(c.req.param("id")));
  return c.json({ ok: true });
});

core.delete("/tasks/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM tasks WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

