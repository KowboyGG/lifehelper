import { useState } from "react";
import { Page } from "../App";
import { fmtMin, plural, useApi } from "../lib";
import { HabitModal, type HabitFull } from "../ui/forms";
import { Icon } from "../ui/icons";
import { Empty, ErrorBox, Loading, daysLabel } from "../ui/kit";

export function HabitsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, error } = useApi<HabitFull[]>(`/habits${showArchived ? "?all=1" : ""}`);
  const [edit, setEdit] = useState<HabitFull | "new" | null>(null);

  return (
    <Page
      title="Привычки"
      sub="Ежедневные действия, из которых складываются цели"
      actions={
        <button className="btn primary" onClick={() => setEdit("new")}>
          <Icon name="plus" size={17} /> Привычка
        </button>
      }
    >
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && data.length === 0 && (
        <Empty icon="repeat" title="Пока ни одной привычки">
          Начни с одной. Маленькой. Например — 20 минут математики.
        </Empty>
      )}
      <div className="cards">
        {data?.map((h) => (
          <section key={h.id} className="card" style={{ opacity: h.archived_at ? 0.55 : 1, cursor: "pointer" }} onClick={() => setEdit(h)}>
            <div className="row" style={{ gap: 14 }}>
              <div className="stat-ico" style={{ width: 50, height: 50, fontSize: 24, borderRadius: 16 }}>
                {h.emoji || "•"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700 }}>
                  {h.title}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {h.type === "minutes" ? `${h.target_minutes} мин` : "галочка"} · {daysLabel(h.days)}
                  {h.archived_at ? " · в архиве" : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="serif" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>
                  🔥{h.streak}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {plural(h.streak, "день", "дня", "дней")}
                </div>
              </div>
            </div>
            <div className="strip" style={{ margin: "18px 0 8px" }} title="Последние 4 недели">
              {h.recent.map((s, i) => (
                <i key={i} className={`s${s}`} />
              ))}
            </div>
            <div className="row wrap between muted" style={{ fontSize: 12.5 }}>
              <span>28 дней: {h.rate28 !== null ? `${Math.round(h.rate28 * 100)}%` : "—"}</span>
              {h.type === "minutes" && <span>всего {fmtMin(h.total_minutes)}</span>}
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 14 }}>
              {h.goal_title && <span className="pill">🎯 {h.goal_title}</span>}
              {h.blocking && (
                <span className="pill amber" title="Блокирует отвлекающие сайты, пока не сделано">
                  <Icon name="shield" size={13} /> блок
                </span>
              )}
              {h.start_url && <span className="pill blue">▶ {h.start_url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 28)}</span>}
            </div>
          </section>
        ))}
      </div>
      <div style={{ marginTop: 26 }}>
        <button className="btn ghost sm" onClick={() => setShowArchived(!showArchived)}>
          <Icon name="archive" size={15} /> {showArchived ? "Скрыть архив" : "Показать архив"}
        </button>
      </div>
      {edit && <HabitModal habit={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </Page>
  );
}
