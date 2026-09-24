// Общие элементы дня: строка привычки, пропуск с таймером, фокус-таймер
import { useEffect, useRef, useState } from "react";
import { api, fmtDate, fmtMin, mutate, refresh, toast, type HabitDay, type SkipPreview } from "../lib";
import { Icon } from "./icons";
import { Bar, Modal, Ring } from "./kit";

export function HabitRow({ h, date, editable = true, onFocus }: { h: HabitDay; date: string; editable?: boolean; onFocus?: (h: HabitDay) => void }) {
  const toggle = async () => {
    const r = await mutate<{ done: boolean }>(`/habits/${h.id}/toggle`, "POST", { date });
    if (r.done) toast(`${h.emoji ?? "✅"} ${h.title} — готово`);
  };
  const add = (m: number) => mutate(`/habits/${h.id}/minutes`, "POST", { date, add: m });
  const pct = h.type === "minutes" && h.target_minutes ? Math.min(1, h.minutes / h.target_minutes) : h.done ? 1 : 0;
  return (
    <div className={`hrow${h.done ? " done" : ""}`}>
      <div className="emoji">{h.emoji || "•"}</div>
      <div className="body">
        <div className="title">
          {h.title}
          {h.goal_title && <span className="tag">🎯 {h.goal_title}</span>}
          {!!h.streak && h.streak > 1 && <span className="tag">🔥 {h.streak}</span>}
        </div>
        {h.type === "minutes" ? (
          <div style={{ marginTop: 8, maxWidth: 360 }}>
            <Bar value={pct} className="thin" />
            <div className="meta mono" style={{ marginTop: 6 }}>
              {Math.round(h.minutes)} / {h.target_minutes} мин
            </div>
          </div>
        ) : (
          <div className="meta">{h.done ? "Сделано" : "Отметь, когда сделаешь"}</div>
        )}
      </div>
      <div className="actions">
        {editable && h.type === "minutes" && !h.done && (
          <>
            <button className="btn xs" onClick={() => add(15)} title="Добавить 15 минут вручную">
              +15
            </button>
            {onFocus && (
              <button className="btn soft sm" onClick={() => onFocus(h)}>
                <Icon name="play" size={14} /> Фокус
              </button>
            )}
          </>
        )}
        {editable && (
          <button className={`check${h.done ? " on" : ""}`} onClick={toggle} aria-label={h.done ? "Снять отметку" : "Отметить"}>
            <Icon name="check" size={18} stroke={2.4} />
          </button>
        )}
      </div>
    </div>
  );
}

export function SkipModal({ date, onClose }: { date: string; onClose: () => void }) {
  const [p, setP] = useState<SkipPreview | null>(null);
  const [left, setLeft] = useState(20);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SkipPreview>(`/days/${date}/skip-preview`).then((d) => {
      setP(d);
      setLeft(d.countdown);
    });
  }, [date]);
  useEffect(() => {
    if (!p?.allowed || left <= 0) return;
    const t = setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [p, left]);

  const confirm = async () => {
    setBusy(true);
    try {
      await mutate(`/days/${date}/pass`, "POST", { reason });
      toast("🎟 Пропуск взят. Завтра — без поблажек.");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Точно пропустить?" sub={`${fmtDate(date, { weekday: true })} · пропусков на неделе: ${p ? `${p.passes.left} из ${p.passes.weekly}` : "…"}`} onClose={onClose}>
      {!p ? (
        <div className="spinner" />
      ) : (
        <div className="skip-box">
          <div className="headline">{p.headline}</div>
          {p.allowed && (
            <>
              <ul>
                {p.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              {p.why.map((w) => (
                <div className="why-quote" key={w.goal}>
                  <small>Ты сам писал про «{w.goal}»</small>«{w.text}»
                </div>
              ))}
              <div className="field" style={{ marginTop: 18 }}>
                <span>Почему? (честно, для себя)</span>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Заболел / поездка / просто лень…" />
              </div>
            </>
          )}
          <div className="modal-foot">
            {p.allowed ? (
              <>
                <button className="btn countdown-btn" disabled={left > 0 || busy} onClick={confirm}>
                  {left > 0 && <span className="fill" style={{ transform: `scaleX(${left / p.countdown})`, transition: "transform 1s linear" }} />}
                  <span style={{ position: "relative" }}>{left > 0 ? `Да, пропустить (${left})` : "Да, пропустить"}</span>
                </button>
                <button className="btn primary" onClick={onClose}>
                  Нет, я сделаю 💪
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={onClose}>
                Понятно
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Таймер фокуса на сайте: считает только пока вкладка видима, сбрасывает минуты раз в минуту */
export function FocusTimer({ habit, onClose }: { habit: HabitDay; onClose: () => void }) {
  const [sec, setSec] = useState(0);
  const [paused, setPaused] = useState(false);
  const pending = useRef(0);
  const base = habit.minutes;
  const target = habit.target_minutes ?? 60;

  const flush = async () => {
    const s = pending.current;
    if (s < 5) return;
    pending.current = 0;
    try {
      const r = await api<{ justCompleted: boolean }>(`/habits/${habit.id}/minutes`, "POST", { add: s / 60 });
      if (r.justCompleted) toast(`🎉 ${habit.title}: норма выполнена!`);
    } catch {
      pending.current += s;
    }
  };

  useEffect(() => {
    const t = setInterval(() => {
      if (paused || document.visibilityState !== "visible") return;
      setSec((x) => x + 1);
      pending.current += 1;
      if (pending.current >= 60) flush();
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const stop = async () => {
    await flush();
    refresh();
    onClose();
  };

  const total = base + sec / 60;
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="focus-screen">
      <div>
        <div className="eyebrow">Фокус · {habit.emoji} {habit.title}</div>
        <div style={{ margin: "28px auto", width: "fit-content" }}>
          <Ring value={total / target} size={300} stroke={10}>
            <div>
              <div className="time">
                {mm}:{ss}
              </div>
              <div className="muted mono">
                {Math.floor(total)} / {target} мин
              </div>
            </div>
          </Ring>
        </div>
        <div className="muted" style={{ maxWidth: 420, margin: "0 auto 26px" }}>
          {total >= target ? "Норма на сегодня выполнена. Можно остановиться — или добить ещё немного." : `Осталось ${fmtMin(target - total)}. Время идёт, пока эта вкладка открыта.`}
        </div>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn" onClick={() => setPaused(!paused)}>
            <Icon name={paused ? "play" : "pause"} size={16} /> {paused ? "Продолжить" : "Пауза"}
          </button>
          <button className="btn primary" onClick={stop}>
            <Icon name="check" size={16} /> Завершить
          </button>
        </div>
      </div>
    </div>
  );
}
