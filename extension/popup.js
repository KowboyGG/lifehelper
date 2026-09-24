const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (sec) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
};
let data = null;

async function load() {
  data = await chrome.runtime.sendMessage({ type: "popup" });
  render();
}

function pendingSeconds(habitId) {
  const p = data.pending?.sessions || {};
  return Object.values(p)
    .filter((s) => s.habitId === habitId)
    .reduce((a, s) => a + s.seconds, 0);
}

function render() {
  const { config, state, session, authError } = data || {};
  if (!config?.token) {
    app.innerHTML = `
      <div class="card">
        <h2 style="font-size:20px;margin-bottom:6px">Подключи расширение</h2>
        <div class="muted" style="margin-bottom:12px">Укажи адрес своего LifeHelper и войди через Telegram.</div>
        <button class="primary" id="opts">Открыть настройки</button>
      </div>`;
    document.getElementById("opts").onclick = () => chrome.runtime.openOptionsPage();
    return;
  }
  if (authError) {
    app.innerHTML = `<div class="card"><b style="color:var(--danger)">Токен больше не действует.</b><div class="muted" style="margin:6px 0 12px">Войди заново в настройках расширения.</div><button class="primary" id="opts">Настройки</button></div>`;
    document.getElementById("opts").onclick = () => chrome.runtime.openOptionsPage();
    return;
  }
  if (!state) {
    app.innerHTML = `<div class="muted">Нет связи с сайтом. Проверь адрес в настройках.</div>`;
    return;
  }
  document.getElementById("streak").textContent = `🔥 ${state.streak.current}`;

  let html = "";
  if (session) {
    const h = state.habits.find((x) => x.id === session.habitId);
    const mins = (h?.minutes || 0) + pendingSeconds(session.habitId) / 60;
    const target = h?.target_minutes || 60;
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    html += `
      <section class="card session">
        <div class="eyebrow">Фокус${session.auto ? " · включился сам" : ""}</div>
        <div class="row between" style="margin:6px 0 10px">
          <b style="font-size:16px">${esc(session.emoji || "")} ${esc(session.title)}</b>
          <span class="timer" id="timer" data-start="${session.startedAt}">${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}</span>
        </div>
        <div class="bar"><i style="width:${Math.min(100, (mins / target) * 100)}%"></i></div>
        <div class="row between" style="margin-top:8px">
          <span class="muted mono" style="font-size:12px">${Math.floor(mins)} / ${target} мин · считается, пока вкладка на экране</span>
          <button id="stop">Стоп</button>
        </div>
      </section>`;
  }

  const status = state.pass?.usedToday
    ? `<span class="pill">🎟 пропуск</span>`
    : state.block.active
      ? `<span class="pill">🛡 блок включён</span>`
      : `<span class="pill green">свободно</span>`;
  html += `<section class="card"><div class="row between" style="margin-bottom:4px"><div class="eyebrow">Сегодня</div>${status}</div>`;
  if (!state.habits.length) html += `<div class="muted" style="padding:8px 0">На сегодня привычек нет.</div>`;
  for (const h of state.habits) {
    const mins = h.minutes + pendingSeconds(h.id) / 60;
    const meta = h.skipped
      ? "пропуск на сегодня"
      : h.type === "minutes"
        ? `${Math.floor(mins)} / ${h.target_minutes} мин`
        : h.done
          ? "сделано"
          : "отметь на сайте или в боте";
    const canStart = !h.done && !h.skipped && h.type === "minutes" && session?.habitId !== h.id;
    html += `
      <div class="habit${h.done || h.skipped ? " done" : ""}">
        <div class="em">${esc(h.emoji || "•")}</div>
        <div class="body">
          <div class="t">${esc(h.title)}</div>
          ${h.type === "minutes" ? `<div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, (mins / h.target_minutes) * 100)}%"></i></div>` : ""}
          <div class="m">${meta}</div>
        </div>
        ${h.done ? "✅" : canStart ? `<button class="primary" data-start="${h.id}">▶</button>` : ""}
      </div>`;
  }
  html += `</section>`;

  const sites = (state.sites || []).slice(0, 4);
  if (sites.length) {
    html += `<section class="card"><div class="eyebrow" style="margin-bottom:6px">Отвлечения сегодня</div>${sites
      .map((s) => `<div class="site"><span>${esc(s.domain)}</span><span class="mono muted">${fmt(s.seconds)}</span></div>`)
      .join("")}</section>`;
  }
  app.innerHTML = html;

  app.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "start", habitId: Number(b.dataset.start), newTab: true });
      window.close();
    }),
  );
  const stop = document.getElementById("stop");
  if (stop) stop.onclick = async () => (await chrome.runtime.sendMessage({ type: "stop" }), load());
}

setInterval(() => {
  const t = document.getElementById("timer");
  if (!t) return;
  const s = Math.floor((Date.now() - Number(t.dataset.start)) / 1000);
  t.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}, 1000);

document.getElementById("open").onclick = async () => {
  const { config } = await chrome.storage.local.get("config");
  if (config?.apiUrl) chrome.tabs.create({ url: config.apiUrl });
  else chrome.runtime.openOptionsPage();
};
document.getElementById("refresh").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "sync" });
  load();
};
load();
chrome.runtime.sendMessage({ type: "sync" }).then(load).catch(() => undefined);
