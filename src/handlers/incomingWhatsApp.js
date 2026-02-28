const telegramService = require('../services/telegram');
const messageMapper = require('../services/messageMapper');
const mediaHandler = require('../services/mediaHandler');
const whatsappService = require('../services/whatsapp');
const rateLimiter = require('../utils/rateLimiter');
const logger = require('../utils/logger');
const { escapeHTML } = require('../utils/sanitizer');
const { Contact } = require('../database');
const encryptionService = require('../services/encryption');

class IncomingWhatsAppHandler {
  async handleMessage(msg) {
    try {
      if (msg.isStatus) return;
      if (!rateLimiter.canProceed('wa_' + msg.from)) return;

      const contactInfo = await whatsappService.getContactInfo(msg.from);
      const contact = await messageMapper.getOrCreateContact(msg.from, contactInfo);

      // Check if contact is muted
      if (contact.is_muted) return;

      const topicId = await messageMapper.getOrCreateTopic(contact);
      if (!topicId) return;

      let replyToTgMsgId = null;
      if (msg.hasQuotedMsg) {
        try {
          const quotedMsg = await msg.getQuotedMessage();
          const mapped = messageMapper.findTelegramMessage(quotedMsg.id._serialized);
          if (mapped) replyToTgMsgId = mapped.telegram_message_id;
        } catch (e) { }
      }

      let senderPrefix = '';
      if (msg.from.includes('@g.us') && msg.author) {
        const authorInfo = await whatsappService.getContactInfo(msg.author);
        const authorContact = Contact.findByWaId(msg.author);
        const authorName = (authorContact && Contact.getDisplayName(authorContact)) || authorInfo.savedName || authorInfo.pushName || authorInfo.phone;
        senderPrefix = '<b>[' + escapeHTML(authorName) + ']</b>\n';
      }

      let sentTgMsg;
      // Get plain text content for search storage
      let plainContent = msg.body || '';

      if (msg.hasMedia) {
        sentTgMsg = await this._handleMediaMessage(msg, topicId, senderPrefix, replyToTgMsgId);
      } else {
        sentTgMsg = await this._handleTextMessage(msg, topicId, senderPrefix, replyToTgMsgId);
      }

      if (sentTgMsg) {
        // Encrypt content before storing
        const encryptedContent = plainContent ? encryptionService.encrypt(plainContent) : null;

        await messageMapper.mapMessage({
          waMessageId: msg.id._serialized,
          telegramMessageId: sentTgMsg.message_id,
          telegramChatId: sentTgMsg.chat.id.toString(),
          topicId,
          contactId: contact.id,
          direction: 'incoming',
          messageType: msg.type || 'text',
          content: encryptedContent,
        });
      }
    } catch (error) {
      logger.error('Error handling incoming WA message:', error);
    }
  }

  async _handleTextMessage(msg, topicId, senderPrefix, replyToTgMsgId) {
    let text = msg.body || '';

    if (msg.type === 'location') {
      text = '📍 <b>Location:</b>\nLat: ' + msg.location.latitude + '\nLng: ' + msg.location.longitude;
    } else if (msg.type === 'vcard' || msg.type === 'multi_vcard') {
      text = '📇 <b>Contact Card</b>\n<code>' + escapeHTML(msg.body || 'Contact shared') + '</code>';
    } else {
      text = text ? escapeHTML(text) : '<i>[' + (msg.type || 'unknown') + ' message]</i>';
    }

    const fullText = '📩 ' + senderPrefix + text;
    const chatId = telegramService.forumGroupId || telegramService.adminChatId;
    const options = { message_thread_id: topicId, parse_mode: 'HTML' };
    if (replyToTgMsgId) options.reply_to_message_id = replyToTgMsgId;

    return telegramService.getBot().sendMessage(chatId, fullText, options);
  }

  async _handleMediaMessage(msg, topicId, senderPrefix, replyToTgMsgId) {
    try {
      const media = await msg.downloadMedia();
      if (!media) {
        return this._handleTextMessage({ ...msg, body: '[Media download failed]', type: 'text' }, topicId, senderPrefix, replyToTgMsgId);
      }

      const savedMedia = await mediaHandler.saveMedia(media, msg.id._serialized, 'incoming');
      if (!savedMedia) {
        return this._handleTextMessage({ ...msg, body: '[Media too large or save failed]', type: 'text' }, topicId, senderPrefix, replyToTgMsgId);
      }

      const mediaType = mediaHandler.getMediaType(media.mimetype);
      const caption = msg.body
        ? '📩 ' + senderPrefix + escapeHTML(msg.body)
        : '📩 ' + senderPrefix + '<i>[' + mediaType + ']</i>';

      let filePath = savedMedia.filePath;
      if (mediaType === 'sticker' && media.mimetype === 'image/webp') {
        try { filePath = await mediaHandler.convertStickerToPng(filePath); } catch (e) { }
      }

      return telegramService.sendMediaToTopic(topicId, mediaType, filePath, caption, replyToTgMsgId);
    } catch (error) {
      logger.error('Error handling media message:', error);
      return this._handleTextMessage({ ...msg, body: '[Error processing media]', type: 'text' }, topicId, senderPrefix, replyToTgMsgId);
    }
  }
}

module.exports = new IncomingWhatsAppHandler();
