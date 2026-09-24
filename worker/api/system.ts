import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createSession } from "../lib/auth";
import { all, run, str } from "../lib/db";
import { getStreak, isScheduled, loadHistory, localToday, logOf, summarizeDay } from "../lib/progress";
import { EDITABLE, getSettings, ownerId, parseList, setSettings, type Settings } from "../lib/settings";
import { addDays, nowInTz, weekStart, weekday } from "../lib/time";
import { ensureWebhook, sendMessage } from "../bot/telegram";
import { normalizeSite } from "../lib/db";

export const system = new Hono<AppEnv>();

// ---------------------------------------------------------------- настройки

system.get("/settings", async (c) => {
  const s = await getSettings(c.env.DB);
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) out[k] = s[k];
  out.blocklist = parseList(s.blocklist);
  try {
    out.rates = JSON.parse(s.rates);
  } catch {
    out.rates = {};
  }
  return c.json({
    ...out,
    info: {
      owner_name: s.owner_name,
      owner_id: ownerId(c.env, s),
      owner_from_env: !!c.env.OWNER_TELEGRAM_ID,
      bot_username: s.bot_username,
      bot_configured: !!c.env.TELEGRAM_BOT_TOKEN,
      webhook_url: s.webhook_url,
      rates_date: s.rates_date,
    },
  });
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

system.put("/settings", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const out: Partial<Settings> = {};
  for (const k of EDITABLE) {
    const v = b[k];
    if (v === undefined) continue;
    if (k.endsWith("_time") || k === "block_from" || k === "block_to") {
      if (typeof v === "string" && TIME.test(v)) out[k] = v;
    } else if (k.endsWith("_enabled")) out[k] = v ? "1" : "0";
    else if (k === "weekly_passes" || k === "wish_cooldown_days") out[k] = String(Math.max(0, Math.min(7, Math.round(Number(v) || 0))));
    else if (k === "blocklist") {
      const list = (Array.isArray(v) ? v : String(v).split(/[\s,]+/)).map((x) => normalizeSite(String(x))).filter(Boolean);
      out.blocklist = JSON.stringify([...new Set(list)].slice(0, 100));
    } else if (k === "timezone") {
      try {
        nowInTz(String(v));
        new Intl.DateTimeFormat("en", { timeZone: String(v) });
        out.timezone = String(v);
      } catch {
        return c.json({ error: "Неизвестный часовой пояс" }, 400);
      }
    } else if (k === "rates" && typeof v === "object" && v) {
      const r: Record<string, number> = { UAH: 1 };
      for (const [cur, val] of Object.entries(v)) if (Number(val) > 0) r[cur] = Number(val);
      out.rates = JSON.stringify(r);
    } else if (k === "base_currency") out.base_currency = String(v).slice(0, 3).toUpperCase();
  }
  await setSettings(c.env.DB, out);
  if (out.timezone || out.weekly_passes) await run(c.env.DB, "DELETE FROM settings WHERE key = 'streak_cache'");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- бот

system.post("/bot/reconnect", async (c) => {
  try {
    await ensureWebhook(c.env, new URL(c.req.url).origin, true);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

system.post("/bot/test", async (c) => {
  const s = await getSettings(c.env.DB);
  const owner = ownerId(c.env, s);
  if (!owner) return c.json({ error: "Владелец не определён — войди через Telegram" }, 400);
  try {
    await sendMessage(c.env, owner, "👋 Бот на связи. Вечером пришлю чек-лист дня.");
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---------------------------------------------------------------- токены / сессии

system.get("/tokens", async (c) => {
  const rows = await all<{ id: number; kind: string; label: string | null; created_at: number; last_used_at: number | null }>(
    c.env.DB,
    "SELECT id, kind, label, created_at, last_used_at FROM sessions WHERE expires_at IS NULL OR expires_at > ? ORDER BY last_used_at DESC",
    Date.now(),
  );
  return c.json(rows.map((r) => ({ ...r, current: r.id === c.get("sessionId") })));
});

system.post("/tokens", async (c) => {
  const b = await c.req.json<{ label?: string }>().catch(() => ({}) as { label?: string });
  const token = await createSession(c.env.DB, "ext", str(b.label, 60) ?? "Chrome-расширение");
  return c.json({ token });
});

system.delete("/tokens/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM sessions WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- экспорт

system.get("/export", async (c) => {
  const tables = ["goals", "habits", "habit_logs", "days", "tasks", "focus_sessions", "site_time", "accounts", "transactions", "wishes", "stickers"];
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), version: 1 };
  for (const t of tables) out[t] = await all(c.env.DB, `SELECT * FROM ${t}`);
  c.header("Content-Disposition", `attachment; filename="lifehelper-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json(out);
});

// ---------------------------------------------------------------- статистика

system.get("/stats", async (c) => {
  const db = c.env.DB;
  const { s, today } = await localToday(db);
  const hist = await loadHistory(db);

  // тепловая карта за 53 недели, начиная с понедельника
  const heatStart = weekStart(addDays(today, -364));
  const heatmap = [];
  for (let d = heatStart; d <= today; d = addDays(d, 1)) heatmap.push(summarizeDay(hist, d));

  // 12 недель: процент выполнения
  const weeks: { week: string; done: number; total: number; passes: number; rate: number | null }[] = [];
  const thisWeek = weekStart(today);
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(thisWeek, -7 * i);
    let done = 0;
    let total = 0;
    let passes = 0;
    for (let j = 0; j < 7; j++) {
      const d = addDays(ws, j);
      if (d > today) break;
      const sum = summarizeDay(hist, d);
      if (sum.pass) passes++;
      if (sum.pass && sum.done < sum.total) continue;
      done += sum.done;
      total += d === today && sum.done < sum.total ? sum.done : sum.total;
    }
    weeks.push({ week: ws, done, total, passes, rate: total ? done / total : null });
  }

  // по дням недели (последние 12 недель)
  const byWeekday = Array.from({ length: 7 }, () => ({ done: 0, total: 0 }));
  for (let d = addDays(thisWeek, -84); d < today; d = addDays(d, 1)) {
    const sum = summarizeDay(hist, d);
    if (sum.pass) continue;
    byWeekday[weekday(d)].done += sum.done;
    byWeekday[weekday(d)].total += sum.total;
  }

  // минуты по привычкам по неделям
  const focus = hist.habits
    .filter((h) => h.type === "minutes")
    .map((h) => {
      const perWeek = weeks.map((w) => {
        let m = 0;
        for (let j = 0; j < 7; j++) m += logOf(hist, h.id, addDays(w.week, j))?.minutes ?? 0;
        return Math.round(m);
      });
      return { id: h.id, title: h.title, emoji: h.emoji, archived: !!h.archived_at, weeks: perWeek };
    })
    .filter((f) => f.weeks.some((m) => m > 0) || !f.archived);

  // отвлечения за 14 дней
  const from14 = addDays(today, -13);
  const siteRows = await all<{ date: string; domain: string; seconds: number }>(db, "SELECT date, domain, seconds FROM site_time WHERE date >= ?", from14);
  const distractions = [];
  for (let d = from14; d <= today; d = addDays(d, 1)) {
    const rows = siteRows.filter((r) => r.date === d);
    distractions.push({ date: d, seconds: rows.reduce((a, r) => a + r.seconds, 0) });
  }
  const topSites = new Map<string, number>();
  for (const r of siteRows) topSites.set(r.domain, (topSites.get(r.domain) ?? 0) + r.seconds);

  const focusRows = await all<{ date: string; seconds: number; clicks: number; keys: number }>(
    db,
    "SELECT date, SUM(seconds) AS seconds, SUM(clicks) AS clicks, SUM(keys) AS keys FROM focus_sessions WHERE date >= ? GROUP BY date",
    from14,
  );

  const moods = await all<{ date: string; mood: number }>(db, "SELECT date, mood FROM days WHERE mood IS NOT NULL AND date >= ? ORDER BY date", addDays(today, -59));

  const totals = await all<{ k: string; v: number }>(
    db,
    `SELECT 'minutes' AS k, COALESCE(SUM(minutes),0) AS v FROM habit_logs
     UNION ALL SELECT 'done', COUNT(*) FROM habit_logs WHERE done = 1
     UNION ALL SELECT 'passes', COUNT(*) FROM days WHERE pass_used = 1
     UNION ALL SELECT 'tasks', COUNT(*) FROM tasks WHERE done_at IS NOT NULL`,
  );
  const streak = await getStreak(db, s, today, summarizeDay(hist, today));

  // Честная доля «сделал по плану» за 30 дней
  let sched30 = 0;
  let done30 = 0;
  for (let d = addDays(today, -30); d < today; d = addDays(d, 1)) {
    for (const h of hist.habits) {
      if (!isScheduled(h, d)) continue;
      sched30++;
      if (logOf(hist, h.id, d)?.done) done30++;
    }
  }

  return c.json({
    today,
    heatmap,
    weeks,
    byWeekday,
    focus,
    focusDays: focusRows,
    distractions,
    topSites: [...topSites].map(([domain, seconds]) => ({ domain, seconds })).sort((a, b) => b.seconds - a.seconds).slice(0, 8),
    moods,
    streak,
    rate30: sched30 ? done30 / sched30 : null,
    totals: Object.fromEntries(totals.map((t) => [t.k, t.v])),
  });
});
