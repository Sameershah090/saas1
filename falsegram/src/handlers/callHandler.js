const telegramService = require('../services/telegram');
const whatsappService = require('../services/whatsapp');
const { CallRecord } = require('../database');
const { getDatabase } = require('../database/connection');
const logger = require('../utils/logger');
const { escapeHTML } = require('../utils/sanitizer');

class CallHandler {
  constructor() {
    this.callLogTopicId = null;
  }

  /**
   * Gets or creates a single unified "📞 Call Logs" topic for all calls.
   */
  async _getOrCreateCallLogTopic() {
    // Return cached value
    if (this.callLogTopicId) return this.callLogTopicId;

    // Check database for saved topic ID
    const db = getDatabase();
    const state = db.prepare("SELECT value FROM app_state WHERE key = 'call_log_topic_id'").get();
    if (state) {
      this.callLogTopicId = parseInt(state.value, 10);
      return this.callLogTopicId;
    }

    // Create a new topic
    if (!telegramService.forumGroupId) {
      logger.warn('Forum group not configured. Call logs sent to admin chat.');
      return null;
    }

    try {
      const topicId = await telegramService.createForumTopic('📞 Call Logs');
      this.callLogTopicId = topicId;

      // Save to database
      db.prepare(
        "INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES ('call_log_topic_id', ?, CURRENT_TIMESTAMP)"
      ).run(topicId.toString());

      // Send intro message
      await telegramService.sendMessageToTopic(topicId,
        '📞 <b>Call Logs</b>\n\nAll incoming and outgoing call notifications will appear here.'
      );

      logger.info('Created unified Call Logs topic: ' + topicId);
      return topicId;
    } catch (error) {
      logger.error('Failed to create Call Logs topic:', error);
      return null;
    }
  }

  async handleCall(call) {
    try {
      const contactInfo = await whatsappService.getContactInfo(call.from);

      // Build contact name without creating a per-contact topic
      const displayName = contactInfo.savedName || contactInfo.pushName || contactInfo.phone || 'Unknown';
      const phone = contactInfo.phone || call.from.replace(/@[cg]\.us$/, '');
      const callType = call.isVideo ? 'video' : 'voice';
      const callIcon = call.isVideo ? '📹' : '📞';
      const direction = call.fromMe ? 'outgoing' : 'incoming';

      // Store in database
      const { Contact: ContactModel } = require('../database');
      const contact = ContactModel.upsert({
        waId: call.from,
        phone: contactInfo.phone || call.from.replace(/@[cg]\.us$/, ''),
        pushName: contactInfo.pushName || null,
        savedName: contactInfo.savedName || null,
        isGroup: false,
      });

      const recordId = CallRecord.create({
        waId: call.id,
        contactId: contact.id,
        callType,
        direction,
        duration: 0,
      });

      const directionText = direction === 'incoming' ? '⬇️ Incoming' : '⬆️ Outgoing';
      const text =
        callIcon + ' <b>' + directionText + ' ' + callType + ' call</b>\n' +
        '👤 <b>Contact:</b> ' + escapeHTML(displayName) + '\n' +
        '📱 <b>Phone:</b> +' + escapeHTML(phone) + '\n' +
        '⏰ <b>Time:</b> ' + new Date().toLocaleString();

      // Send to unified Call Logs topic
      const topicId = await this._getOrCreateCallLogTopic();
      let sentMsg;
      if (topicId) {
        sentMsg = await telegramService.sendMessageToTopic(topicId, text);
      } else {
        // Fallback: send to admin DM
        sentMsg = await telegramService.sendToAdmin(text);
      }

      if (sentMsg) CallRecord.setTelegramMessageId(recordId, sentMsg.message_id);
      logger.info('Call record: ' + direction + ' ' + callType + ' from ' + displayName);
    } catch (error) {
      logger.error('Error handling call:', error);
    }
  }
}

module.exports = new CallHandler();
