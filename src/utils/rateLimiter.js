const { config } = require('../config');
const logger = require('./logger');

class RateLimiter {
  constructor() {
    this.windows = new Map();
    this.maxPerMinute = config.rateLimit.maxMessagesPerMinute;
  }

  canProceed(identifier) {
    const now = Date.now();
    const windowStart = now - 60000;
    if (!this.windows.has(identifier)) {
      this.windows.set(identifier, []);
    }
    const timestamps = this.windows.get(identifier);
    const valid = timestamps.filter((ts) => ts > windowStart);
    this.windows.set(identifier, valid);
    if (valid.length >= this.maxPerMinute) {
      logger.warn('Rate limit hit for: ' + identifier);
      return false;
    }
    valid.push(now);
    return true;
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - 60000;
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((ts) => ts > windowStart);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }
}

const rateLimiter = new RateLimiter();
setInterval(() => rateLimiter.cleanup(), 300000);
module.exports = rateLimiter;
