const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { config } = require('../config');
const logger = require('../utils/logger');
const telegramService = require('./telegram');
const fs = require('fs');
const path = require('path');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.isAuthenticated = false;
    this.qrRetries = 0;
    this.maxQrRetries = 5;
    this.eventHandlers = {};
    this.pendingQR = null;
    this.qrRequested = false;

    // Auto-reconnect state
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimer = null;
    this.autoReconnect = true;
  }

  hasSession() {
    try {
      const sessionDir = path.resolve(config.paths.waSession);
      if (!fs.existsSync(sessionDir)) return false;
      const contents = fs.readdirSync(sessionDir);
      return contents.some((item) => item.startsWith('session'));
    } catch {
      return false;
    }
  }

  async initialize() {
    if (this.client) {
      try { await this.client.destroy(); } catch (e) { }
      this.client = null;
    }

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.paths.waSession }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    });

    this.setupClientEvents();
    await this.client.initialize();
    return this.client;
  }

  setupClientEvents() {
    this.client.on('qr', async (qr) => {
      this.qrRetries++;
      logger.info('QR Code received (attempt ' + this.qrRetries + '/' + this.maxQrRetries + ')');
      if (this.qrRetries > this.maxQrRetries) {
        logger.error('Max QR retries reached. Waiting for /login command.');
        this.pendingQR = null;
        this.qrRequested = false;
        try {
          await telegramService.sendToAdmin('❌ <b>Max QR attempts reached.</b>\nUse /login to try again.');
        } catch (e) { }
        return;
      }
      this.pendingQR = qr;
      if (this.qrRequested) {
        await this._sendQRToTelegram(qr);
      } else {
        logger.info('QR buffered. Waiting for /login command.');
      }
    });

    this.client.on('authenticated', () => {
      this.isAuthenticated = true;
      this.qrRetries = 0;
      this.pendingQR = null;
      this.qrRequested = false;
      this.reconnectAttempts = 0; // Reset reconnect counter on successful auth
      logger.info('WhatsApp authenticated');
      telegramService.sendToAdmin('✅ <b>WhatsApp authenticated successfully!</b>');
    });

    this.client.on('auth_failure', (msg) => {
      this.isAuthenticated = false;
      this.pendingQR = null;
      logger.error('WhatsApp auth failure:', msg);
      telegramService.sendToAdmin('❌ <b>WhatsApp authentication failed!</b>\n<code>' + msg + '</code>\nUse /login to try again.');
    });

    this.client.on('ready', () => {
      this.isReady = true;
      this.reconnectAttempts = 0;
      logger.info('WhatsApp client is ready');
      telegramService.sendToAdmin('🟢 <b>WhatsApp is connected and ready!</b>');
      this.emit('ready');
    });

    this.client.on('disconnected', async (reason) => {
      this.isReady = false;
      this.isAuthenticated = false;
      logger.warn('WhatsApp disconnected:', reason);

      if (reason === 'LOGOUT') {
        // User-initiated logout, don't auto-reconnect
        this.autoReconnect = false;
        telegramService.sendToAdmin('🔴 <b>WhatsApp logged out.</b>\nUse /login to reconnect.');
      } else if (this.autoReconnect) {
        telegramService.sendToAdmin(
          '🔴 <b>WhatsApp disconnected!</b>\nReason: <code>' + reason + '</code>\n⏳ Auto-reconnecting...'
        );
        this._scheduleReconnect();
      } else {
        telegramService.sendToAdmin('🔴 <b>WhatsApp disconnected!</b>\nReason: <code>' + reason + '</code>\nUse /login to reconnect.');
      }
    });

    // Core message events
    this.client.on('message', (msg) => this.emit('message', msg));
    this.client.on('message_create', (msg) => this.emit('message_create', msg));
    this.client.on('message_ack', (msg, ack) => this.emit('message_ack', msg, ack));
    this.client.on('call', (call) => this.emit('call', call));

    // Reaction events
    this.client.on('message_reaction', (reaction) => this.emit('message_reaction', reaction));

    // Message edit/revoke events
    this.client.on('message_revoke_everyone', (after, before) => this.emit('message_revoke_everyone', after, before));
    this.client.on('message_edit', (msg, newBody, oldBody) => this.emit('message_edit', msg, newBody, oldBody));

    // Group events
    this.client.on('group_join', (notification) => this.emit('group_join', notification));
    this.client.on('group_leave', (notification) => this.emit('group_leave', notification));
    this.client.on('group_update', (notification) => this.emit('group_update', notification));
    this.client.on('group_admin_changed', (notification) => this.emit('group_admin_changed', notification));
  }

  /**
   * Auto-reconnect with exponential backoff.
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached (' + this.maxReconnectAttempts + ')');
      telegramService.sendToAdmin(
        '❌ <b>Auto-reconnect failed after ' + this.maxReconnectAttempts + ' attempts.</b>\nUse /login to connect manually.'
      );
      this.reconnectAttempts = 0;
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 40s, 80s, ... capped at 5 min
    const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 300000);
    const delaySec = Math.round(delay / 1000);

    logger.info('Reconnecting in ' + delaySec + 's (attempt ' + this.reconnectAttempts + '/' + this.maxReconnectAttempts + ')');

    this.reconnectTimer = setTimeout(async () => {
      try {
        logger.info('Auto-reconnect attempt ' + this.reconnectAttempts + '...');
        await this.initialize();
      } catch (error) {
        logger.error('Reconnect attempt failed:', error);
        if (this.autoReconnect) {
          this._scheduleReconnect();
        }
      }
    }, delay);
  }

  async requestQR() {
    this.qrRequested = true;
    this.qrRetries = 0;
    this.autoReconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pendingQR) {
      await this._sendQRToTelegram(this.pendingQR);
      return;
    }
    await this.initialize();
  }

  async _sendQRToTelegram(qr) {
    try {
      const qrBuffer = await qrcode.toBuffer(qr, { type: 'png', width: 512, margin: 2 });
      await telegramService.sendQRCode(qrBuffer);
    } catch (error) {
      logger.error('Error sending QR code:', error);
      try {
        await telegramService.sendToAdmin('📱 <b>QR Code ready but failed to send image. Check logs.</b>');
      } catch (e) { }
    }
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(handler);
  }

  emit(event, ...args) {
    if (this.eventHandlers[event]) {
      for (const handler of this.eventHandlers[event]) {
        try { handler(...args); } catch (error) {
          logger.error('Error in event handler for ' + event + ':', error);
        }
      }
    }
  }

  async sendMessage(chatId, content, options = {}) {
    if (!this.isReady) throw new Error('WhatsApp client is not ready');
    return this.client.sendMessage(chatId, content, options);
  }

  async getContactInfo(waId) {
    try {
      const contact = await this.client.getContactById(waId);
      return {
        waId: contact.id._serialized,
        phone: contact.number,
        pushName: contact.pushname || null,
        savedName: contact.name || null,
        isGroup: contact.isGroup || false,
      };
    } catch (error) {
      return {
        waId,
        phone: waId.replace(/@[cg]\.us$/, ''),
        pushName: null,
        savedName: null,
        isGroup: waId.includes('@g.us'),
      };
    }
  }

  /**
   * Get profile picture URL for a contact.
   */
  async getProfilePicUrl(waId) {
    try {
      if (!this.client || !this.isReady) return null;
      return await this.client.getProfilePicUrl(waId);
    } catch {
      return null;
    }
  }

  /**
   * Send typing indicator to a WhatsApp chat.
   */
  async sendTyping(chatId) {
    try {
      if (!this.isReady) return;
      const chat = await this.client.getChatById(chatId);
      await chat.sendStateTyping();
    } catch (error) {
      logger.error('Error sending typing indicator:', error);
    }
  }

  /**
   * Clear typing indicator.
   */
  async clearTyping(chatId) {
    try {
      if (!this.isReady) return;
      const chat = await this.client.getChatById(chatId);
      await chat.clearState();
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Get WhatsApp statuses/stories.
   */
  async getStatuses() {
    try {
      if (!this.isReady) return [];
      const chats = await this.client.getChats();
      const statusChat = chats.find((c) => c.id._serialized === 'status@broadcast');
      if (!statusChat) return [];
      const messages = await statusChat.fetchMessages({ limit: 20 });
      return messages;
    } catch (error) {
      logger.error('Error fetching statuses:', error);
      return [];
    }
  }

  /**
   * React to a WhatsApp message.
   */
  async reactToMessage(messageId, emoji) {
    try {
      if (!this.isReady) return;
      const msg = await this.client.getMessageById(messageId);
      if (msg) await msg.react(emoji);
    } catch (error) {
      logger.error('Error reacting to message:', error);
    }
  }

  async restart() {
    logger.info('Restarting WhatsApp client...');
    this.isReady = false;
    this.isAuthenticated = false;
    this.qrRetries = 0;
    this.pendingQR = null;
    this.qrRequested = false;
    this.autoReconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { if (this.client) await this.client.destroy(); } catch (e) { }
    this.client = null;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    this.qrRequested = true;
    await this.initialize();
  }

  async logout() {
    try {
      this.autoReconnect = false;
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

      if (this.client) {
        try { await this.client.logout(); } catch (e) {
          logger.warn('client.logout() failed:', e.message);
        }
        try { await this.client.destroy(); } catch (e) {
          logger.warn('client.destroy() failed:', e.message);
        }
      }

      this._clearSession();
      this.client = null;
      this.isReady = false;
      this.isAuthenticated = false;
      this.qrRetries = 0;
      this.pendingQR = null;
      this.qrRequested = false;
      this.reconnectAttempts = 0;

      logger.info('WhatsApp logged out and session cleared');
      await telegramService.sendToAdmin(
        '👋 <b>WhatsApp logged out successfully.</b>\n🗑 Session data cleared.\n🔑 Use /login to connect with a fresh QR code.'
      );
    } catch (error) {
      logger.error('Error during logout:', error);
      this._clearSession();
      this.client = null;
      this.isReady = false;
      this.isAuthenticated = false;
      throw error;
    }
  }

  _clearSession() {
    const sessionDir = path.resolve(config.paths.waSession);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        fs.mkdirSync(sessionDir, { recursive: true });
        logger.info('Session directory cleared: ' + sessionDir);
      }
    } catch (error) {
      logger.error('Failed to clear session directory:', error);
    }
  }

  getClient() { return this.client; }
}

module.exports = new WhatsAppService();
