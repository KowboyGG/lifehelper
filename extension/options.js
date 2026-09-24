const $ = (id) => document.getElementById(id);
const status = (text, kind = "") => {
  const el = $("status");
  el.hidden = false;
  el.className = `status ${kind}`;
  el.textContent = text;
};
const cleanUrl = (u) => {
  let s = u.trim().replace(/\/+$/, "");
  if (s && !/^https?:\/\//.test(s)) s = `https://${s}`;
  return s;
};

async function init() {
  const { config } = await chrome.storage.local.get("config");
  if (config?.apiUrl) $("url").value = config.apiUrl;
  if (config?.token) test();
}

async function saveConfig(patch) {
  const { config = {} } = await chrome.storage.local.get("config");
  await chrome.storage.local.set({ config: { ...config, ...patch }, authError: false });
}

async function test() {
  const { config } = await chrome.storage.local.get("config");
  if (!config?.apiUrl || !config?.token) return status("Сначала войди через Telegram или вставь токен.");
  try {
    const res = await fetch(`${config.apiUrl}/api/ext/state`, { headers: { authorization: `Bearer ${config.token}` } });
    if (res.status === 401) return status("Токен не принят — войди заново.", "err");
    const st = await res.json();
    status(`✓ Подключено. Сегодня ${st.habits.length} привычек, стрик ${st.streak.current}.`, "ok");
    chrome.runtime.sendMessage({ type: "sync" }).catch(() => undefined);
  } catch (e) {
    status(`Не удаётся достучаться до ${config.apiUrl}: ${e.message}`, "err");
  }
}

$("tg").onclick = async () => {
  const apiUrl = cleanUrl($("url").value);
  if (!apiUrl) return status("Укажи адрес сайта.", "err");
  $("url").value = apiUrl;
  await saveConfig({ apiUrl });
  try {
    const res = await fetch(`${apiUrl}/api/auth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ext" }) });
    const r = await res.json();
    if (!res.ok) return status(r.error || "Ошибка", "err");
    chrome.tabs.create({ url: r.url });
    status("Жду подтверждения в Telegram — нажми Start в открывшемся чате…");
    const began = Date.now();
    const poll = async () => {
      const p = await fetch(`${apiUrl}/api/auth/poll?code=${encodeURIComponent(r.code)}`).then((x) => x.json()).catch(() => ({ status: "pending" }));
      if (p.status === "ok" && p.token) {
        await saveConfig({ apiUrl, token: p.token });
        return test();
      }
      if (p.status === "denied") return status("⛔ Этот Telegram-аккаунт — не владелец.", "err");
      if (p.status === "expired" || Date.now() - began > 600000) return status("Код устарел — попробуй ещё раз.", "err");
      setTimeout(poll, 2000);
    };
    poll();
  } catch (e) {
    status(`Не удаётся достучаться до ${apiUrl}: ${e.message}`, "err");
  }
};

$("saveToken").onclick = async () => {
  const apiUrl = cleanUrl($("url").value);
  const token = $("token").value.trim();
  if (!apiUrl || !token) return status("Нужны и адрес, и токен.", "err");
  await saveConfig({ apiUrl, token });
  test();
};
$("test").onclick = test;
init();
