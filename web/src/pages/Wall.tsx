import { useEffect, useRef, useState } from "react";
import { Page, useMe } from "../App";
import { api, mutate, useApi } from "../lib";
import { Icon } from "../ui/icons";
import { Field, Loading, Modal } from "../ui/kit";
import { COLORS, StickerCard, useStickerCtx, type Sticker } from "../ui/stickers";

export function WallPage() {
  const me = useMe();
  const stickers = useApi<Sticker[]>("/stickers");
  const ctx = useStickerCtx(me?.streak.current ?? 0);
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
            Наведи на стикер (на телефоне — тапни): цвет, 📌 на «Сегодня», удалить
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
              <StickerCard
                key={s.id}
                s={s}
                ctx={ctx}
                mode="board"
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
            {ctx.goals.length === 0 && <div className="muted">Сначала создай цель.</div>}
            {ctx.goals.map((g) => (
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
            {ctx.wishes.filter((w) => w.status === "want").length === 0 && <div className="muted">Вишлист пуст.</div>}
            {ctx.wishes
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
