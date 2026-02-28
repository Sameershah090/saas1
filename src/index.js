const { validateConfig, config } = require('./config');
const { setupGlobalErrorHandlers } = require('./utils/errorHandler');
const logger = require('./utils/logger');

// Validate configuration
try {
  validateConfig();
} catch (error) {
  console.error('❌ Configuration Error:', error.message);
  console.error('Please edit your .env file');
  process.exit(1);
}

setupGlobalErrorHandlers();

const telegramService = require('./services/telegram');
const whatsappService = require('./services/whatsapp');
const mediaHandler = require('./services/mediaHandler');
const schedulerService = require('./services/scheduler');
const dashboardService = require('./services/dashboard');
const incomingHandler = require('./handlers/incomingWhatsApp');
const outgoingHandler = require('./handlers/outgoingWhatsApp');
const telegramCommandsHandler = require('./handlers/telegramCommands');
const telegramReplyHandler = require('./handlers/telegramReply');
const callHandler = require('./handlers/callHandler');
const whatsappEventsHandler = require('./handlers/whatsappEvents');
const { getDatabase } = require('./database');
const { runMigrations } = require('./database/migrations');

async function main() {
  logger.info('============================================');
  logger.info('  WhatsApp-Telegram Bridge v2.0 Starting...');
  logger.info('============================================');

  // Step 1: Database + Migrations
  logger.info('Initializing database...');
  getDatabase();
  runMigrations();

  // Step 2: Telegram bot
  logger.info('Initializing Telegram bot...');
  await telegramService.initialize();

  // Step 3: Telegram handlers
  setupTelegramHandlers();

  // Step 4: WhatsApp handlers
  setupWhatsAppHandlers();

  // Step 5: WhatsApp connection
  if (whatsappService.hasSession()) {
    logger.info('Existing WhatsApp session found. Auto-connecting...');
    await whatsappService.initialize();
  } else {
    logger.info('No WhatsApp session found. Use /login in Telegram to connect.');
    await telegramService.sendToAdmin(
      '🤖 <b>Bridge is online!</b>\n\nNo WhatsApp session found.\nUse /login to scan a QR code and connect.'
    );
  }

  // Step 6: Start scheduler
  schedulerService.start(
    async (waId, message) => await whatsappService.sendMessage(waId, message),
    async (text) => await telegramService.sendToAdmin(text)
  );

  // Step 7: Start dashboard / health check
  dashboardService.registerStatus('whatsapp', () => whatsappService.isReady ? 'connected' : 'disconnected');
  dashboardService.registerStatus('whatsapp_auth', () => whatsappService.isAuthenticated ? 'authenticated' : 'not authenticated');
  dashboardService.registerStatus('telegram', () => telegramService.isReady ? 'ready' : 'not ready');
  dashboardService.registerStatus('forum_group', () => telegramService.forumGroupId ? 'configured' : 'not set');
  dashboardService.start();

  // Step 8: Periodic tasks
  setInterval(() => {
    try { mediaHandler.cleanupOldFiles(7); } catch (e) { }
  }, 24 * 60 * 60 * 1000);

  logger.info('✅ Bridge is running!');
  logger.info('Dashboard: http://localhost:' + (process.env.DASHBOARD_PORT || 3001));
}

function setupTelegramHandlers() {
  const bot = telegramService.getBot();

  bot.on('message', async (msg) => {
    try {
      if (!msg.from || msg.from.id.toString() !== config.telegram.adminChatId) return;
      const text = msg.text || '';

      if (text.startsWith('/')) {
        await telegramCommandsHandler.handleCommand(msg);
        return;
      }

      // Handle replies in forum group — send typing indicator to WA
      if (telegramService.forumGroupId &&
        msg.chat.id.toString() === telegramService.forumGroupId.toString() &&
        msg.message_thread_id) {

        // Send typing indicator to WhatsApp while processing
        const { Contact } = require('./database');
        const contact = Contact.findByTopicId(msg.message_thread_id);
        if (contact && contact.wa_id) {
          whatsappService.sendTyping(contact.wa_id).catch(() => { });
        }

        await telegramReplyHandler.handleReply(msg);

        // Clear typing after sending
        if (contact && contact.wa_id) {
          whatsappService.clearTyping(contact.wa_id).catch(() => { });
        }
      }
    } catch (error) {
      logger.error('Error in Telegram handler:', error);
    }
  });

  // Inline keyboard button presses
  bot.on('callback_query', async (query) => {
    try {
      if (!query.from || query.from.id.toString() !== config.telegram.adminChatId) {
        await bot.answerCallbackQuery(query.id, { text: '⛔ Unauthorized', show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);

      const action = query.data;
      if (!action || !action.startsWith('cmd_')) return;
      const command = '/' + action.replace('cmd_', '');

      // Commands that need args: show usage prompt
      const needsArgs = ['/search', '/send', '/alias', '/mute', '/unmute', '/schedule', '/find', '/unarchive', '/cancelschedule'];
      if (needsArgs.includes(command)) {
        const usageHints = {
          '/search': '🔍 Type: <code>/search &lt;name or number&gt;</code>',
          '/send': '📤 Type: <code>/send &lt;phone&gt; &lt;message&gt;</code>',
          '/alias': '🏷 Type: <code>/alias &lt;phone&gt; &lt;nickname&gt;</code>',
          '/mute': '🔇 Type: <code>/mute &lt;phone&gt;</code>',
          '/unmute': '🔊 Type: <code>/unmute &lt;phone&gt;</code>',
          '/schedule': '⏰ Type: <code>/schedule &lt;phone&gt; &lt;time&gt; &lt;message&gt;</code>',
          '/find': '📨 Type: <code>/find &lt;keyword&gt;</code>',
          '/unarchive': '📤 Type: <code>/unarchive &lt;phone&gt;</code>',
          '/cancelschedule': '❌ Type: <code>/cancelschedule &lt;id&gt;</code>',
        };
        await bot.sendMessage(query.message.chat.id, usageHints[command] || 'Type the command with arguments.',
          { parse_mode: 'HTML', message_thread_id: query.message.message_thread_id });
        return;
      }

      const fakeMsg = { ...query.message, from: query.from, text: command, message_thread_id: query.message.message_thread_id };
      await telegramCommandsHandler.handleCommand(fakeMsg);
    } catch (error) {
      logger.error('Error in callback_query handler:', error);
    }
  });

  logger.info('Telegram handlers configured');
}

function setupWhatsAppHandlers() {
  // Core message handlers
  whatsappService.on('message', async (msg) => {
    await incomingHandler.handleMessage(msg);
  });

  whatsappService.on('message_create', async (msg) => {
    await outgoingHandler.handleMessage(msg);
  });

  whatsappService.on('call', async (call) => {
    await callHandler.handleCall(call);
  });

  // Delivery/read receipts
  whatsappService.on('message_ack', async (msg, ack) => {
    await whatsappEventsHandler.handleMessageAck(msg, ack);
  });

  // Reactions
  whatsappService.on('message_reaction', async (reaction) => {
    await whatsappEventsHandler.handleMessageReaction(reaction);
  });

  // Message edits and deletions
  whatsappService.on('message_revoke_everyone', async (after, before) => {
    await whatsappEventsHandler.handleMessageRevoke(after, before);
  });

  whatsappService.on('message_edit', async (msg, newBody, oldBody) => {
    await whatsappEventsHandler.handleMessageEdit(msg, newBody, oldBody);
  });

  // Group events
  whatsappService.on('group_join', async (notification) => {
    await whatsappEventsHandler.handleGroupJoin(notification);
  });

  whatsappService.on('group_leave', async (notification) => {
    await whatsappEventsHandler.handleGroupLeave(notification);
  });

  whatsappService.on('group_update', async (notification) => {
    await whatsappEventsHandler.handleGroupUpdate(notification);
  });

  logger.info('WhatsApp handlers configured');
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(signal + ' received. Shutting down...');
  schedulerService.stop();
  dashboardService.stop();
  try { if (whatsappService.getClient()) await whatsappService.getClient().destroy(); } catch (e) { }
  try { const { closeDatabase } = require('./database'); closeDatabase(); } catch (e) { }
  try { if (telegramService.getBot()) await telegramService.getBot().stopPolling(); } catch (e) { }
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
