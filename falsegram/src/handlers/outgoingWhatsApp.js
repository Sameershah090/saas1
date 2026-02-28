const telegramService = require('../services/telegram');
const messageMapper = require('../services/messageMapper');
const mediaHandler = require('../services/mediaHandler');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');
const { escapeHTML } = require('../utils/sanitizer');
const encryptionService = require('../services/encryption');

class OutgoingWhatsAppHandler {
  async handleMessage(msg) {
    try {
      if (!msg.fromMe) return;
      if (msg.isStatus) return;

      const chatId = msg.to;
      const contactInfo = await whatsappService.getContactInfo(chatId);
      const contact = await messageMapper.getOrCreateContact(chatId, contactInfo);
      const topicId = await messageMapper.getOrCreateTopic(contact);
      if (!topicId) return;

      // Avoid echo for messages sent from Telegram
      const existingMap = messageMapper.findTelegramMessage(msg.id._serialized);
      if (existingMap) return;

      let replyToTgMsgId = null;
      if (msg.hasQuotedMsg) {
        try {
          const quotedMsg = await msg.getQuotedMessage();
          const mapped = messageMapper.findTelegramMessage(quotedMsg.id._serialized);
          if (mapped) replyToTgMsgId = mapped.telegram_message_id;
        } catch (e) { }
      }

      let sentTgMsg;
      let plainContent = msg.body || '';

      if (msg.hasMedia) {
        sentTgMsg = await this._handleOutgoingMedia(msg, topicId, replyToTgMsgId);
      } else {
        const text = '📤 <b>You:</b> ' + escapeHTML(msg.body || '');
        const tgChatId = telegramService.forumGroupId || telegramService.adminChatId;
        const options = { message_thread_id: topicId, parse_mode: 'HTML' };
        if (replyToTgMsgId) options.reply_to_message_id = replyToTgMsgId;
        sentTgMsg = await telegramService.getBot().sendMessage(tgChatId, text, options);
      }

      if (sentTgMsg) {
        const encryptedContent = plainContent ? encryptionService.encrypt(plainContent) : null;

        await messageMapper.mapMessage({
          waMessageId: msg.id._serialized,
          telegramMessageId: sentTgMsg.message_id,
          telegramChatId: sentTgMsg.chat.id.toString(),
          topicId,
          contactId: contact.id,
          direction: 'outgoing',
          messageType: msg.type || 'text',
          content: encryptedContent,
        });
      }
    } catch (error) {
      logger.error('Error handling outgoing WA message:', error);
    }
  }

  async _handleOutgoingMedia(msg, topicId, replyToTgMsgId) {
    try {
      const media = await msg.downloadMedia();
      if (!media) return null;

      const savedMedia = await mediaHandler.saveMedia(media, msg.id._serialized, 'outgoing');
      if (!savedMedia) return null;

      const mediaType = mediaHandler.getMediaType(media.mimetype);
      const caption = msg.body
        ? '📤 <b>You:</b> ' + escapeHTML(msg.body)
        : '📤 <b>You:</b> <i>[' + mediaType + ']</i>';

      let filePath = savedMedia.filePath;
      if (mediaType === 'sticker' && media.mimetype === 'image/webp') {
        try { filePath = await mediaHandler.convertStickerToPng(filePath); } catch (e) { }
      }

      return telegramService.sendMediaToTopic(topicId, mediaType, filePath, caption, replyToTgMsgId);
    } catch (error) {
      logger.error('Error handling outgoing media:', error);
      return null;
    }
  }
}

module.exports = new OutgoingWhatsAppHandler();
