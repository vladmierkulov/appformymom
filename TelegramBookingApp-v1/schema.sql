CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  chat_id TEXT,
  reminders_enabled INTEGER NOT NULL DEFAULT 1,
  reminder_template TEXT NOT NULL DEFAULT 'Здравствуйте, {name}! Напоминаем о вашей записи {date} в {time}.'
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, date, time)
);

CREATE INDEX IF NOT EXISTS bookings_owner_date ON bookings(owner_id, date);
