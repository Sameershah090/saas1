const { getDatabase } = require('./connection');
const logger = require('../utils/logger');

/**
 * Database migration system. Each migration has a version number, name, and up() function.
 * Migrations are run in order and tracked in the `migrations` table.
 */

const migrations = [
    {
        version: 1,
        name: 'add_contact_alias_and_muted',
        up(db) {
            try { db.exec('ALTER TABLE contacts ADD COLUMN alias TEXT'); } catch (e) { }
            try { db.exec('ALTER TABLE contacts ADD COLUMN is_muted INTEGER DEFAULT 0'); } catch (e) { }
        },
    },
    {
        version: 2,
        name: 'add_message_content_for_search',
        up(db) {
            try { db.exec('ALTER TABLE message_map ADD COLUMN content TEXT'); } catch (e) { }
            try { db.exec('ALTER TABLE message_map ADD COLUMN content_encrypted INTEGER DEFAULT 0'); } catch (e) { }
        },
    },
    {
        version: 3,
        name: 'create_scheduled_messages_table',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          target_wa_id TEXT NOT NULL,
          target_phone TEXT,
          message TEXT NOT NULL,
          scheduled_at DATETIME NOT NULL,
          sent_at DATETIME,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'cancelled')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_messages(status, scheduled_at);
      `);
        },
    },
    {
        version: 4,
        name: 'create_reaction_map_table',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS reaction_map (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wa_message_id TEXT NOT NULL,
          telegram_message_id INTEGER,
          telegram_chat_id TEXT,
          emoji TEXT,
          sender_wa_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_reaction_wa ON reaction_map(wa_message_id);
      `);
        },
    },
    {
        version: 5,
        name: 'add_metrics_table',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          metric_name TEXT NOT NULL,
          metric_value REAL DEFAULT 0,
          recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name, recorded_at);
      `);
        },
    },
    {
        version: 6,
        name: 'add_contact_last_active_and_archived',
        up(db) {
            try { db.exec('ALTER TABLE contacts ADD COLUMN last_active_at DATETIME'); } catch (e) { }
            try { db.exec('ALTER TABLE contacts ADD COLUMN is_archived INTEGER DEFAULT 0'); } catch (e) { }
        },
    },
];

function ensureMigrationsTable(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getAppliedVersions(db) {
    const rows = db.prepare('SELECT version FROM migrations ORDER BY version').all();
    return new Set(rows.map((r) => r.version));
}

function runMigrations() {
    const db = getDatabase();
    ensureMigrationsTable(db);

    const applied = getAppliedVersions(db);
    let ranCount = 0;

    for (const migration of migrations) {
        if (applied.has(migration.version)) continue;

        try {
            const runInTransaction = db.transaction(() => {
                migration.up(db);
                db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
            });
            runInTransaction();
            ranCount++;
            logger.info('Migration applied: v' + migration.version + ' — ' + migration.name);
        } catch (error) {
            logger.error('Migration v' + migration.version + ' failed:', error);
            throw error;
        }
    }

    if (ranCount > 0) {
        logger.info('Applied ' + ranCount + ' migration(s)');
    } else {
        logger.info('Database schema is up to date');
    }
}

module.exports = { runMigrations, migrations };
