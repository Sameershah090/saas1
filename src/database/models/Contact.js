const { getDatabase } = require('../connection');

class Contact {
  static findByWaId(waId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
  }

  static findById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  }

  static findByTopicId(topicId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM contacts WHERE telegram_topic_id = ?').get(topicId);
  }

  static upsert({ waId, phone, pushName, savedName, isGroup = false, groupName = null }) {
    const db = getDatabase();
    const existing = this.findByWaId(waId);

    if (existing) {
      db.prepare(`
        UPDATE contacts
        SET phone = COALESCE(?, phone),
            push_name = COALESCE(?, push_name),
            saved_name = COALESCE(?, saved_name),
            is_group = ?,
            group_name = COALESCE(?, group_name),
            last_active_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE wa_id = ?
      `).run(phone, pushName, savedName, isGroup ? 1 : 0, groupName, waId);
      return this.findByWaId(waId);
    }

    const result = db.prepare(`
      INSERT INTO contacts (wa_id, phone, push_name, saved_name, is_group, group_name, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(waId, phone, pushName, savedName, isGroup ? 1 : 0, groupName);
    return this.findById(result.lastInsertRowid);
  }

  static setTopicId(waId, topicId) {
    const db = getDatabase();
    db.prepare('UPDATE contacts SET telegram_topic_id = ?, updated_at = CURRENT_TIMESTAMP WHERE wa_id = ?')
      .run(topicId, waId);
  }

  static setAlias(waId, alias) {
    const db = getDatabase();
    db.prepare('UPDATE contacts SET alias = ?, updated_at = CURRENT_TIMESTAMP WHERE wa_id = ?')
      .run(alias, waId);
  }

  static setMuted(waId, muted) {
    const db = getDatabase();
    db.prepare('UPDATE contacts SET is_muted = ?, updated_at = CURRENT_TIMESTAMP WHERE wa_id = ?')
      .run(muted ? 1 : 0, waId);
  }

  static setArchived(waId, archived) {
    const db = getDatabase();
    db.prepare('UPDATE contacts SET is_archived = ?, updated_at = CURRENT_TIMESTAMP WHERE wa_id = ?')
      .run(archived ? 1 : 0, waId);
  }

  static getAll() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM contacts WHERE is_archived = 0 ORDER BY updated_at DESC').all();
  }

  static getAllIncludingArchived() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM contacts ORDER BY updated_at DESC').all();
  }

  static getArchived() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM contacts WHERE is_archived = 1 ORDER BY updated_at DESC').all();
  }

  static getMuted() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM contacts WHERE is_muted = 1 ORDER BY updated_at DESC').all();
  }

  static getInactiveSince(daysSinceActive) {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM contacts
      WHERE is_archived = 0
        AND (last_active_at IS NULL OR last_active_at < datetime('now', '-' || ? || ' days'))
      ORDER BY last_active_at ASC
    `).all(daysSinceActive);
  }

  static search(query) {
    const db = getDatabase();
    const q = '%' + query + '%';
    return db.prepare(`
      SELECT * FROM contacts
      WHERE (push_name LIKE ? OR saved_name LIKE ? OR phone LIKE ? OR wa_id LIKE ? OR alias LIKE ?)
        AND is_archived = 0
      ORDER BY updated_at DESC
    `).all(q, q, q, q, q);
  }

  static getDisplayName(contact) {
    return contact.alias || contact.saved_name || contact.push_name || contact.phone || contact.wa_id || 'Unknown';
  }
}

module.exports = Contact;
