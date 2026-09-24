-- Стикеры, закреплённые на странице «Сегодня»
ALTER TABLE stickers ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
