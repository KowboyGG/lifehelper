import { useState } from "react";
import { Page } from "../App";
import { fmtDate, fmtMin, mutate, plural, toast, useApi, type Goal } from "../lib";
import { GoalModal, HabitModal } from "../ui/forms";
import { Icon } from "../ui/icons";
import { Bar, Empty, ErrorBox, Loading, Seg } from "../ui/kit";
import { GoalPace } from "./Dashboard";

export function GoalsPage() {
  const [status, setStatus] = useState<"active" | "done" | "archived">("active");
  const { data, error } = useApi<Goal[]>(`/goals?status=${status}`);
  const [edit, setEdit] = useState<Goal | "new" | null>(null);
  const [habitFor, setHabitFor] = useState<number | null>(null);

  return (
    <Page
      title="Цели"
      sub="Глобальные цели и то, успеваешь ли ты к дедлайну"
      actions={
        <button className="btn primary" onClick={() => setEdit("new")}>
          <Icon name="plus" size={17} /> Новая цель
        </button>
      }
    >
      <div className="tabs">
        <Seg
          value={status}
          onChange={setStatus}
          options={[
            ["active", "Активные"],
            ["done", "Достигнутые"],
            ["archived", "Архив"],
          ]}
        />
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && data.length === 0 && (
        <Empty icon="target" title={status === "active" ? "Пока нет целей" : "Здесь пусто"}>
          {status === "active" && "Поставь одну большую цель на год — и разбей её на ежедневную норму."}
        </Empty>
      )}
      <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
        {data?.map((g) => (
          <GoalCard key={g.id} g={g} onEdit={() => setEdit(g)} onAddHabit={() => setHabitFor(g.id)} />
        ))}
      </div>
      {edit && <GoalModal goal={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {habitFor && <HabitModal goalId={habitFor} onClose={() => setHabitFor(null)} />}
    </Page>
  );
}

function amountText(g: Goal) {
  if (g.mode === "value") return `${fmtNum(g.current_value)} из ${fmtNum(g.target_value ?? 0)} ${g.unit ?? ""}`;
  if (g.mode === "minutes") return g.planned_total ? `${fmtMin(g.done_amount)} из ${fmtMin(g.planned_total)}` : `${fmtMin(g.done_amount)} всего`;
  if (g.mode === "days") return g.planned_total ? `${g.done_amount} из ${g.planned_total} дней` : `${g.done_amount} ${plural(g.done_amount, "день", "дня", "дней")}`;
  if (g.mode === "tasks") return `${g.tasks_done} из ${g.tasks_total} шагов`;
  return "Привяжи привычку или задачи, чтобы считать прогресс";
}
const fmtNum = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

function GoalCard({ g, onEdit, onAddHabit }: { g: Goal; onEdit: () => void; onAddHabit: () => void }) {
  const [add, setAdd] = useState("1");
  const tracked = g.mode === "value" ? g.expected !== null : g.required_factor !== null;
  const behind = g.mode === "value" ? g.diff !== null && g.diff < 0 : g.diff !== null && g.diff < 0 && g.required_factor !== null && g.required_factor > 1.01;
  const mark = g.expected !== null && g.planned_total ? g.expected / g.planned_total : null;
  const pct = g.progress !== null ? Math.round(g.progress * 100) : null;

  return (
    <section className="card">
      <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
        <div className="stat-ico" style={{ width: 52, height: 52, fontSize: 26, borderRadius: 17 }}>
          {g.emoji || "🎯"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>
            {g.title}
          </h2>
          <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
            {g.deadline && (
              <span className={`pill ${g.days_left !== null && g.days_left < 14 ? "amber" : ""}`}>
                до {fmtDate(g.deadline)} · {g.days_left} {plural(g.days_left ?? 0, "день", "дня", "дней")}
              </span>
            )}
            {g.status === "done" && <span className="pill green">🏆 достигнута</span>}
            {g.status === "active" && tracked && (
              <span className={`pill ${behind ? "red" : "green"}`}>
                <span className="dot" />
                {behind ? "отстаёшь" : "по плану"}
              </span>
            )}
          </div>
        </div>
        <button className="btn ghost icon sm" onClick={onEdit} aria-label="Редактировать">
          <Icon name="edit" size={17} />
        </button>
      </div>

      <div className="row between" style={{ margin: "22px 0 10px", alignItems: "flex-end" }}>
        <div className="serif" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>
          {pct !== null ? `${pct}%` : "—"}
        </div>
        <div className="muted" style={{ fontSize: 13.5, textAlign: "right" }}>
          {amountText(g)}
        </div>
      </div>
      <Bar value={g.progress ?? 0} mark={mark} className="thick" />
      <div className="muted" style={{ fontSize: 13.5, marginTop: 10, minHeight: 20 }}>
        <GoalPace g={g} />
      </div>

      {g.why && (
        <div className="why-quote" style={{ fontSize: 16 }}>
          <small>Зачем</small>«{g.why}»
        </div>
      )}

      <div className="divider" />
      <div className="row wrap" style={{ gap: 8 }}>
        {g.habits.map((h) => (
          <span key={h.id} className="pill">
            {h.emoji} {h.title}
            {h.type === "minutes" ? ` · ${h.target_minutes} мин` : ""}
          </span>
        ))}
        {g.mode !== "value" && g.status === "active" && (
          <button className="btn ghost xs" onClick={onAddHabit}>
            <Icon name="plus" size={13} /> привычка
          </button>
        )}
      </div>

      {g.status === "active" && (
        <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
          {g.mode === "value" && (
            <>
              <input className="input sm" style={{ width: 80 }} type="number" value={add} onChange={(e) => setAdd(e.target.value)} />
              <button className="btn soft sm" onClick={() => mutate(`/goals/${g.id}/add`, "POST", { value: Number(add) || 0 }).then(() => toast(`+${add} ${g.unit ?? ""}`))}>
                <Icon name="plus" size={14} /> Добавить
              </button>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn sm"
            onClick={() => mutate(`/goals/${g.id}`, "PUT", { status: "done" }).then(() => toast("🏆 Цель достигнута! Ты молодец."))}
          >
            🏆 Достигнута
          </button>
          <button className="btn ghost sm" onClick={() => mutate(`/goals/${g.id}`, "PUT", { status: "archived" })}>
            <Icon name="archive" size={15} />
          </button>
        </div>
      )}
      {g.status !== "active" && (
        <div className="row" style={{ marginTop: 16, gap: 8 }}>
          <button className="btn sm" onClick={() => mutate(`/goals/${g.id}`, "PUT", { status: "active" })}>
            Вернуть в активные
          </button>
          <button
            className="btn ghost sm"
            style={{ color: "var(--danger)" }}
            onClick={() => confirm("Удалить цель насовсем? Привычки останутся.") && mutate(`/goals/${g.id}`, "DELETE")}
          >
            Удалить
          </button>
        </div>
      )}
    </section>
  );
}
