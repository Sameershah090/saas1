const { getDatabase } = require('../connection');

class CallRecord {
  static create({ waId, contactId, callType, direction, duration = 0 }) {
    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO call_records (wa_id, contact_id, call_type, direction, duration)
      VALUES (?, ?, ?, ?, ?)
    `).run(waId, contactId, callType, direction, duration);
    return result.lastInsertRowid;
  }

  static setTelegramMessageId(id, telegramMessageId) {
    const db = getDatabase();
    db.prepare('UPDATE call_records SET telegram_message_id = ? WHERE id = ?')
      .run(telegramMessageId, id);
  }

  static getRecent(limit = 50) {
    const db = getDatabase();
    return db.prepare(`
      SELECT cr.*, c.push_name, c.saved_name, c.phone
      FROM call_records cr
      LEFT JOIN contacts c ON cr.contact_id = c.id
      ORDER BY cr.timestamp DESC LIMIT ?
    `).all(limit);
  }
}

module.exports = CallRecord;
