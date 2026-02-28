const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mime = require('mime-types');
const { config } = require('../config');
const logger = require('../utils/logger');
const { safeFilename } = require('../utils/sanitizer');

class MediaHandler {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = [
      path.join(config.paths.media, 'incoming'),
      path.join(config.paths.media, 'outgoing'),
      path.join(config.paths.media, 'temp'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async saveMedia(messageMedia, messageId, direction = 'incoming') {
    try {
      const mimeType = messageMedia.mimetype;
      const extension = mime.extension(mimeType) || 'bin';
      const filename = safeFilename(messageId + '_' + Date.now() + '.' + extension);
      const dir = path.join(config.paths.media, direction);
      const filePath = path.join(dir, filename);

      const buffer = Buffer.from(messageMedia.data, 'base64');
      const sizeMB = buffer.length / (1024 * 1024);

      if (sizeMB > config.rateLimit.maxMediaSizeMB) {
        logger.warn('Media too large: ' + sizeMB.toFixed(2) + 'MB');
        return null;
      }

      fs.writeFileSync(filePath, buffer);
      logger.info('Media saved: ' + filename + ' (' + sizeMB.toFixed(2) + 'MB)');

      return { filePath, filename, mimeType, extension, size: buffer.length, sizeMB: sizeMB.toFixed(2) };
    } catch (error) {
      logger.error('Error saving media:', error);
      return null;
    }
  }

  async convertStickerToPng(stickerPath) {
    try {
      const outputPath = stickerPath.replace(/\.\w+$/, '.png');
      await sharp(stickerPath).png().toFile(outputPath);
      return outputPath;
    } catch (error) {
      logger.error('Error converting sticker:', error);
      return stickerPath;
    }
  }

  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      logger.error('Error cleaning up file:', error);
    }
  }

  cleanupOldFiles(maxAgeDays = 7) {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;

    for (const dir of ['incoming', 'outgoing', 'temp']) {
      const dirPath = path.join(config.paths.media, dir);
      if (!fs.existsSync(dirPath)) continue;
      for (const file of fs.readdirSync(dirPath)) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) logger.info('Cleaned up ' + cleaned + ' old media files');
  }

  getMediaType(mimeType) {
    if (!mimeType) return 'document';
    if (mimeType.startsWith('image/')) {
      if (mimeType === 'image/webp') return 'sticker';
      if (mimeType === 'image/gif') return 'animation';
      return 'photo';
    }
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) {
      if (mimeType === 'audio/ogg; codecs=opus') return 'voice';
      return 'audio';
    }
    return 'document';
  }
}

module.exports = new MediaHandler();
