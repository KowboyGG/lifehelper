// Формы целей и привычек
import { useState } from "react";
import { mutate, toast, useApi, type Goal } from "../lib";
import { DaysPicker, EmojiInput, Field, Modal, Seg, Switch } from "./kit";

export interface HabitFull {
  id: number;
  goal_id: number | null;
  title: string;
  emoji: string | null;
  type: "check" | "minutes";
  target_minutes: number | null;
  days: string;
  start_url: string | null;
  focus_sites: string[];
  blocking: boolean;
  start_date: string;
  archived_at: string | null;
  goal_title: string | null;
  streak: number;
  rate28: number | null;
  minutes28: number;
  total_minutes: number;
  recent: number[];
}

export function GoalModal({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const [f, setF] = useState({
    title: goal?.title ?? "",
    emoji: goal?.emoji ?? "🎯",
    why: goal?.why ?? "",
    start_date: goal?.start_date ?? new Date().toISOString().slice(0, 10),
    deadline: goal?.deadline ?? "",
    kind: goal?.target_value ? "value" : "habit",
    target_value: goal?.target_value ?? "",
    current_value: goal?.current_value ?? 0,
    unit: goal?.unit ?? "",
    daily: 60,
    daily_type: "minutes" as "minutes" | "check",
    days: "1111111",
    start_url: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.title.trim()) return toast("Назови цель", true);
    setBusy(true);
    try {
      const body = {
        title: f.title,
        emoji: f.emoji,
        why: f.why,
        start_date: f.start_date,
        deadline: f.deadline || null,
        target_value: f.kind === "value" ? Number(f.target_value) || null : null,
        current_value: f.kind === "value" ? Number(f.current_value) || 0 : 0,
        unit: f.kind === "value" ? f.unit : null,
      };
      if (goal) {
        await mutate(`/goals/${goal.id}`, "PUT", body);
      } else {
        const { id } = await mutate<{ id: number }>("/goals", "POST", body);
        if (f.kind === "habit" && (f.daily_type === "check" || f.daily > 0)) {
          await mutate("/habits", "POST", {
            title: f.title.replace(/^(выучить|научиться|освоить)\s+/i, "").replace(/^./, (c) => c.toUpperCase()),
            emoji: f.emoji,
            goal_id: id,
            type: f.daily_type,
            target_minutes: f.daily,
            days: f.days,
            start_url: f.start_url || null,
            focus_sites: f.start_url ? [f.start_url] : [],
            start_date: f.start_date,
          });
        }
        toast("🎯 Цель создана");
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={goal ? "Цель" : "Новая цель"}
      sub="Большая цель + ежедневная норма = понятный путь до дедлайна"
      onClose={onClose}
      wide
      foot={
        <>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {goal ? "Сохранить" : "Создать цель"}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <EmojiInput value={f.emoji} onChange={(v) => set("emoji", v)} />
          <Field label="Цель">
            <input className="input lg" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Выучить математику" />
          </Field>
        </div>
        <Field label="Зачем мне это" hint="Этот текст ты увидишь, когда рука потянется нажать «Пропустить». Пиши честно.">
          <textarea className="input" value={f.why} onChange={(e) => set("why", e.target.value)} placeholder="Хочу поступить на CS и перестать бояться формул" />
        </Field>
        <div className="form-row">
          <Field label="Старт">
            <input className="input" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </Field>
          <Field label="Дедлайн">
            <input className="input" type="date" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
          </Field>
        </div>
        <Field label="Как считаем прогресс">
          <Seg
            value={f.kind}
            onChange={(v) => set("kind", v)}
            options={[
              ["habit", "Ежедневной практикой"],
              ["value", "Числом (книги, деньги…)"],
            ]}
          />
        </Field>
        {f.kind === "value" ? (
          <div className="form-row">
            <Field label="Сколько нужно">
              <input className="input" type="number" value={f.target_value} onChange={(e) => set("target_value", e.target.value)} placeholder="12" />
            </Field>
            <Field label="Уже есть">
              <input className="input" type="number" value={f.current_value} onChange={(e) => set("current_value", Number(e.target.value))} />
            </Field>
            <Field label="Единица">
              <input className="input" value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="книг" />
            </Field>
          </div>
        ) : goal ? (
          <div className="muted" style={{ fontSize: 14 }}>
            Прогресс считается по привязанным привычкам: {goal.habits.map((h) => h.title).join(", ") || "пока ни одной — привяжи на странице «Привычки»"}.
          </div>
        ) : (
          <div className="card tight" style={{ background: "var(--card-2)", animation: "none" }}>
            <div className="form">
              <div className="row wrap between">
                <b>Ежедневная норма</b>
                <Seg
                  value={f.daily_type}
                  onChange={(v) => set("daily_type", v)}
                  options={[
                    ["minutes", "Время"],
                    ["check", "Галочка"],
                  ]}
                />
              </div>
              {f.daily_type === "minutes" && (
                <Field label="Минут в день">
                  <input className="input" type="number" min={5} step={5} value={f.daily} onChange={(e) => set("daily", Number(e.target.value))} />
                </Field>
              )}
              <Field label="Дни">
                <DaysPicker value={f.days} onChange={(v) => set("days", v)} />
              </Field>
              <Field label="Где заниматься (необязательно)" hint="Сюда расширение отправит по кнопке «Начать», и время на этом сайте засчитается.">
                <input className="input" value={f.start_url} onChange={(e) => set("start_url", e.target.value)} placeholder="khanacademy.org" />
              </Field>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function HabitModal({ habit, goalId, onClose }: { habit?: HabitFull; goalId?: number; onClose: () => void }) {
  const goals = useApi<Goal[]>("/goals");
  const [f, setF] = useState({
    title: habit?.title ?? "",
    emoji: habit?.emoji ?? "",
    goal_id: habit?.goal_id ?? goalId ?? 0,
    type: habit?.type ?? "check",
    target_minutes: habit?.target_minutes ?? 30,
    days: habit?.days ?? "1111111",
    blocking: habit?.blocking ?? true,
    start_url: habit?.start_url ?? "",
    focus_sites: (habit?.focus_sites ?? []).join("\n"),
    start_date: habit?.start_date ?? new Date().toISOString().slice(0, 10),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.title.trim()) return toast("Назови привычку", true);
    const body = { ...f, goal_id: f.goal_id || null, focus_sites: f.focus_sites };
    if (habit) await mutate(`/habits/${habit.id}`, "PUT", body);
    else await mutate("/habits", "POST", body);
    toast(habit ? "Сохранено" : "Привычка добавлена");
    onClose();
  };
  const archive = async () => {
    await mutate(`/habits/${habit!.id}`, "PUT", { archived: !habit!.archived_at });
    onClose();
  };
  const remove = async () => {
    if (!confirm("Удалить привычку вместе со всей историей? Если просто надоела — лучше в архив.")) return;
    await mutate(`/habits/${habit!.id}`, "DELETE");
    onClose();
  };

  return (
    <Modal
      title={habit ? "Привычка" : "Новая привычка"}
      sub="То, что делаешь регулярно и отмечаешь галочкой"
      onClose={onClose}
      wide
      foot={
        <>
          {habit && (
            <>
              <button className="btn ghost" onClick={remove} style={{ color: "var(--danger)" }}>
                Удалить
              </button>
              <button className="btn ghost" onClick={archive} style={{ marginRight: "auto" }}>
                {habit.archived_at ? "Вернуть из архива" : "В архив"}
              </button>
            </>
          )}
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="form">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <EmojiInput value={f.emoji} onChange={(v) => set("emoji", v)} />
          <Field label="Название">
            <input className="input lg" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Математика" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Цель">
            <select className="input" value={f.goal_id} onChange={(e) => set("goal_id", Number(e.target.value))}>
              <option value={0}>— без цели —</option>
              {goals.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.emoji} {g.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Начало">
            <input className="input" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </Field>
        </div>
        <div className="row wrap" style={{ gap: 18, alignItems: "flex-end" }}>
          <Field label="Как отмечать">
            <Seg
              value={f.type}
              onChange={(v) => set("type", v)}
              options={[
                ["check", "Галочка"],
                ["minutes", "Время"],
              ]}
            />
          </Field>
          {f.type === "minutes" && (
            <Field label="Минут в день">
              <input className="input" style={{ width: 130 }} type="number" min={1} value={f.target_minutes} onChange={(e) => set("target_minutes", Number(e.target.value))} />
            </Field>
          )}
        </div>
        <Field label="Дни">
          <DaysPicker value={f.days} onChange={(v) => set("days", v)} />
        </Field>
        <div className="setting-row" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="txt">
            <div className="t">Блокировать отвлечения, пока не сделано</div>
            <div className="d">Расширение закроет YouTube, TikTok и т.п. экраном «Сначала — {f.title || "дело"}»</div>
          </div>
          <Switch on={f.blocking} onChange={(v) => set("blocking", v)} />
        </div>
        <div className="form-row">
          <Field label="Кнопка «Начать» ведёт на" hint="Например, khanacademy.org или ссылка на курс">
            <input className="input" value={f.start_url} onChange={(e) => set("start_url", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Засчитывать время на сайтах" hint="Каждый с новой строки. Можно путь: youtube.com/@3blue1brown">
            <textarea className="input" style={{ minHeight: 60 }} value={f.focus_sites} onChange={(e) => set("focus_sites", e.target.value)} placeholder={"khanacademy.org\nstepik.org"} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
