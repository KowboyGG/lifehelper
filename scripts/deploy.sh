#!/usr/bin/env bash
# Деплой на Cloudflare (запускается из GitHub Actions, можно и руками).
# Нужны переменные: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; опционально TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID.
set -euo pipefail

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "::error::Добавь секреты CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID в Settings → Secrets → Actions (см. README)"
  exit 1
fi

# 1. База D1: находим или создаём, подставляем id в wrangler.jsonc
find_db() {
  npx wrangler d1 list --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const d = JSON.parse(s).find((x) => x.name === "lifehelper"); process.stdout.write(d ? d.uuid || d.database_id || d.id || "" : ""); } catch {}
    });'
}
DB_ID="$(find_db)"
if [ -z "$DB_ID" ]; then
  echo "→ Создаю базу D1 lifehelper"
  npx wrangler d1 create lifehelper
  DB_ID="$(find_db)"
fi
[ -n "$DB_ID" ] || { echo "::error::Не удалось получить id базы D1"; exit 1; }
sed -i.bak "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$DB_ID\"/" wrangler.jsonc && rm -f wrangler.jsonc.bak
echo "→ База: $DB_ID"

# 2. Миграции
npx wrangler d1 migrations apply lifehelper --remote

# 3. Деплой воркера + сайта
npx wrangler deploy | tee /tmp/deploy.log
URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' /tmp/deploy.log | head -1 || true)"

# 4. Секреты
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then printf '%s' "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN; fi
if [ -n "${OWNER_TELEGRAM_ID:-}" ]; then printf '%s' "$OWNER_TELEGRAM_ID" | npx wrangler secret put OWNER_TELEGRAM_ID; fi

# 5. Вебхук бота (сайт и сам это сделает при первом входе — здесь для надёжности)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "$URL" ]; then
  SECRET="$(printf '%s' "lifehelper-webhook:$TELEGRAM_BOT_TOKEN" | sha256sum | cut -c1-48)"
  curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
    -d "url=$URL/tg/webhook" -d "secret_token=$SECRET" -d 'allowed_updates=["message","callback_query"]' >/dev/null \
    && echo "→ Вебхук бота: $URL/tg/webhook"
fi

echo ""
echo "✅ Готово: ${URL:-см. лог выше}"
