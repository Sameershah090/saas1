const { config } = require('../config');
const path = require('path');

class SecurityMiddleware {
  /**
   * Check if a Telegram user ID matches the authorized admin.
   */
  static isAuthorizedTelegramUser(userId) {
    return userId.toString() === config.telegram.adminChatId;
  }

  /**
   * Validate that a file path is within the allowed media directory.
   * Prevents path traversal attacks.
   */
  static isValidFilePath(filePath) {
    const resolved = path.resolve(filePath);
    const mediaDir = path.resolve(config.paths.media);
    return resolved.startsWith(mediaDir + path.sep) || resolved === mediaDir;
  }

  /**
   * Validate a phone number: 7-15 digits only.
   */
  static isValidPhoneNumber(phone) {
    const cleaned = phone.replace(/[^\d+]/g, '');
    return /^\+?\d{7,15}$/.test(cleaned);
  }

  /**
   * Check that a message doesn't exceed the maximum allowed size.
   */
  static checkMessageSize(text) {
    const MAX_MESSAGE_SIZE = 65536;
    return !(text && text.length > MAX_MESSAGE_SIZE);
  }

  /**
   * Sanitize a command/text input: strip null bytes, limit length.
   */
  static sanitizeCommand(text) {
    if (!text) return '';
    return text
      .replace(/\0/g, '')           // remove null bytes
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // remove control chars (keep \n, \r, \t)
      .trim()
      .substring(0, 4096);          // hard limit
  }

  /**
   * Check if encryption key meets minimum security requirements.
   */
  static isSecureEncryptionKey(key) {
    if (!key || key.length < 16) return false;
    const defaults = ['default_key_change_in_production!', 'change_this_to_random_32_chars!!'];
    if (defaults.includes(key)) return false;
    return true;
  }

  /**
   * Validate a WhatsApp ID format.
   */
  static isValidWaId(waId) {
    if (!waId || typeof waId !== 'string') return false;
    return /^\d+@[cg]\.us$/.test(waId);
  }
}

module.exports = SecurityMiddleware;
