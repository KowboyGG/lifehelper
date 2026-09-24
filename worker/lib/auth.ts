import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../env";

export const COOKIE = "lh_session";
const WEB_SESSION_DAYS = 180;
export const LOGIN_CODE_TTL = 10 * 60 * 1000;

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(db: D1Database, kind: "web" | "ext", label: string | null): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  const expires = kind === "web" ? now + WEB_SESSION_DAYS * 86400000 : null;
  await db
    .prepare("INSERT INTO sessions(token_hash, kind, label, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), kind, label, now, now, expires)
    .run();
  return token;
}

export function sessionCookie(token: string, secure: boolean): string {
  const maxAge = WEB_SESSION_DAYS * 86400;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function bearer(c: Context): string | null {
  const h = c.req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** Проверяет cookie сайта или Bearer-токен расширения */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const fromBearer = bearer(c);
  const token = fromBearer ?? getCookie(c, COOKIE);
  if (!token) return c.json({ error: "unauthorized" }, 401);

  // CSRF: изменяющие запросы по cookie должны прийти с нашим заголовком
  if (!fromBearer && c.req.method !== "GET" && c.req.header("x-lh") !== "1") {
    return c.json({ error: "csrf" }, 403);
  }

  const row = await c.env.DB.prepare("SELECT id, expires_at, last_used_at FROM sessions WHERE token_hash = ?")
    .bind(await sha256(token))
    .first<{ id: number; expires_at: number | null; last_used_at: number | null }>();
  const now = Date.now();
  if (!row || (row.expires_at && row.expires_at < now)) return c.json({ error: "unauthorized" }, 401);

  if (!row.last_used_at || now - row.last_used_at > 3600000) {
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").bind(now, row.id).run());
  }
  c.set("sessionId", row.id);
  await next();
};
