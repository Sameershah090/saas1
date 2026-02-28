const { Contact, MessageMap } = require('../database');
const telegramService = require('./telegram');
const logger = require('../utils/logger');
const { sanitizeContactName, escapeHTML } = require('../utils/sanitizer');

class MessageMapper {
  constructor() {
    this.topicCreationLocks = new Map();
  }

  async getOrCreateContact(waId, contactInfo = {}) {
    const isGroup = waId.includes('@g.us');
    const contact = Contact.upsert({
      waId,
      phone: contactInfo.phone || waId.replace(/@[cg]\.us$/, ''),
      pushName: contactInfo.pushName || null,
      savedName: contactInfo.savedName || null,
      isGroup,
      groupName: contactInfo.groupName || null,
    });
    return contact;
  }

  async getOrCreateTopic(contact) {
    if (contact.telegram_topic_id) return contact.telegram_topic_id;

    const lockKey = contact.wa_id;
    if (this.topicCreationLocks.has(lockKey)) {
      await this.topicCreationLocks.get(lockKey);
      const refreshed = Contact.findByWaId(contact.wa_id);
      return refreshed?.telegram_topic_id;
    }

    const promise = this._createTopicForContact(contact);
    this.topicCreationLocks.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      this.topicCreationLocks.delete(lockKey);
    }
  }

  async _createTopicForContact(contact) {
    const displayName = this._getDisplayName(contact);
    const phone = contact.phone || 'Unknown';
    const topicName = contact.is_group
      ? '👥 ' + displayName
      : displayName + ' (' + phone + ')';

    try {
      const topicId = await telegramService.createForumTopic(topicName);
      Contact.setTopicId(contact.wa_id, topicId);

      const introText = contact.is_group
        ? '👥 <b>Group:</b> ' + escapeHTML(displayName)
        : '👤 <b>Contact:</b> ' + escapeHTML(displayName) + '\n📱 <b>Phone:</b> +' + escapeHTML(phone) +
        (contact.saved_name ? '\n📒 <b>Saved:</b> ' + escapeHTML(contact.saved_name) : '') +
        (contact.push_name ? '\n🏷 <b>Push Name:</b> ' + escapeHTML(contact.push_name) : '');

      await telegramService.sendMessageToTopic(topicId, introText);
      return topicId;
    } catch (error) {
      logger.error('Failed to create topic for ' + contact.wa_id + ':', error);
      return null;
    }
  }

  _getDisplayName(contact) {
    return sanitizeContactName(contact.alias || contact.saved_name || contact.push_name || contact.phone || contact.wa_id);
  }

  async mapMessage({ waMessageId, telegramMessageId, telegramChatId, topicId, contactId, direction, messageType, content }) {
    return MessageMap.create({
      waMessageId,
      telegramMessageId,
      telegramChatId,
      telegramTopicId: topicId,
      contactId,
      direction,
      messageType,
      content: content || null,
    });
  }

  findTelegramMessage(waMessageId) { return MessageMap.findByWaMessageId(waMessageId); }
  findWhatsAppMessage(telegramMessageId, telegramChatId) { return MessageMap.findByTelegramMessageId(telegramMessageId, telegramChatId); }
}

module.exports = new MessageMapper();
