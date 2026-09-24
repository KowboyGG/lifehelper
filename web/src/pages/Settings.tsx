import { useEffect, useState } from "react";
import { Page } from "../App";
import { api, mutate, navigate, setTheme, toast, useApi } from "../lib";
import { Icon } from "../ui/icons";
import { ErrorBox, Loading, Seg, Switch } from "../ui/kit";

interface S {
  timezone: string;
  morning_enabled: string;
  morning_time: string;
  reminder_enabled: string;
  reminder_time: string;
  evening_enabled: string;
  evening_time: string;
  weekly_review_enabled: string;
  weekly_passes: string;
  block_enabled: string;
  block_from: string;
  block_to: string;
  blocklist: string[];
  rates: Record<string, number>;
  wish_cooldown_days: string;
  info: {
    owner_name: string;
    owner_id: string;
    owner_from_env: boolean;
    bot_username: string;
    bot_configured: boolean;
    webhook_url: string;
    rates_date: string;
  };
}
interface Tok {
  id: number;
  kind: string;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
  current: boolean;
}

const TZ = ["Europe/Kyiv", "Europe/Warsaw", "Europe/Berlin", "Europe/London", "Europe/Lisbon", "Europe/Istanbul", "Asia/Tbilisi", "America/New_York", "Asia/Dubai"];

export function SettingsPage() {
  const { data, error } = useApi<S>("/settings");
  const tokens = useApi<Tok[]>("/tokens");
  const [s, setS] = useState<S | null>(null);
  const [site, setSite] = useState("");
  const [theme, setThemeState] = useState(document.documentElement.dataset.theme ?? "dark");
  useEffect(() => {
    if (data) setS(data);
  }, [data]);

  if (error) return <Page title="Настройки"><ErrorBox error={error} /></Page>;
  if (!s) return <Page title="Настройки"><Loading /></Page>;

  const save = (patch: Partial<S>) => {
    setS({ ...s, ...patch });
    mutate("/settings", "PUT", patch).then(() => toast("Сохранено"));
  };
  const flag = (k: keyof S) => s[k] === "1";
  const addSite = () => {
    const v = site.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!v) return;
    save({ blocklist: [...new Set([...s.blocklist, v])] });
    setSite("");
  };

  const notif: [keyof S, keyof S, string, string][] = [
    ["morning_enabled", "morning_time", "Утренний план", "Привычки и задачи на день, стрик, дедлайны"],
    ["reminder_enabled", "reminder_time", "Напоминание", "Если к этому времени что-то не сделано"],
    ["evening_enabled", "evening_time", "Вечерний чек-лист", "«Выполнил ли ты…?» — галочки прямо в Telegram"],
  ];

  return (
    <Page title="Настройки">
      <div className="bento">
        <div className="span-6 stack">
          <section className="card">
            <div className="card-head">
              <h2>Внешний вид</h2>
            </div>
            <div className="t" style={{ fontWeight: 600 }}>
              Тема интерфейса
            </div>
            <div className="faint" style={{ fontSize: 13, marginBottom: 12 }}>
              Меняется сразу, запоминается в этом браузере
            </div>
            <div className="row" style={{ gap: 12 }}>
              {(["dark", "light"] as const).map((t) => (
                <div key={t} style={{ textAlign: "center" }}>
                  <button
                    className={`theme-swatch${theme === t ? " on" : ""}`}
                    style={{ background: t === "dark" ? "#12151b" : "#f4f2ed" }}
                    onClick={() => {
                      setTheme(t);
                      setThemeState(t);
                    }}
                    aria-label={t}
                  />
                  <div className="eyebrow" style={{ fontSize: 10.5, marginTop: 6 }}>
                    {t === "dark" ? "Тёмная" : "Светлая"}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Telegram-бот</h2>
              <div className="spacer" />
              {s.info.bot_configured && s.info.webhook_url ? (
                <span className="pill green">
                  <span className="dot" /> Подключён
                </span>
              ) : (
                <span className="pill red">
                  <span className="dot" /> {s.info.bot_configured ? "Вебхук не задан" : "Нет токена"}
                </span>
              )}
            </div>
            <div className="row" style={{ gap: 14, marginBottom: 12 }}>
              <div className="stat-ico blue" style={{ width: 46, height: 46 }}>
                <Icon name="telegram" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{s.info.bot_username ? `@${s.info.bot_username}` : "Бот"}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Владелец: {s.info.owner_name || "—"} {s.info.owner_id && <span className="mono">({s.info.owner_id})</span>}
                </div>
              </div>
              {s.info.bot_username && (
                <a className="btn sm" href={`https://t.me/${s.info.bot_username}`} target="_blank" rel="noreferrer">
                  Открыть <Icon name="external" size={14} />
                </a>
              )}
            </div>
            <div className="row wrap" style={{ marginBottom: 6 }}>
              <button className="btn sm" onClick={() => mutate("/bot/test", "POST").then(() => toast("Отправил — проверь Telegram"))}>
                Тестовое сообщение
              </button>
              <button className="btn ghost sm" onClick={() => mutate("/bot/reconnect", "POST").then(() => toast("Вебхук обновлён"))}>
                Переподключить
              </button>
            </div>
            {notif.map(([en, time, t, d]) => (
              <div className="setting-row" key={en}>
                <div className="txt">
                  <div className="t">{t}</div>
                  <div className="d">{d}</div>
                </div>
                <input className="input sm mono" type="time" style={{ width: 128 }} value={s[time] as string} onChange={(e) => save({ [time]: e.target.value } as Partial<S>)} />
                <Switch on={flag(en)} onChange={(v) => save({ [en]: v ? "1" : "0" } as Partial<S>)} />
              </div>
            ))}
            <div className="setting-row">
              <div className="txt">
                <div className="t">Итоги недели</div>
                <div className="d">В воскресенье вместе с вечерним чек-листом</div>
              </div>
              <Switch on={flag("weekly_review_enabled")} onChange={(v) => save({ weekly_review_enabled: v ? "1" : "0" })} />
            </div>
            <div className="setting-row">
              <div className="txt">
                <div className="t">Часовой пояс</div>
                <div className="d">От него зависит «сегодня» и время сообщений</div>
              </div>
              <select className="input sm" style={{ width: 190 }} value={s.timezone} onChange={(e) => save({ timezone: e.target.value })}>
                {[...new Set([s.timezone, ...TZ])].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Сессии и токены</h2>
            </div>
            {tokens.data?.map((t) => (
              <div className="task" key={t.id}>
                <div className="stat-ico" style={{ width: 36, height: 36 }}>
                  <Icon name={t.kind === "ext" ? "puzzle" : "eye"} size={17} />
                </div>
                <div className="t">
                  <div className="title">
                    {t.label || (t.kind === "ext" ? "Расширение" : "Сайт")} {t.current && <span className="pill green" style={{ marginLeft: 6 }}>это устройство</span>}
                  </div>
                  <div className="sub">
                    создан {new Date(t.created_at).toLocaleDateString("ru-RU")}
                    {t.last_used_at && ` · активность ${new Date(t.last_used_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`}
                  </div>
                </div>
                {!t.current && (
                  <button className="btn ghost sm" onClick={() => mutate(`/tokens/${t.id}`, "DELETE")}>
                    Отозвать
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>

        <div className="span-6 stack">
          <section className="card">
            <div className="card-head">
              <h2>Дисциплина</h2>
            </div>
            <div className="setting-row">
              <div className="txt">
                <div className="t">Пропусков в неделю</div>
                <div className="d">Пропуск замораживает стрик. Каждый — через 20 секунд раздумий</div>
              </div>
              <Seg value={s.weekly_passes} onChange={(v) => save({ weekly_passes: v })} options={["0", "1", "2", "3"].map((x) => [x, x] as [string, string])} />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Блокировщик</h2>
              <div className="spacer" />
              <Switch on={flag("block_enabled")} onChange={(v) => save({ block_enabled: v ? "1" : "0" })} />
            </div>
            <div className="setting-row">
              <div className="txt">
                <div className="t">Когда блокировать</div>
                <div className="d">Вне этого окна расширение не мешает</div>
              </div>
              <input className="input sm mono" type="time" style={{ width: 128 }} value={s.block_from} onChange={(e) => save({ block_from: e.target.value })} />
              <span className="faint">—</span>
              <input className="input sm mono" type="time" style={{ width: 128 }} value={s.block_to} onChange={(e) => save({ block_to: e.target.value })} />
            </div>
            <div className="label" style={{ margin: "14px 0 10px" }}>
              Отвлекающие сайты
            </div>
            <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
              {s.blocklist.map((d) => (
                <span className="pill" key={d}>
                  {d}
                  <button className="link-btn" style={{ color: "var(--faint)" }} onClick={() => save({ blocklist: s.blocklist.filter((x) => x !== d) })} aria-label={`Убрать ${d}`}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="row">
              <input className="input sm" value={site} onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSite()} placeholder="например, pinterest.com" />
              <button className="btn sm" onClick={addSite}>
                Добавить
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Деньги и вишлист</h2>
            </div>
            {(["USD", "EUR"] as const).map((c) => (
              <div className="setting-row" key={c}>
                <div className="txt">
                  <div className="t">Курс {c}</div>
                  <div className="d">{s.info.rates_date ? `Обновляется автоматически по НБУ (${s.info.rates_date})` : "Обновляется автоматически по НБУ раз в день"}</div>
                </div>
                <input
                  className="input sm mono"
                  style={{ width: 110 }}
                  type="number"
                  step="0.01"
                  defaultValue={s.rates[c] ?? ""}
                  onBlur={(e) => Number(e.target.value) > 0 && save({ rates: { ...s.rates, [c]: Number(e.target.value) } })}
                />
              </div>
            ))}
            <div className="setting-row">
              <div className="txt">
                <div className="t">Правило N дней для покупок</div>
                <div className="d">Столько дней желание «остывает», прежде чем можно купить</div>
              </div>
              <Seg value={s.wish_cooldown_days} onChange={(v) => save({ wish_cooldown_days: v })} options={["0", "3", "7"].map((x) => [x, x] as [string, string])} />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Данные</h2>
            </div>
            <div className="row wrap">
              <a className="btn" href="/api/export" download>
                <Icon name="download" size={16} /> Скачать всё (JSON)
              </a>
              <button
                className="btn danger"
                onClick={async () => {
                  await api("/auth/logout", "POST");
                  navigate("/login");
                }}
              >
                <Icon name="logout" size={16} /> Выйти
              </button>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
