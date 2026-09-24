#!/usr/bin/env bash
# Деплой на Cloudflare (запускается из GitHub Actions, можно и руками).
# Нужны переменные: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; опционально TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID.
set -euo pipefail

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "::error::Добавь секреты CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID в Settings → Secrets → Actions (см. README)"
  exit 1
fi

# База D1 создаётся сама при первом `wrangler deploy`, таблицы — сам воркер при первом запросе.

# 1. Деплой воркера + сайта
npx wrangler deploy | tee /tmp/deploy.log
URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' /tmp/deploy.log | head -1 || true)"

# 2. Секреты
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then printf '%s' "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN; fi
if [ -n "${OWNER_TELEGRAM_ID:-}" ]; then printf '%s' "$OWNER_TELEGRAM_ID" | npx wrangler secret put OWNER_TELEGRAM_ID; fi

# 3. Вебхук бота (сайт и сам это сделает при первом входе — здесь для надёжности)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "$URL" ]; then
  SECRET="$(printf '%s' "lifehelper-webhook:$TELEGRAM_BOT_TOKEN" | sha256sum | cut -c1-48)"
  curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
    -d "url=$URL/tg/webhook" -d "secret_token=$SECRET" -d 'allowed_updates=["message","callback_query"]' >/dev/null \
    && echo "→ Вебхук бота: $URL/tg/webhook"
fi

echo ""
echo "✅ Готово: ${URL:-см. лог выше}"
