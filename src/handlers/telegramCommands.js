const telegramService = require('../services/telegram');
const whatsappService = require('../services/whatsapp');
const messageMapper = require('../services/messageMapper');
const { Contact, CallRecord, ScheduledMessage, MessageMap } = require('../database');
const { config } = require('../config');
const logger = require('../utils/logger');
const { escapeHTML } = require('../utils/sanitizer');
const mediaHandler = require('../services/mediaHandler');
const SecurityMiddleware = require('../middleware/security');
const rateLimiter = require('../utils/rateLimiter');
const schedulerService = require('../services/scheduler');
const encryptionService = require('../services/encryption');
const fs = require('fs');
const path = require('path');

class TelegramCommandsHandler {
  constructor() {
    this.commands = new Map();
    this.commands.set('/start', this.cmdStart.bind(this));
    this.commands.set('/help', this.cmdHelp.bind(this));
    this.commands.set('/status', this.cmdStatus.bind(this));
    this.commands.set('/setgroup', this.cmdSetGroup.bind(this));
    this.commands.set('/contacts', this.cmdContacts.bind(this));
    this.commands.set('/search', this.cmdSearch.bind(this));
    this.commands.set('/calls', this.cmdCalls.bind(this));
    this.commands.set('/login', this.cmdLogin.bind(this));
    this.commands.set('/logout', this.cmdLogout.bind(this));
    this.commands.set('/restart', this.cmdRestart.bind(this));
    this.commands.set('/cleanup', this.cmdCleanup.bind(this));
    this.commands.set('/send', this.cmdSend.bind(this));
    // New commands
    this.commands.set('/alias', this.cmdAlias.bind(this));
    this.commands.set('/mute', this.cmdMute.bind(this));
    this.commands.set('/unmute', this.cmdUnmute.bind(this));
    this.commands.set('/schedule', this.cmdSchedule.bind(this));
    this.commands.set('/scheduled', this.cmdScheduled.bind(this));
    this.commands.set('/cancelschedule', this.cmdCancelSchedule.bind(this));
    this.commands.set('/broadcast', this.cmdBroadcast.bind(this));
    this.commands.set('/find', this.cmdFind.bind(this));
    this.commands.set('/backup', this.cmdBackup.bind(this));
    this.commands.set('/restore', this.cmdRestore.bind(this));
    this.commands.set('/archive', this.cmdArchive.bind(this));
    this.commands.set('/unarchive', this.cmdUnarchive.bind(this));
    this.commands.set('/stories', this.cmdStories.bind(this));
    this.commands.set('/muted', this.cmdMuted.bind(this));
  }

  _getMainMenuKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'cmd_status' },
          { text: '📒 Contacts', callback_data: 'cmd_contacts' },
          { text: '🔍 Search', callback_data: 'cmd_search' },
        ],
        [
          { text: '📞 Calls', callback_data: 'cmd_calls' },
          { text: '🔑 Login', callback_data: 'cmd_login' },
          { text: '🚪 Logout', callback_data: 'cmd_logout' },
        ],
        [
          { text: '📨 Find', callback_data: 'cmd_find' },
          { text: '⏰ Scheduled', callback_data: 'cmd_scheduled' },
          { text: '📡 Broadcast', callback_data: 'cmd_broadcast' },
        ],
        [
          { text: '🔇 Muted', callback_data: 'cmd_muted' },
          { text: '📦 Archive', callback_data: 'cmd_archive' },
          { text: '📷 Stories', callback_data: 'cmd_stories' },
        ],
        [
          { text: '💾 Backup', callback_data: 'cmd_backup' },
          { text: '🔄 Restart', callback_data: 'cmd_restart' },
          { text: '🧹 Cleanup', callback_data: 'cmd_cleanup' },
        ],
        [
          { text: '❓ Help', callback_data: 'cmd_help' },
        ],
      ],
    };
  }

  async handleCommand(msg) {
    if (!SecurityMiddleware.isAuthorizedTelegramUser(msg.from.id)) return;
    const text = msg.text || '';
    if (!SecurityMiddleware.checkMessageSize(text)) {
      await telegramService.sendToAdmin('❌ Message too large.');
      return;
    }
    if (!rateLimiter.canProceed('tg_cmd_' + msg.from.id)) {
      await telegramService.getBot().sendMessage(msg.chat.id, '⚠️ Too many commands. Please wait.', { message_thread_id: msg.message_thread_id });
      return;
    }
    const parts = text.split(' ');
    const command = parts[0].toLowerCase().split('@')[0];
    const handler = this.commands.get(command);
    if (handler) {
      try { await handler(msg, parts.slice(1)); }
      catch (error) {
        logger.error('Error executing ' + command + ':', error);
        await telegramService.sendToAdmin('❌ Command error. Check logs.');
      }
    }
  }

  // ===========================
  // CORE COMMANDS
  // ===========================

  async cmdStart(msg) {
    await telegramService.getBot().sendMessage(msg.chat.id,
      '🌉 <b>WhatsApp-Telegram Bridge v2.0</b>\n\n' +
      'Tap any button below or type /help for all commands.\n\n' +
      '<b>Quick Setup:</b>\n' +
      '1. Create a Telegram group with Topics enabled\n' +
      '2. Add this bot as admin\n' +
      '3. Use /setgroup in the group\n' +
      '4. Use /login to get a WhatsApp QR code',
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id, reply_markup: this._getMainMenuKeyboard() }
    );
  }

  async cmdHelp(msg) {
    await telegramService.getBot().sendMessage(msg.chat.id,
      '📖 <b>All Commands</b>\n\n' +
      '<b>🔗 Connection</b>\n' +
      '/login - Connect WhatsApp\n' +
      '/logout - Disconnect & clear session\n' +
      '/restart - Restart WhatsApp\n' +
      '/setgroup - Set forum group\n' +
      '/status - Connection status\n\n' +
      '<b>💬 Messaging</b>\n' +
      '/send [phone] [msg] - Send message\n' +
      '/broadcast [msg] - Send to multiple contacts\n' +
      '/schedule [phone] [time] [msg] - Schedule message\n' +
      '/scheduled - View scheduled messages\n' +
      '/cancelschedule [id] - Cancel scheduled\n' +
      '/find [query] - Search message history\n\n' +
      '<b>👥 Contacts</b>\n' +
      '/contacts - List contacts\n' +
      '/search [query] - Search contacts\n' +
      '/alias [phone] [name] - Set nickname\n' +
      '/mute [phone] - Mute contact\n' +
      '/unmute [phone] - Unmute contact\n' +
      '/muted - List muted contacts\n\n' +
      '<b>📂 Management</b>\n' +
      '/calls - Call records\n' +
      '/stories - View WhatsApp stories\n' +
      '/archive - Auto-archive inactive\n' +
      '/unarchive [phone] - Unarchive contact\n' +
      '/backup - Export database\n' +
      '/restore - Restore from backup\n' +
      '/cleanup - Clean old media files',
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id, reply_markup: this._getMainMenuKeyboard() }
    );
  }

  async cmdLogin(msg) {
    if (whatsappService.isReady && whatsappService.isAuthenticated) {
      await telegramService.getBot().sendMessage(msg.chat.id,
        '✅ <b>WhatsApp is already connected!</b>\nUse /logout first to re-login.',
        { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
      );
      return;
    }
    await telegramService.getBot().sendMessage(msg.chat.id,
      '⏳ <b>Generating WhatsApp QR code...</b>\nPlease wait.',
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
    try { await whatsappService.requestQR(); }
    catch (error) {
      logger.error('Error during /login:', error);
      await telegramService.getBot().sendMessage(msg.chat.id, '❌ Failed to generate QR. Try /login again.', { message_thread_id: msg.message_thread_id });
    }
  }

  async cmdLogout(msg) {
    if (!whatsappService.isReady && !whatsappService.isAuthenticated && !whatsappService.getClient()) {
      await telegramService.getBot().sendMessage(msg.chat.id, '⚠️ Not connected. Use /login.', { message_thread_id: msg.message_thread_id });
      return;
    }
    await telegramService.getBot().sendMessage(msg.chat.id, '⏳ Logging out...', { message_thread_id: msg.message_thread_id });
    try { await whatsappService.logout(); }
    catch (error) {
      await telegramService.getBot().sendMessage(msg.chat.id, '⚠️ Logout had issues but session was cleared. Use /login.', { message_thread_id: msg.message_thread_id });
    }
  }

  async cmdRestart(msg) {
    if (!whatsappService.getClient() && !whatsappService.hasSession()) {
      await telegramService.getBot().sendMessage(msg.chat.id, '⚠️ No session. Use /login.', { message_thread_id: msg.message_thread_id });
      return;
    }
    await telegramService.getBot().sendMessage(msg.chat.id, '🔄 Restarting WhatsApp...', { message_thread_id: msg.message_thread_id });
    await whatsappService.restart();
  }

  async cmdStatus(msg) {
    const waStatus = whatsappService.isReady ? '🟢 Connected' : '🔴 Disconnected';
    const waAuth = whatsappService.isAuthenticated ? '✅ Yes' : '❌ No';
    const forum = telegramService.forumGroupId ? '✅ ' + telegramService.forumGroupId : '❌ Not set';
    const contacts = Contact.getAll().length;
    const mutedCount = Contact.getMuted().length;
    const archivedCount = Contact.getArchived().length;
    const totalMsgs = MessageMap.getCount();
    const scheduledCount = ScheduledMessage.getUpcoming().length;
    const uptime = Math.floor(process.uptime() / 60);
    const hasSession = whatsappService.hasSession() ? '💾 Yes' : '🚫 No';
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    await telegramService.getBot().sendMessage(msg.chat.id,
      '📊 <b>Bridge Status</b>\n\n' +
      '<b>WhatsApp:</b> ' + waStatus + '\n' +
      '<b>Authenticated:</b> ' + waAuth + '\n' +
      '<b>Saved Session:</b> ' + hasSession + '\n' +
      '<b>Forum Group:</b> ' + forum + '\n\n' +
      '<b>📈 Stats</b>\n' +
      '<b>Contacts:</b> ' + contacts + ' (🔇' + mutedCount + ' 📦' + archivedCount + ')\n' +
      '<b>Messages:</b> ' + totalMsgs + '\n' +
      '<b>Scheduled:</b> ' + scheduledCount + '\n' +
      '<b>Uptime:</b> ' + uptime + 'min\n' +
      '<b>Memory:</b> ' + mem + 'MB',
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  async cmdSetGroup(msg) {
    if (msg.chat.type !== 'supergroup') {
      await telegramService.getBot().sendMessage(msg.chat.id, '❌ Use this in a supergroup with Topics enabled.');
      return;
    }
    await telegramService.setForumGroup(msg.chat.id);
    await telegramService.getBot().sendMessage(msg.chat.id,
      '✅ <b>Forum group configured!</b> New contacts will get topic threads here.',
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  async cmdContacts(msg) {
    const contacts = Contact.getAll();
    if (contacts.length === 0) {
      await telegramService.getBot().sendMessage(msg.chat.id, '📭 No contacts yet.', { message_thread_id: msg.message_thread_id });
      return;
    }
    const lines = contacts.slice(0, 50).map((c, i) => {
      const name = Contact.getDisplayName(c);
      const type = c.is_group ? '👥' : '👤';
      const muted = c.is_muted ? '🔇' : '';
      return (i + 1) + '. ' + type + muted + ' <b>' + escapeHTML(name) + '</b> (+' + escapeHTML(c.phone || 'N/A') + ')';
    });
    await telegramService.getBot().sendMessage(msg.chat.id,
      '📒 <b>Contacts (' + contacts.length + ')</b>\n\n' + lines.join('\n'),
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  async cmdSearch(msg, args) {
    const query = args.join(' ');
    if (!query) return this._sendUsage(msg, '/search <name or number>');
    if (query.length > 100) return this._sendError(msg, 'Search query too long.');
    const results = Contact.search(query);
    if (results.length === 0) {
      await telegramService.getBot().sendMessage(msg.chat.id, '🔍 No results for "' + escapeHTML(query) + '"', { parse_mode: 'HTML', message_thread_id: msg.message_thread_id });
      return;
    }
    const lines = results.map((c, i) => {
      const name = Contact.getDisplayName(c);
      return (i + 1) + '. <b>' + escapeHTML(name) + '</b> (+' + escapeHTML(c.phone || 'N/A') + ')';
    });
    await telegramService.getBot().sendMessage(msg.chat.id,
      '🔍 <b>Results for "' + escapeHTML(query) + '"</b>\n\n' + lines.join('\n'),
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  async cmdCalls(msg) {
    const calls = CallRecord.getRecent(20);
    if (calls.length === 0) return this._sendMsg(msg, '📞 No call records yet.');
    const lines = calls.map((c) => {
      const name = c.saved_name || c.push_name || c.phone || 'Unknown';
      const icon = c.call_type === 'video' ? '📹' : '📞';
      const dir = c.direction === 'incoming' ? '⬇️' : '⬆️';
      return icon + dir + ' <b>' + escapeHTML(name) + '</b> - ' + new Date(c.timestamp).toLocaleString();
    });
    await telegramService.getBot().sendMessage(msg.chat.id,
      '📞 <b>Recent Calls</b>\n\n' + lines.join('\n'),
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  async cmdCleanup(msg) {
    mediaHandler.cleanupOldFiles(7);
    await this._sendMsg(msg, '🧹 Cleaned up old media files.');
  }

  async cmdSend(msg, args) {
    if (args.length < 2) return this._sendUsage(msg, '/send <phone> <message>\nExample: /send 919876543210 Hello!');
    const phone = args[0].replace(/[^\d]/g, '');
    const message = args.slice(1).join(' ');
    if (!SecurityMiddleware.isValidPhoneNumber(phone)) return this._sendError(msg, 'Invalid phone (7-15 digits).');
    if (!message.trim()) return this._sendError(msg, 'Message cannot be empty.');
    if (!SecurityMiddleware.checkMessageSize(message)) return this._sendError(msg, 'Message too long.');
    if (!whatsappService.isReady) return this._sendError(msg, 'WhatsApp not connected. Use /login.');
    const waId = phone + '@c.us';
    try {
      const sentMsg = await whatsappService.sendMessage(waId, message);
      await this._sendMsg(msg, '✅ Sent to +' + phone);
      const contactInfo = await whatsappService.getContactInfo(waId);
      const contact = await messageMapper.getOrCreateContact(waId, contactInfo);
      await messageMapper.mapMessage({
        waMessageId: sentMsg.id._serialized, telegramMessageId: msg.message_id,
        telegramChatId: msg.chat.id.toString(), topicId: msg.message_thread_id,
        contactId: contact.id, direction: 'outgoing', messageType: 'text',
        content: encryptionService.encrypt(message),
      });
    } catch (error) {
      await this._sendError(msg, 'Failed to send. Check logs.');
    }
  }

  // ===========================
  // ALIAS & NOTIFICATION COMMANDS
  // ===========================

  async cmdAlias(msg, args) {
    if (args.length < 2) return this._sendUsage(msg, '/alias <phone> <nickname>\nExample: /alias 919876543210 Boss');
    const phone = args[0].replace(/[^\d]/g, '');
    const alias = args.slice(1).join(' ').substring(0, 50);
    if (!SecurityMiddleware.isValidPhoneNumber(phone)) return this._sendError(msg, 'Invalid phone.');
    const waId = phone + '@c.us';
    const contact = Contact.findByWaId(waId);
    if (!contact) return this._sendError(msg, 'Contact +' + phone + ' not found.');
    Contact.setAlias(waId, alias);
    await this._sendMsg(msg, '🏷 Alias set: <b>' + escapeHTML(alias) + '</b> for +' + phone);
  }

  async cmdMute(msg, args) {
    if (args.length < 1) return this._sendUsage(msg, '/mute <phone>\nExample: /mute 919876543210');
    const phone = args[0].replace(/[^\d]/g, '');
    const waId = phone + '@c.us';
    const contact = Contact.findByWaId(waId);
    if (!contact) return this._sendError(msg, 'Contact +' + phone + ' not found.');
    Contact.setMuted(waId, true);
    await this._sendMsg(msg, '🔇 Muted +' + phone + '. Messages won\'t be forwarded.');
  }

  async cmdUnmute(msg, args) {
    if (args.length < 1) return this._sendUsage(msg, '/unmute <phone>\nExample: /unmute 919876543210');
    const phone = args[0].replace(/[^\d]/g, '');
    const waId = phone + '@c.us';
    const contact = Contact.findByWaId(waId);
    if (!contact) return this._sendError(msg, 'Contact +' + phone + ' not found.');
    Contact.setMuted(waId, false);
    await this._sendMsg(msg, '🔊 Unmuted +' + phone + '. Messages will be forwarded again.');
  }

  async cmdMuted(msg) {
    const muted = Contact.getMuted();
    if (muted.length === 0) return this._sendMsg(msg, '🔊 No muted contacts.');
    const lines = muted.map((c, i) => (i + 1) + '. 🔇 <b>' + escapeHTML(Contact.getDisplayName(c)) + '</b> (+' + escapeHTML(c.phone || '') + ')');
    await telegramService.getBot().sendMessage(msg.chat.id,
      '🔇 <b>Muted Contacts</b>\n\n' + lines.join('\n'),
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  // ===========================
  // SCHEDULED MESSAGES
  // ===========================

  async cmdSchedule(msg, args) {
    if (args.length < 3) {
      return this._sendUsage(msg,
        '/schedule <phone> <time> <message>\n' +
        'Time formats: 5m, 1h, 30m, 2h30m\n' +
        'Example: /schedule 919876543210 30m Hello in 30 minutes!'
      );
    }
    const phone = args[0].replace(/[^\d]/g, '');
    if (!SecurityMiddleware.isValidPhoneNumber(phone)) return this._sendError(msg, 'Invalid phone.');
    if (!whatsappService.isReady) return this._sendError(msg, 'WhatsApp not connected.');

    const timeStr = args[1].toLowerCase();
    const delayMs = this._parseTimeString(timeStr);
    if (!delayMs || delayMs < 60000) return this._sendError(msg, 'Invalid time. Min 1m. Examples: 5m, 1h, 2h30m');
    if (delayMs > 7 * 24 * 60 * 60 * 1000) return this._sendError(msg, 'Max schedule time is 7 days.');

    const message = args.slice(2).join(' ');
    if (!message.trim()) return this._sendError(msg, 'Message cannot be empty.');

    const scheduledAt = new Date(Date.now() + delayMs).toISOString();
    const waId = phone + '@c.us';

    const id = schedulerService.schedule(waId, phone, message, scheduledAt);
    const timeLabel = new Date(scheduledAt).toLocaleString();

    await this._sendMsg(msg,
      '⏰ <b>Message scheduled!</b>\n' +
      '📱 To: +' + phone + '\n' +
      '⏳ At: ' + timeLabel + '\n' +
      '💬 ' + escapeHTML(message.substring(0, 100)) + (message.length > 100 ? '...' : '') + '\n' +
      '🔢 ID: <code>' + id + '</code>'
    );
  }

  async cmdScheduled(msg) {
    const upcoming = ScheduledMessage.getUpcoming();
    if (upcoming.length === 0) return this._sendMsg(msg, '⏰ No scheduled messages.');
    const lines = upcoming.map((s) => {
      const time = new Date(s.scheduled_at).toLocaleString();
      return '🔢 <code>' + s.id + '</code> → +' + (s.target_phone || '?') + ' at ' + time + '\n   💬 ' + escapeHTML((s.message || '').substring(0, 60));
    });
    await telegramService.getBot().sendMessage(msg.chat.id,
      '⏰ <b>Scheduled Messages</b>\n\n' + lines.join('\n\n'),
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  async cmdCancelSchedule(msg, args) {
    if (args.length < 1) return this._sendUsage(msg, '/cancelschedule <id>');
    const id = parseInt(args[0]);
    if (isNaN(id)) return this._sendError(msg, 'Invalid ID.');
    const cancelled = ScheduledMessage.cancel(id);
    if (cancelled) {
      await this._sendMsg(msg, '❌ Scheduled message #' + id + ' cancelled.');
    } else {
      await this._sendError(msg, 'Message #' + id + ' not found or already sent.');
    }
  }

  // ===========================
  // BROADCAST
  // ===========================

  async cmdBroadcast(msg, args) {
    if (args.length < 1) {
      return this._sendUsage(msg,
        '/broadcast <message>\n' +
        'Sends to ALL active (non-muted, non-archived) contacts.\n' +
        '⚠️ Use with caution!'
      );
    }
    if (!whatsappService.isReady) return this._sendError(msg, 'WhatsApp not connected.');

    const message = args.join(' ');
    if (!message.trim()) return this._sendError(msg, 'Message cannot be empty.');

    const contacts = Contact.getAll().filter((c) => !c.is_group && !c.is_muted && c.wa_id);
    if (contacts.length === 0) return this._sendError(msg, 'No eligible contacts.');

    // Confirmation (for safety, require typing /broadcast confirm <message>)
    if (args[0] !== 'confirm') {
      await this._sendMsg(msg,
        '📡 <b>Broadcast Preview</b>\n\n' +
        '👥 Recipients: ' + contacts.length + ' contacts\n' +
        '💬 Message: ' + escapeHTML(message.substring(0, 200)) + '\n\n' +
        '⚠️ To confirm, type:\n<code>/broadcast confirm ' + escapeHTML(message.substring(0, 100)) + '</code>'
      );
      return;
    }

    const actualMessage = args.slice(1).join(' ');
    if (!actualMessage.trim()) return this._sendError(msg, 'Message cannot be empty after "confirm".');

    await this._sendMsg(msg, '📡 Broadcasting to ' + contacts.length + ' contacts...');

    let sent = 0, failed = 0;
    for (const c of contacts) {
      try {
        await whatsappService.sendMessage(c.wa_id, actualMessage);
        sent++;
        // Small delay to avoid rate limits
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        failed++;
      }
    }

    await this._sendMsg(msg, '📡 <b>Broadcast complete!</b>\n✅ Sent: ' + sent + '\n❌ Failed: ' + failed);
  }

  // ===========================
  // MESSAGE SEARCH
  // ===========================

  async cmdFind(msg, args) {
    const query = args.join(' ');
    if (!query) return this._sendUsage(msg, '/find <keyword>\nSearches through message history.');
    if (query.length > 100) return this._sendError(msg, 'Query too long.');

    // Search encrypted content — we need to decrypt before matching
    // For efficiency, we do a broad DB search and then filter decrypted results
    const results = MessageMap.searchContent(query, 100);

    // Also try decrypted search
    const matches = [];
    for (const r of results) {
      let content = r.content || '';
      if (encryptionService.isEncrypted(content)) {
        content = encryptionService.decrypt(content);
      }
      if (content.toLowerCase().includes(query.toLowerCase())) {
        matches.push({ ...r, decryptedContent: content });
      }
      if (matches.length >= 20) break;
    }

    if (matches.length === 0) {
      // Try broader search on decrypted content in-memory
      const allRecent = MessageMap.searchContent('', 500); // Get recent messages
      for (const r of allRecent) {
        let content = r.content || '';
        if (encryptionService.isEncrypted(content)) {
          content = encryptionService.decrypt(content);
        }
        if (content && content.toLowerCase().includes(query.toLowerCase())) {
          matches.push({ ...r, decryptedContent: content });
        }
        if (matches.length >= 20) break;
      }
    }

    if (matches.length === 0) {
      return this._sendMsg(msg, '🔍 No messages found for "' + escapeHTML(query) + '"');
    }

    const lines = matches.slice(0, 15).map((m) => {
      const name = m.alias || m.saved_name || m.push_name || m.phone || '?';
      const dir = m.direction === 'incoming' ? '📩' : '📤';
      const snippet = (m.decryptedContent || '').substring(0, 80);
      return dir + ' <b>' + escapeHTML(name) + ':</b> ' + escapeHTML(snippet);
    });

    await telegramService.getBot().sendMessage(msg.chat.id,
      '🔍 <b>Messages matching "' + escapeHTML(query) + '"</b>\n\n' + lines.join('\n\n'),
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );
  }

  // ===========================
  // BACKUP & RESTORE
  // ===========================

  async cmdBackup(msg) {
    try {
      const dbPath = path.resolve(config.paths.db);
      if (!fs.existsSync(dbPath)) return this._sendError(msg, 'Database file not found.');

      const backupDir = path.join(path.dirname(dbPath), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, 'bridge_backup_' + timestamp + '.db');

      fs.copyFileSync(dbPath, backupPath);

      // Send backup file to admin
      await telegramService.getBot().sendDocument(msg.chat.id, backupPath, {
        caption: '💾 <b>Database backup</b>\n📅 ' + new Date().toLocaleString() + '\n📦 ' + (fs.statSync(backupPath).size / 1024).toFixed(1) + ' KB',
        parse_mode: 'HTML',
        message_thread_id: msg.message_thread_id,
      });

      // Keep only last 5 backups
      const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith('bridge_backup_')).sort().reverse();
      for (const old of backups.slice(5)) {
        try { fs.unlinkSync(path.join(backupDir, old)); } catch (e) { }
      }

      logger.info('Database backed up to: ' + backupPath);
    } catch (error) {
      logger.error('Backup failed:', error);
      await this._sendError(msg, 'Backup failed. Check logs.');
    }
  }

  async cmdRestore(msg) {
    if (!msg.reply_to_message || !msg.reply_to_message.document) {
      return this._sendUsage(msg, 'Reply to a backup .db file with /restore to restore it.\n⚠️ This will overwrite the current database!');
    }

    try {
      const bot = telegramService.getBot();
      const fileId = msg.reply_to_message.document.file_id;
      const fileName = msg.reply_to_message.document.file_name || '';

      if (!fileName.endsWith('.db')) return this._sendError(msg, 'File must be a .db file.');

      const dbPath = path.resolve(config.paths.db);
      const backupDir = path.join(path.dirname(dbPath), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      // Auto-backup current DB first
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(dbPath, path.join(backupDir, 'pre_restore_' + timestamp + '.db'));

      // Download and replace
      const downloadPath = await bot.downloadFile(fileId, backupDir);
      const { closeDatabase } = require('../database');
      closeDatabase();
      fs.copyFileSync(downloadPath, dbPath);
      fs.unlinkSync(downloadPath);

      await this._sendMsg(msg, '✅ <b>Database restored!</b>\n⚠️ Restart the bot with /restart for changes to take effect.');
      logger.info('Database restored from uploaded file');
    } catch (error) {
      logger.error('Restore failed:', error);
      await this._sendError(msg, 'Restore failed. Check logs.');
    }
  }

  // ===========================
  // ARCHIVAL
  // ===========================

  async cmdArchive(msg, args) {
    if (args.length >= 1) {
      // Archive a specific contact
      const phone = args[0].replace(/[^\d]/g, '');
      const waId = phone + '@c.us';
      const contact = Contact.findByWaId(waId);
      if (!contact) return this._sendError(msg, 'Contact +' + phone + ' not found.');
      Contact.setArchived(waId, true);
      return this._sendMsg(msg, '📦 Archived +' + phone);
    }

    // Auto-archive: list inactive contacts (>30 days)
    const inactive = Contact.getInactiveSince(30);
    if (inactive.length === 0) return this._sendMsg(msg, '📦 No inactive contacts (30+ days).');

    const lines = inactive.slice(0, 20).map((c, i) => {
      const name = Contact.getDisplayName(c);
      const lastActive = c.last_active_at ? new Date(c.last_active_at).toLocaleDateString() : 'Never';
      return (i + 1) + '. <b>' + escapeHTML(name) + '</b> — Last: ' + lastActive;
    });

    await telegramService.getBot().sendMessage(msg.chat.id,
      '📦 <b>Inactive Contacts (30+ days): ' + inactive.length + '</b>\n\n' + lines.join('\n') +
      '\n\nTo archive all: <code>/archive all</code>',
      { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
    );

    if (args[0] === 'all') {
      let count = 0;
      for (const c of inactive) {
        Contact.setArchived(c.wa_id, true);
        count++;
      }
      await this._sendMsg(msg, '📦 Archived ' + count + ' inactive contacts.');
    }
  }

  async cmdUnarchive(msg, args) {
    if (args.length < 1) {
      const archived = Contact.getArchived();
      if (archived.length === 0) return this._sendMsg(msg, '📦 No archived contacts.');
      const lines = archived.slice(0, 20).map((c, i) => {
        const name = Contact.getDisplayName(c);
        return (i + 1) + '. <b>' + escapeHTML(name) + '</b> (+' + escapeHTML(c.phone || '') + ')';
      });
      return telegramService.getBot().sendMessage(msg.chat.id,
        '📦 <b>Archived Contacts</b>\n\n' + lines.join('\n') + '\n\nUse: /unarchive <phone>',
        { parse_mode: 'HTML', message_thread_id: msg.message_thread_id }
      );
    }
    const phone = args[0].replace(/[^\d]/g, '');
    const waId = phone + '@c.us';
    const contact = Contact.findByWaId(waId);
    if (!contact) return this._sendError(msg, 'Contact not found.');
    Contact.setArchived(waId, false);
    await this._sendMsg(msg, '📤 Unarchived +' + phone);
  }

  // ===========================
  // STORIES / STATUS
  // ===========================

  async cmdStories(msg) {
    if (!whatsappService.isReady) return this._sendError(msg, 'WhatsApp not connected.');
    await this._sendMsg(msg, '📷 Fetching WhatsApp statuses...');
    try {
      const statuses = await whatsappService.getStatuses();
      if (!statuses || statuses.length === 0) return this._sendMsg(msg, '📷 No recent statuses found.');

      let count = 0;
      for (const status of statuses.slice(0, 10)) {
        try {
          const contactInfo = await whatsappService.getContactInfo(status.from);
          const name = contactInfo.savedName || contactInfo.pushName || contactInfo.phone || 'Unknown';

          if (status.hasMedia) {
            const media = await status.downloadMedia();
            if (media) {
              const savedMedia = await mediaHandler.saveMedia(media, 'status_' + Date.now(), 'incoming');
              if (savedMedia) {
                const mediaType = mediaHandler.getMediaType(media.mimetype);
                const caption = '📷 <b>Status from ' + escapeHTML(name) + '</b>' + (status.body ? '\n' + escapeHTML(status.body) : '');
                await telegramService.sendMediaToTopic(msg.message_thread_id, mediaType, savedMedia.filePath, caption);
                count++;
                continue;
              }
            }
          }

          if (status.body) {
            await this._sendMsg(msg, '📷 <b>Status from ' + escapeHTML(name) + ':</b>\n' + escapeHTML(status.body));
            count++;
          }
        } catch (e) {
          // Skip individual status errors
        }
      }

      if (count === 0) await this._sendMsg(msg, '📷 No viewable statuses.');
    } catch (error) {
      logger.error('Error fetching stories:', error);
      await this._sendError(msg, 'Failed to fetch statuses.');
    }
  }

  // ===========================
  // HELPERS
  // ===========================

  _parseTimeString(str) {
    let totalMs = 0;
    const hourMatch = str.match(/(\d+)h/);
    const minMatch = str.match(/(\d+)m/);
    if (hourMatch) totalMs += parseInt(hourMatch[1]) * 60 * 60 * 1000;
    if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;
    if (totalMs === 0 && /^\d+$/.test(str)) totalMs = parseInt(str) * 60 * 1000; // Plain number = minutes
    return totalMs;
  }

  async _sendMsg(msg, text) {
    await telegramService.getBot().sendMessage(msg.chat.id, text, { parse_mode: 'HTML', message_thread_id: msg.message_thread_id });
  }

  async _sendError(msg, text) {
    await telegramService.getBot().sendMessage(msg.chat.id, '❌ ' + text, { message_thread_id: msg.message_thread_id });
  }

  async _sendUsage(msg, text) {
    await telegramService.getBot().sendMessage(msg.chat.id, '💡 Usage: ' + text, { message_thread_id: msg.message_thread_id });
  }
}

module.exports = new TelegramCommandsHandler();
