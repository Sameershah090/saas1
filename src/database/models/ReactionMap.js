const { getDatabase } = require('../connection');

class ReactionMap {
    static create({ waMessageId, telegramMessageId, telegramChatId, emoji, senderWaId }) {
        const db = getDatabase();
        const result = db.prepare(`
      INSERT INTO reaction_map (wa_message_id, telegram_message_id, telegram_chat_id, emoji, sender_wa_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(waMessageId, telegramMessageId, telegramChatId, emoji, senderWaId);
        return result.lastInsertRowid;
    }

    static findByWaMessageId(waMessageId) {
        const db = getDatabase();
        return db.prepare('SELECT * FROM reaction_map WHERE wa_message_id = ?').all(waMessageId);
    }

    static deleteByWaMessageId(waMessageId, senderWaId) {
        const db = getDatabase();
        db.prepare('DELETE FROM reaction_map WHERE wa_message_id = ? AND sender_wa_id = ?').run(waMessageId, senderWaId);
    }
}

module.exports = ReactionMap;
