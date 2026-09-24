// Изменения, которые делают и сайт, и бот, и расширение
import { ensureDay, first, run, type HabitRow } from "./db";
import { invalidateStreak, localToday, skipPreview, skipsUsed } from "./progress";

export async function setHabitDone(db: D1Database, habitId: number, date: string, done: boolean, source: string): Promise<boolean> {
  const h = await first<HabitRow>(db, "SELECT * FROM habits WHERE id = ?", habitId);
  if (!h) return false;
  await run(
    db,
    `INSERT INTO habit_logs(habit_id, date, done, minutes, source, updated_at) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET done = excluded.done, source = excluded.source, updated_at = excluded.updated_at,
       skipped = CASE WHEN excluded.done = 1 THEN 0 ELSE skipped END`,
    habitId,
    date,
    done ? 1 : 0,
    source,
    Date.now(),
  );
  await afterChange(db, date);
  return true;
}

/** Личный пропуск привычки (например, зал): не больше skips_per_month в календарном месяце */
export async function skipHabit(db: D1Database, habitId: number, date: string, skip: boolean): Promise<{ ok: boolean; error?: string; left?: number }> {
  const h = await first<HabitRow>(db, "SELECT * FROM habits WHERE id = ?", habitId);
  if (!h) return { ok: false, error: "Привычка не найдена" };
  if (skip) {
    const limit = h.skips_per_month ?? 0;
    if (limit <= 0) return { ok: false, error: "У этой привычки нет пропусков. Их можно включить в её настройках." };
    const used = (await skipsUsed(db, date, date)).get(habitId) ?? 0;
    if (used >= limit) return { ok: false, error: `Пропуски «${h.title}» на этот месяц закончились (${used} из ${limit}).` };
    await run(
      db,
      `INSERT INTO habit_logs(habit_id, date, done, minutes, skipped, source, updated_at) VALUES (?, ?, 0, 0, 1, 'skip', ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET done = 0, skipped = 1, updated_at = excluded.updated_at`,
      habitId,
      date,
      Date.now(),
    );
    await afterChange(db, date);
    return { ok: true, left: limit - used - 1 };
  }
  await run(db, "UPDATE habit_logs SET skipped = 0, updated_at = ? WHERE habit_id = ? AND date = ?", Date.now(), habitId, date);
  await afterChange(db, date);
  return { ok: true };
}

export async function toggleHabit(db: D1Database, habitId: number, date: string, source: string): Promise<boolean | null> {
  const cur = await first<{ done: number }>(db, "SELECT done FROM habit_logs WHERE habit_id = ? AND date = ?", habitId, date);
  const next = !cur?.done;
  return (await setHabitDone(db, habitId, date, next, source)) ? next : null;
}

/** Добавить минуты; при достижении нормы привычка отмечается сама */
export async function addMinutes(
  db: D1Database,
  habitId: number,
  date: string,
  add: number,
  source: string,
): Promise<{ minutes: number; done: boolean; justCompleted: boolean } | null> {
  const h = await first<HabitRow>(db, "SELECT * FROM habits WHERE id = ?", habitId);
  if (!h) return null;
  const before = await first<{ done: number; minutes: number }>(db, "SELECT done, minutes FROM habit_logs WHERE habit_id = ? AND date = ?", habitId, date);
  const minutes = Math.max(0, (before?.minutes ?? 0) + add);
  const target = h.type === "minutes" ? h.target_minutes ?? 0 : 0;
  const reached = target > 0 && minutes >= target;
  const done = !!before?.done || reached;
  await run(
    db,
    `INSERT INTO habit_logs(habit_id, date, done, minutes, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET done = excluded.done, minutes = excluded.minutes, source = excluded.source, updated_at = excluded.updated_at,
       skipped = CASE WHEN excluded.done = 1 THEN 0 ELSE skipped END`,
    habitId,
    date,
    done ? 1 : 0,
    minutes,
    source,
    Date.now(),
  );
  await afterChange(db, date);
  return { minutes, done, justCompleted: done && !before?.done };
}

export async function usePass(db: D1Database, date: string, reason: string | null): Promise<{ ok: boolean; error?: string }> {
  const preview = await skipPreview(db, date);
  if (!preview.allowed) return { ok: false, error: preview.headline };
  await ensureDay(db, date);
  await run(db, "UPDATE days SET pass_used = 1, pass_reason = ? WHERE date = ?", reason, date);
  await afterChange(db, date);
  return { ok: true };
}

export async function undoPass(db: D1Database, date: string): Promise<void> {
  await run(db, "UPDATE days SET pass_used = 0, pass_reason = NULL WHERE date = ?", date);
  await afterChange(db, date);
}

async function afterChange(db: D1Database, date: string): Promise<void> {
  const { today } = await localToday(db);
  if (date < today) await invalidateStreak(db);
}
