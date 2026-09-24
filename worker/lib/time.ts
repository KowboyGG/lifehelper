// Даты храним как строки YYYY-MM-DD в часовом поясе владельца.

export interface LocalNow {
  date: string;
  time: string; // HH:MM
  minutes: number; // минут с начала дня
}

export function nowInTz(tz: string, at: Date = new Date()): LocalNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return nowInTz("Europe/Kyiv", at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hh = get("hour") === "24" ? "00" : get("hour");
  const mm = get("minute");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hh}:${mm}`,
    minutes: Number(hh) * 60 + Number(mm),
  };
}

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * 86400000);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

/** 0 = понедельник … 6 = воскресенье */
export function weekday(date: string): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

export function weekStart(date: string): string {
  return addDays(date, -weekday(date));
}

export function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s));
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = fromUtc(Date.UTC(y, m, 0));
  return { start, end };
}

export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

export function fmtDate(date: string, withWeekday = false): string {
  const [, m, d] = date.split("-").map(Number);
  const s = `${d} ${MONTHS_GEN[m - 1]}`;
  return withWeekday ? `${WEEKDAYS[weekday(date)]}, ${s}` : s;
}

export function fmtDateShort(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

/** Склонение: plural(5, "день", "дня", "дней") */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}
