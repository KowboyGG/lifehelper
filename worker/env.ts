export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Токен бота от @BotFather */
  TELEGRAM_BOT_TOKEN?: string;
  /** Твой Telegram ID. Если не задан — владельцем станет первый, кто войдёт через бота */
  OWNER_TELEGRAM_ID?: string;
  /** Публичный адрес сайта (иначе берётся из запросов) */
  PUBLIC_URL?: string;
  /** Для тестов: подмена https://api.telegram.org */
  TELEGRAM_API?: string;
  /** Только для локальной разработки: вход без Telegram */
  DEV_LOGIN?: string;
}

export type AppEnv = { Bindings: Env; Variables: { sessionId: number } };
