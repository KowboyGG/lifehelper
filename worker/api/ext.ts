// API для Chrome-расширения: состояние блокировки и учёт времени
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { addMinutes, usePass } from "../lib/actions";
import { all, first, normalizeSite, run, str } from "../lib/db";
import { getStreak, habitsForDay, isBlockWindow, localToday, passInfo, skipPreview, summaryOf } from "../lib/progress";
import { parseList } from "../lib/settings";

export const ext = new Hono<AppEnv>();

async function state(db: D1Database) {
  const { s, today, minutes, time } = await localToday(db);
  const [habits, pass, sites, focus, goals] = await Promise.all([
    habitsForDay(db, today),
    passInfo(db, s, today),
    all<{ domain: string; seconds: number }>(db, "SELECT domain, seconds FROM site_time WHERE date = ? ORDER BY seconds DESC", today),
    first<{ seconds: number }>(db, "SELECT COALESCE(SUM(seconds),0) AS seconds FROM focus_sessions WHERE date = ?", today),
    all<{ id: number; title: string; emoji: string | null; deadline: string | null; why: string | null }>(
      db,
      "SELECT id, title, emoji, deadline, why FROM goals WHERE status = 'active'",
    ),
  ]);
  const streak = await getStreak(db, s, today, summaryOf(today, habits, pass.usedToday));
  const enabled = s.block_enabled === "1";
  const inWindow = isBlockWindow(s, minutes);
  const pending = habits.filter((h) => h.blocking && !h.done && !h.skipped);
  return {
    date: today,
    time,
    block: {
      enabled,
      inWindow,
      from: s.block_from,
      to: s.block_to,
      active: enabled && inWindow && !pass.usedToday && pending.length > 0,
    },
    blocklist: parseList(s.blocklist),
    habits: habits.map((h) => ({ ...h, goal: goals.find((g) => g.id === h.goal_id) ?? null })),
    pass,
    streak,
    sites,
    focusSeconds: focus?.seconds ?? 0,
  };
}

ext.get("/state", async (c) => c.json(await state(c.env.DB)));

interface Beat {
  sessions?: { id: string; habitId: number; seconds: number; clicks?: number; keys?: number; scrolls?: number; startedAt?: number }[];
  sites?: Record<string, number>;
}

ext.post("/heartbeat", async (c) => {
  const db = c.env.DB;
  const b = await c.req.json<Beat>();
  const { today } = await localToday(db);
  const completed: { id: number; title: string }[] = [];
  const now = Date.now();
  const clamp = (n: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

  for (const sess of (b.sessions ?? []).slice(0, 10)) {
    const id = str(sess.id, 64);
    const habitId = Number(sess.habitId);
    const seconds = clamp(sess.seconds, 3600);
    if (!id || !habitId) continue;
    await run(
      db,
      `INSERT INTO focus_sessions(id, habit_id, date, started_at, updated_at, seconds, clicks, keys, scrolls, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ext')
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, seconds = seconds + excluded.seconds,
         clicks = clicks + excluded.clicks, keys = keys + excluded.keys, scrolls = scrolls + excluded.scrolls`,
      id,
      habitId,
      today,
      Number(sess.startedAt) || now,
      now,
      seconds,
      clamp(sess.clicks, 100000),
      clamp(sess.keys, 100000),
      clamp(sess.scrolls, 100000),
    );
    if (seconds > 0) {
      const r = await addMinutes(db, habitId, today, seconds / 60, "ext");
      if (r?.justCompleted) {
        const h = await first<{ title: string }>(db, "SELECT title FROM habits WHERE id = ?", habitId);
        completed.push({ id: habitId, title: h?.title ?? "" });
      }
    }
  }

  const siteStmts = Object.entries(b.sites ?? {})
    .slice(0, 30)
    .map(([domain, sec]) => [normalizeSite(domain).slice(0, 100), clamp(sec, 3600)] as const)
    .filter(([d, sec]) => d && sec > 0)
    .map(([domain, sec]) =>
      db
        .prepare("INSERT INTO site_time(date, domain, seconds) VALUES (?, ?, ?) ON CONFLICT(date, domain) DO UPDATE SET seconds = seconds + excluded.seconds")
        .bind(today, domain, sec),
    );
  if (siteStmts.length) await db.batch(siteStmts);

  return c.json({ ...(await state(db)), completed });
});

ext.get("/skip-preview", async (c) => {
  const { today } = await localToday(c.env.DB);
  return c.json(await skipPreview(c.env.DB, today));
});

ext.post("/pass", async (c) => {
  const { today } = await localToday(c.env.DB);
  const b = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const r = await usePass(c.env.DB, today, str(b.reason, 300) ?? "из расширения");
  return r.ok ? c.json(await state(c.env.DB)) : c.json({ error: r.error }, 400);
});
