const { getDatabase } = require('../connection');

class MessageMap {
  static create({ waMessageId, telegramMessageId, telegramChatId, telegramTopicId, contactId, direction, messageType = 'text', content = null }) {
    const db = getDatabase();
    try {
      db.prepare(`
        INSERT INTO message_map (wa_message_id, telegram_message_id, telegram_chat_id, telegram_topic_id, contact_id, direction, message_type, content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(waMessageId, telegramMessageId, telegramChatId, telegramTopicId, contactId, direction, messageType, content);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        db.prepare(`
          UPDATE message_map SET telegram_message_id = ?, telegram_chat_id = ?, telegram_topic_id = ?, content = COALESCE(?, content)
          WHERE wa_message_id = ?
        `).run(telegramMessageId, telegramChatId, telegramTopicId, content, waMessageId);
      } else {
        throw err;
      }
    }
  }

  static findByWaMessageId(waMessageId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM message_map WHERE wa_message_id = ?').get(waMessageId);
  }

  static findByTelegramMessageId(telegramMessageId, telegramChatId) {
    const db = getDatabase();
    return db.prepare(
      'SELECT * FROM message_map WHERE telegram_message_id = ? AND telegram_chat_id = ?'
    ).get(telegramMessageId, telegramChatId);
  }

  static findByContact(contactId, limit = 50) {
    const db = getDatabase();
    return db.prepare(
      'SELECT * FROM message_map WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(contactId, limit);
  }

  /**
   * Search messages by content. Returns matching messages with contact info.
   */
  static searchContent(query, limit = 30) {
    const db = getDatabase();
    const q = '%' + query + '%';
    return db.prepare(`
      SELECT mm.*, c.push_name, c.saved_name, c.phone, c.alias
      FROM message_map mm
      LEFT JOIN contacts c ON mm.contact_id = c.id
      WHERE mm.content LIKE ?
      ORDER BY mm.created_at DESC LIMIT ?
    `).all(q, limit);
  }

  /**
   * Get message count for metrics.
   */
  static getCount(direction = null) {
    const db = getDatabase();
    if (direction) {
      return db.prepare('SELECT COUNT(*) as count FROM message_map WHERE direction = ?').get(direction).count;
    }
    return db.prepare('SELECT COUNT(*) as count FROM message_map').get().count;
  }
}

module.exports = MessageMap;
