import { useState } from "react";
import { Page } from "../App";
import { addDays, mutate, useApi, type Goal, type Task } from "../lib";
import { useMe } from "../App";
import { Icon } from "../ui/icons";
import { Empty, ErrorBox, Loading, Seg } from "../ui/kit";
import { TaskLine } from "./Dashboard";

type View = "today" | "inbox" | "upcoming" | "done";

export function TasksPage() {
  const me = useMe();
  const today = me?.today ?? new Date().toISOString().slice(0, 10);
  const [view, setView] = useState<View>("today");
  const { data, error } = useApi<Task[]>(`/tasks?view=${view}`);
  const goals = useApi<Goal[]>("/goals");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<"today" | "tomorrow" | "none" | "date">("today");
  const [date, setDate] = useState(today);
  const [goal, setGoal] = useState(0);
  const [prio, setPrio] = useState(false);

  const add = async () => {
    if (!title.trim()) return;
    const d = when === "today" ? today : when === "tomorrow" ? addDays(today, 1) : when === "date" ? date : null;
    await mutate("/tasks", "POST", { title, date: d, goal_id: goal || null, priority: prio ? 2 : 0 });
    setTitle("");
  };

  return (
    <Page title="Задачи" sub="Разовые дела. Всё, что пишешь боту, попадает во «Входящие»">
      <section className="card" style={{ marginBottom: 22 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            className="input lg"
            style={{ flex: "1 1 300px" }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Новая задача…"
          />
          <button className="btn primary" onClick={add}>
            <Icon name="plus" size={17} /> Добавить
          </button>
        </div>
        <div className="row wrap" style={{ marginTop: 14, gap: 10 }}>
          <Seg
            value={when}
            onChange={setWhen}
            options={[
              ["today", "Сегодня"],
              ["tomorrow", "Завтра"],
              ["none", "Без даты"],
              ["date", "Дата…"],
            ]}
          />
          {when === "date" && <input className="input sm" type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} />}
          <select className="input sm" style={{ width: 220 }} value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
            <option value={0}>Без цели</option>
            {goals.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.emoji} {g.title}
              </option>
            ))}
          </select>
          <button className={`btn sm ${prio ? "soft" : "ghost"}`} onClick={() => setPrio(!prio)}>
            ⚡ Важно
          </button>
        </div>
      </section>

      <div className="tabs">
        <Seg
          value={view}
          onChange={setView}
          options={[
            ["today", "Сегодня"],
            ["inbox", "Входящие"],
            ["upcoming", "Скоро"],
            ["done", "Готово"],
          ]}
        />
      </div>

      <section className="card">
        {error && <ErrorBox error={error} />}
        {!data && !error && <Loading />}
        {data && data.length === 0 && (
          <Empty icon={view === "inbox" ? "inbox" : "tasks"} title={view === "inbox" ? "Входящие пусты" : view === "done" ? "Пока ничего не сделано" : "Задач нет"}>
            {view === "inbox" ? "Напиши боту любую мысль — она окажется здесь." : ""}
          </Empty>
        )}
        {data?.map((t) => (
          <div key={t.id} className="row" style={{ gap: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TaskLine t={t} today={today} />
            </div>
            {view === "inbox" && (
              <button className="btn xs" onClick={() => mutate(`/tasks/${t.id}`, "PUT", { date: today })}>
                На сегодня
              </button>
            )}
          </div>
        ))}
      </section>
    </Page>
  );
}
