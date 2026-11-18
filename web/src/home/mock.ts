// Демо-данные для отладочного стенда (как в scripts/seed-demo.mjs)
import type { HomeData } from "./props";

export function mockData(): HomeData {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const days: Record<string, { total: number; done: number; pass: boolean }> = {};
  const d0 = Number(today.slice(8, 10));
  for (let d = 1; d < d0; d++) {
    const k = (d * 7) % 10;
    days[`${month}-${String(d).padStart(2, "0")}`] = { total: 3, done: k < 6 ? 3 : k < 8 ? 2 : k < 9 ? 0 : 1, pass: d === 9 };
  }
  return {
    today: {
      date: today,
      today,
      habits: [
        { id: 1, title: "Математика", emoji: "📐", type: "minutes", target_minutes: 60, goal_id: 1, goal_title: "Выучить математику", goal_why: null, start_url: null, focus_sites: [], blocking: true, days: "1111111", done: false, minutes: 25, skipped: false, skips_per_month: 2, skips_left: 2, streak: 12 },
        { id: 2, title: "Английский", emoji: "🇬🇧", type: "minutes", target_minutes: 20, goal_id: null, goal_title: null, goal_why: null, start_url: null, focus_sites: [], blocking: false, days: "1111111", done: true, minutes: 22, skipped: false, skips_per_month: 2, skips_left: 2, streak: 15 },
        { id: 3, title: "Чтение перед сном", emoji: "🌙", type: "check", target_minutes: null, goal_id: 2, goal_title: null, goal_why: null, start_url: null, focus_sites: [], blocking: false, days: "1111111", done: false, minutes: 0, skipped: false, skips_per_month: 2, skips_left: 2, streak: 10 },
      ],
      done: 1,
      total: 3,
      skipped: 0,
      pass: { weekly: 1, used: 0, left: 1, usedToday: false, reason: null },
      mood: null,
      note: null,
      streak: { current: 10, best: 10 },
      goals: [],
      tasks: [],
      focus: { seconds: 1500, clicks: 0, keys: 0 },
      distractions: [{ domain: "youtube.com", seconds: 3240 }],
      money: { total: 38526, currency: "UAH", expense: 2882, income: 18000 },
      last: [],
    },
    stickers: [
      { id: 1, kind: "goal", ref_id: 1, text: null, date: null, color: "yellow", pinned: 1 },
      { id: 2, kind: "countdown", ref_id: null, text: "НМТ по математике", date: "2027-05-20", color: "blue", pinned: 0 },
      { id: 3, kind: "note", ref_id: null, text: "Не жди мотивации. Сядь на 10 минут — дальше пойдёт.", date: null, color: "pink", pinned: 1 },
      { id: 4, kind: "note", ref_id: null, text: "Книги: «Атомные привычки», «Думай медленно»", date: null, color: "white", pinned: 0 },
      { id: 5, kind: "streak", ref_id: null, text: null, date: null, color: "orange", pinned: 0 },
      { id: 6, kind: "wish", ref_id: 1, text: null, date: null, color: "purple", pinned: 0 },
      { id: 7, kind: "money", ref_id: null, text: null, date: null, color: "green", pinned: 0 },
    ],
    goals: [
      { id: 1, title: "Выучить математику", emoji: "📐", progress: 0.37 } as never,
    ],
    wishes: [{ id: 1, title: "Наушники Sony WH-1000XM5", emoji: "🎧", price: 12999, currency: "UAH", cooldown_left: 0, status: "active" }],
    money: {
      total: 38526,
      currency: "UAH",
      rates: { USD: 41.3, EUR: 48.2 },
      accounts: [
        { id: 1, name: "Монобанк", emoji: "🐈", currency: "UAH", balance: 14750 },
        { id: 2, name: "Наличные", emoji: "💵", currency: "UAH", balance: 2300 },
        { id: 3, name: "Копилка $", emoji: "🛟", currency: "USD", balance: 520 },
      ],
    },
    calendar: { month, today, days },
  };
}
