import { useEffect, useRef, useState } from "react";
import { api, navigate, toast } from "../lib";
import { Icon } from "../ui/icons";

export function LoginPage() {
  const [status, setStatus] = useState<{ botConfigured: boolean; ownerSet: boolean; devLogin: boolean } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "denied" | "magic">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.title = "Вход · LifeHelper";
    api<typeof status>("/auth/status").then(setStatus).catch(() => undefined);
    const code = new URLSearchParams(location.search).get("code");
    if (code) {
      setState("magic");
      api("/auth/magic", "POST", { code })
        .then(() => navigate("/"))
        .catch((e) => {
          toast((e as Error).message, true);
          setState("idle");
          history.replaceState(null, "", "/login");
        });
    }
    return () => clearTimeout(timer.current);
  }, []);

  const start = async () => {
    const tab = window.open("", "_blank");
    try {
      const r = await api<{ code: string; url: string }>("/auth/start", "POST", { kind: "web" });
      setLink(r.url);
      if (tab) tab.location.href = r.url;
      setState("waiting");
      const began = Date.now();
      const poll = async () => {
        const p = await api<{ status: string }>(`/auth/poll?code=${r.code}`).catch(() => ({ status: "pending" }));
        if (p.status === "ok") return navigate("/");
        if (p.status === "denied") return setState("denied");
        if (p.status === "expired" || Date.now() - began > 10 * 60 * 1000) return setState("idle");
        timer.current = window.setTimeout(poll, 2000);
      };
      poll();
    } catch (e) {
      tab?.close();
      toast((e as Error).message, true);
    }
  };

  const dev = async () => {
    await api("/auth/dev", "POST", {});
    navigate("/");
  };

  return (
    <div className="login">
      <div className="card">
        <div className="brand-mark" style={{ margin: "0 auto", width: 56, height: 56, fontSize: 28, borderRadius: 17, fontFamily: "Playfair Display, serif", fontWeight: 700 }}>
          L
        </div>
        <h1>
          Life<span className="accent">Helper</span>
        </h1>
        <p className="muted" style={{ margin: "0 0 28px" }}>
          Цели, привычки, деньги — вся жизнь на одной стене.
        </p>

        {state === "magic" && (
          <div className="row" style={{ justifyContent: "center" }}>
            <span className="spinner" /> Входим…
          </div>
        )}

        {state === "idle" && (
          <>
            <button className="btn primary block" style={{ padding: "15px 20px", fontSize: 16 }} onClick={start} disabled={status?.botConfigured === false}>
              <Icon name="telegram" size={19} /> Войти через Telegram
            </button>
            {status && !status.ownerSet && status.botConfigured && (
              <p className="faint" style={{ fontSize: 13, marginTop: 14 }}>
                Первый вход сделает твой Telegram-аккаунт владельцем. Больше никто войти не сможет.
              </p>
            )}
            {status?.botConfigured === false && (
              <p className="danger" style={{ fontSize: 13.5, marginTop: 14 }}>
                Бот ещё не настроен: добавь секрет <span className="kbd">TELEGRAM_BOT_TOKEN</span> (см. README).
              </p>
            )}
          </>
        )}

        {state === "waiting" && (
          <div className="stack" style={{ gap: 14, alignItems: "center" }}>
            <div className="row">
              <span className="spinner" />
              <b>Жду подтверждения в Telegram…</b>
            </div>
            <div className="muted" style={{ fontSize: 14 }}>
              В открывшемся чате нажми <b>Start</b> — и эта страница сама пустит тебя внутрь.
            </div>
            {link && (
              <a className="btn sm" href={link} target="_blank" rel="noreferrer">
                Открыть бота ещё раз <Icon name="external" size={14} />
              </a>
            )}
          </div>
        )}

        {state === "denied" && (
          <div className="danger" style={{ fontWeight: 700 }}>
            ⛔ Этот Telegram-аккаунт не владелец.
            <div style={{ marginTop: 14 }}>
              <button className="btn sm" onClick={() => setState("idle")}>
                Попробовать другой
              </button>
            </div>
          </div>
        )}

        {status?.devLogin && state === "idle" && (
          <button className="btn ghost sm" style={{ marginTop: 18 }} onClick={dev}>
            Войти без Telegram (режим разработки)
          </button>
        )}
      </div>
    </div>
  );
}
