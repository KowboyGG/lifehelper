import { useState } from "react";
import { Page } from "../App";
import { money, mutate, plural, toast, useApi } from "../lib";
import { Icon } from "../ui/icons";
import { EmojiInput, Empty, ErrorBox, Field, Loading, Modal, Seg } from "../ui/kit";

interface Wish {
  id: number;
  title: string;
  emoji: string | null;
  price: number | null;
  currency: string;
  url: string | null;
  note: string | null;
  priority: number;
  status: "want" | "bought" | "dropped";
  created_at: number;
  price_base: number | null;
  cooldown_left: number;
}

const PRIO = ["низкий", "средний", "высокий"];

export function WishlistPage() {
  const { data, error } = useApi<{ cooldown_days: number; currency: string; items: Wish[] }>("/wishes");
  const moneyData = useApi<{ total: number; accounts: { id: number; name: string; emoji: string | null }[] }>("/money");
  const [tab, setTab] = useState<"want" | "bought" | "dropped">("want");
  const [edit, setEdit] = useState<Wish | "new" | null>(null);
  const [buy, setBuy] = useState<Wish | null>(null);

  if (error) return <Page title="Вишлист"><ErrorBox error={error} /></Page>;
  if (!data) return <Page title="Вишлист"><Loading /></Page>;

  const wants = data.items.filter((w) => w.status === "want");
  const sum = wants.reduce((a, w) => a + (w.price_base ?? 0), 0);
  const items = data.items.filter((w) => w.status === tab);
  const total = moneyData.data?.total ?? 0;

  return (
    <Page
      title="Вишлист"
      sub={`Правило ${data.cooldown_days} ${plural(data.cooldown_days, "дня", "дней", "дней")}: хочешь — запиши и подожди. Если ещё хочется — покупай`}
      actions={
        <button className="btn primary" onClick={() => setEdit("new")}>
          <Icon name="plus" size={17} /> Желание
        </button>
      }
    >
      <div className="tiles" style={{ marginBottom: 22 }}>
        <div className="tile">
          <div className="k">Хочу</div>
          <div className="v">{wants.length}</div>
        </div>
        <div className="tile">
          <div className="k">На сумму</div>
          <div className="v">{money(sum, data.currency)}</div>
        </div>
        <div className="tile">
          <div className="k">Это от всех денег</div>
          <div className="v">{total > 0 ? `${Math.round((sum / total) * 100)}%` : "—"}</div>
        </div>
        <div className="tile">
          <div className="k">Можно покупать</div>
          <div className="v">{wants.filter((w) => w.cooldown_left === 0).length}</div>
        </div>
      </div>
      <div className="tabs">
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            ["want", "Хочу"],
            ["bought", "Куплено"],
            ["dropped", "Передумал"],
          ]}
        />
      </div>
      {items.length === 0 && (
        <Empty icon="gift" title={tab === "want" ? "Вишлист пуст" : "Здесь пусто"}>
          {tab === "want" && (
            <>
              Из Telegram: <span className="kbd">/wish Наушники 3500</span>
            </>
          )}
        </Empty>
      )}
      <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {items.map((w) => (
          <section className={`card wish${w.status === "bought" ? " bought" : ""}`} key={w.id}>
            <div className="row between" style={{ alignItems: "flex-start" }}>
              <div className="w-emoji">{w.emoji || "🎁"}</div>
              <div className="row" style={{ gap: 4 }}>
                {w.url && (
                  <a className="btn ghost icon sm" href={w.url} target="_blank" rel="noreferrer" aria-label="Открыть ссылку">
                    <Icon name="external" size={16} />
                  </a>
                )}
                <button className="btn ghost icon sm" onClick={() => setEdit(w)} aria-label="Редактировать">
                  <Icon name="edit" size={16} />
                </button>
              </div>
            </div>
            <div className="serif" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>
              {w.title}
            </div>
            <div className="price">{w.price ? money(w.price, w.currency) : <span className="faint">цена?</span>}</div>
            {w.note && <div className="muted" style={{ fontSize: 13.5 }}>{w.note}</div>}
            <div className="row wrap" style={{ gap: 6 }}>
              {w.status === "want" &&
                (w.cooldown_left > 0 ? (
                  <span className="pill blue">⏳ остынь ещё {w.cooldown_left} дн.</span>
                ) : (
                  <span className="pill green">
                    <span className="dot" /> можно покупать
                  </span>
                ))}
              <span className={`pill ${w.priority === 2 ? "amber" : ""}`}>{PRIO[w.priority]} приоритет</span>
              {w.price_base !== null && total > 0 && w.status === "want" && <span className="pill">{Math.round((w.price_base / total) * 100)}% от денег</span>}
            </div>
            {w.status === "want" ? (
              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn soft sm" onClick={() => setBuy(w)} disabled={w.cooldown_left > 0} title={w.cooldown_left > 0 ? "Ещё не прошло время на подумать" : ""}>
                  <Icon name="check" size={14} /> Купил
                </button>
                <button className="btn ghost sm" onClick={() => mutate(`/wishes/${w.id}`, "PUT", { status: "dropped" }).then(() => toast("Сэкономил 👏"))}>
                  Передумал
                </button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn ghost sm" onClick={() => mutate(`/wishes/${w.id}`, "PUT", { status: "want" })}>
                  Вернуть в «Хочу»
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
      {edit && <WishModal wish={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {buy && (
        <Modal title={`Купил: ${buy.title}`} sub="Списать деньги со счёта?" onClose={() => setBuy(null)}>
          <div className="stack" style={{ gap: 8 }}>
            {moneyData.data?.accounts.map((a) => (
              <button
                key={a.id}
                className="btn"
                style={{ justifyContent: "flex-start" }}
                onClick={() => mutate(`/wishes/${buy.id}`, "PUT", { status: "bought", account_id: a.id }).then(() => setBuy(null))}
              >
                {a.emoji} Списать с «{a.name}»
              </button>
            ))}
            <button className="btn ghost" onClick={() => mutate(`/wishes/${buy.id}`, "PUT", { status: "bought" }).then(() => setBuy(null))}>
              Просто отметить купленным
            </button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function WishModal({ wish, onClose }: { wish?: Wish; onClose: () => void }) {
  const [f, setF] = useState({
    title: wish?.title ?? "",
    emoji: wish?.emoji ?? "🎁",
    price: wish?.price ? String(wish.price) : "",
    currency: wish?.currency ?? "UAH",
    url: wish?.url ?? "",
    note: wish?.note ?? "",
    priority: wish?.priority ?? 1,
  });
  const save = async () => {
    if (!f.title.trim()) return toast("Что хочется?", true);
    const body = { ...f, price: f.price ? Number(f.price.replace(",", ".")) : null };
    if (wish) await mutate(`/wishes/${wish.id}`, "PUT", body);
    else await mutate("/wishes", "POST", body);
    onClose();
  };
  return (
    <Modal
      title={wish ? "Желание" : "Хочу…"}
      onClose={onClose}
      foot={
        <>
          {wish && (
            <button className="btn ghost" style={{ color: "var(--danger)", marginRight: "auto" }} onClick={() => mutate(`/wishes/${wish.id}`, "DELETE").then(onClose)}>
              Удалить
            </button>
          )}
          <button className="btn primary" onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="form">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <EmojiInput value={f.emoji} onChange={(v) => setF({ ...f, emoji: v })} />
          <Field label="Что">
            <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Наушники Sony WH-1000XM5" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Цена">
            <input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
          <Field label="Валюта">
            <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {["UAH", "USD", "EUR", "PLN"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Приоритет">
            <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>
              {PRIO.map((p, i) => (
                <option key={p} value={i}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Ссылка">
          <input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://rozetka.com.ua/…" />
        </Field>
        <Field label="Зачем / заметка">
          <textarea className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
