const { getDatabase } = require('../connection');

class ScheduledMessage {
    static create({ targetWaId, targetPhone, message, scheduledAt }) {
        const db = getDatabase();
        const result = db.prepare(`
      INSERT INTO scheduled_messages (target_wa_id, target_phone, message, scheduled_at)
      VALUES (?, ?, ?, ?)
    `).run(targetWaId, targetPhone, message, scheduledAt);
        return result.lastInsertRowid;
    }

    static getPending() {
        const db = getDatabase();
        return db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE status = 'pending' AND scheduled_at <= datetime('now')
      ORDER BY scheduled_at ASC
    `).all();
    }

    static getAll(limit = 20) {
        const db = getDatabase();
        return db.prepare(`
      SELECT * FROM scheduled_messages
      ORDER BY scheduled_at DESC LIMIT ?
    `).all(limit);
    }

    static getUpcoming() {
        const db = getDatabase();
        return db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE status = 'pending' AND scheduled_at > datetime('now')
      ORDER BY scheduled_at ASC
    `).all();
    }

    static markSent(id) {
        const db = getDatabase();
        db.prepare("UPDATE scheduled_messages SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(id);
    }

    static markFailed(id) {
        const db = getDatabase();
        db.prepare("UPDATE scheduled_messages SET status = 'failed' WHERE id = ?").run(id);
    }

    static cancel(id) {
        const db = getDatabase();
        const result = db.prepare("UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id);
        return result.changes > 0;
    }

    static delete(id) {
        const db = getDatabase();
        db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
    }
}

module.exports = ScheduledMessage;
