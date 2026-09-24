// Типы строк БД и мелкие помощники

export interface HabitRow {
  id: number;
  goal_id: number | null;
  title: string;
  emoji: string | null;
  type: "check" | "minutes";
  target_minutes: number | null;
  days: string;
  start_url: string | null;
  focus_sites: string;
  blocking: number;
  skips_per_month: number;
  pauses: string; // JSON [{from, to, note}]
  start_date: string;
  archived_at: string | null;
  sort: number;
  created_at: number;
}

export interface LogRow {
  habit_id: number;
  date: string;
  done: number;
  minutes: number;
  skipped: number;
}

export interface DayRow {
  date: string;
  pass_used: number;
  pass_reason: string | null;
  mood: number | null;
  note: string | null;
  skip_requested_at: number | null;
  checkin_msg_id: number | null;
}

export interface GoalRow {
  id: number;
  title: string;
  emoji: string | null;
  color: string | null;
  why: string | null;
  start_date: string;
  deadline: string | null;
  target_value: number | null;
  current_value: number;
  unit: string | null;
  status: "active" | "done" | "archived";
  done_at: number | null;
  sort: number;
  created_at: number;
}

export interface TaskRow {
  id: number;
  title: string;
  goal_id: number | null;
  date: string | null;
  time: string | null;
  done_at: number | null;
  priority: number;
  source: string | null;
  created_at: number;
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>();
  return results;
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

export async function ensureDay(db: D1Database, date: string): Promise<void> {
  await run(db, "INSERT OR IGNORE INTO days(date) VALUES (?)", date);
}

// --- валидация входных данных ---

export function str(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

export function parseSites(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : [];
  return [...new Set(arr.map((s) => normalizeSite(String(s))).filter(Boolean))].slice(0, 50);
}

export function normalizeSite(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}
