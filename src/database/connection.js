const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');
const logger = require('../utils/logger');

let db = null;

function getDatabase() {
  if (db) return db;

  const dbDir = path.dirname(path.resolve(config.paths.db));
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(path.resolve(config.paths.db));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeTables();
  logger.info('Database connected and initialized');
  return db;
}

function initializeTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT UNIQUE NOT NULL,
      phone TEXT,
      push_name TEXT,
      saved_name TEXT,
      telegram_topic_id INTEGER,
      telegram_chat_id TEXT,
      is_group INTEGER DEFAULT 0,
      group_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT UNIQUE NOT NULL,
      telegram_message_id INTEGER,
      telegram_chat_id TEXT,
      telegram_topic_id INTEGER,
      contact_id INTEGER,
      direction TEXT CHECK(direction IN ('incoming', 'outgoing')) NOT NULL,
      message_type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS call_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT,
      contact_id INTEGER,
      call_type TEXT CHECK(call_type IN ('voice', 'video')),
      direction TEXT CHECK(direction IN ('incoming', 'outgoing', 'missed')),
      duration INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      telegram_message_id INTEGER,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_wa_id ON contacts(wa_id);
    CREATE INDEX IF NOT EXISTS idx_message_map_wa_id ON message_map(wa_message_id);
    CREATE INDEX IF NOT EXISTS idx_message_map_tg_id ON message_map(telegram_message_id, telegram_chat_id);
    CREATE INDEX IF NOT EXISTS idx_message_map_contact ON message_map(contact_id);
    CREATE INDEX IF NOT EXISTS idx_call_records_contact ON call_records(contact_id);
  `);
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

module.exports = { getDatabase, closeDatabase };
