import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, first, int, num, run, str } from "../lib/db";
import { localToday } from "../lib/progress";
import type { Settings } from "../lib/settings";
import { addDays, isValidDate, monthBounds } from "../lib/time";

export const life = new Hono<AppEnv>();

const CURRENCIES = ["UAH", "USD", "EUR", "PLN", "GBP"];

interface AccountRow {
  id: number;
  name: string;
  emoji: string | null;
  currency: string;
  balance: number;
  sort: number;
}

export function converter(s: Settings) {
  let rates: Record<string, number> = {};
  try {
    rates = JSON.parse(s.rates);
  } catch {
    rates = {};
  }
  const base = s.base_currency || "UAH";
  const r = (cur: string) => (cur === "UAH" ? 1 : rates[cur] || 1);
  return { base, rates, to: (amount: number, cur: string) => (amount * r(cur)) / r(base) };
}

export async function moneySummary(db: D1Database, s: Settings, month: string) {
  const { base, rates, to } = converter(s);
  const { start, end } = monthBounds(month);
  const accounts = await all<AccountRow>(db, "SELECT * FROM accounts WHERE archived = 0 ORDER BY sort, id");
  const txs = await all<{ amount: number; category: string | null; currency: string; date: string }>(
    db,
    "SELECT t.amount, t.category, a.currency, t.date FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.date BETWEEN ? AND ?",
    start,
    end,
  );
  let income = 0;
  let expense = 0;
  const cats = new Map<string, number>();
  for (const t of txs) {
    const v = to(t.amount, t.currency);
    if (t.category === "Перевод") continue;
    if (v >= 0) income += v;
    else {
      expense += -v;
      const k = t.category || "Без категории";
      cats.set(k, (cats.get(k) ?? 0) - v);
    }
  }
  return {
    currency: base,
    rates,
    rates_date: s.rates_date,
    total: accounts.reduce((sum, a) => sum + to(a.balance, a.currency), 0),
    accounts,
    month: {
      month,
      income,
      expense,
      categories: [...cats].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    },
  };
}

life.get("/money", async (c) => {
  const db = c.env.DB;
  const { s, today } = await localToday(db);
  const month = /^\d{4}-\d{2}$/.test(c.req.query("month") ?? "") ? c.req.query("month")! : today.slice(0, 7);
  const summary = await moneySummary(db, s, month);
  const { to } = converter(s);
  const transactions = await all(
    db,
    `SELECT t.*, a.name AS account_name, a.emoji AS account_emoji, a.currency
       FROM transactions t JOIN accounts a ON a.id = t.account_id
      ORDER BY t.date DESC, t.id DESC LIMIT 60`,
  );
  // динамика за полгода
  const history: { month: string; income: number; expense: number }[] = [];
  const from = `${addDays(`${month}-01`, -160).slice(0, 7)}-01`;
  const rows = await all<{ ym: string; amount: number; currency: string; category: string | null }>(
    db,
    "SELECT substr(t.date,1,7) AS ym, t.amount, a.currency, t.category FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.date >= ? AND t.date <= ?",
    from,
    monthBounds(month).end,
  );
  for (const r of rows) {
    if (r.category === "Перевод") continue;
    let h = history.find((x) => x.month === r.ym);
    if (!h) history.push((h = { month: r.ym, income: 0, expense: 0 }));
    const v = to(r.amount, r.currency);
    if (v >= 0) h.income += v;
    else h.expense -= v;
  }
  history.sort((a, b) => a.month.localeCompare(b.month));
  const categories = await all<{ category: string }>(db, "SELECT category FROM transactions WHERE category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC LIMIT 20");
  return c.json({ ...summary, transactions, history, knownCategories: categories.map((x) => x.category), today });
});

life.post("/accounts", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const name = str(b.name, 60);
  if (!name) return c.json({ error: "Нужно название" }, 400);
  const cur = CURRENCIES.includes(String(b.currency)) ? String(b.currency) : "UAH";
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO accounts(name, emoji, currency, balance, sort, created_at) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM accounts), ?) RETURNING id",
    name,
    str(b.emoji, 16),
    cur,
    num(b.balance) ?? 0,
    Date.now(),
  );
  return c.json({ id: row!.id });
});

life.put("/accounts/:id", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  if (b.name !== undefined) out.name = str(b.name, 60) ?? "Счёт";
  if (b.emoji !== undefined) out.emoji = str(b.emoji, 16);
  if (b.currency !== undefined && CURRENCIES.includes(String(b.currency))) out.currency = b.currency;
  if (b.balance !== undefined) out.balance = num(b.balance) ?? 0;
  if (b.archived !== undefined) out.archived = b.archived ? 1 : 0;
  const keys = Object.keys(out);
  if (keys.length) await run(c.env.DB, `UPDATE accounts SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => out[k]), Number(c.req.param("id")));
  return c.json({ ok: true });
});

life.delete("/accounts/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM accounts WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

export async function addTransaction(
  db: D1Database,
  t: { account_id: number; amount: number; category: string | null; note: string | null; date: string },
): Promise<number> {
  const [ins] = await db.batch<{ id: number }>([
    db
      .prepare("INSERT INTO transactions(account_id, amount, category, note, date, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(t.account_id, t.amount, t.category, t.note, t.date, Date.now()),
    db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?").bind(t.amount, t.account_id),
  ]);
  return ins.results[0].id;
}

export async function deleteTransaction(db: D1Database, id: number): Promise<boolean> {
  const t = await first<{ account_id: number; amount: number }>(db, "SELECT account_id, amount FROM transactions WHERE id = ?", id);
  if (!t) return false;
  await db.batch([
    db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?").bind(t.amount, t.account_id),
    db.prepare("DELETE FROM transactions WHERE id = ?").bind(id),
  ]);
  return true;
}

/** Счёт по умолчанию для быстрых трат из бота — первый, либо создаём «Карта» */
export async function defaultAccount(db: D1Database): Promise<AccountRow> {
  const a = await first<AccountRow>(db, "SELECT * FROM accounts WHERE archived = 0 ORDER BY sort, id LIMIT 1");
  if (a) return a;
  const row = await first<AccountRow>(
    db,
    "INSERT INTO accounts(name, emoji, currency, balance, sort, created_at) VALUES ('Карта', '💳', 'UAH', 0, 1, ?) RETURNING *",
    Date.now(),
  );
  return row!;
}

life.post("/transactions", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const { today } = await localToday(c.env.DB);
  const amount = num(b.amount);
  const accountId = int(b.account_id);
  if (!amount || !accountId) return c.json({ error: "Нужны сумма и счёт" }, 400);
  if (b.to_account_id) {
    // перевод между счетами: списание + зачисление (с конвертацией по курсу)
    const toId = int(b.to_account_id)!;
    const accs = await all<AccountRow>(c.env.DB, "SELECT * FROM accounts WHERE id IN (?, ?)", accountId, toId);
    const src = accs.find((a) => a.id === accountId);
    const dst = accs.find((a) => a.id === toId);
    if (!src || !dst) return c.json({ error: "Счёт не найден" }, 400);
    const { rates } = converter((await localToday(c.env.DB)).s);
    const r = (cur: string) => (cur === "UAH" ? 1 : rates[cur] || 1);
    const abs = Math.abs(amount);
    const date = isValidDate(b.date) ? b.date : today;
    await addTransaction(c.env.DB, { account_id: src.id, amount: -abs, category: "Перевод", note: `→ ${dst.name}`, date });
    await addTransaction(c.env.DB, {
      account_id: dst.id,
      amount: num(b.to_amount) ?? Math.round(((abs * r(src.currency)) / r(dst.currency)) * 100) / 100,
      category: "Перевод",
      note: `← ${src.name}`,
      date,
    });
    return c.json({ ok: true });
  }
  const id = await addTransaction(c.env.DB, {
    account_id: accountId,
    amount,
    category: str(b.category, 40),
    note: str(b.note, 200),
    date: isValidDate(b.date) ? b.date : today,
  });
  return c.json({ id });
});

life.delete("/transactions/:id", async (c) => {
  const ok = await deleteTransaction(c.env.DB, Number(c.req.param("id")));
  return ok ? c.json({ ok }) : c.json({ error: "not found" }, 404);
});

// ---------------------------------------------------------------- вишлист

life.get("/wishes", async (c) => {
  const { s } = await localToday(c.env.DB);
  const cooldown = Math.max(0, Number(s.wish_cooldown_days) || 0);
  const rows = await all<{ created_at: number; status: string; price: number | null; currency: string }>(
    c.env.DB,
    "SELECT * FROM wishes ORDER BY status = 'want' DESC, priority DESC, created_at DESC",
  );
  const { to, base } = converter(s);
  const now = Date.now();
  return c.json({
    cooldown_days: cooldown,
    currency: base,
    items: rows.map((w) => ({
      ...w,
      price_base: w.price ? to(w.price, w.currency) : null,
      cooldown_left: w.status === "want" ? Math.max(0, Math.ceil((w.created_at + cooldown * 86400000 - now) / 86400000)) : 0,
    })),
  });
});

function wishInput(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (b.title !== undefined) out.title = str(b.title, 160);
  if (b.emoji !== undefined) out.emoji = str(b.emoji, 16);
  if (b.price !== undefined) out.price = num(b.price);
  if (b.currency !== undefined && CURRENCIES.includes(String(b.currency))) out.currency = b.currency;
  if (b.url !== undefined) {
    const u = str(b.url, 1000);
    out.url = u && !/^https?:\/\//.test(u) ? `https://${u}` : u;
  }
  if (b.note !== undefined) out.note = str(b.note, 1000);
  if (b.priority !== undefined) out.priority = Math.max(0, Math.min(2, int(b.priority) ?? 1));
  if (b.status !== undefined && ["want", "bought", "dropped"].includes(String(b.status))) {
    out.status = b.status;
    out.bought_at = b.status === "bought" ? Date.now() : null;
  }
  return out;
}

life.post("/wishes", async (c) => {
  const b = wishInput(await c.req.json());
  if (!b.title) return c.json({ error: "Нужно название" }, 400);
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO wishes(title, emoji, price, currency, url, note, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    b.title,
    b.emoji ?? null,
    b.price ?? null,
    b.currency ?? "UAH",
    b.url ?? null,
    b.note ?? null,
    b.priority ?? 1,
    Date.now(),
  );
  return c.json({ id: row!.id });
});

life.put("/wishes/:id", async (c) => {
  const raw = await c.req.json<Record<string, unknown>>();
  const b = wishInput(raw);
  if ("title" in b && !b.title) return c.json({ error: "Нужно название" }, 400);
  const id = Number(c.req.param("id"));
  const keys = Object.keys(b);
  if (keys.length) await run(c.env.DB, `UPDATE wishes SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => b[k]), id);
  // «Купил» + списать со счёта
  if (b.status === "bought" && raw.account_id) {
    const w = await first<{ title: string; price: number | null }>(c.env.DB, "SELECT title, price FROM wishes WHERE id = ?", id);
    const { today } = await localToday(c.env.DB);
    if (w?.price) await addTransaction(c.env.DB, { account_id: Number(raw.account_id), amount: -Math.abs(w.price), category: "Вишлист", note: w.title, date: today });
  }
  return c.json({ ok: true });
});

life.delete("/wishes/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM wishes WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- стена стикеров

const STICKER_KINDS = ["note", "goal", "wish", "countdown", "money", "streak", "quote"];
const COLORS = ["yellow", "pink", "green", "blue", "purple", "orange", "white"];

function stickerInput(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (b.kind !== undefined && STICKER_KINDS.includes(String(b.kind))) out.kind = b.kind;
  if (b.ref_id !== undefined) out.ref_id = int(b.ref_id);
  if (b.text !== undefined) out.text = str(b.text, 2000);
  if (b.date !== undefined) out.date = isValidDate(b.date) ? b.date : null;
  if (b.color !== undefined && COLORS.includes(String(b.color))) out.color = b.color;
  for (const k of ["x", "y", "rot"] as const) if (b[k] !== undefined) out[k] = num(b[k]) ?? 0;
  if (b.z !== undefined) out.z = int(b.z) ?? 1;
  if (b.pinned !== undefined) out.pinned = b.pinned ? 1 : 0;
  return out;
}

life.get("/stickers", async (c) => c.json(await all(c.env.DB, "SELECT * FROM stickers ORDER BY z, id")));

life.post("/stickers", async (c) => {
  const b = stickerInput(await c.req.json());
  const z = await first<{ z: number }>(c.env.DB, "SELECT COALESCE(MAX(z),0)+1 AS z FROM stickers");
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO stickers(kind, ref_id, text, date, color, x, y, rot, z, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    b.kind ?? "note",
    b.ref_id ?? null,
    b.text ?? null,
    b.date ?? null,
    b.color ?? "yellow",
    b.x ?? 60,
    b.y ?? 60,
    b.rot ?? Math.round((Math.random() * 6 - 3) * 10) / 10,
    z?.z ?? 1,
    b.pinned ?? 0,
    Date.now(),
  );
  return c.json({ id: row!.id });
});

life.put("/stickers/:id", async (c) => {
  const b = stickerInput(await c.req.json());
  const keys = Object.keys(b);
  if (keys.length) await run(c.env.DB, `UPDATE stickers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => b[k]), Number(c.req.param("id")));
  return c.json({ ok: true });
});

life.delete("/stickers/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM stickers WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});
