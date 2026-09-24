import type { Env } from "../env";

export const DEFAULT_BLOCKLIST = [
  "youtube.com",
  "tiktok.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "reddit.com",
  "twitch.tv",
  "netflix.com",
  "9gag.com",
];

const DEFAULTS = {
  timezone: "Europe/Kyiv",
  morning_enabled: "1",
  morning_time: "08:30",
  reminder_enabled: "1",
  reminder_time: "19:00",
  evening_enabled: "1",
  evening_time: "21:30",
  weekly_review_enabled: "1",
  weekly_passes: "1",
  block_enabled: "1",
  block_from: "08:00",
  block_to: "23:59",
  blocklist: JSON.stringify(DEFAULT_BLOCKLIST),
  base_currency: "UAH",
  rates: JSON.stringify({ UAH: 1, USD: 41.3, EUR: 48.2 }),
  rates_date: "",
  wish_cooldown_days: "7",
  owner_tg_id: "",
  owner_name: "",
  bot_username: "",
  webhook_url: "",
  public_url: "",
  streak_cache: "",
};

export type SettingKey = keyof typeof DEFAULTS;
export type Settings = Record<SettingKey, string>;

/** Ключи, которые можно менять с сайта */
export const EDITABLE: SettingKey[] = [
  "timezone",
  "morning_enabled",
  "morning_time",
  "reminder_enabled",
  "reminder_time",
  "evening_enabled",
  "evening_time",
  "weekly_review_enabled",
  "weekly_passes",
  "block_enabled",
  "block_from",
  "block_to",
  "blocklist",
  "base_currency",
  "rates",
  "wish_cooldown_days",
];

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const s: Settings = { ...DEFAULTS };
  for (const r of results) if (r.key in s) s[r.key as SettingKey] = r.value;
  return s;
}

export async function setSettings(db: D1Database, values: Partial<Settings>): Promise<void> {
  const entries = Object.entries(values).filter(([k, v]) => k in DEFAULTS && typeof v === "string");
  if (!entries.length) return;
  await db.batch(
    entries.map(([k, v]) =>
      db.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v),
    ),
  );
}

export function ownerId(env: Env, s: Settings): string {
  return (env.OWNER_TELEGRAM_ID || s.owner_tg_id || "").trim();
}

export function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function publicUrl(env: Env, s: Settings): string {
  return (env.PUBLIC_URL || s.public_url || "").replace(/\/$/, "");
}
