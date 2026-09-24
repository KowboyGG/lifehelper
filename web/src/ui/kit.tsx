import { useEffect, useState, type ReactNode } from "react";
import { WD_SHORT, useToasts } from "../lib";
import { Icon } from "./icons";

export function Modal({ title, sub, onClose, children, wide, foot }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; foot?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <h3>{title}</h3>
            {sub && <div className="muted" style={{ fontSize: 14 }}>{sub}</div>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ marginTop: 20 }}>{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">{children}</aside>
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} />;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Ring({ value, size = 180, stroke = 14, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setV(Math.max(0, Math.min(1, value))));
    return () => cancelAnimationFrame(t);
  }, [value]);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="ring-val" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function Bar({ value, mark, className, color }: { value: number; mark?: number | null; className?: string; color?: string }) {
  return (
    <div className={`bar ${className ?? ""}`}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      {mark !== undefined && mark !== null && mark > 0 && mark < 1 && <span className="mark" style={{ left: `${mark * 100}%` }} title="Где нужно быть по плану" />}
    </div>
  );
}

export function Empty({ icon = "sparkle", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">
        <Icon name={icon} />
      </div>
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function DaysPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const toggle = (i: number) => {
    const arr = value.split("");
    arr[i] = arr[i] === "1" ? "0" : "1";
    const next = arr.join("");
    onChange(next === "0000000" ? value : next);
  };
  return (
    <div className="row wrap">
      <div className="days-pick">
        {WD_SHORT.map((d, i) => (
          <button type="button" key={d} className={value[i] === "1" ? "on" : ""} onClick={() => toggle(i)}>
            {d}
          </button>
        ))}
      </div>
      <button type="button" className="btn ghost xs" onClick={() => onChange("1111111")}>
        каждый день
      </button>
      <button type="button" className="btn ghost xs" onClick={() => onChange("1111100")}>
        будни
      </button>
    </div>
  );
}

export function daysLabel(days: string) {
  if (days === "1111111") return "каждый день";
  if (days === "1111100") return "по будням";
  if (days === "0000011") return "по выходным";
  return WD_SHORT.filter((_, i) => days[i] === "1").join(" ");
}

const EMOJIS = ["📐", "📚", "🏃", "💪", "🧘", "💻", "🇬🇧", "🎸", "✍️", "🧠", "💧", "🥗", "😴", "🎯", "💰", "🚀", "🎨", "📝", "🧹", "🌱"];
export function EmojiInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="input" style={{ width: 58, fontSize: 22, textAlign: "center", padding: "8px 0" }} onClick={() => setOpen(!open)}>
        {value || "＋"}
      </button>
      {open && (
        <div
          className="card tight"
          style={{ position: "absolute", zIndex: 5, top: 56, left: 0, width: 280, display: "flex", flexWrap: "wrap", gap: 4, animation: "none" }}
          onMouseLeave={() => setOpen(false)}
        >
          {EMOJIS.map((e) => (
            <button
              type="button"
              key={e}
              className="btn ghost icon sm"
              style={{ fontSize: 19 }}
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
          <input className="input sm" placeholder="или свой" maxLength={4} onChange={(e) => onChange(e.target.value)} style={{ marginTop: 6 }} />
        </div>
      )}
    </div>
  );
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.err ? " err" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Loading() {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 60 }}>
      <span className="spinner" />
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="empty" style={{ borderColor: "var(--danger)" }}>
      <b className="danger">Не получилось загрузить</b>
      {error}
    </div>
  );
}
