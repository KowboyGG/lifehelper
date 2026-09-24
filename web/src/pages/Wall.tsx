import { useEffect, useRef, useState } from "react";
import { Page, useMe } from "../App";
import { api, diffDays, fmtDate, money, mutate, plural, useApi, type Goal } from "../lib";
import { Icon } from "../ui/icons";
import { Field, Loading, Modal } from "../ui/kit";

interface Sticker {
  id: number;
  kind: "note" | "goal" | "wish" | "countdown" | "money" | "streak";
  ref_id: number | null;
  text: string | null;
  date: string | null;
  color: string;
  x: number;
  y: number;
  rot: number;
  z: number;
}
interface Wish {
  id: number;
  title: string;
  emoji: string | null;
  price: number | null;
  currency: string;
  cooldown_left: number;
  status: string;
}

const COLORS = ["yellow", "pink", "green", "blue", "purple", "orange", "white"];
const COLOR_HEX: Record<string, string> = {
  yellow: "#fde58a",
  pink: "#f9b9cc",
  green: "#b7ebc9",
  blue: "#b9d6fb",
  purple: "#d7c6fb",
  orange: "#fcc79b",
  white: "#fbfaf6",
};

export function WallPage() {
  const me = useMe();
  const stickers = useApi<Sticker[]>("/stickers");
  const goals = useApi<Goal[]>("/goals");
  const wishes = useApi<{ items: Wish[] }>("/wishes");
  const moneyData = useApi<{ total: number; currency: string }>("/money");
  const [local, setLocal] = useState<Sticker[]>([]);
  const [pick, setPick] = useState<"goal" | "wish" | "countdown" | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stickers.data) setLocal(stickers.data);
  }, [stickers.data]);

  const spot = () => {
    const el = wrap.current;
    const sx = el ? el.scrollLeft : 0;
    const sy = el ? el.scrollTop : 0;
    const w = el ? el.clientWidth : 800;
    return { x: Math.round(sx + 60 + Math.random() * Math.max(100, w - 340)), y: Math.round(sy + 50 + Math.random() * 220) };
  };
  const add = (body: Partial<Sticker>) => mutate("/stickers", "POST", { color: COLORS[Math.floor(Math.random() * 6)], ...spot(), ...body });

  const update = (id: number, patch: Partial<Sticker>, save = true) => {
    setLocal((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    if (save) api(`/stickers/${id}`, "PUT", patch).catch(() => undefined);
  };

  const maxZ = local.reduce((m, s) => Math.max(m, s.z), 0);

  return (
    <Page
      title="Стена"
      sub="Стикеры с тем, что важно видеть каждый день. Перетаскивай как хочешь"
    >
      <div className="row wrap" style={{ marginBottom: 16 }}>
          <button className="btn primary sm" onClick={() => add({ kind: "note", text: "Новая мысль" })}>
            <Icon name="plus" size={15} /> Заметка
          </button>
          <button className="btn sm" onClick={() => setPick("goal")}>
            🎯 Цель
          </button>
          <button className="btn sm" onClick={() => setPick("countdown")}>
            ⏳ Отсчёт
          </button>
          <button className="btn sm" onClick={() => setPick("wish")}>
            🎁 Желание
          </button>
          <button className="btn sm" onClick={() => add({ kind: "money", color: "green" })}>
            💰 Деньги
          </button>
          <button className="btn sm" onClick={() => add({ kind: "streak", color: "orange" })}>
            🔥 Стрик
          </button>
          <span className="faint" style={{ fontSize: 13, marginLeft: 6 }}>
            Двойной клик по заметке — редактировать
          </span>
      </div>
      {!stickers.data ? (
        <Loading />
      ) : (
        <div className="board-wrap" ref={wrap}>
          <div className="board">
            {local.length === 0 && (
              <div className="muted" style={{ position: "absolute", left: 40, top: 40, maxWidth: 380 }}>
                Здесь пусто. Приклей цель, отсчёт до важной даты или мысль, которую нельзя забыть. Из Telegram — командой <span className="kbd">/note текст</span>.
              </div>
            )}
            {local.map((s) => (
              <StickerView
                key={s.id}
                s={s}
                goal={goals.data?.find((g) => g.id === s.ref_id)}
                wish={wishes.data?.items.find((w) => w.id === s.ref_id)}
                streak={me?.streak.current ?? 0}
                total={moneyData.data ? money(moneyData.data.total, moneyData.data.currency) : "…"}
                onMove={(x, y, save) => update(s.id, { x, y }, save)}
                onFront={() => s.z < maxZ && update(s.id, { z: maxZ + 1 })}
                onChange={(patch) => update(s.id, patch)}
                onDelete={() => mutate(`/stickers/${s.id}`, "DELETE")}
              />
            ))}
          </div>
        </div>
      )}

      {pick === "goal" && (
        <Modal title="Какую цель приклеить?" onClose={() => setPick(null)}>
          <div className="stack" style={{ gap: 8 }}>
            {goals.data?.length === 0 && <div className="muted">Сначала создай цель.</div>}
            {goals.data?.map((g) => (
              <button
                key={g.id}
                className="btn"
                style={{ justifyContent: "flex-start" }}
                onClick={() => {
                  add({ kind: "goal", ref_id: g.id, color: "yellow" });
                  setPick(null);
                }}
              >
                {g.emoji} {g.title}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {pick === "wish" && (
        <Modal title="Какое желание приклеить?" onClose={() => setPick(null)}>
          <div className="stack" style={{ gap: 8 }}>
            {wishes.data?.items.filter((w) => w.status === "want").length === 0 && <div className="muted">Вишлист пуст.</div>}
            {wishes.data?.items
              .filter((w) => w.status === "want")
              .map((w) => (
                <button
                  key={w.id}
                  className="btn"
                  style={{ justifyContent: "flex-start" }}
                  onClick={() => {
                    add({ kind: "wish", ref_id: w.id, color: "pink" });
                    setPick(null);
                  }}
                >
                  {w.emoji ?? "🎁"} {w.title}
                </button>
              ))}
          </div>
        </Modal>
      )}
      {pick === "countdown" && <CountdownModal onClose={() => setPick(null)} onAdd={(text, date) => add({ kind: "countdown", text, date, color: "blue" })} />}
    </Page>
  );
}

function CountdownModal({ onClose, onAdd }: { onClose: () => void; onAdd: (text: string, date: string) => void }) {
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  return (
    <Modal
      title="Отсчёт до даты"
      sub="Экзамен, поездка, день рождения — сколько осталось"
      onClose={onClose}
      foot={
        <button
          className="btn primary"
          disabled={!text || !date}
          onClick={() => {
            onAdd(text, date);
            onClose();
          }}
        >
          Приклеить
        </button>
      }
    >
      <div className="form">
        <Field label="Что">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Экзамен по математике" autoFocus />
        </Field>
        <Field label="Когда">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function StickerView({
  s,
  goal,
  wish,
  streak,
  total,
  onMove,
  onFront,
  onChange,
  onDelete,
}: {
  s: Sticker;
  goal?: Goal;
  wish?: Wish;
  streak: number;
  total: string;
  onMove: (x: number, y: number, save: boolean) => void;
  onFront: () => void;
  onChange: (p: Partial<Sticker>) => void;
  onDelete: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.text ?? "");
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, textarea")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, x: s.x, y: s.y, moved: false };
    setDrag(true);
    onFront();
  };
  const move = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st) return;
    const dx = e.clientX - st.px;
    const dy = e.clientY - st.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
    onMove(Math.max(0, Math.min(1780, st.x + dx)), Math.max(10, Math.min(1140, st.y + dy)), false);
  };
  const up = (e: React.PointerEvent) => {
    const st = start.current;
    start.current = null;
    setDrag(false);
    if (st?.moved) onMove(Math.max(0, Math.min(1780, st.x + e.clientX - st.px)), Math.max(10, Math.min(1140, st.y + e.clientY - st.py)), true);
  };

  let body: React.ReactNode;
  if (s.kind === "note") {
    body = editing ? (
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (text !== s.text) onChange({ text });
        }}
      />
    ) : (
      <div className="s-text" onDoubleClick={() => setEditing(true)}>
        {s.text || "…"}
      </div>
    );
  } else if (s.kind === "goal") {
    body = goal ? (
      <>
        <div className="s-kind">Цель</div>
        <div className="s-text">
          {goal.emoji} {goal.title}
        </div>
        <div className="s-big" style={{ fontSize: 36 }}>
          {goal.progress !== null ? `${Math.round(goal.progress * 100)}%` : "—"}
        </div>
        <div className="s-bar">
          <i style={{ width: `${(goal.progress ?? 0) * 100}%` }} />
        </div>
        {goal.deadline && (
          <div className="s-sub">
            до {fmtDate(goal.deadline)} · {goal.days_left} {plural(goal.days_left ?? 0, "день", "дня", "дней")}
          </div>
        )}
      </>
    ) : (
      <div className="s-sub">Цель удалена или завершена</div>
    );
  } else if (s.kind === "wish") {
    body = wish ? (
      <>
        <div className="s-kind">Хочу</div>
        <div className="s-text">
          {wish.emoji ?? "🎁"} {wish.title}
        </div>
        {wish.price && <div className="s-big" style={{ fontSize: 30 }}>{money(wish.price, wish.currency)}</div>}
        <div className="s-sub">{wish.status === "bought" ? "✓ куплено" : wish.cooldown_left > 0 ? `остынь ещё ${wish.cooldown_left} дн.` : "можно покупать"}</div>
      </>
    ) : (
      <div className="s-sub">Желание удалено</div>
    );
  } else if (s.kind === "countdown" && s.date) {
    const n = diffDays(today, s.date);
    body = (
      <>
        <div className="s-kind">Отсчёт</div>
        <div className="s-big">{Math.abs(n)}</div>
        <div className="s-sub">
          {n >= 0 ? `${plural(n, "день", "дня", "дней")} до` : `${plural(-n, "день", "дня", "дней")} назад`} · {fmtDate(s.date)}
        </div>
        <div className="s-text" style={{ fontSize: 17 }}>
          {s.text}
        </div>
      </>
    );
  } else if (s.kind === "money") {
    body = (
      <>
        <div className="s-kind">Все деньги</div>
        <div className="s-big" style={{ fontSize: 32 }}>
          {total}
        </div>
      </>
    );
  } else if (s.kind === "streak") {
    body = (
      <>
        <div className="s-kind">Стрик</div>
        <div className="s-big">🔥 {streak}</div>
        <div className="s-sub">{plural(streak, "день", "дня", "дней")} подряд. Не разрывай цепочку.</div>
      </>
    );
  }

  return (
    <div
      className={`sticker c-${s.color}${drag ? " dragging" : ""}${editing ? " editing" : ""}`}
      style={{ left: s.x, top: s.y, zIndex: s.z, transform: `rotate(${drag ? 0 : s.rot}deg)${drag ? " scale(1.03)" : ""}` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {body}
      <div className="s-tools">
        {COLORS.map((c) => (
          <button key={c} className="dotc" style={{ background: COLOR_HEX[c] }} onClick={() => onChange({ color: c })} aria-label={c} />
        ))}
        {s.kind === "note" && (
          <button className="btn ghost icon sm" style={{ width: 24, height: 24, padding: 3 }} onClick={() => setEditing(true)} aria-label="Редактировать">
            <Icon name="edit" size={14} />
          </button>
        )}
        <button className="btn ghost icon sm" style={{ width: 24, height: 24, padding: 3 }} onClick={onDelete} aria-label="Удалить">
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}
