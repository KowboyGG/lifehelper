import { useEffect, useState } from "react";
import { Page } from "../App";
import { MOODS, WD_SHORT, addDays, weekday, fmtDate, fmtMin, fmtSec, money, mutate, navigate, plural, relDay, toast, useApi, type Goal, type HabitDay, type Task, type Today } from "../lib";
import { FocusTimer, HabitRow, SkipModal } from "../ui/day";
import { GoalModal, HabitModal } from "../ui/forms";
import { Icon } from "../ui/icons";
import { Bar, Empty, ErrorBox, Loading, Modal, Ring } from "../ui/kit";
import { COLORS, StickerCard, stickerLabel, useStickerCtx, type Sticker } from "../ui/stickers";

export function Dashboard() {
  const { data, error } = useApi<Today>("/today");
  const [skip, setSkip] = useState(false);
  const [focus, setFocus] = useState<HabitDay | null>(null);
  const [newGoal, setNewGoal] = useState(false);
  const [newHabit, setNewHabit] = useState(false);

  if (error) return <Page title="Сегодня"><ErrorBox error={error} /></Page>;
  if (!data) return <Page title="Сегодня"><Loading /></Page>;

  const d = data;
  const pct = d.total ? d.done / d.total : 0;
  const pending = d.habits.filter((h) => !h.done);
  const distraction = d.distractions.reduce((a, x) => a + x.seconds, 0);

  return (
    <Page
      title="Сегодня"
      sub={fmtDate(d.date, { weekday: true })}
    >
      {d.total === 0 && d.goals.length === 0 ? (
        <Onboarding onGoal={() => setNewGoal(true)} onHabit={() => setNewHabit(true)} />
      ) : (
        <div className="bento">
          {/* Итог дня */}
          <section className="card span-8 fill">
            <div className="row between" style={{ alignItems: "flex-start" }}>
              <div className="eyebrow">Прогресс дня</div>
              {d.pass.usedToday ? (
                <button className="btn ghost sm" onClick={() => mutate(`/days/${d.date}/pass`, "DELETE")}>
                  Отменить пропуск
                </button>
              ) : (
                pending.length > 0 && (
                  <button className="btn ghost sm" onClick={() => setSkip(true)}>
                    <Icon name="ticket" size={16} /> Пропустить день
                  </button>
                )
              )}
            </div>
            <div className="row" style={{ alignItems: "baseline", gap: 14, marginTop: 10 }}>
              <div className="big-num">
                {d.done}
                <small> из {d.total}</small>
              </div>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {d.pass.usedToday
                ? "🎟 Сегодня пропуск — стрик заморожен, цель ждёт завтра."
                : d.total === 0
                  ? "На сегодня привычек нет — день для задач и отдыха."
                  : d.done === d.total
                    ? "День закрыт. Ты сделал всё, что обещал себе 🎉"
                    : `Осталось: ${pending.map((h) => h.title).join(", ")}`}
            </div>
            <WeekStrip days={d.last} today={d.today} />
            <div className="stat-cells" style={{ marginTop: "auto", paddingTop: 22 }}>
              <div className="stat-cell">
                <div className="stat-ico green">
                  <Icon name="focus" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Фокус</div>
                  <div className="v">{d.focus.seconds ? fmtSec(d.focus.seconds) : "—"}</div>
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-ico red">
                  <Icon name="alert" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Отвлечения</div>
                  <div className="v">{distraction ? fmtSec(distraction) : "—"}</div>
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-ico blue">
                  <Icon name="ticket" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Пропуски · неделя</div>
                  <div className="v">
                    {d.pass.left} из {d.pass.weekly}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Стрик */}
          <section className="card span-4 fill" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ textAlign: "left" }}>
              Стрик
            </div>
            <div style={{ display: "grid", placeItems: "center", margin: "10px 0 6px" }}>
              <Ring value={d.pass.usedToday ? 1 : pct} size={176} stroke={13}>
                <div>
                  <div className="serif" style={{ fontSize: 48, fontWeight: 800, lineHeight: 1 }}>
                    {d.streak.current}
                  </div>
                  <div className="eyebrow" style={{ marginTop: 6, fontSize: 11 }}>
                    {plural(d.streak.current, "день", "дня", "дней")} подряд
                  </div>
                </div>
              </Ring>
            </div>
            <div className="muted" style={{ fontSize: 14 }}>
              Рекорд <b style={{ color: "var(--text)" }}>{d.streak.best}</b> · сегодня {Math.round(pct * 100)}%
            </div>
            <MiniHeat days={d.last} today={d.today} />
          </section>

          <PinnedNotes streak={d.streak.current} />

          {/* Лента дня */}
          <div className="span-8 stack">
            <section className="card">
              <div className="card-head">
                <h2 style={{ fontStyle: "italic" }}>Лента дня</h2>
                <div className="spacer" />
                <Clock />
              </div>
              {d.habits.length ? (
                <div className="timeline">
                  {d.habits.map((h) => (
                    <HabitRow key={h.id} h={h} date={d.date} onFocus={setFocus} />
                  ))}
                </div>
              ) : (
                <Empty icon="repeat" title="Привычек на сегодня нет">
                  <button className="link-btn" onClick={() => setNewHabit(true)} style={{ marginTop: 8 }}>
                    Добавить привычку
                  </button>
                </Empty>
              )}
            </section>
            <TodayTasks tasks={d.tasks} today={d.today} />
          </div>

          <div className="span-4 stack">
            <GoalsMini goals={d.goals} onNew={() => setNewGoal(true)} />
            <MoodCard date={d.date} mood={d.mood} note={d.note} />
            <section className="card tight" style={{ cursor: "pointer" }} onClick={() => navigate("/money")}>
              <div className="row between">
                <div className="eyebrow">Деньги</div>
                <Icon name="right" size={16} className="faint" />
              </div>
              <div className="serif" style={{ fontSize: 32, fontWeight: 800, marginTop: 8 }}>
                {money(d.money.total, d.money.currency)}
              </div>
              <div className="muted" style={{ fontSize: 13.5 }}>
                В этом месяце: −{money(d.money.expense, d.money.currency).replace(/^−/, "")} · +{money(d.money.income, d.money.currency)}
              </div>
            </section>
            <section className="card tight">
              <div className="eyebrow" style={{ marginBottom: 12 }}>
                Куда ушло время
              </div>
              {d.distractions.length ? (
                d.distractions.slice(0, 5).map((x) => (
                  <div className="hbar" key={x.domain} style={{ gridTemplateColumns: "110px 1fr auto" }}>
                    <span className="name">{x.domain}</span>
                    <Bar value={x.seconds / d.distractions[0].seconds} className="thin" color="var(--danger)" />
                    <span className="mono muted" style={{ fontSize: 12 }}>
                      {fmtSec(x.seconds)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="muted" style={{ fontSize: 14 }}>
                  Пока пусто.{" "}
                  <button className="link-btn" onClick={() => navigate("/extension")}>
                    Поставь расширение
                  </button>{" "}
                  — оно покажет, сколько съедают соцсети.
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {skip && <SkipModal date={d.date} onClose={() => setSkip(false)} />}
      {focus && <FocusTimer habit={focus} onClose={() => setFocus(null)} />}
      {newGoal && <GoalModal onClose={() => setNewGoal(false)} />}
      {newHabit && <HabitModal onClose={() => setNewHabit(false)} />}
    </Page>
  );
}

function WeekStrip({ days, today }: { days: Today["last"]; today: string }) {
  const monday = addDays(today, -weekday(today));
  const cells = WD_SHORT.map((label, i) => {
    const date = addDays(monday, i);
    return { label, date, x: days.find((x) => x.date === date) };
  });
  return (
    <div className="week-strip">
      {cells.map(({ label, date, x }) => {
        const future = date > today;
        const cls = !x || x.total === 0 || future ? "" : x.done >= x.total ? "full" : x.pass ? "pass" : date === today ? "now" : x.done > 0 ? "part" : "miss";
        return (
          <div key={date} className={`ws-day ${cls}${date === today ? " today" : ""}`}>
            <span>{label}</span>
            <b>{future || !x || x.total === 0 ? "·" : x.pass && x.done < x.total ? "🎟" : `${x.done}/${x.total}`}</b>
          </div>
        );
      })}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return <span className="mono accent" style={{ fontWeight: 700 }}>{now.toTimeString().slice(0, 5)}</span>;
}

function MiniHeat({ days, today }: { days: Today["last"]; today: string }) {
  return (
    <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
      <div className="heat" style={{ gridTemplateRows: "repeat(5, 1fr)", gridAutoFlow: "row", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {days.map((x) => {
          const cls =
            x.total === 0 ? "none" : x.done >= x.total ? "l3" : x.pass ? "pass" : x.date === today ? (x.done ? "l1" : "") : x.done ? "l1 miss" : "miss";
          return <i key={x.date} className={cls} title={`${fmtDate(x.date)}: ${x.done}/${x.total}${x.pass ? " (пропуск)" : ""}`} style={{ width: 16, height: 16 }} />;
        })}
      </div>
    </div>
  );
}

function TodayTasks({ tasks, today }: { tasks: Task[]; today: string }) {
  const [title, setTitle] = useState("");
  const add = async () => {
    if (!title.trim()) return;
    await mutate("/tasks", "POST", { title, date: today });
    setTitle("");
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Задачи</h2>
        <span className="pill">{tasks.filter((t) => !t.done_at).length}</span>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => navigate("/tasks")}>
          Все задачи <Icon name="right" size={14} />
        </button>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Что ещё нужно сделать сегодня?" />
        <button className="btn primary icon" onClick={add} aria-label="Добавить">
          <Icon name="plus" />
        </button>
      </div>
      {tasks.length === 0 && <div className="muted" style={{ fontSize: 14, padding: "8px 4px" }}>Пусто. Разовые дела на сегодня — сюда.</div>}
      {tasks.map((t) => (
        <TaskLine key={t.id} t={t} today={today} />
      ))}
    </section>
  );
}

export function TaskLine({ t, today, showDate = true }: { t: Task; today: string; showDate?: boolean }) {
  const toggle = async () => {
    await mutate(`/tasks/${t.id}`, "PUT", { done: !t.done_at });
    if (!t.done_at) toast("✔ Готово");
  };
  const overdue = t.date && t.date < today && !t.done_at;
  return (
    <div className={`task${t.done_at ? " done" : ""}`}>
      <button className={`check sm${t.done_at ? " on" : ""}`} onClick={toggle} aria-label="Отметить">
        <Icon name="check" size={14} stroke={2.6} />
      </button>
      <div className="t">
        <div className="title">{t.title}</div>
        <div className="sub">
          {showDate && t.date && <span className={overdue ? "danger" : ""}>{overdue ? `просрочено · ${relDay(t.date, today)}` : relDay(t.date, today)}</span>}
          {t.time && <span className="mono">{t.time}</span>}
          {t.goal_title && (
            <span>
              {t.goal_emoji} {t.goal_title}
            </span>
          )}
          {t.priority === 2 && <span className="warn">важно</span>}
        </div>
      </div>
      {overdue && (
        <button className="btn xs" onClick={() => mutate(`/tasks/${t.id}`, "PUT", { date: today })}>
          На сегодня
        </button>
      )}
      <button className="btn ghost icon sm x" onClick={() => mutate(`/tasks/${t.id}`, "DELETE")} aria-label="Удалить">
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

function GoalsMini({ goals, onNew }: { goals: Goal[]; onNew: () => void }) {
  return (
    <section className="card tight">
      <div className="card-head" style={{ marginBottom: 14 }}>
        <h2>Цели</h2>
        <div className="spacer" />
        <button className="btn ghost icon sm" onClick={onNew} aria-label="Новая цель">
          <Icon name="plus" size={18} />
        </button>
      </div>
      {goals.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Глобальных целей пока нет.</div>}
      <div className="stack" style={{ gap: 16 }}>
        {goals.slice(0, 4).map((g) => (
          <div key={g.id} style={{ cursor: "pointer" }} onClick={() => navigate("/goals")}>
            <div className="row between" style={{ marginBottom: 7 }}>
              <b style={{ fontSize: 14.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {g.emoji} {g.title}
              </b>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                {g.progress !== null ? `${Math.round(g.progress * 100)}%` : "—"}
              </span>
            </div>
            <Bar value={g.progress ?? 0} mark={g.expected !== null && g.planned_total ? g.expected / g.planned_total : null} />
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              <GoalPace g={g} short />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const fmtAmount = (n: number) => (n >= 10 ? Math.round(n).toLocaleString("ru-RU") : n.toFixed(1).replace(/\.0$/, ""));

export function GoalPace({ g, short }: { g: Goal; short?: boolean }) {
  const parts: string[] = [];
  if (g.days_left !== null) parts.push(`${g.days_left} ${plural(g.days_left, "день", "дня", "дней")} до дедлайна`);
  if (g.mode === "minutes" && g.required_per_day !== null && g.habits.length === 1) {
    const norm = g.habits[0].target_minutes ?? 0;
    if (g.required_per_day <= norm * 1.01) parts.push("идёшь по плану ✓");
    else parts.push(`нужно ${Math.ceil(g.required_per_day)} мин/день вместо ${norm}`);
  } else if (g.required_factor !== null) {
    parts.push(g.required_factor <= 1.01 ? "идёшь по плану ✓" : `нужно +${Math.round((g.required_factor - 1) * 100)}% к норме`);
  } else if (g.mode === "value" && g.required_per_day !== null && g.target_value) {
    const r = g.required_per_day;
    const unit = g.unit ? ` ${g.unit}` : "";
    parts.push(r < 1 ? `нужно ${fmtAmount(r * 7)}${unit} в неделю` : `нужно ${fmtAmount(r)}${unit} в день`);
  } else if (g.mode === "minutes" && !g.deadline) {
    parts.push(`всего ${fmtMin(g.done_amount)}`);
  }
  if (!short && g.projected_finish && g.deadline && g.projected_finish > g.deadline) parts.push(`в текущем темпе финиш ${fmtDate(g.projected_finish)}`);
  return <>{parts.join(" · ")}</>;
}

function MoodCard({ date, mood, note }: { date: string; mood: number | null; note: string | null }) {
  const [text, setText] = useState(note ?? "");
  useEffect(() => setText(note ?? ""), [note, date]);
  const saveNote = () => text !== (note ?? "") && mutate(`/days/${date}`, "PUT", { note: text }).then(() => toast("Записал"));
  return (
    <section className="card tight">
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Как день?
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        {MOODS.map((m, i) => (
          <button
            key={m}
            className="btn icon"
            style={{
              fontSize: 22,
              width: 46,
              height: 46,
              background: mood === i + 1 ? "var(--accent-soft)" : undefined,
              borderColor: mood === i + 1 ? "var(--accent)" : undefined,
            }}
            onClick={() => mutate(`/days/${date}`, "PUT", { mood: mood === i + 1 ? null : i + 1 })}
          >
            {m}
          </button>
        ))}
      </div>
      <textarea className="input" style={{ minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} onBlur={saveNote} placeholder="Пара строк о дне — что получилось, что мешало…" />
    </section>
  );
}

function Onboarding({ onGoal, onHabit }: { onGoal: () => void; onHabit: () => void }) {
  return (
    <section className="card" style={{ padding: "48px 40px", textAlign: "center", maxWidth: 760, margin: "20px auto" }}>
      <span className="pill green">
        <span className="dot" /> Начало
      </span>
      <h2 className="serif" style={{ fontSize: 40, margin: "18px 0 10px", lineHeight: 1.15 }}>
        Одна большая цель.
        <br />
        Один маленький шаг в день.
      </h2>
      <p className="muted" style={{ maxWidth: 520, margin: "0 auto 28px", fontSize: 16 }}>
        Например: «Выучить математику до 31 декабря» → по часу в день. Календарь покажет 0/1 каждый день, бот вечером спросит «сделал?», а расширение не пустит на YouTube, пока не сделаешь.
      </p>
      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn primary" onClick={onGoal}>
          Поставить цель
          <span className="btn-ico">
            <Icon name="right" size={14} />
          </span>
        </button>
        <button className="btn" onClick={onHabit}>
          Просто привычка
        </button>
      </div>
    </section>
  );
}

/** Заметки со стены, закреплённые на «Сегодня» */
function PinnedNotes({ streak }: { streak: number }) {
  const { data } = useApi<Sticker[]>("/stickers");
  const ctx = useStickerCtx(streak);
  const [text, setText] = useState("");
  const [pick, setPick] = useState(false);
  if (!data) return null;
  const pinned = data.filter((s) => s.pinned);
  const rest = data.filter((s) => !s.pinned);

  const add = async () => {
    if (!text.trim()) return;
    await mutate("/stickers", "POST", {
      kind: "note",
      text: text.trim(),
      pinned: 1,
      color: COLORS[Math.floor(Math.random() * 6)],
      x: 60 + Math.round(Math.random() * 700),
      y: 60 + Math.round(Math.random() * 400),
    });
    setText("");
  };

  return (
    <section className="card span-12">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <h2>Заметки</h2>
        <span className="pill">{pinned.length}</span>
        <div className="spacer" />
        <input
          className="input sm"
          style={{ width: "min(320px, 100%)" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Новая заметка и Enter…"
        />
        <button className="btn primary icon sm" onClick={add} aria-label="Добавить заметку">
          <Icon name="plus" size={16} />
        </button>
        <button className="btn sm" onClick={() => setPick(true)}>
          <Icon name="wall" size={15} /> Со стены
        </button>
      </div>
      {pinned.length === 0 ? (
        <div className="muted" style={{ fontSize: 14 }}>
          Здесь будут стикеры, которые важно видеть каждый день. Напиши заметку выше или закрепи любую со стены — кнопкой 📌 на стикере или «Со стены».
        </div>
      ) : (
        <div className="sticker-grid">
          {pinned.map((s) => (
            <StickerCard
              key={s.id}
              s={s}
              ctx={ctx}
              mode="static"
              onChange={(patch) => mutate(`/stickers/${s.id}`, "PUT", patch)}
              onDelete={() => confirm("Удалить стикер совсем (и со стены тоже)? Чтобы просто убрать отсюда — нажми 📌.") && mutate(`/stickers/${s.id}`, "DELETE")}
            />
          ))}
        </div>
      )}
      {pick && (
        <Modal title="Закрепить на «Сегодня»" sub="Стикер останется на стене и появится здесь" onClose={() => setPick(false)}>
          <div className="stack" style={{ gap: 8 }}>
            {rest.length === 0 && <div className="muted">На стене нет незакреплённых стикеров.</div>}
            {rest.map((s) => (
              <button
                key={s.id}
                className="btn"
                style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }}
                onClick={() => mutate(`/stickers/${s.id}`, "PUT", { pinned: 1 })}
              >
                <span className={`sticker-dot c-${s.color}`} /> {stickerLabel(s, ctx).slice(0, 80)}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}
