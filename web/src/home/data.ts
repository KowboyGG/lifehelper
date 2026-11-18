// Данные для сцены «Дом» и денежные расчёты — без three.js, чтобы страница
// могла их использовать, не подтягивая тяжёлый 3D-код в основной бандл.
import type { Goal, Today } from "../lib";


export interface HomeSticker {
  id: number;
  kind: "note" | "goal" | "wish" | "countdown" | "money" | "streak";
  ref_id: number | null;
  text: string | null;
  date: string | null;
  color: string;
  pinned: number;
}
export interface HomeWish {
  id: number;
  title: string;
  emoji: string | null;
  price: number | null;
  currency: string;
  cooldown_left: number;
  status: string;
}
export interface HomeAccount {
  id: number;
  name: string;
  emoji: string | null;
  currency: string;
  balance: number;
}
export interface HomeMoney {
  total: number;
  currency: string;
  rates: Record<string, number>;
  accounts: HomeAccount[];
}
export interface HomeCalendar {
  month: string;
  today: string;
  days: Record<string, { total: number; done: number; pass: boolean; skipped?: number }>;
}
export interface HomeData {
  today?: Today | null;
  stickers?: HomeSticker[] | null;
  goals?: Goal[] | null;
  wishes?: HomeWish[] | null;
  money?: HomeMoney | null;
  calendar?: HomeCalendar | null;
}

// ------------------------------------------------------------------ деньги: что лежит в сейфе

const SAFE_RE = /копил|подушк|сейф|накоп|резерв|депоз|запас|saving|safe|stash|reserve/i;
const HARD = new Set(["USD", "EUR", "GBP", "CHF"]);
/** В сейфе — накопления: «Копилка», «Подушка», валютные счета. Остальное — на столе. */
export const inSafe = (a: HomeAccount) => SAFE_RE.test(a.name) || HARD.has(a.currency);

export function splitMoney(m: HomeMoney) {
  const r = (c: string) => (c === "UAH" ? 1 : m.rates[c] || 1);
  const toBase = (v: number, c: string) => (v * r(c)) / r(m.currency || "UAH");
  let table = 0;
  let safe = 0;
  const safeAcc: HomeAccount[] = [];
  const tableAcc: HomeAccount[] = [];
  for (const a of m.accounts) {
    const v = toBase(a.balance, a.currency);
    if (inSafe(a)) {
      safe += v;
      safeAcc.push(a);
    } else {
      table += v;
      tableAcc.push(a);
    }
  }
  return { table, safe, safeAcc, tableAcc, toBase };
}

/** Номинал пачки: чтобы пачек было не больше max */
export function bundleValue(amount: number, max: number) {
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
  for (const s of steps) if (amount / s <= max) return s;
  return steps[steps.length - 1];
}

export const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ");
export const SYM: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", PLN: "zł", GBP: "£" };

