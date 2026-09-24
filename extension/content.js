// LifeHelper — скрипт на каждой странице:
// 1) спрашивает фон, нужно ли закрыть сайт экраном «Сначала — дело»;
// 2) раз в 15 секунд сообщает, что вкладка открыта на экране (для учёта фокуса и отвлечений).
//    Клики/клавиши только считаются для статистики — на засчитывание времени они не влияют,
//    чтобы учёба по видео засчитывалась полностью.
(() => {
  if (window.top !== window || window.__lifehelper) return;
  window.__lifehelper = true;

  const TICK = 15;
  const send = (msg) => {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null); // расширение перезагрузили — страница живёт дальше
    }
  };

  // ------------------------------------------------------------ активность

  let counters = { clicks: 0, keys: 0, scrolls: 0 };
  let lastActivity = Date.now();
  let lastScroll = 0;
  let lastMove = 0;
  addEventListener("click", () => (counters.clicks++, (lastActivity = Date.now())), true);
  addEventListener("keydown", () => (counters.keys++, (lastActivity = Date.now())), true);
  addEventListener(
    "wheel",
    () => {
      const now = Date.now();
      lastActivity = now;
      if (now - lastScroll > 700) counters.scrolls++, (lastScroll = now);
    },
    { capture: true, passive: true },
  );
  for (const ev of ["mousemove", "touchstart", "pointerdown"]) {
    addEventListener(
      ev,
      () => {
        const now = Date.now();
        if (now - lastMove > 1000) (lastMove = now), (lastActivity = now);
      },
      { capture: true, passive: true },
    );
  }
  const mediaPlaying = () => [...document.querySelectorAll("video, audio")].some((m) => !m.paused && !m.ended && m.readyState > 2);

  setInterval(() => {
    if (document.visibilityState !== "visible" || overlay) return;
    const active = Date.now() - lastActivity < 60000 || mediaPlaying();
    send({ type: "tick", url: location.href, seconds: TICK, active, focused: document.hasFocus(), ...counters });
    counters = { clicks: 0, keys: 0, scrolls: 0 };
  }, TICK * 1000);

  // ------------------------------------------------------------ блокировка

  let overlay = null;
  let currentView = null;
  let mediaTimer = null;

  async function check() {
    const r = await send({ type: "check", url: location.href });
    if (r && r.block) show(r.view);
    else hide();
  }

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      check();
    }
  }, 1000);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "recheck") check();
  });
  check();

  function hide() {
    if (!overlay) return;
    overlay.host.remove();
    overlay = null;
    currentView = null;
    clearInterval(mediaTimer);
    document.documentElement.style.removeProperty("overflow");
  }

  // Пока экран открыт — никаких видео и горячих клавиш страницы
  function pauseMedia() {
    for (const m of document.querySelectorAll("video, audio")) if (!m.paused) m.pause();
  }
  addEventListener(
    "keydown",
    (e) => {
      if (overlay && !e.composedPath().includes(overlay.host)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const plural = (n, a, b, c) => {
    const x = Math.abs(n) % 100;
    const y = x % 10;
    if (x > 10 && x < 20) return c;
    if (y > 1 && y < 5) return b;
    if (y === 1) return a;
    return c;
  };

  function show(view) {
    if (overlay && JSON.stringify(view) === JSON.stringify(currentView)) return;
    if (!overlay) {
      const host = document.createElement("lifehelper-block");
      host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
      const root = host.attachShadow({ mode: "open" });
      (document.body || document.documentElement).appendChild(host);
      overlay = { host, root };
      document.documentElement.style.setProperty("overflow", "hidden", "important");
      pauseMedia();
      mediaTimer = setInterval(pauseMedia, 500);
      // body может появиться позже — переносим экран туда, чтобы сайт его не затёр
      if (!document.body) document.addEventListener("DOMContentLoaded", () => overlay && document.body.appendChild(overlay.host), { once: true });
    }
    currentView = view;
    renderMain(view);
  }

  function frame(inner) {
    overlay.root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="card">${inner}</div></div>`;
  }

  function renderMain(v) {
    const main = v.habits.find((h) => h.type === "minutes") || v.habits[0];
    if (!main) return hide();
    const others = v.habits.filter((h) => h.id !== main.id);

    if (v.session) {
      frame(`
        <div class="brand"><span class="mark">L</span> LifeHelper</div>
        <div class="eyebrow">Идёт фокус-сессия</div>
        <h1>${esc(v.session.emoji || "")} ${esc(v.session.title)} ещё не закончена</h1>
        <p class="sub">${esc(v.site)} подождёт. Вернись к занятию — время идёт только там.</p>
        <div class="actions">
          <button class="primary" data-act="back">▶ Вернуться к занятию</button>
        </div>
        <div class="foot">
          <button class="link" data-act="allow">Этот сайт мне нужен для учёбы — засчитать вкладку</button>
        </div>`);
    } else {
      const pct = main.type === "minutes" && main.target ? Math.min(100, Math.round((main.minutes / main.target) * 100)) : 0;
      const progress =
        main.type === "minutes"
          ? `<div class="progress"><div class="bar"><i style="width:${pct}%"></i></div><span>${main.minutes} / ${main.target} мин</span></div>`
          : "";
      const why = main.goal?.why ? `<blockquote><small>Ты сам писал про «${esc(main.goal.title)}»</small>«${esc(main.goal.why)}»</blockquote>` : "";
      const list = others.length
        ? `<div class="others">Ещё не сделано: ${others
            .map((h) => `<button class="chip" data-start="${h.id}">${esc(h.emoji || "")} ${esc(h.title)}</button>`)
            .join(" ")}</div>`
        : "";
      const passBtn =
        v.pass.left > 0
          ? `<button class="link" data-act="skip">Пропустить день · осталось ${v.pass.left} из ${v.pass.weekly}</button>`
          : `<span class="muted">Пропуски на этой неделе закончились</span>`;
      frame(`
        <div class="brand"><span class="mark">L</span> LifeHelper</div>
        <div class="eyebrow">Сначала дело · ${esc(v.site)} подождёт</div>
        <h1>Сначала — ${esc(main.emoji || "")} ${esc(main.title)}</h1>
        <p class="sub">${
          main.type === "minutes"
            ? `Осталось ${Math.max(0, main.target - main.minutes)} мин. Как только наберёшь норму — ${esc(v.site)} снова откроется сам.`
            : "Сделай и отметь на сайте или в боте — и сайт откроется."
        }</p>
        ${progress}
        ${why}
        <div class="actions">
          <button class="primary" data-start="${main.id}">▶ Начать</button>
        </div>
        ${list}
        <div class="foot">${passBtn}<span class="muted">🔥 стрик ${v.streak} ${plural(v.streak, "день", "дня", "дней")}</span></div>`);
    }
    bind();
  }

  async function renderSkip() {
    frame(`<div class="brand"><span class="mark">L</span> LifeHelper</div><div class="loading">Считаю, во что обойдётся пропуск…</div>`);
    const p = await send({ type: "skipPreview" });
    if (!overlay) return;
    if (!p || p.error) {
      frame(`<h1>Не получилось связаться с сайтом</h1><p class="sub">${esc(p?.error || "")}</p><div class="actions"><button class="primary" data-act="main">Назад</button></div>`);
      return bind();
    }
    if (!p.allowed) {
      frame(`<h1>${esc(p.headline)}</h1><div class="actions"><button class="primary" data-act="main">Понятно, иду делать</button></div>`);
      return bind();
    }
    let left = p.countdown;
    frame(`
      <div class="brand"><span class="mark">L</span> LifeHelper</div>
      <div class="eyebrow">Точно пропустить сегодня?</div>
      <h1 class="h2">${esc(p.headline)}</h1>
      <ul>${p.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      ${p.why.map((w) => `<blockquote><small>Ты сам писал про «${esc(w.goal)}»</small>«${esc(w.text)}»</blockquote>`).join("")}
      <input class="reason" placeholder="Почему? (честно, для себя)" maxlength="200" />
      <div class="actions">
        <button class="primary" data-act="main">Нет, я сделаю 💪</button>
        <button class="danger" data-act="confirm" disabled><span class="fill"></span><span class="lbl">Да, пропустить (${left})</span></button>
      </div>`);
    bind();
    const btn = overlay.root.querySelector('[data-act="confirm"]');
    const lbl = btn.querySelector(".lbl");
    const fill = btn.querySelector(".fill");
    const t = setInterval(() => {
      if (!overlay || !btn.isConnected) return clearInterval(t);
      left--;
      fill.style.transform = `scaleX(${Math.max(0, left / p.countdown)})`;
      if (left <= 0) {
        clearInterval(t);
        btn.disabled = false;
        lbl.textContent = "Да, пропустить";
      } else lbl.textContent = `Да, пропустить (${left})`;
    }, 1000);
  }

  function bind() {
    overlay.root.querySelectorAll("[data-start]").forEach((b) =>
      b.addEventListener("click", () => {
        b.disabled = true;
        send({ type: "start", habitId: Number(b.dataset.start) });
      }),
    );
    overlay.root.querySelectorAll("[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const act = b.dataset.act;
        if (act === "skip") return renderSkip();
        if (act === "main") return renderMain(currentView);
        if (act === "back") return send({ type: "start", habitId: currentView.session.habitId });
        if (act === "allow") {
          await send({ type: "allowTab" });
          return check();
        }
        if (act === "confirm") {
          b.disabled = true;
          const reason = overlay.root.querySelector(".reason")?.value || "";
          const r = await send({ type: "skip", reason });
          if (r && r.error) {
            b.disabled = false;
            alert(r.error);
          } else check();
        }
      }),
    );
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      position: fixed; inset: 0; display: grid; place-items: center; padding: 20px; overflow-y: auto;
      background: radial-gradient(900px 500px at 50% 120%, rgba(79,196,145,.18), transparent), rgba(10,12,16,.94);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      font-family: Manrope, "Segoe UI", system-ui, -apple-system, sans-serif; color: #eef0f3;
      animation: fade .35s ease-out both;
    }
    @keyframes fade { from { opacity: 0 } }
    @keyframes rise { from { opacity: 0; transform: translateY(18px) scale(.98) } }
    .card {
      width: min(600px, 100%); background: #1b1f27; border: 1px solid rgba(255,255,255,.08); border-radius: 30px;
      padding: 38px 40px; box-shadow: 0 40px 100px -30px rgba(0,0,0,.8);
      animation: rise .6s cubic-bezier(.32,.72,0,1) both;
    }
    .brand { display: flex; align-items: center; gap: 10px; font: 700 17px Georgia, "Playfair Display", serif; margin-bottom: 26px; }
    .mark { width: 30px; height: 30px; border-radius: 9px; background: #4fc491; color: #0c261b; display: grid; place-items: center; font-size: 16px; }
    .eyebrow { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; color: #8b93a1; }
    h1 { font: 700 38px/1.15 "Playfair Display", Georgia, serif; margin: 12px 0 12px; letter-spacing: -.01em; }
    h1.h2 { font-size: 25px; line-height: 1.3; }
    .sub { color: #a5acb8; font-size: 16px; line-height: 1.5; margin: 0 0 20px; }
    .progress { display: flex; align-items: center; gap: 14px; margin: 6px 0 22px; }
    .bar { flex: 1; height: 10px; border-radius: 99px; background: #262c36; overflow: hidden; }
    .bar i { display: block; height: 100%; background: #4fc491; border-radius: inherit; }
    .progress span { font: 700 14px "JetBrains Mono", ui-monospace, monospace; color: #cfd4dc; white-space: nowrap; }
    blockquote { margin: 0 0 22px; padding: 16px 18px; border-left: 3px solid #4fc491; background: rgba(79,196,145,.12); border-radius: 14px; font: italic 600 18px/1.4 "Playfair Display", Georgia, serif; }
    blockquote small { display: block; font: 700 11px system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #8b93a1; margin-bottom: 6px; font-style: normal; }
    ul { list-style: none; margin: 16px 0 18px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li { padding: 12px 14px; border-radius: 14px; background: #20252e; border: 1px solid rgba(255,255,255,.06); font-size: 14.5px; line-height: 1.45; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    button { font: inherit; cursor: pointer; border: 0; }
    .primary { background: #4fc491; color: #0c261b; font-weight: 800; font-size: 16px; padding: 15px 28px; border-radius: 99px; box-shadow: 0 14px 30px -14px rgba(79,196,145,.6); transition: transform .3s cubic-bezier(.32,.72,0,1), background .2s; }
    .primary:hover { background: #45b884; }
    .primary:active { transform: scale(.97); }
    .danger { position: relative; overflow: hidden; background: #262c36; color: #f07a7a; font-weight: 700; padding: 15px 24px; border-radius: 99px; border: 1px solid rgba(240,122,122,.3); }
    .danger:disabled { color: #8b93a1; cursor: not-allowed; }
    .danger .fill { position: absolute; inset: 0; background: rgba(240,122,122,.18); transform-origin: left; transition: transform 1s linear; }
    .danger .lbl { position: relative; }
    .others { margin-top: 18px; color: #8b93a1; font-size: 14px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .chip { background: #20252e; color: #eef0f3; border: 1px solid rgba(255,255,255,.1); border-radius: 99px; padding: 6px 12px; font-size: 13px; font-weight: 700; }
    .foot { margin-top: 26px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.06); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 13.5px; }
    .link { background: none; color: #8b93a1; text-decoration: underline; text-underline-offset: 3px; padding: 0; font-size: 13.5px; }
    .link:hover { color: #eef0f3; }
    .muted { color: #6b7380; }
    .reason { width: 100%; margin: 0 0 16px; padding: 13px 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,.1); background: #20252e; color: #eef0f3; font: inherit; font-size: 15px; outline: none; }
    .reason:focus { border-color: #4fc491; }
    .loading { color: #8b93a1; padding: 30px 0; }
    @media (max-width: 520px) { .card { padding: 26px 22px; border-radius: 24px; } h1 { font-size: 29px; } }
  `;
})();
