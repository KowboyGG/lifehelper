// Стикеры: общий вид для «Стены» и для страницы «Сегодня»
import { useRef, useState, type ReactNode } from "react";
import { diffDays, fmtDate, money, plural, useApi, type Goal } from "../lib";
import { Icon } from "./icons";

export interface Sticker {
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
  pinned: number;
}
export interface Wish {
  id: number;
  title: string;
  emoji: string | null;
  price: number | null;
  currency: string;
  cooldown_left: number;
  status: string;
}

export const COLORS = ["yellow", "pink", "green", "blue", "purple", "orange", "white"];
const COLOR_HEX: Record<string, string> = {
  yellow: "#fde58a",
  pink: "#f9b9cc",
  green: "#b7ebc9",
  blue: "#b9d6fb",
  purple: "#d7c6fb",
  orange: "#fcc79b",
  white: "#fbfaf6",
};
const KIND_LABEL: Record<Sticker["kind"], string> = {
  note: "Заметка",
  goal: "Цель",
  wish: "Желание",
  countdown: "Отсчёт",
  money: "Деньги",
  streak: "Стрик",
};

export interface StickerCtx {
  goals: Goal[];
  wishes: Wish[];
  streak: number;
  total: string;
}

/** Живые данные для стикеров-карточек (цель, желание, деньги) */
export function useStickerCtx(streak: number): StickerCtx {
  const goals = useApi<Goal[]>("/goals");
  const wishes = useApi<{ items: Wish[] }>("/wishes");
  const m = useApi<{ total: number; currency: string }>("/money");
  return { goals: goals.data ?? [], wishes: wishes.data?.items ?? [], streak, total: m.data ? money(m.data.total, m.data.currency) : "…" };
}

export const stickerLabel = (s: Sticker, ctx: StickerCtx) => {
  if (s.kind === "note" || s.kind === "countdown") return s.text || KIND_LABEL[s.kind];
  if (s.kind === "goal") return ctx.goals.find((g) => g.id === s.ref_id)?.title ?? "Цель";
  if (s.kind === "wish") return ctx.wishes.find((w) => w.id === s.ref_id)?.title ?? "Желание";
  return KIND_LABEL[s.kind];
};

function NoteEditor({ initial, onSave }: { initial: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(initial);
  return <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onSave(text)} onPointerDown={(e) => e.stopPropagation()} />;
}

function StickerBody({ s, ctx, editing, onSave }: { s: Sticker; ctx: StickerCtx; editing: boolean; onSave: (text: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);

  if (s.kind === "note") {
    return editing ? (
      <NoteEditor initial={s.text ?? ""} onSave={onSave} />
    ) : (
      <div className="s-text">{s.text || "…"}</div>
    );
  }
  if (s.kind === "goal") {
    const goal = ctx.goals.find((g) => g.id === s.ref_id);
    if (!goal) return <div className="s-sub">Цель удалена или завершена</div>;
    return (
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
    );
  }
  if (s.kind === "wish") {
    const wish = ctx.wishes.find((w) => w.id === s.ref_id);
    if (!wish) return <div className="s-sub">Желание удалено</div>;
    return (
      <>
        <div className="s-kind">Хочу</div>
        <div className="s-text">
          {wish.emoji ?? "🎁"} {wish.title}
        </div>
        {wish.price && (
          <div className="s-big" style={{ fontSize: 30 }}>
            {money(wish.price, wish.currency)}
          </div>
        )}
        <div className="s-sub">{wish.status === "bought" ? "✓ куплено" : wish.cooldown_left > 0 ? `остынь ещё ${wish.cooldown_left} дн.` : "можно покупать"}</div>
      </>
    );
  }
  if (s.kind === "countdown" && s.date) {
    const n = diffDays(today, s.date);
    return (
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
  }
  if (s.kind === "money") {
    return (
      <>
        <div className="s-kind">Все деньги</div>
        <div className="s-big" style={{ fontSize: 32 }}>
          {ctx.total}
        </div>
      </>
    );
  }
  if (s.kind === "streak") {
    return (
      <>
        <div className="s-kind">Стрик</div>
        <div className="s-big">🔥 {ctx.streak}</div>
        <div className="s-sub">{plural(ctx.streak, "день", "дня", "дней")} подряд. Не разрывай цепочку.</div>
      </>
    );
  }
  return null;
}

/**
 * Один стикер. На «Стене» — свободно перетаскивается (mode="board"),
 * на «Сегодня» — стоит в сетке (mode="static").
 * Панель действий внутри карточки: цвет, «на главную», редактировать, удалить.
 * На телефоне панель открывается тапом.
 */
export function StickerCard({
  s,
  ctx,
  mode,
  onChange,
  onDelete,
  onMove,
  onFront,
}: {
  s: Sticker;
  ctx: StickerCtx;
  mode: "board" | "static";
  onChange: (p: Partial<Sticker>) => void;
  onDelete: () => void;
  onMove?: (x: number, y: number, save: boolean) => void;
  onFront?: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [editing, setEditing] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const board = mode === "board";
  const clampX = (x: number) => Math.max(0, Math.min(1780, x));
  const clampY = (y: number) => Math.max(10, Math.min(1140, y));

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, textarea, .s-tools")) return;
    start.current = { px: e.clientX, py: e.clientY, x: s.x, y: s.y, moved: false };
    if (board) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      onFront?.();
    }
  };
  const move = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st || !board) return;
    const dx = e.clientX - st.px;
    const dy = e.clientY - st.py;
    if (!st.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    st.moved = true;
    setDrag(true);
    onMove?.(clampX(st.x + dx), clampY(st.y + dy), false);
  };
  const up = (e: React.PointerEvent) => {
    const st = start.current;
    start.current = null;
    setDrag(false);
    if (!st) return;
    if (st.moved) onMove?.(clampX(st.x + e.clientX - st.px), clampY(st.y + e.clientY - st.py), true);
    else if (e.pointerType !== "mouse") setOpen((o) => !o); // тап открывает панель
  };

  const toolBtn = (icon: ReactNode, title: string, onClick: () => void, extra = "") => (
    <button type="button" className={`t-btn ${extra}`} title={title} aria-label={title} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <div
      className={`sticker c-${s.color}${board ? "" : " static"}${drag ? " dragging" : ""}${open ? " open" : ""}${editing ? " editing" : ""}`}
      style={
        board
          ? { left: s.x, top: s.y, zIndex: s.z, transform: `rotate(${drag ? 0 : s.rot}deg)${drag ? " scale(1.03)" : ""}` }
          : { transform: `rotate(${s.rot / 2}deg)` }
      }
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onMouseLeave={() => setPalette(false)}
      onDoubleClick={() => s.kind === "note" && setEditing(true)}
    >
      <StickerBody
        s={s}
        ctx={ctx}
        editing={editing}
        onSave={(text) => {
          setEditing(false);
          if (text !== s.text) onChange({ text });
        }}
      />
      {!!s.pinned && board && (
        <span className="s-pin" title="Закреплён на «Сегодня»">
          📌
        </span>
      )}
      <div className="s-tools" onPointerDown={(e) => e.stopPropagation()}>
        {toolBtn("🎨", "Цвет", () => setPalette((p) => !p), palette ? "on" : "")}
        {toolBtn(s.pinned ? "📌" : <Icon name="today" size={15} />, s.pinned ? "Убрать с «Сегодня»" : "Показывать на «Сегодня»", () => onChange({ pinned: s.pinned ? 0 : 1 }), s.pinned ? "on" : "")}
        {s.kind === "note" && toolBtn(<Icon name="edit" size={15} />, "Редактировать", () => setEditing(true))}
        {toolBtn(<Icon name="trash" size={15} />, "Удалить", onDelete, "danger")}
        {palette && (
          <div className="s-palette">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`dotc${c === s.color ? " on" : ""}`}
                style={{ background: COLOR_HEX[c] }}
                onClick={() => onChange({ color: c })}
                aria-label={`Цвет ${c}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
