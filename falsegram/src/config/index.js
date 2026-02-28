require('dotenv').config();
const path = require('path');

const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '', // Optional: set for webhook mode
  },
  security: {
    adminPassword: process.env.ADMIN_PASSWORD || 'changeme',
    encryptionKey: process.env.ENCRYPTION_KEY || 'default_key_change_in_production!',
  },
  paths: {
    media: process.env.MEDIA_DIR || path.join(__dirname, '../../media'),
    db: process.env.DB_PATH || path.join(__dirname, '../../data/bridge.db'),
    logs: process.env.LOG_DIR || path.join(__dirname, '../../logs'),
    waSession: process.env.WA_SESSION_DIR || path.join(__dirname, '../../wa_session'),
  },
  rateLimit: {
    maxMessagesPerMinute: parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 30,
    maxMediaSizeMB: parseInt(process.env.MAX_MEDIA_SIZE_MB) || 50,
  },
  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT) || 3001,
    enabled: process.env.DASHBOARD_ENABLED !== 'false', // Enabled by default
  },
};

const WEAK_PASSWORDS = ['changeme', 'password', '123456', 'admin', 'test', ''];
const DEFAULT_KEYS = ['default_key_change_in_production!', 'change_this_to_random_32_chars!!'];

function validateConfig() {
  const missing = [];
  if (!config.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.telegram.adminChatId) missing.push('TELEGRAM_ADMIN_CHAT_ID');
  if (missing.length > 0) {
    throw new Error('Missing required configuration: ' + missing.join(', '));
  }

  if (!/^\d+$/.test(config.telegram.adminChatId)) {
    throw new Error('TELEGRAM_ADMIN_CHAT_ID must be a numeric value');
  }

  const warnings = [];
  if (WEAK_PASSWORDS.includes(config.security.adminPassword)) {
    warnings.push('⚠️  ADMIN_PASSWORD is weak or default. Change it in .env!');
  }
  if (DEFAULT_KEYS.includes(config.security.encryptionKey)) {
    warnings.push('⚠️  ENCRYPTION_KEY is default. Set a random 32+ char string in .env!');
  }
  if (config.security.encryptionKey.length < 16) {
    warnings.push('⚠️  ENCRYPTION_KEY is too short (< 16 chars). Use 32+ characters.');
  }
  if (warnings.length > 0) {
    console.warn('\n' + '='.repeat(50));
    console.warn('  SECURITY WARNINGS');
    console.warn('='.repeat(50));
    warnings.forEach((w) => console.warn(w));
    console.warn('='.repeat(50) + '\n');
  }
}

module.exports = { config, validateConfig };
