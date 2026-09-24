import { Page } from "../App";
import { MONTHS_NOM, MOODS, WD, WD_SHORT, fmtDate, fmtMin, fmtSec, fmtShort, useApi, type DaySummary } from "../lib";
import { Bar, ErrorBox, Loading } from "../ui/kit";

interface Stats {
  today: string;
  heatmap: DaySummary[];
  weeks: { week: string; done: number; total: number; passes: number; rate: number | null }[];
  byWeekday: { done: number; total: number }[];
  focus: { id: number; title: string; emoji: string | null; weeks: number[] }[];
  focusDays: { date: string; seconds: number; clicks: number; keys: number }[];
  distractions: { date: string; seconds: number }[];
  topSites: { domain: string; seconds: number }[];
  moods: { date: string; mood: number }[];
  streak: { current: number; best: number };
  rate30: number | null;
  totals: Record<string, number>;
}

export function StatsPage() {
  const { data, error } = useApi<Stats>("/stats");
  if (error) return <Page title="Статистика"><ErrorBox error={error} /></Page>;
  if (!data) return <Page title="Статистика"><Loading /></Page>;
  const d = data;

  const wd = d.byWeekday.map((x, i) => ({ i, rate: x.total ? x.done / x.total : null }));
  const rated = wd.filter((x) => x.rate !== null) as { i: number; rate: number }[];
  const worst = rated.length > 1 ? rated.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
  const best = rated.length > 1 ? rated.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  const distMax = Math.max(1, ...d.distractions.map((x) => x.seconds));
  const distAvg = d.distractions.reduce((a, x) => a + x.seconds, 0) / Math.max(1, d.distractions.filter((x) => x.seconds > 0).length);
  const moodAvg = d.moods.length ? d.moods.reduce((a, m) => a + m.mood, 0) / d.moods.length : null;

  return (
    <Page title="Статистика" sub="Честная картина: что делаешь, а что только планируешь">
      <div className="tiles" style={{ marginBottom: 22 }}>
        <Tile k="Стрик" v={`🔥 ${d.streak.current}`} />
        <Tile k="Рекорд" v={String(d.streak.best)} />
        <Tile k="Выполнение · 30 дней" v={d.rate30 !== null ? `${Math.round(d.rate30 * 100)}%` : "—"} />
        <Tile k="Фокус за всё время" v={fmtHours(d.totals.minutes ?? 0)} />
        <Tile k="Отмеченных дел" v={String(d.totals.done ?? 0)} />
        <Tile k="Пропусков взято" v={String(d.totals.passes ?? 0)} />
      </div>

      <div className="bento">
        <section className="card span-12">
          <div className="card-head">
            <h2>Год привычек</h2>
          </div>
          <YearHeat days={d.heatmap} today={d.today} />
          <div className="legend" style={{ marginTop: 14 }}>
            <span>
              <i style={{ background: "var(--card-3)" }} /> ничего
            </span>
            <span>
              <i style={{ background: "color-mix(in srgb, var(--accent) 30%, var(--card-3))" }} /> меньше половины
            </span>
            <span>
              <i style={{ background: "color-mix(in srgb, var(--accent) 60%, var(--card-3))" }} /> больше половины
            </span>
            <span>
              <i style={{ background: "var(--accent)" }} /> всё
            </span>
            <span>
              <i style={{ background: "var(--blue-soft)", outline: "1px solid var(--blue)" }} /> пропуск
            </span>
          </div>
        </section>

        <section className="card span-7">
          <div className="card-head">
            <h2>Выполнение по неделям</h2>
          </div>
          <div className="bars">
            {d.weeks.map((w, i) => (
              <div className="b" key={w.week} data-tip={`${fmtShort(w.week)}: ${w.done}/${w.total}${w.passes ? `, пропусков ${w.passes}` : ""}`}>
                {i === d.weeks.length - 1 && w.rate !== null && <em>{Math.round(w.rate * 100)}%</em>}
                <i className={w.rate === null ? "muted" : ""} style={{ height: `${(w.rate ?? 0) * 100}%` }} />
                <span>{fmtShort(w.week).replace(/ .*/, "")}</span>
              </div>
            ))}
          </div>
          <div className="chart-note">Доля сделанного из запланированного; подпись — первый день недели.</div>
        </section>

        <section className="card span-5">
          <div className="card-head">
            <h2>По дням недели</h2>
          </div>
          <div className="bars" style={{ height: 150 }}>
            {wd.map((x) => (
              <div className="b" key={x.i} data-tip={`${WD[x.i]}: ${x.rate !== null ? Math.round(x.rate * 100) + "%" : "нет данных"}`}>
                <i className={x.rate === null ? "muted" : ""} style={{ height: `${(x.rate ?? 0) * 100}%`, opacity: worst && x.i === worst.i ? 0.55 : 1 }} />
                <span>{WD_SHORT[x.i]}</span>
              </div>
            ))}
          </div>
          <div className="chart-note">
            {worst && best && worst.i !== best.i
              ? `Слабее всего — ${WD[worst.i]} (${Math.round(worst.rate * 100)}%), сильнее — ${WD[best.i]} (${Math.round(best.rate * 100)}%). Спланируй ${WD[worst.i]} полегче или начинай пораньше.`
              : "Нужно чуть больше истории, чтобы увидеть закономерность."}
          </div>
        </section>

        <section className="card span-7">
          <div className="card-head">
            <h2>Время на привычки</h2>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 13 }}>
              минут в неделю · 12 недель
            </span>
          </div>
          {d.focus.length === 0 && <div className="muted">Появится, когда будут привычки «на время».</div>}
          <div className="stack" style={{ gap: 18 }}>
            {d.focus.map((f) => {
              const max = Math.max(1, ...f.weeks);
              const total = f.weeks.reduce((a, b) => a + b, 0);
              return (
                <div key={f.id}>
                  <div className="row between" style={{ marginBottom: 8 }}>
                    <b>
                      {f.emoji} {f.title}
                    </b>
                    <span className="mono muted" style={{ fontSize: 12.5 }}>
                      {fmtMin(total)} за 12 нед.
                    </span>
                  </div>
                  <div className="bars" style={{ height: 56, gap: 4 }}>
                    {f.weeks.map((m, i) => (
                      <div className="b" key={i} data-tip={`${fmtShort(d.weeks[i].week)}: ${fmtMin(m)}`}>
                        <i style={{ height: `${(m / max) * 100}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card span-5">
          <div className="card-head">
            <h2>Отвлечения</h2>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 13 }}>
              14 дней
            </span>
          </div>
          <div className="bars" style={{ height: 110 }}>
            {d.distractions.map((x) => (
              <div className="b" key={x.date} data-tip={`${fmtDate(x.date)}: ${fmtSec(x.seconds)}`}>
                <i className="alt" style={{ height: `${(x.seconds / distMax) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="chart-note" style={{ marginBottom: 14 }}>
            {distAvg > 60 ? `В среднем ${fmtSec(distAvg)} в день на соцсети и видео.` : "Данные собирает Chrome-расширение."}
          </div>
          {d.topSites.map((s) => (
            <div className="hbar" key={s.domain}>
              <span className="name">{s.domain}</span>
              <Bar value={s.seconds / d.topSites[0].seconds} className="thin" color="var(--danger)" />
              <span className="mono" style={{ fontSize: 12.5 }}>
                {fmtSec(s.seconds)}
              </span>
            </div>
          ))}
        </section>

        <section className="card span-12">
          <div className="card-head">
            <h2>Настроение</h2>
            <div className="spacer" />
            {moodAvg !== null && (
              <span className="muted" style={{ fontSize: 13.5 }}>
                в среднем {MOODS[Math.round(moodAvg) - 1]} {moodAvg.toFixed(1)} из 5
              </span>
            )}
          </div>
          {d.moods.length === 0 ? (
            <div className="muted">Отмечай настроение вечером в боте или на главной — здесь появится график.</div>
          ) : (
            <div className="bars" style={{ height: 90, gap: 3 }}>
              {d.moods.map((m) => (
                <div className="b" key={m.date} data-tip={`${fmtDate(m.date)}: ${MOODS[m.mood - 1]}`}>
                  <i style={{ height: `${(m.mood / 5) * 100}%`, background: "var(--violet)" }} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}

const fmtHours = (min: number) => (min >= 600 ? `${Math.round(min / 60)} ч` : fmtMin(min));

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function YearHeat({ days, today }: { days: DaySummary[]; today: string }) {
  // подписи месяцев над колонками-неделями
  const months: { col: number; label: string }[] = [];
  days.forEach((x, i) => {
    if (i % 7 === 0) {
      const m = Number(x.date.slice(5, 7));
      const prev = months[months.length - 1];
      const label = MONTHS_NOM[m - 1].slice(0, 3);
      if (!prev || (prev.label !== label && i / 7 - prev.col >= 3)) months.push({ col: i / 7, label });
    }
  });
  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.ceil(days.length / 7)}, 17px)`, marginBottom: 6, fontSize: 11, color: "var(--muted)" }}>
        {months.map((m) => (
          <span key={m.col} style={{ gridColumn: m.col + 1 }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="heat">
        {days.map((x) => {
          let cls = "";
          if (x.date > today) cls = "future";
          else if (x.total === 0) cls = "";
          else if (x.done >= x.total) cls = "l3";
          else if (x.pass) cls = "pass";
          else if (x.done / x.total >= 0.5) cls = "l2";
          else if (x.done > 0) cls = "l1";
          return <i key={x.date} className={cls} data-tip={`${fmtDate(x.date)}: ${x.done}/${x.total}${x.pass ? " · пропуск" : ""}`} />;
        })}
      </div>
    </div>
  );
}
