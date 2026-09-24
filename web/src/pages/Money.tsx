import { useState } from "react";
import { Page } from "../App";
import { MONTHS_NOM, curSym, fmtShort, money, mutate, toast, useApi } from "../lib";
import { Icon } from "../ui/icons";
import { Bar, EmojiInput, Empty, ErrorBox, Field, Loading, Modal, Seg } from "../ui/kit";

interface Account {
  id: number;
  name: string;
  emoji: string | null;
  currency: string;
  balance: number;
}
interface Tx {
  id: number;
  account_id: number;
  amount: number;
  category: string | null;
  note: string | null;
  date: string;
  account_name: string;
  account_emoji: string | null;
  currency: string;
}
interface MoneyData {
  currency: string;
  rates: Record<string, number>;
  rates_date: string;
  total: number;
  accounts: Account[];
  month: { month: string; income: number; expense: number; categories: { category: string; amount: number }[] };
  transactions: Tx[];
  history: { month: string; income: number; expense: number }[];
  knownCategories: string[];
  today: string;
}

const DEFAULT_CATS = ["Еда", "Кафе", "Транспорт", "Подписки", "Одежда", "Здоровье", "Учёба", "Развлечения", "Подарки", "Дом"];

export function MoneyPage() {
  const { data, error } = useApi<MoneyData>("/money");
  const [acc, setAcc] = useState<Account | "new" | null>(null);
  const [allTx, setAllTx] = useState(false);

  if (error) return <Page title="Деньги"><ErrorBox error={error} /></Page>;
  if (!data) return <Page title="Деньги"><Loading /></Page>;
  const d = data;
  const maxH = Math.max(1, ...d.history.map((h) => Math.max(h.income, h.expense)));
  const [y, m] = d.month.month.split("-").map(Number);

  return (
    <Page title="Деньги" sub="Сколько у тебя есть и куда уходит">
      <div className="bento">
        <section className="card span-5">
          <div className="eyebrow">Всего денег</div>
          <div className="big-num" style={{ marginTop: 12, fontSize: 54 }}>
            {money(d.total, d.currency)}
          </div>
          <div className="stat-cells" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="stat-cell">
              <div className="stat-ico green">
                <Icon name="arrowDown" />
              </div>
              <div>
                <div className="k">Доход · {MONTHS_NOM[m - 1].toLowerCase()}</div>
                <div className="v">{money(d.month.income, d.currency)}</div>
              </div>
            </div>
            <div className="stat-cell">
              <div className="stat-ico red">
                <Icon name="arrowUp" />
              </div>
              <div>
                <div className="k">Расход</div>
                <div className="v">{money(d.month.expense, d.currency)}</div>
              </div>
            </div>
          </div>
          {Object.keys(d.rates).length > 1 && (
            <div className="faint" style={{ fontSize: 12, marginTop: 16 }}>
              Курс НБУ: {Object.entries(d.rates)
                .filter(([k]) => k !== "UAH")
                .map(([k, v]) => `${curSym(k)}${v.toFixed(2)}`)
                .join(" · ")}
              {d.rates_date ? ` · ${fmtShort(d.rates_date)}` : ""}
            </div>
          )}
        </section>

        <section className="card span-7">
          <QuickTx d={d} />
        </section>

        <section className="span-12">
          <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 }}>
            {d.accounts.map((a) => (
              <button key={a.id} className="acc-card" onClick={() => setAcc(a)}>
                <div className="row between">
                  <span style={{ fontSize: 22 }}>{a.emoji ?? "💳"}</span>
                  <span className="tag">{a.currency}</span>
                </div>
                <div className="muted" style={{ fontWeight: 600 }}>
                  {a.name}
                </div>
                <div className="bal">{money(a.balance, a.currency, 2)}</div>
              </button>
            ))}
            <button className="acc-card" style={{ borderStyle: "dashed", alignItems: "center", justifyContent: "center", color: "var(--muted)" }} onClick={() => setAcc("new")}>
              <Icon name="plus" size={22} />
              Добавить счёт
            </button>
          </div>
        </section>

        <section className="card span-5">
          <div className="card-head">
            <h2>Расходы · {MONTHS_NOM[m - 1]}</h2>
          </div>
          {d.month.categories.length === 0 && <div className="muted">В этом месяце трат ещё нет.</div>}
          {d.month.categories.map((c) => (
            <div className="hbar" key={c.category}>
              <span className="name">{c.category}</span>
              <Bar value={c.amount / d.month.categories[0].amount} className="thin" color="var(--danger)" />
              <span className="mono" style={{ fontSize: 13 }}>
                {money(c.amount, d.currency)}
              </span>
            </div>
          ))}
          {d.history.length > 1 && (
            <>
              <div className="divider" />
              <div className="eyebrow" style={{ marginBottom: 12 }}>
                По месяцам
              </div>
              <div className="bars" style={{ height: 130 }}>
                {d.history.map((h) => (
                  <div className="b" key={h.month} title={`+${Math.round(h.income)} / −${Math.round(h.expense)}`}>
                    <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: "100%", width: "100%", justifyContent: "center" }}>
                      <i style={{ height: `${(h.income / maxH) * 100}%`, maxWidth: 14 }} />
                      <i className="alt" style={{ height: `${(h.expense / maxH) * 100}%`, maxWidth: 14 }} />
                    </div>
                    <span>{MONTHS_NOM[Number(h.month.slice(5)) - 1].slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card span-7">
          <div className="card-head">
            <h2>Операции</h2>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 13 }}>
              из бота: <span className="kbd">-250 кофе</span>
            </span>
          </div>
          {d.transactions.length === 0 && <Empty icon="wallet" title="Операций пока нет" />}
          {(allTx ? d.transactions : d.transactions.slice(0, 12)).map((t) => (
            <div className="task" key={t.id}>
              <div className="stat-ico" style={{ width: 38, height: 38 }}>
                {t.account_emoji ?? "💳"}
              </div>
              <div className="t">
                <div className="title">{t.category ?? (t.amount > 0 ? "Доход" : "Расход")}</div>
                <div className="sub">
                  <span>{fmtShort(t.date)}</span>
                  <span>{t.account_name}</span>
                  {t.note && <span>{t.note}</span>}
                </div>
              </div>
              <span className={t.amount > 0 ? "amount-pos" : "amount-neg"}>
                {t.amount > 0 ? "+" : ""}
                {money(t.amount, t.currency, 2)}
              </span>
              <button className="btn ghost icon sm x" onClick={() => mutate(`/transactions/${t.id}`, "DELETE")} aria-label="Удалить">
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
          {d.transactions.length > 12 && (
            <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setAllTx(!allTx)}>
              {allTx ? "Свернуть" : `Показать ещё ${d.transactions.length - 12}`}
            </button>
          )}
        </section>
      </div>
      {acc && <AccountModal acc={acc === "new" ? undefined : acc} onClose={() => setAcc(null)} />}
    </Page>
  );
}

function QuickTx({ d }: { d: MoneyData }) {
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(d.accounts[0]?.id ?? 0);
  const [to, setTo] = useState(d.accounts[1]?.id ?? 0);
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(d.today);
  const cats = [...new Set([...d.knownCategories, ...DEFAULT_CATS])];

  const save = async () => {
    const n = Number(amount.replace(",", "."));
    if (!n) return toast("Введи сумму", true);
    if (!account) return toast("Сначала добавь счёт", true);
    if (kind === "transfer") {
      if (!to || to === account) return toast("Выбери другой счёт", true);
      await mutate("/transactions", "POST", { account_id: account, to_account_id: to, amount: n, date });
    } else {
      await mutate("/transactions", "POST", { account_id: account, amount: kind === "expense" ? -Math.abs(n) : Math.abs(n), category: category || null, note, date });
    }
    toast(kind === "expense" ? "💸 Записал расход" : kind === "income" ? "💰 Записал доход" : "🔁 Перевод выполнен");
    setAmount("");
    setNote("");
  };

  return (
    <div className="form">
      <div className="row between wrap">
        <h2 className="card-title">Новая операция</h2>
        <Seg
          value={kind}
          onChange={setKind}
          options={[
            ["expense", "Расход"],
            ["income", "Доход"],
            ["transfer", "Перевод"],
          ]}
        />
      </div>
      <div className="form-row">
        <Field label="Сумма">
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="0" />
        </Field>
        <Field label={kind === "transfer" ? "Откуда" : "Счёт"}>
          <select className="input" value={account} onChange={(e) => setAccount(Number(e.target.value))}>
            {d.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name} ({curSym(a.currency)})
              </option>
            ))}
          </select>
        </Field>
        {kind === "transfer" ? (
          <Field label="Куда">
            <select className="input" value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {d.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name} ({curSym(a.currency)})
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Категория">
            <input className="input" list="cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Еда" />
            <datalist id="cats">
              {cats.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        )}
      </div>
      <div className="form-row">
        <Field label="Комментарий">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
        </Field>
        <Field label="Дата">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" onClick={save}>
          Записать
          <span className="btn-ico">
            <Icon name="check" size={14} />
          </span>
        </button>
      </div>
    </div>
  );
}

function AccountModal({ acc, onClose }: { acc?: Account; onClose: () => void }) {
  const [f, setF] = useState({ name: acc?.name ?? "", emoji: acc?.emoji ?? "💳", currency: acc?.currency ?? "UAH", balance: String(acc?.balance ?? 0) });
  const save = async () => {
    if (!f.name.trim()) return toast("Назови счёт", true);
    const body = { ...f, balance: Number(f.balance.replace(",", ".")) || 0 };
    if (acc) await mutate(`/accounts/${acc.id}`, "PUT", body);
    else await mutate("/accounts", "POST", body);
    onClose();
  };
  return (
    <Modal
      title={acc ? "Счёт" : "Новый счёт"}
      sub="Карта, наличные, копилка, долларовый счёт…"
      onClose={onClose}
      foot={
        <>
          {acc && (
            <button
              className="btn ghost"
              style={{ color: "var(--danger)", marginRight: "auto" }}
              onClick={() => confirm("Удалить счёт вместе с его операциями?") && mutate(`/accounts/${acc.id}`, "DELETE").then(onClose)}
            >
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
          <Field label="Название">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Монобанк" autoFocus />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Валюта">
            <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {["UAH", "USD", "EUR", "PLN", "GBP"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Баланс сейчас" hint="Можно поправить в любой момент">
            <input className="input" inputMode="decimal" value={f.balance} onChange={(e) => setF({ ...f, balance: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
