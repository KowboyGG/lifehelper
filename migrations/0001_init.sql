-- LifeHelper: начальная схема

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Сессии сайта и токены расширения (храним только sha256 токена)
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL DEFAULT 'web',      -- web | ext
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at   INTEGER                            -- NULL = бессрочно
);

-- Одноразовые коды входа через Telegram
CREATE TABLE login_codes (
  code       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'web',
  status     TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | used
  token      TEXT,
  created_at INTEGER NOT NULL
);

-- Глобальные цели
CREATE TABLE goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  emoji         TEXT,
  color         TEXT,
  why           TEXT,                              -- «зачем мне это» — показывается при попытке пропуска
  start_date    TEXT NOT NULL,
  deadline      TEXT,
  target_value  REAL,                              -- для числовых целей (12 книг, 50 000 ₴)
  current_value REAL NOT NULL DEFAULT 0,
  unit          TEXT,
  status        TEXT NOT NULL DEFAULT 'active',    -- active | done | archived
  done_at       INTEGER,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- Ежедневные привычки/задачи (то, что отмечается каждый день)
CREATE TABLE habits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id        INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  emoji          TEXT,
  type           TEXT NOT NULL DEFAULT 'check',    -- check | minutes
  target_minutes INTEGER,
  days           TEXT NOT NULL DEFAULT '1111111',  -- Пн..Вс
  start_url      TEXT,                             -- куда ведёт кнопка «Начать» в расширении
  focus_sites    TEXT NOT NULL DEFAULT '[]',       -- JSON: домены, где засчитывается время
  blocking       INTEGER NOT NULL DEFAULT 1,       -- блокировать отвлекающие сайты, пока не сделано
  start_date     TEXT NOT NULL,
  archived_at    TEXT,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE habit_logs (
  habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  minutes    REAL NOT NULL DEFAULT 0,
  source     TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (habit_id, date)
);
CREATE INDEX idx_habit_logs_date ON habit_logs(date);

-- День: пропуск, настроение, дневник, служебные флаги бота
CREATE TABLE days (
  date              TEXT PRIMARY KEY,
  pass_used         INTEGER NOT NULL DEFAULT 0,
  pass_reason       TEXT,
  mood              INTEGER,
  note              TEXT,
  skip_requested_at INTEGER,
  checkin_msg_id    INTEGER,
  morning_sent      INTEGER NOT NULL DEFAULT 0,
  reminder_sent     INTEGER NOT NULL DEFAULT 0,
  evening_sent      INTEGER NOT NULL DEFAULT 0,
  weekly_sent       INTEGER NOT NULL DEFAULT 0
);

-- Разовые задачи
CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  goal_id    INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  date       TEXT,                                 -- NULL = «Входящие»
  time       TEXT,
  done_at    INTEGER,
  priority   INTEGER NOT NULL DEFAULT 0,
  source     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_date ON tasks(date);

-- Фокус-сессии из расширения / таймера на сайте
CREATE TABLE focus_sessions (
  id         TEXT PRIMARY KEY,
  habit_id   INTEGER REFERENCES habits(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seconds    INTEGER NOT NULL DEFAULT 0,
  clicks     INTEGER NOT NULL DEFAULT 0,
  keys       INTEGER NOT NULL DEFAULT 0,
  scrolls    INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'ext'
);
CREATE INDEX idx_focus_date ON focus_sessions(date);

-- Время на сайтах (из расширения)
CREATE TABLE site_time (
  date    TEXT NOT NULL,
  domain  TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, domain)
);

-- Деньги
CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  emoji      TEXT,
  currency   TEXT NOT NULL DEFAULT 'UAH',
  balance    REAL NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount     REAL NOT NULL,                        -- < 0 расход, > 0 доход
  category   TEXT,
  note       TEXT,
  date       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tx_date ON transactions(date);

-- Вишлист
CREATE TABLE wishes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  emoji      TEXT,
  price      REAL,
  currency   TEXT NOT NULL DEFAULT 'UAH',
  url        TEXT,
  note       TEXT,
  priority   INTEGER NOT NULL DEFAULT 1,           -- 0 низкий, 1 средний, 2 высокий
  status     TEXT NOT NULL DEFAULT 'want',         -- want | bought | dropped
  bought_at  INTEGER,
  created_at INTEGER NOT NULL
);

-- Стена стикеров
CREATE TABLE stickers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'note',         -- note | goal | wish | countdown | money | streak
  ref_id     INTEGER,
  text       TEXT,
  date       TEXT,
  color      TEXT NOT NULL DEFAULT 'yellow',
  x          REAL NOT NULL DEFAULT 40,
  y          REAL NOT NULL DEFAULT 40,
  rot        REAL NOT NULL DEFAULT 0,
  z          INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
