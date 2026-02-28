const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { config } = require('../config');
const logger = require('../utils/logger');
const telegramService = require('./telegram');

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
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimer = null;
    this.autoReconnect = true;
    this.messageCache = new Map();
  }

  hasSession() {
    try {
      const sessionDir = path.resolve(config.paths.waSession);
      if (!fs.existsSync(sessionDir)) return false;
      const contents = fs.readdirSync(sessionDir);
      return contents.some((item) => item.startsWith('creds') || item.endsWith('.json'));
    } catch {
      return false;
    }
  }

  async initialize() {
    this.autoReconnect = true;
    const sessionDir = path.resolve(config.paths.waSession);
    fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    this.client = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      browser: ['Bridge', 'Chrome', '1.0.0'],
    });

    this.client.ev.on('creds.update', saveCreds);
    this.setupClientEvents();
    return this.client;
  }

  setupClientEvents() {
    this.client.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrRetries++;
        this.pendingQR = qr;
        logger.info('QR Code received (attempt ' + this.qrRetries + '/' + this.maxQrRetries + ')');
        if (this.qrRetries > this.maxQrRetries) {
          logger.error('Max QR retries reached. Waiting for /login command.');
          this.pendingQR = null;
          this.qrRequested = false;
          await telegramService.sendToAdmin('❌ <b>Max QR attempts reached.</b>\nUse /login to try again.');
          return;
        }
        if (this.qrRequested) await this._sendQRToTelegram(qr);
      }

      if (connection === 'open') {
        this.isReady = true;
        this.isAuthenticated = true;
        this.reconnectAttempts = 0;
        this.pendingQR = null;
        this.qrRequested = false;
        logger.info('WhatsApp client is ready (Baileys)');
        await telegramService.sendToAdmin('🟢 <b>WhatsApp is connected and ready!</b>');
        this.emit('ready');
      }

      if (connection === 'close') {
        this.isReady = false;
        this.isAuthenticated = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        logger.warn('WhatsApp disconnected:', statusCode || 'unknown');
        if (isLoggedOut) {
          this.autoReconnect = false;
          await telegramService.sendToAdmin('🔴 <b>WhatsApp logged out.</b>\nUse /login to reconnect.');
        } else if (this.autoReconnect) {
          await telegramService.sendToAdmin('🔴 <b>WhatsApp disconnected!</b>\n⏳ Auto-reconnecting...');
          this._scheduleReconnect();
        }
      }
    });

    this.client.ev.on('messages.upsert', async ({ messages }) => {
      for (const rawMsg of messages || []) {
        const normalized = this._normalizeMessage(rawMsg);
        if (!normalized) continue;

        this.messageCache.set(normalized.id._serialized, normalized);
        if (this.messageCache.size > 500) {
          const firstKey = this.messageCache.keys().next().value;
          this.messageCache.delete(firstKey);
        }

        if (normalized.fromMe) this.emit('message_create', normalized);
        else this.emit('message', normalized);
      }
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached (' + this.maxReconnectAttempts + ')');
      telegramService.sendToAdmin('❌ <b>Auto-reconnect failed.</b>\nUse /login to connect manually.');
      this.reconnectAttempts = 0;
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 300000);
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        logger.error('Reconnect attempt failed:', error);
        if (this.autoReconnect) this._scheduleReconnect();
      }
    }, delay);
  }

  async requestQR() {
    this.qrRequested = true;
    this.qrRetries = 0;
    this.autoReconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (this.pendingQR) {
      await this._sendQRToTelegram(this.pendingQR);
      return;
    }
    await this.initialize();
  }

  async _sendQRToTelegram(qr) {
    const qrBuffer = await qrcode.toBuffer(qr, { type: 'png', width: 512, margin: 2 });
    await telegramService.sendQRCode(qrBuffer);
  }

  _normalizeMessage(rawMsg) {
    if (!rawMsg?.message || !rawMsg.key?.remoteJid) return null;

    const key = rawMsg.key;
    const messageType = getContentType(rawMsg.message) || 'conversation';
    const content = rawMsg.message[messageType] || {};
    const from = jidNormalizedUser(key.remoteJid);
    const fromMe = !!key.fromMe;

    let body = '';
    if (messageType === 'conversation') body = rawMsg.message.conversation || '';
    else if (content?.text) body = content.text;
    else if (content?.caption) body = content.caption;

    const msgId = key.id;
    const quoted = content?.contextInfo?.stanzaId;
    const hasMedia = !!(
      rawMsg.message.imageMessage || rawMsg.message.videoMessage || rawMsg.message.audioMessage ||
      rawMsg.message.documentMessage || rawMsg.message.stickerMessage
    );

    return {
      _raw: rawMsg,
      id: { _serialized: msgId },
      from,
      to: from,
      fromMe,
      author: content?.contextInfo?.participant || rawMsg.participant,
      body,
      type: this._mapType(messageType),
      isStatus: from === 'status@broadcast',
      hasMedia,
      hasQuotedMsg: !!quoted,
      getQuotedMessage: async () => this.messageCache.get(quoted) || null,
      downloadMedia: async () => this._downloadMedia(rawMsg),
      location: content?.degreesLatitude ? { latitude: content.degreesLatitude, longitude: content.degreesLongitude } : null,
    };
  }

  _mapType(type) {
    const map = {
      conversation: 'text',
      extendedTextMessage: 'text',
      imageMessage: 'image',
      videoMessage: 'video',
      audioMessage: 'audio',
      documentMessage: 'document',
      stickerMessage: 'sticker',
      locationMessage: 'location',
      contactMessage: 'vcard',
      contactsArrayMessage: 'multi_vcard',
    };
    return map[type] || type;
  }

  async _downloadMedia(rawMsg) {
    try {
      const buffer = await downloadMediaMessage(rawMsg, 'buffer', {}, { logger: undefined, reuploadRequest: this.client.updateMediaMessage });
      if (!buffer) return null;

      const messageType = getContentType(rawMsg.message);
      const mediaMsg = rawMsg.message[messageType] || {};
      const mimetype = mediaMsg.mimetype || 'application/octet-stream';
      return { mimetype, data: buffer.toString('base64'), filename: mediaMsg.fileName || `file.${mime.extension(mimetype) || 'bin'}` };
    } catch (error) {
      logger.error('Failed to download media:', error.message);
      return null;
    }
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(handler);
  }

  emit(event, ...args) {
    if (!this.eventHandlers[event]) return;
    for (const handler of this.eventHandlers[event]) {
      try { handler(...args); } catch (error) { logger.error('Error in event handler for ' + event + ':', error); }
    }
  }

  async sendMessage(chatId, content, options = {}) {
    if (!this.isReady) throw new Error('WhatsApp client is not ready');

    const payload = typeof content === 'string' ? { text: content } : content;
    const sent = await this.client.sendMessage(chatId, payload, {
      quoted: options.quotedMessage,
      quotedMessageId: options.quotedMessageId,
    });

    return {
      id: { _serialized: sent.key.id },
      fromMe: true,
      from: sent.key.remoteJid,
      to: sent.key.remoteJid,
      body: payload.text || options.caption || '',
      type: payload.text ? 'text' : 'media',
      hasMedia: !!(payload.image || payload.video || payload.document || payload.audio || payload.sticker),
      _raw: sent,
    };
  }

  async sendMediaFromFile(chatId, filePath, options = {}) {
    const mimetype = mime.lookup(filePath) || 'application/octet-stream';
    const extType = mimetype.split('/')[0];
    const quotedOptions = {};
    if (options.quotedMessageId) quotedOptions.quotedMessageId = options.quotedMessageId;

    if (options.sendMediaAsSticker) {
      return this.sendMessage(chatId, { sticker: fs.readFileSync(filePath) }, quotedOptions);
    }

    const mediaPayload = {};
    if (extType === 'image') mediaPayload.image = fs.readFileSync(filePath);
    else if (extType === 'video') mediaPayload.video = fs.readFileSync(filePath);
    else if (extType === 'audio') mediaPayload.audio = fs.readFileSync(filePath);
    else mediaPayload.document = fs.readFileSync(filePath);

    if (options.caption) mediaPayload.caption = options.caption;
    if (extType !== 'audio') mediaPayload.mimetype = mimetype;

    return this.sendMessage(chatId, mediaPayload, quotedOptions);
  }

  async getContactInfo(waId) {
    const phone = waId.replace(/@s\.whatsapp\.net|@[cg]\.us$/, '');
    return {
      waId,
      phone,
      pushName: null,
      savedName: null,
      isGroup: waId.includes('@g.us'),
    };
  }

  async getProfilePicUrl() { return null; }
  async sendTyping() { }
  async clearTyping() { }
  async getStatuses() { return []; }
  async reactToMessage() { }

  async restart() {
    this.isReady = false;
    this.isAuthenticated = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.qrRequested = true;
    await this.initialize();
  }

  async logout() {
    this.autoReconnect = false;
    if (this.client) {
      try { await this.client.logout(); } catch (e) {}
      try { this.client.end(new Error('logout')); } catch (e) {}
    }
    this._clearSession();
    this.client = null;
    this.isReady = false;
    this.isAuthenticated = false;
    this.pendingQR = null;
    this.qrRequested = false;
    this.reconnectAttempts = 0;
    await telegramService.sendToAdmin('👋 <b>WhatsApp logged out successfully.</b>\nUse /login to connect again.');
  }

  _clearSession() {
    const sessionDir = path.resolve(config.paths.waSession);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        fs.mkdirSync(sessionDir, { recursive: true });
      }
    } catch (error) {
      logger.error('Failed to clear session directory:', error);
    }
  }

  getClient() { return this.client; }
}

module.exports = new WhatsAppService();
