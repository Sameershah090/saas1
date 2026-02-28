const TelegramBot = require('node-telegram-bot-api');
const { config } = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');

class TelegramService {
  constructor() {
    this.bot = null;
    this.adminChatId = config.telegram.adminChatId;
    this.forumGroupId = null;
    this.isReady = false;
  }

  async initialize() {
    try {
      this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
      const me = await this.bot.getMe();
      logger.info('Telegram bot initialized: @' + me.username);
      this.isReady = true;

      const { getDatabase } = require('../database/connection');
      const db = getDatabase();
      const state = db.prepare("SELECT value FROM app_state WHERE key = 'forum_group_id'").get();
      if (state) {
        this.forumGroupId = state.value;
        logger.info('Forum group loaded: ' + this.forumGroupId);
      }
      return this.bot;
    } catch (error) {
      logger.error('Failed to initialize Telegram bot:', error);
      throw error;
    }
  }

  async setForumGroup(chatId) {
    this.forumGroupId = chatId;
    const { getDatabase } = require('../database/connection');
    const db = getDatabase();
    db.prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES ('forum_group_id', ?, CURRENT_TIMESTAMP)")
      .run(chatId.toString());
    logger.info('Forum group set to: ' + chatId);
  }

  async createForumTopic(name) {
    if (!this.forumGroupId) throw new Error('Forum group not configured. Use /setgroup command.');
    try {
      const topic = await this.bot.createForumTopic(this.forumGroupId, name);
      logger.info('Created forum topic: "' + name + '" (' + topic.message_thread_id + ')');
      return topic.message_thread_id;
    } catch (error) {
      logger.error('Failed to create topic "' + name + '":', error);
      throw error;
    }
  }

  async sendMessageToTopic(topicId, text, options = {}) {
    const chatId = this.forumGroupId || this.adminChatId;
    try {
      return await this.bot.sendMessage(chatId, text, {
        message_thread_id: topicId,
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error) {
      logger.error('Failed to send to topic ' + topicId + ':', error);
      return this.sendToAdmin(text, options);
    }
  }

  async sendToAdmin(text, options = {}) {
    try {
      return await this.bot.sendMessage(this.adminChatId, text, { parse_mode: 'HTML', ...options });
    } catch (error) {
      logger.error('Failed to send to admin:', error);
      throw error;
    }
  }

  async sendMediaToTopic(topicId, mediaType, filePath, caption = '', replyToMessageId = null) {
    const chatId = this.forumGroupId || this.adminChatId;
    const options = {
      message_thread_id: topicId || undefined,
      caption: caption || undefined,
      parse_mode: 'HTML',
    };
    if (replyToMessageId) options.reply_to_message_id = replyToMessageId;

    const stream = fs.createReadStream(filePath);
    try {
      switch (mediaType) {
        case 'photo': return await this.bot.sendPhoto(chatId, stream, options);
        case 'video': return await this.bot.sendVideo(chatId, stream, options);
        case 'audio': return await this.bot.sendAudio(chatId, stream, options);
        case 'voice': return await this.bot.sendVoice(chatId, stream, options);
        case 'sticker': return await this.bot.sendSticker(chatId, stream, { message_thread_id: topicId || undefined, reply_to_message_id: replyToMessageId || undefined });
        case 'animation': return await this.bot.sendAnimation(chatId, stream, options);
        default: return await this.bot.sendDocument(chatId, stream, options);
      }
    } catch (error) {
      logger.error('Failed to send media:', error);
      throw error;
    }
  }

  async sendQRCode(qrImageBuffer) {
    try {
      return await this.bot.sendPhoto(this.adminChatId, qrImageBuffer, {
        caption: '📱 <b>Scan this QR code with WhatsApp</b>\n\nOpen WhatsApp → Settings → Linked Devices → Link a Device',
        parse_mode: 'HTML',
      });
    } catch (error) {
      logger.error('Failed to send QR code:', error);
      throw error;
    }
  }

  getBot() { return this.bot; }
}

module.exports = new TelegramService();
