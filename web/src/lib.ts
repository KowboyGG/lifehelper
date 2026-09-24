// API-клиент, роутер, форматирование, общие типы
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// ---------------------------------------------------------------- API

export class ApiError extends Error {}

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-lh": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !path.startsWith("/auth")) {
    navigate("/login");
    throw new ApiError("Нужно войти");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Ошибка ${res.status}`);
  return data as T;
}

/** Изменение + обновление всех экранов */
export async function mutate<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  try {
    const r = await api<T>(path, method, body);
    refresh();
    return r;
  } catch (e) {
    toast((e as Error).message, true);
    throw e;
  }
}

export function refresh() {
  window.dispatchEvent(new Event("lh:refresh"));
}

export function useApi<T>(path: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => n === seq.current && setError((e as Error).message))
      .finally(() => n === seq.current && setLoading(false));
  }, [path]);
  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener("lh:refresh", on);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("lh:refresh", on);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);
  return { data, error, loading, reload: load };
}

// ---------------------------------------------------------------- роутер

const listeners = new Set<() => void>();
export function navigate(to: string) {
  if (location.pathname + location.search === to) return;
  history.pushState(null, "", to);
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}
window.addEventListener("popstate", () => listeners.forEach((l) => l()));
export function useLocation(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}

// ---------------------------------------------------------------- тосты

type ToastItem = { id: number; text: string; err: boolean };
let toasts: ToastItem[] = [];
const toastSubs = new Set<() => void>();
export function toast(text: string, err = false) {
  const t = { id: Date.now() + Math.random(), text, err };
  toasts = [...toasts, t];
  toastSubs.forEach((f) => f());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastSubs.forEach((f) => f());
  }, 2800);
}
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb);
      return () => toastSubs.delete(cb);
    },
    () => toasts,
  );
}

// ---------------------------------------------------------------- тема

export function setTheme(t: "dark" | "light") {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("lh-theme", t);
  } catch {
    /* приватный режим */
  }
}

// ---------------------------------------------------------------- даты и числа

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const WD = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const utc = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
};
export const addDays = (d: string, n: number) => new Date(utc(d) + n * 86400000).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86400000);
export const weekday = (d: string) => (new Date(utc(d)).getUTCDay() + 6) % 7;

export function fmtDate(d: string, opts: { weekday?: boolean; year?: boolean } = {}) {
  const [y, m, dd] = d.split("-").map(Number);
  let s = `${dd} ${MONTHS[m - 1]}`;
  if (opts.year) s += ` ${y}`;
  if (opts.weekday) s = `${WD[weekday(d)]}, ${s}`;
  return s;
}
export function fmtShort(d: string) {
  const [, m, dd] = d.split("-").map(Number);
  return `${dd} ${MONTHS_SHORT[m - 1]}`;
}
export function relDay(d: string, today: string) {
  const n = diffDays(today, d);
  if (n === 0) return "Сегодня";
  if (n === 1) return "Завтра";
  if (n === -1) return "Вчера";
  return fmtShort(d);
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtMin(min: number) {
  const m = Math.round(min);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}
export const fmtSec = (s: number) => fmtMin(s / 60);

const SYMBOLS: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", PLN: "zł", GBP: "£" };
export const curSym = (c: string) => SYMBOLS[c] ?? c;
export function money(n: number, cur = "UAH", digits = 0) {
  const s = Math.abs(n).toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return `${n < 0 ? "−" : ""}${curSym(cur)} ${s}`;
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "Я"
  );
}

// ---------------------------------------------------------------- типы API

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

export interface PassInfo {
  weekly: number;
  used: number;
  left: number;
  usedToday: boolean;
  reason: string | null;
}

export interface Goal {
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

export interface Task {
  id: number;
  title: string;
  goal_id: number | null;
  goal_title?: string | null;
  goal_emoji?: string | null;
  date: string | null;
  time: string | null;
  done_at: number | null;
  priority: number;
  source: string | null;
}

export interface DaySummary {
  date: string;
  total: number;
  done: number;
  pass: boolean;
}

export interface Today {
  date: string;
  today: string;
  habits: HabitDay[];
  done: number;
  total: number;
  pass: PassInfo;
  mood: number | null;
  note: string | null;
  streak: { current: number; best: number };
  goals: Goal[];
  tasks: Task[];
  focus: { seconds: number; clicks: number; keys: number };
  distractions: { domain: string; seconds: number }[];
  money: { total: number; currency: string; expense: number; income: number };
  last: DaySummary[];
}

export interface SkipPreview {
  date: string;
  allowed: boolean;
  blocked_reason: string | null;
  passes: PassInfo;
  headline: string;
  lines: string[];
  why: { goal: string; text: string }[];
  countdown: number;
}

export interface Me {
  name: string;
  ownerId: string;
  botUsername: string;
  botConfigured: boolean;
  timezone: string;
}

export const MOODS = ["😣", "😕", "😐", "🙂", "🤩"];
