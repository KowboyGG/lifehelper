-- Личные пропуски привычки на месяц и паузы (нет абонемента, отпуск, болезнь)
ALTER TABLE habits ADD COLUMN skips_per_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE habits ADD COLUMN pauses TEXT NOT NULL DEFAULT '[]';
ALTER TABLE habit_logs ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
