// LifeHelper — фоновый service worker
// Решает, блокировать ли вкладку, ведёт фокус-сессии и раз в минуту синхронизируется с сайтом.

const FLUSH_AFTER_SECONDS = 60;

// ---------------------------------------------------------------- хранилище (с блокировкой от гонок)

let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}
const load = (keys) => chrome.storage.local.get(keys);
const save = (obj) => chrome.storage.local.set(obj);
const emptyPending = () => ({ sessions: {}, sites: {} });

// ---------------------------------------------------------------- API

async function api(path, { method = "GET", body } = {}) {
  const { config } = await load("config");
  if (!config?.apiUrl || !config?.token) throw new Error("not-configured");
  const res = await fetch(`${config.apiUrl.replace(/\/$/, "")}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await save({ authError: true });
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  await save({ authError: false, lastSyncAt: Date.now() });
  return data;
}

// ---------------------------------------------------------------- URL-помощники

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const matchDomain = (host, d) => host === d || host.endsWith(`.${d}`);

function matchSite(url, pattern) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const [domain, ...rest] = pattern.toLowerCase().split("/");
  if (!matchDomain(u.hostname.replace(/^www\./, "").toLowerCase(), domain)) return false;
  if (!rest.length || !rest.join("")) return true;
  const path = `/${rest.join("/")}`.toLowerCase();
  return (u.pathname + u.search).toLowerCase().startsWith(path);
}

function focusSites(h) {
  const list = [...(h.focus_sites || [])];
  if (h.start_url) {
    const host = hostOf(h.start_url);
    if (host && !list.some((p) => p.split("/")[0] === host)) list.push(host);
  }
  return list;
}

const blockedDomain = (state, host) => (state?.blocklist || []).find((d) => matchDomain(host, d));

// ---------------------------------------------------------------- состояние

async function applyState(st) {
  const { session, notified = {} } = await load(["session", "notified"]);
  let sess = session;
  if (sess && sess.date !== st.date) sess = null; // новый день — новая жизнь
  if (sess) {
    const h = st.habits.find((x) => x.id === sess.habitId);
    if (!h || h.done) sess = null;
  }
  for (const c of st.completed || []) {
    const key = `${st.date}:${c.id}`;
    if (notified[key]) continue;
    notified[key] = true;
    const h = st.habits.find((x) => x.id === c.id);
    notify("Норма выполнена! 🎉", `${h?.emoji ?? ""} ${c.title}${h?.target_minutes ? ` — ${h.target_minutes} мин` : ""}. ${st.block.active ? "" : "Блокировка снята."}`);
  }
  // чистим старые отметки уведомлений
  for (const k of Object.keys(notified)) if (!k.startsWith(st.date)) delete notified[k];
  await save({ state: { ...st, fetchedAt: Date.now() }, session: sess, notified });
  updateBadge(st, sess);
  broadcast();
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/128.png", title, message, priority: 1 }, () => void chrome.runtime.lastError);
}

function updateBadge(st, sess) {
  const pending = (st?.habits || []).filter((h) => !h.done && !h.skipped);
  let text = "";
  let color = "#f0b75e";
  if (!st) text = "";
  else if (st.pass?.usedToday) text = "🎟";
  else if (!pending.length && st.habits.length) {
    text = "✓";
    color = "#4fc491";
  } else {
    const m = pending.find((h) => h.type === "minutes" && (!sess || h.id === sess.habitId));
    text = m ? `${Math.max(0, Math.ceil(m.target_minutes - m.minutes))}m` : String(pending.length);
    if (sess) color = "#4fc491";
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function broadcast() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id && t.url?.startsWith("http")) chrome.tabs.sendMessage(t.id, { type: "recheck" }).catch(() => undefined);
}

// ---------------------------------------------------------------- синхронизация

let syncing = null;
function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const pending = await withLock(async () => {
      const { pending } = await load("pending");
      await save({ pending: emptyPending() });
      return pending || emptyPending();
    });
    const sessions = Object.entries(pending.sessions).map(([id, s]) => ({ id, ...s }));
    const hasData = sessions.length > 0 || Object.keys(pending.sites).length > 0;
    try {
      const st = hasData ? await api("/ext/heartbeat", { method: "POST", body: { sessions, sites: pending.sites } }) : await api("/ext/state");
      await applyState(st);
      return st;
    } catch (e) {
      // вернуть несохранённое обратно
      await withLock(async () => {
        const { pending: cur = emptyPending() } = await load("pending");
        for (const [id, s] of Object.entries(pending.sessions)) {
          const c = (cur.sessions[id] ||= { habitId: s.habitId, startedAt: s.startedAt, seconds: 0, clicks: 0, keys: 0, scrolls: 0 });
          c.seconds += s.seconds;
          c.clicks += s.clicks;
          c.keys += s.keys;
          c.scrolls += s.scrolls;
        }
        for (const [d, sec] of Object.entries(pending.sites)) cur.sites[d] = (cur.sites[d] || 0) + sec;
        await save({ pending: cur });
      });
      throw e;
    }
  })().finally(() => (syncing = null));
  return syncing;
}

// ---------------------------------------------------------------- фокус-сессии

async function startSession(habitId, auto) {
  const { state, session } = await load(["state", "session"]);
  const h = state?.habits.find((x) => x.id === habitId);
  if (!h) return null;
  if (session?.habitId === habitId) return session;
  const sess = {
    id: crypto.randomUUID(),
    habitId,
    title: h.title,
    emoji: h.emoji,
    target: h.target_minutes,
    date: state.date,
    startedAt: Date.now(),
    auto,
    allowedTabs: [],
  };
  await save({ session: sess });
  updateBadge(state, sess);
  return sess;
}

async function stopSession() {
  await sync().catch(() => undefined);
  const { state } = await load("state");
  await save({ session: null });
  updateBadge(state, null);
  broadcast();
}

// ---------------------------------------------------------------- решение по вкладке

async function decide(url, tabId) {
  const { config, state, session } = await load(["config", "state", "session"]);
  if (!config?.token || !state) return { block: false };
  if (state.fetchedAt && Date.now() - state.fetchedAt > 5 * 60 * 1000) sync().catch(() => undefined);
  const host = hostOf(url);
  if (!host || (config.apiUrl && host === hostOf(config.apiUrl))) return { block: false };

  const pending = state.habits.filter((h) => !h.done && !h.skipped);
  const focusHabit = pending.find((h) => h.type === "minutes" && focusSites(h).some((p) => matchSite(url, p)));
  let sess = session;
  // Зашёл на сайт для занятий сам — таймер включается автоматически
  if (focusHabit && (!sess || sess.habitId !== focusHabit.id) && !(sess && !sess.auto)) sess = await startSession(focusHabit.id, true);
  if (focusHabit) return { block: false, focus: true };

  if (!blockedDomain(state, host)) return { block: false };
  if (sess && sess.allowedTabs.includes(tabId)) return { block: false };
  if (!state.block.active) return { block: false };

  const blocking = pending.filter((h) => h.blocking);
  return {
    block: true,
    view: {
      habits: blocking.map((h) => ({
        id: h.id,
        title: h.title,
        emoji: h.emoji,
        type: h.type,
        minutes: Math.round(h.minutes),
        target: h.target_minutes,
        start_url: h.start_url,
        goal: h.goal ? { title: h.goal.title, why: h.goal.why, deadline: h.goal.deadline } : null,
      })),
      streak: state.streak.current,
      pass: state.pass,
      session: sess ? { habitId: sess.habitId, title: sess.title, emoji: sess.emoji } : null,
      site: host,
      apiUrl: config.apiUrl,
    },
  };
}

// ---------------------------------------------------------------- тики от вкладок

async function onTick(msg, tabId) {
  let flush = false;
  await withLock(async () => {
    const { state, session, pending = emptyPending(), config } = await load(["state", "session", "pending", "config"]);
    if (!state || !config?.token) return;
    const host = hostOf(msg.url);
    if (!host) return;
    const seconds = Math.max(0, Math.min(30, Number(msg.seconds) || 0));
    const focusHere = session && (() => {
      const h = state.habits.find((x) => x.id === session.habitId);
      if (!h) return false;
      if (session.allowedTabs.includes(tabId)) return true;
      const sites = focusSites(h);
      if (sites.length) return sites.some((p) => matchSite(msg.url, p));
      // у привычки нет сайтов — засчитываем любой не отвлекающий сайт, кроме самого LifeHelper
      return !blockedDomain(state, host) && host !== hostOf(config.apiUrl);
    })();

    if (focusHere) {
      // Время идёт, пока вкладка на экране — без проверки кликов (видео-уроки засчитываются целиком).
      // Защита от двойного счёта, если учебных вкладок на экране две: не чаще одного тика в ~12 секунд.
      const now = Date.now();
      if (!session.lastTickAt || now - session.lastTickAt >= 12000) {
        const s = (pending.sessions[session.id] ||= { habitId: session.habitId, startedAt: session.startedAt, seconds: 0, clicks: 0, keys: 0, scrolls: 0 });
        s.seconds += seconds;
        s.clicks += msg.clicks | 0;
        s.keys += msg.keys | 0;
        s.scrolls += msg.scrolls | 0;
        session.lastTickAt = now;
        await save({ session });
      }
    } else if (msg.focused !== false) {
      const d = blockedDomain(state, host);
      if (d) pending.sites[d] = (pending.sites[d] || 0) + seconds;
    }
    await save({ pending });
    const total = Object.values(pending.sessions).reduce((a, s) => a + s.seconds, 0) + Object.values(pending.sites).reduce((a, x) => a + x, 0);
    flush = total >= FLUSH_AFTER_SECONDS;
  });
  if (flush) sync().catch(() => undefined);
}

// ---------------------------------------------------------------- сообщения

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  (async () => {
    switch (msg.type) {
      case "check":
        return decide(msg.url, tabId);
      case "tick":
        await onTick(msg, tabId);
        return { ok: true };
      case "start": {
        const { state, config } = await load(["state", "config"]);
        const h = state?.habits.find((x) => x.id === msg.habitId);
        if (!h) return { ok: false };
        await startSession(h.id, false);
        const url = h.start_url || config.apiUrl;
        if (msg.newTab || !tabId) await chrome.tabs.create({ url });
        else await chrome.tabs.update(tabId, { url });
        broadcast();
        return { ok: true };
      }
      case "stop":
        await stopSession();
        return { ok: true };
      case "allowTab": {
        const { session } = await load("session");
        if (!session || !tabId) return { ok: false };
        session.allowedTabs = [...new Set([...session.allowedTabs, tabId])];
        await save({ session });
        return { ok: true };
      }
      case "skipPreview":
        return api("/ext/skip-preview");
      case "skip": {
        const st = await api("/ext/pass", { method: "POST", body: { reason: msg.reason || "из расширения" } });
        await applyState(st);
        return { ok: true };
      }
      case "popup": {
        const data = await load(["config", "state", "session", "pending", "authError", "lastSyncAt"]);
        return data;
      }
      case "sync":
        return sync();
      default:
        return null;
    }
  })()
    .then(reply)
    .catch((e) => reply({ error: String(e.message || e) }));
  return true; // ответ асинхронный
});

// ---------------------------------------------------------------- расписание

function setup() {
  chrome.alarms.create("sync", { periodInMinutes: 1 });
  sync().catch(() => undefined);
}
chrome.runtime.onInstalled.addListener((d) => {
  setup();
  if (d.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => a.name === "sync" && sync().catch(() => undefined));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.config) sync().catch(() => undefined);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await withLock(async () => {
    const { session } = await load("session");
    if (session?.allowedTabs?.includes(tabId)) {
      session.allowedTabs = session.allowedTabs.filter((t) => t !== tabId);
      await save({ session });
    }
  });
});
