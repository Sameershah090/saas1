const whatsappService = require('../services/whatsapp');
const telegramService = require('../services/telegram');
const messageMapper = require('../services/messageMapper');
const mediaHandler = require('../services/mediaHandler');
const { Contact, MessageMap } = require('../database');
const { MessageMedia } = require('whatsapp-web.js');
const logger = require('../utils/logger');
const rateLimiter = require('../utils/rateLimiter');
const path = require('path');
const { config } = require('../config');

class TelegramReplyHandler {
  async handleReply(msg) {
    try {
      if (msg.from.id.toString() !== config.telegram.adminChatId) return;

      if (!whatsappService.isReady) {
        await telegramService.getBot().sendMessage(msg.chat.id, '⚠️ WhatsApp is not connected.', {
          reply_to_message_id: msg.message_id,
        });
        return;
      }

      if (!rateLimiter.canProceed('tg_reply')) return;

      let targetWaId = null;
      let quotedWaMessageId = null;

      // Find contact by topic
      if (msg.message_thread_id) {
        const contact = Contact.findByTopicId(msg.message_thread_id);
        if (contact) targetWaId = contact.wa_id;
      }

      // Find quoted WA message
      if (msg.reply_to_message) {
        const mapped = MessageMap.findByTelegramMessageId(
          msg.reply_to_message.message_id,
          msg.chat.id.toString()
        );
        if (mapped) {
          quotedWaMessageId = mapped.wa_message_id;
          if (!targetWaId) {
            const contact = Contact.findById(mapped.contact_id);
            if (contact) targetWaId = contact.wa_id;
          }
        }
      }

      if (!targetWaId) {
        await telegramService.getBot().sendMessage(msg.chat.id,
          '❌ Cannot determine WhatsApp recipient. Reply in a contact topic.',
          { message_thread_id: msg.message_thread_id, reply_to_message_id: msg.message_id }
        );
        return;
      }

      let sentWaMsg;

      if (msg.photo || msg.video || msg.audio || msg.voice || msg.document || msg.sticker || msg.animation) {
        sentWaMsg = await this._sendMediaToWhatsApp(msg, targetWaId, quotedWaMessageId);
      } else if (msg.text) {
        const options = {};
        if (quotedWaMessageId) options.quotedMessageId = quotedWaMessageId;
        sentWaMsg = await whatsappService.sendMessage(targetWaId, msg.text, options);
      }

      if (sentWaMsg) {
        const contact = Contact.findByWaId(targetWaId);
        await messageMapper.mapMessage({
          waMessageId: sentWaMsg.id._serialized,
          telegramMessageId: msg.message_id,
          telegramChatId: msg.chat.id.toString(),
          topicId: msg.message_thread_id,
          contactId: contact?.id,
          direction: 'outgoing',
          messageType: this._getTelegramMediaType(msg),
        });

        try {
          await telegramService.getBot().setMessageReaction(msg.chat.id, msg.message_id, {
            reaction: [{ type: 'emoji', emoji: '✅' }],
          });
        } catch (e) {}

        logger.info('Message sent from Telegram to WhatsApp: ' + targetWaId);
      }
    } catch (error) {
      logger.error('Error handling Telegram reply:', error);
      try {
        await telegramService.getBot().sendMessage(msg.chat.id,
          '❌ Failed to send: ' + error.message,
          { message_thread_id: msg.message_thread_id, reply_to_message_id: msg.message_id }
        );
      } catch (e) {}
    }
  }

  async _sendMediaToWhatsApp(msg, targetWaId, quotedWaMessageId) {
    const bot = telegramService.getBot();
    let fileId;
    let caption = '';

    if (msg.photo) { fileId = msg.photo[msg.photo.length - 1].file_id; caption = msg.caption || ''; }
    else if (msg.video) { fileId = msg.video.file_id; caption = msg.caption || ''; }
    else if (msg.audio) { fileId = msg.audio.file_id; caption = msg.caption || ''; }
    else if (msg.voice) { fileId = msg.voice.file_id; }
    else if (msg.document) { fileId = msg.document.file_id; caption = msg.caption || ''; }
    else if (msg.sticker) { fileId = msg.sticker.file_id; }
    else if (msg.animation) { fileId = msg.animation.file_id; caption = msg.caption || ''; }

    if (!fileId) return null;

    const filePath = await bot.downloadFile(fileId, path.join(config.paths.media, 'outgoing'));

    try {
      const media = MessageMedia.fromFilePath(filePath);
      const options = {};
      if (caption) options.caption = caption;
      if (quotedWaMessageId) options.quotedMessageId = quotedWaMessageId;
      if (msg.sticker) options.sendMediaAsSticker = true;

      const sentMsg = await whatsappService.getClient().sendMessage(targetWaId, media, options);
      mediaHandler.cleanupFile(filePath);
      return sentMsg;
    } catch (error) {
      mediaHandler.cleanupFile(filePath);
      throw error;
    }
  }

  _getTelegramMediaType(msg) {
    if (msg.photo) return 'photo';
    if (msg.video) return 'video';
    if (msg.audio) return 'audio';
    if (msg.voice) return 'voice';
    if (msg.document) return 'document';
    if (msg.sticker) return 'sticker';
    if (msg.animation) return 'animation';
    return 'text';
  }
}

module.exports = new TelegramReplyHandler();
