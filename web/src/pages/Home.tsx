// «Дом»: квартира с панорамными окнами, вечерний город в тумане или под дождём.
// Предметы показывают данные: деньги на столе и в сейфе, заметки на холодильнике,
// «Сегодня» на мониторе, календарь и часы на колонне.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOpenMenu } from "../App";
import { fmtMin, money, navigate, plural, useApi, type Goal, type Today } from "../lib";
import { Icon } from "../ui/icons";
import { fmtNum, splitMoney, SYM, type HomeCalendar, type HomeData, type HomeMoney, type HomeSticker, type HomeWish } from "../home/data";
import type { HomeEngine, LedPalette } from "../home/engine";
import type { Interactive } from "../home/interior";

const ZONE_LABELS = ["Кухня", "Гостиная", "Окно", "Рабочее место", "Сейф"];
const LEDS: { id: LedPalette; name: string; color: string }[] = [
  { id: "neon", name: "Неон", color: "#9d1cff" },
  { id: "cyber", name: "Кибер", color: "#00c8ff" },
  { id: "sunset", name: "Закат", color: "#ff3b12" },
  { id: "red", name: "Красный", color: "#ff0418" },
  { id: "warm", name: "Тёплый", color: "#ff8436" },
  { id: "off", name: "Выключить", color: "#2a2d33" },
];
const LABELS: Record<Interactive, string> = {
  fridge: "Холодильник · заметки",
  money: "Деньги на столе",
  safe: "Сейф · накопления",
  monitor: "Монитор · сегодня",
  calendar: "Календарь",
  window: "Город",
};

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* приватный режим */
    }
  },
};

/** Дождь или туман — раз в день, случайно (40% дождя); можно переключить вручную */
function dailyRain(date: string) {
  try {
    const o = JSON.parse(store.get("lh-weather") ?? "null") as { date: string; rain: boolean } | null;
    if (o && o.date === date) return o.rain;
  } catch {
    /* ignore */
  }
  let h = 2166136261;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 100 < 40;
}

const isMobile = () => window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;

export function HomePage() {
  const openMenu = useOpenMenu();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engRef = useRef<HomeEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [zone, setZone] = useState(1);
  const [focus, setFocus] = useState<Interactive | null>(null);
  const [hover, setHover] = useState<{ key: Interactive; x: number; y: number } | null>(null);
  const todayStr = useMemo(() => new Date().toLocaleDateString("sv-SE"), []);
  const [rain, setRain] = useState(() => dailyRain(todayStr));
  const [led, setLed] = useState<LedPalette>(() => (store.get("lh-led") as LedPalette) || "neon");
  const [hint, setHint] = useState(() => !store.get("lh-home-hint"));
  const [now, setNow] = useState(() => new Date());

  const today = useApi<Today>("/today");
  const stickers = useApi<HomeSticker[]>("/stickers");
  const moneyApi = useApi<HomeMoney>("/money");
  const goals = useApi<Goal[]>("/goals");
  const wishes = useApi<{ items: HomeWish[] }>("/wishes");
  const calendar = useApi<HomeCalendar>("/calendar");

  useEffect(() => {
    document.title = "Дом · LifeHelper";
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // запуск сцены (three.js грузится отдельным куском только здесь)
  useEffect(() => {
    let disposed = false;
    let eng: HomeEngine | null = null;
    const onPointer = (e: PointerEvent) => {
      if (hoverKey.current) setHover({ key: hoverKey.current, x: e.clientX, y: e.clientY });
    };
    const hoverKey = { current: null as Interactive | null };
    import("../home/engine")
      .then(({ HomeEngine }) => {
        if (disposed || !canvasRef.current) return;
        eng = new HomeEngine(canvasRef.current, {
          quality: isMobile() ? "low" : "high",
          events: {
            onHover: (k) => {
              hoverKey.current = k && k !== "window" ? k : null;
              if (!hoverKey.current) setHover(null);
            },
            onPick: (k) => {
              setFocus(k);
              eng?.focus(k, window.matchMedia("(max-width: 760px)").matches ? "bottom" : "right");
              setHint(false);
            },
            onZone: (i) => setZone(i),
          },
        });
        engRef.current = eng;
        if (["localhost", "127.0.0.1"].includes(location.hostname)) {
          // для отладки и скриншотов
          const w = window as unknown as Record<string, unknown>;
          w.__home = eng;
          w.__homePick = (k: Interactive) => {
            setFocus(k);
            eng?.focus(k, window.matchMedia("(max-width: 760px)").matches ? "bottom" : "right");
          };
        }
        eng.setRain(rain, true);
        eng.setLed(led);
        eng.start();
        // первый кадр — и показываем
        requestAnimationFrame(() => requestAnimationFrame(() => !disposed && setReady(true)));
        void eng.loadModels();
      })
      .catch((e) => setFailed(String((e as Error).message || e)));
    window.addEventListener("pointermove", onPointer);
    const onVis = () => {
      if (!eng) return;
      if (document.visibilityState === "hidden") eng.stop();
      else eng.start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVis);
      eng?.dispose();
      engRef.current = null;
    };
    // сцена создаётся один раз
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // данные → предметы
  const data: HomeData = useMemo(
    () => ({
      today: today.data,
      stickers: stickers.data,
      money: moneyApi.data,
      goals: goals.data,
      wishes: wishes.data?.items ?? null,
      calendar: calendar.data,
    }),
    [today.data, stickers.data, moneyApi.data, goals.data, wishes.data, calendar.data],
  );
  useEffect(() => {
    if (ready) engRef.current?.setData(data);
  }, [data, ready]);

  useEffect(() => {
    engRef.current?.setRain(rain);
  }, [rain]);
  useEffect(() => {
    engRef.current?.setLed(led);
    store.set("lh-led", led);
  }, [led]);
  useEffect(() => {
    if (!hint) store.set("lh-home-hint", "1");
    else {
      const t = setTimeout(() => setHint(false), 9000);
      return () => clearTimeout(t);
    }
  }, [hint]);

  const toggleRain = () => {
    const v = !rain;
    setRain(v);
    store.set("lh-weather", JSON.stringify({ date: todayStr, rain: v }));
  };
  const goZone = (i: number) => {
    setFocus(null);
    engRef.current?.goZone(i);
  };
  const closeFocus = () => {
    setFocus(null);
    engRef.current?.goZone(zone);
  };

  // Esc закрывает карточку
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focus) closeFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className={`home${ready ? " ready" : ""}`}>
      <div className="home-canvas">
        <canvas ref={canvasRef} />
      </div>

      {!ready && !failed && (
        <div className="home-loading">
          <div className="home-loading-dot" />
          <span>Заходим домой…</span>
        </div>
      )}
      {failed && (
        <div className="home-loading">
          <span>Сцена не запустилась: {failed}</span>
          <button className="home-chip" onClick={() => navigate("/today")}>
            Открыть «Сегодня»
          </button>
        </div>
      )}

      <header className="home-top">
        <button className="home-btn" onClick={openMenu} aria-label="Меню">
          <Icon name="menu" />
        </button>
        <div className="home-title">
          <div className="home-time">{time}</div>
          <div className="home-date">{date}</div>
        </div>
        <div className="spacer" />
        <button className="home-chip" onClick={toggleRain} title="Погода меняется раз в день сама; кнопка — переключить вручную">
          <Icon name={rain ? "rain" : "fog"} size={18} />
          {rain ? "Дождь" : "Туман"}
        </button>
        <div className="home-leds" role="group" aria-label="Цвет ленты">
          {LEDS.map((l) => (
            <button
              key={l.id}
              className={`home-led${led === l.id ? " on" : ""}${l.id === "off" ? " off" : ""}`}
              style={{ ["--c" as string]: l.color }}
              title={`Лента: ${l.name}`}
              aria-label={`Лента: ${l.name}`}
              onClick={() => setLed(l.id)}
            />
          ))}
        </div>
      </header>

      {hover && !focus && (
        <div className="home-tip" style={{ left: hover.x + 16, top: hover.y + 14 }}>
          {LABELS[hover.key]}
        </div>
      )}

      {hint && ready && (
        <div className="home-hint" onClick={() => setHint(false)}>
          {isMobile() ? "Тяни пальцем — осмотреться · два пальца — шаг · нажми на предмет" : "Тяни мышью — осмотреться · WASD или колесо — ходить · ← → — зоны · клик по предмету"}
        </div>
      )}

      {focus && (
        <aside className="home-panel" key={focus}>
          <button className="home-panel-x" onClick={closeFocus} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
          <FocusCard k={focus} data={data} rain={rain} onRain={toggleRain} />
        </aside>
      )}

      <nav className="home-zones" aria-label="Зоны квартиры">
        <button className="home-btn" onClick={() => goZone(zone - 1)} aria-label="Предыдущая зона">
          <Icon name="left" />
        </button>
        <div className="home-zone-list">
          {ZONE_LABELS.map((z, i) => (
            <button key={z} className={`home-zone${i === zone && !focus ? " on" : ""}`} onClick={() => goZone(i)}>
              {z}
            </button>
          ))}
        </div>
        <button className="home-btn" onClick={() => goZone(zone + 1)} aria-label="Следующая зона">
          <Icon name="right" />
        </button>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ карточки предметов

function Row({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="hp-row">
      <span>{label}</span>
      <b className={tone ? `t-${tone}` : undefined}>{value}</b>
    </div>
  );
}

function Go({ to, children }: { to: string; children: ReactNode }) {
  return (
    <button className="hp-go" onClick={() => navigate(to)}>
      {children}
      <Icon name="right" size={16} />
    </button>
  );
}

function FocusCard({ k, data, rain, onRain }: { k: Interactive; data: HomeData; rain: boolean; onRain: () => void }) {
  const t = data.today;
  if (k === "money" || k === "safe") {
    const m = data.money;
    if (!m) return <p className="hp-muted">Загрузка…</p>;
    const s = splitMoney(m);
    const accs = k === "money" ? s.tableAcc : s.safeAcc;
    return (
      <>
        <div className="hp-kicker">{k === "money" ? "На столе" : "В сейфе"}</div>
        <div className="hp-big">{money(k === "money" ? s.table : s.safe, m.currency)}</div>
        <div className="hp-list">
          {accs.length === 0 && <p className="hp-muted">{k === "safe" ? "Сейф пуст. Счета с «копилка», «подушка», «сейф» в названии или в валюте лягут сюда." : "Всё лежит в сейфе."}</p>}
          {accs.map((a) => (
            <Row
              key={a.id}
              label={`${a.emoji ?? ""} ${a.name}`.trim()}
              value={`${fmtNum(a.balance)} ${SYM[a.currency] ?? a.currency}`}
            />
          ))}
        </div>
        {t && k === "money" && (
          <div className="hp-list">
            <Row label="Доход за месяц" value={money(t.money.income, t.money.currency)} tone="good" />
            <Row label="Расход за месяц" value={money(t.money.expense, t.money.currency)} tone="bad" />
          </div>
        )}
        <p className="hp-muted">Всего: {money(m.total, m.currency)}. Одна пачка на столе — это одна бандероль с подписью сверху.</p>
        <Go to="/money">Открыть «Деньги»</Go>
      </>
    );
  }
  if (k === "fridge") {
    const list = data.stickers ?? [];
    return (
      <>
        <div className="hp-kicker">Холодильник</div>
        <div className="hp-big">
          {list.length} {plural(list.length, "заметка", "заметки", "заметок")}
        </div>
        <div className="hp-list">
          {list
            .filter((s) => s.kind === "note" && s.text)
            .slice(0, 4)
            .map((s) => (
              <p key={s.id} className="hp-note">
                {s.text}
              </p>
            ))}
        </div>
        <p className="hp-muted">Сюда магнитами вешаются первые десять стикеров со «Стены» — закреплённые первыми.</p>
        <Go to="/wall">Открыть «Стену»</Go>
      </>
    );
  }
  if (k === "monitor") {
    if (!t) return <p className="hp-muted">Загрузка…</p>;
    const yt = t.distractions.reduce((a, x) => a + x.seconds, 0);
    return (
      <>
        <div className="hp-kicker">Сегодня</div>
        <div className="hp-big">
          {t.done} <small>из {t.total}</small>
        </div>
        <div className="hp-list">
          {t.habits.map((h) => (
            <Row
              key={h.id}
              label={`${h.emoji ?? ""} ${h.title}`.trim()}
              value={h.done ? "готово" : h.skipped ? "пропуск" : h.type === "minutes" && h.target_minutes ? `${Math.round(h.minutes)}/${h.target_minutes} мин` : "—"}
              tone={h.done ? "good" : undefined}
            />
          ))}
        </div>
        <div className="hp-list">
          <Row label="Фокус" value={fmtMin(t.focus.seconds / 60)} tone="good" />
          <Row label="Отвлечения" value={fmtMin(yt / 60)} tone={yt > 1800 ? "bad" : undefined} />
        </div>
        <Go to="/today">Открыть «Сегодня»</Go>
      </>
    );
  }
  if (k === "calendar") {
    const cal = data.calendar;
    const vals = cal ? Object.entries(cal.days).filter(([d, v]) => d.startsWith(cal.month) && d < cal.today && v.total > 0) : [];
    const good = vals.filter(([, v]) => v.done >= v.total).length;
    return (
      <>
        <div className="hp-kicker">Календарь</div>
        <div className="hp-big">
          🔥 {t?.streak.current ?? 0} <small>{plural(t?.streak.current ?? 0, "день", "дня", "дней")} подряд</small>
        </div>
        <div className="hp-list">
          <Row label="Рекорд" value={`${t?.streak.best ?? 0} дн.`} />
          <Row label="Полных дней в этом месяце" value={`${good} из ${vals.length}`} tone="good" />
        </div>
        <p className="hp-muted">Зелёный маркер — всё сделано, жёлтый — частично, крестик — ноль, синий — пропуск.</p>
        <Go to="/calendar">Открыть календарь</Go>
      </>
    );
  }
  return (
    <>
      <div className="hp-kicker">За окном</div>
      <div className="hp-big">{rain ? "Дождь" : "Туман"}</div>
      <p className="hp-muted">Погода выбирается сама раз в день. Можно переключить.</p>
      <button className="hp-go" onClick={onRain}>
        {rain ? "Пусть будет туман" : "Пусть пойдёт дождь"}
        <Icon name={rain ? "fog" : "rain"} size={16} />
      </button>
    </>
  );
}

