// Самомиграция базы: воркер сам создаёт таблицы при первом запросе.
// Поэтому для деплоя хватает `npx wrangler deploy` — отдельный шаг миграций не нужен.
// Журнал общий с `wrangler d1 migrations apply` (таблица d1_migrations), так что оба способа совместимы.
// Новая миграция: положи файл в migrations/ и добавь его в список ниже.
import init from "../../migrations/0001_init.sql";

const MIGRATIONS: [name: string, sql: string][] = [["0001_init.sql", init]];

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= migrate(db).catch((e) => {
    ready = null; // попробуем ещё раз на следующем запросе
    throw e;
  });
  return ready;
}

function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applied(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
  return new Set(results.map((r) => r.name));
}

async function migrate(db: D1Database): Promise<void> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
    )
    .run();
  let done = await applied(db);
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    try {
      // одна транзакция: либо миграция целиком, либо ничего
      await db.batch([...statements(sql).map((s) => db.prepare(s)), db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").bind(name)]);
    } catch (e) {
      // параллельный запрос мог успеть первым
      done = await applied(db);
      if (!done.has(name)) throw e;
    }
  }
}
