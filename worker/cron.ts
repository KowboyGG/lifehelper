// Запускается каждую минуту: утро, напоминание, вечерний чек-лист, итоги недели, курсы валют
import type { Env } from "./env";
import { ensureDay, run } from "./lib/db";
import { getSettings, ownerId, setSettings } from "./lib/settings";
import { nowInTz, timeToMinutes, weekday } from "./lib/time";
import { sendCheckin } from "./bot/handlers";
import { morningText, reminderText, weeklyText } from "./bot/messages";
import { sendMessage } from "./bot/telegram";

export async function runCron(env: Env, at = new Date()): Promise<string[]> {
  const db = env.DB;
  const s = await getSettings(db);
  const { date, minutes } = nowInTz(s.timezone, at);
  const done: string[] = [];
  await ensureDay(db, date);

  // Атомарно «забираем» флаг, чтобы при наложении запусков не отправить дважды
  const claim = async (flag: "morning_sent" | "reminder_sent" | "evening_sent" | "weekly_sent") =>
    ((await run(db, `UPDATE days SET ${flag} = 1 WHERE date = ? AND ${flag} = 0`, date)).meta.changes ?? 0) > 0;

  const owner = ownerId(env, s);
  if (owner && env.TELEGRAM_BOT_TOKEN) {
    const morning = timeToMinutes(s.morning_time);
    const reminder = timeToMinutes(s.reminder_time);
    const evening = timeToMinutes(s.evening_time);
    try {
      if (s.morning_enabled === "1" && minutes >= morning && minutes < morning + 180 && (await claim("morning_sent"))) {
        await sendMessage(env, owner, await morningText(db), [[{ text: "✅ Чек-лист", callback_data: `op:${date}` }]]);
        done.push("morning");
      }
      if (s.reminder_enabled === "1" && minutes >= reminder && minutes < Math.max(evening, reminder + 1) && (await claim("reminder_sent"))) {
        const text = await reminderText(db);
        if (text) {
          await sendMessage(env, owner, text, [[{ text: "✅ Отметить", callback_data: `op:${date}` }]]);
          done.push("reminder");
        }
      }
      if (s.evening_enabled === "1" && minutes >= evening && (await claim("evening_sent"))) {
        await sendCheckin(env, owner, date);
        done.push("evening");
        if (s.weekly_review_enabled === "1" && weekday(date) === 6 && (await claim("weekly_sent"))) {
          await sendMessage(env, owner, await weeklyText(db));
          done.push("weekly");
        }
      }
    } catch (e) {
      console.error("cron telegram", e);
    }
  }

  // Курсы НБУ раз в день
  if (s.rates_date !== date && minutes >= 9 * 60) {
    await setSettings(db, { rates_date: date });
    try {
      const res = await fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json");
      const list = (await res.json()) as { cc: string; rate: number }[];
      const rates: Record<string, number> = { UAH: 1 };
      for (const r of list) if (["USD", "EUR", "PLN", "GBP"].includes(r.cc)) rates[r.cc] = r.rate;
      if (rates.USD) await setSettings(db, { rates: JSON.stringify(rates) });
      done.push("rates");
    } catch (e) {
      console.error("rates", e);
    }
    // уборка
    await run(db, "DELETE FROM login_codes WHERE created_at < ?", Date.now() - 86400000);
    await run(db, "DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?", Date.now());
  }
  return done;
}
