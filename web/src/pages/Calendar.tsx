import { useEffect, useState } from "react";
import { Page } from "../App";
import { MONTHS_NOM, MOODS, WD_SHORT, addDays, diffDays, fmtDate, mutate, useApi, weekday, type Today } from "../lib";
import { HabitRow, SkipModal } from "../ui/day";
import { Icon } from "../ui/icons";
import { Drawer, ErrorBox, Loading } from "../ui/kit";
import { TaskLine } from "./Dashboard";

interface CalDay {
  total: number;
  skipped: number;
  done: number;
  pass: boolean;
  mood: number | null;
  hasNote: boolean;
  tasks: number;
  tasksDone: number;
  taskTitles: string;
}

export function CalendarPage() {
  const [month, setMonth] = useState<string | null>(null);
  const { data, error } = useApi<{ month: string; today: string; days: Record<string, CalDay> }>(`/calendar${month ? `?month=${month}` : ""}`);
  const [sel, setSel] = useState<string | null>(null);

  if (error) return <Page title="Календарь"><ErrorBox error={error} /></Page>;
  if (!data) return <Page title="Календарь"><Loading /></Page>;

  const [y, m] = data.month.split("-").map(Number);
  const first = `${data.month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const start = addDays(first, -weekday(first));
  const end = addDays(last, 6 - weekday(last));
  const cells: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) cells.push(d);

  const shift = (n: number) => {
    const dt = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(dt.toISOString().slice(0, 7));
  };

  // итоги месяца
  let perfect = 0;
  let partial = 0;
  let missed = 0;
  let done = 0;
  let total = 0;
  for (const d of cells) {
    if (!d.startsWith(data.month) || d > data.today) continue;
    const c = data.days[d];
    if (!c || !c.total) continue;
    done += c.done;
    total += c.total;
    if (c.done >= c.total) perfect++;
    else if (c.pass || d === data.today) continue;
    else if (c.done > 0) partial++;
    else missed++;
  }

  return (
    <Page
      title="Календарь"
      sub="Каждый день — сколько из запланированного сделано"
      actions={
        <div className="row">
          <button className="btn icon" onClick={() => shift(-1)} aria-label="Назад">
            <Icon name="left" size={18} />
          </button>
          <button className="btn sm" onClick={() => setMonth(null)}>
            Сегодня
          </button>
          <button className="btn icon" onClick={() => shift(1)} aria-label="Вперёд">
            <Icon name="right" size={18} />
          </button>
        </div>
      }
    >
      <section className="card">
        <div className="row wrap between" style={{ marginBottom: 22 }}>
          <h2 className="serif" style={{ fontSize: 30, margin: 0 }}>
            {MONTHS_NOM[m - 1]} <span className="faint">{y}</span>
          </h2>
          <div className="row wrap">
            <span className="pill green">идеальных дней: {perfect}</span>
            <span className="pill amber">частично: {partial}</span>
            <span className="pill red">сорвано: {missed}</span>
            <span className="pill">{total ? Math.round((done / total) * 100) : 0}% выполнения</span>
          </div>
        </div>
        <div className="cal-head">
          {WD_SHORT.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="cal">
          {cells.map((d) => {
            const c = data.days[d];
            const future = d > data.today;
            let s = "";
            if (c && !c.total && c.skipped && !future) s = "s-pass";
            if (c && c.total) {
              if (future) s = "s-future";
              else if (c.done >= c.total) s = "s-full";
              else if (c.pass) s = "s-pass";
              else if (d === data.today) s = "s-today";
              else if (c.done > 0) s = "s-part";
              else s = "s-miss";
            }
            return (
              <button
                key={d}
                className={`cal-day ${s}${d.startsWith(data.month) ? "" : " out"}${d === data.today ? " today" : ""}${sel === d ? " sel" : ""}`}
                onClick={() => setSel(d)}
              >
                <div className="n">
                  <span>{Number(d.slice(8))}</span>
                  {c?.mood ? <span className="mood">{MOODS[c.mood - 1]}</span> : c?.hasNote ? <span className="faint">✎</span> : null}
                </div>
                {c && (c.total > 0 || c.skipped > 0) && (
                  <span className="score" title={c.skipped ? `Своих пропусков привычек: ${c.skipped}` : undefined}>
                    {c.pass && c.done < c.total ? "🎟 " : ""}
                    {c.total > 0 ? `${c.done}/${c.total}` : ""}
                    {c.skipped ? `${c.total > 0 ? " " : ""}↷${c.skipped}` : ""}
                  </span>
                )}
                {c && c.tasks > 0 && (
                  <div className="tasks" title={c.taskTitles}>
                    {c.tasksDone}/{c.tasks} · {c.taskTitles}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div className="legend" style={{ marginTop: 18 }}>
          <span>
            <i style={{ background: "var(--accent)" }} /> всё сделано
          </span>
          <span>
            <i style={{ background: "var(--warn)" }} /> частично
          </span>
          <span>
            <i style={{ background: "var(--danger)" }} /> сорвано
          </span>
          <span>
            <i style={{ background: "var(--blue)" }} /> пропуск
          </span>
        </div>
      </section>
      {sel && (
        <Drawer onClose={() => setSel(null)}>
          <DayPanel date={sel} onClose={() => setSel(null)} />
        </Drawer>
      )}
    </Page>
  );
}

export function DayPanel({ date, onClose }: { date: string; onClose: () => void }) {
  const { data } = useApi<Today>(`/today?date=${date}`);
  const [skip, setSkip] = useState(false);
  const [task, setTask] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => setNote(data?.note ?? ""), [data?.note, date]);

  if (!data) return <Loading />;
  const future = date > data.today;
  const canPass = !future && diffDays(date, data.today) <= 1;
  const pending = data.habits.filter((h) => !h.done && !h.skipped).length;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="eyebrow">{date === data.today ? "Сегодня" : future ? "Впереди" : "Было"}</div>
          <h3 className="serif" style={{ fontSize: 28, margin: "4px 0 0" }}>
            {fmtDate(date, { weekday: true })}
          </h3>
        </div>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Закрыть">
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="row wrap">
        {data.total > 0 && (
          <span className={`pill ${data.done >= data.total ? "green" : data.pass.usedToday ? "blue" : future ? "" : "amber"}`}>
            {data.done}/{data.total} привычек
          </span>
        )}
        {data.pass.usedToday && <span className="pill blue">🎟 пропуск{data.pass.reason ? `: ${data.pass.reason}` : ""}</span>}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {data.habits.length === 0 && <div className="muted">На этот день привычек не запланировано.</div>}
        {data.habits.map((h) => (
          <HabitRow key={h.id} h={h} date={date} editable={!future} />
        ))}
      </div>

      {canPass &&
        (data.pass.usedToday ? (
          <button className="btn sm" onClick={() => mutate(`/days/${date}/pass`, "DELETE")}>
            Отменить пропуск
          </button>
        ) : (
          pending > 0 && (
            <button className="btn ghost sm" onClick={() => setSkip(true)} style={{ alignSelf: "flex-start" }}>
              <Icon name="ticket" size={16} /> Взять пропуск на этот день
            </button>
          )
        ))}

      {!future && (
        <div>
          <div className="label" style={{ marginBottom: 8 }}>
            Настроение
          </div>
          <div className="row">
            {MOODS.map((m, i) => (
              <button
                key={m}
                className="btn icon"
                style={{ fontSize: 20, background: data.mood === i + 1 ? "var(--accent-soft)" : undefined, borderColor: data.mood === i + 1 ? "var(--accent)" : undefined }}
                onClick={() => mutate(`/days/${date}`, "PUT", { mood: data.mood === i + 1 ? null : i + 1 })}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span>Заметка дня</span>
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (data.note ?? "") && mutate(`/days/${date}`, "PUT", { note })} placeholder="Мысли, события, выводы…" />
      </label>

      <div>
        <div className="label" style={{ marginBottom: 8 }}>
          Задачи на этот день
        </div>
        <div className="row" style={{ marginBottom: 6 }}>
          <input
            className="input sm"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && task.trim()) {
                await mutate("/tasks", "POST", { title: task, date });
                setTask("");
              }
            }}
            placeholder="Добавить и нажать Enter"
          />
        </div>
        {data.tasks.map((t) => (
          <TaskLine key={t.id} t={t} today={data.today} showDate={false} />
        ))}
      </div>
      {skip && <SkipModal date={date} onClose={() => setSkip(false)} />}
    </div>
  );
}
