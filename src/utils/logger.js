const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');

const logDir = path.resolve(config.paths.logs);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Custom format that redacts sensitive data (bot tokens, passwords) from logs.
 */
const redactSensitive = winston.format((info) => {
  const botToken = config.telegram.botToken;
  const password = config.security.adminPassword;

  const redact = (obj) => {
    if (typeof obj === 'string') {
      let result = obj;
      if (botToken) result = result.split(botToken).join('[REDACTED_TOKEN]');
      if (password && password.length > 3) result = result.split(password).join('[REDACTED]');
      return result;
    }
    return obj;
  };

  if (info.message) info.message = redact(info.message);
  if (info.stack) info.stack = redact(info.stack);

  // Redact in any additional meta properties
  for (const key of Object.keys(info)) {
    if (typeof info[key] === 'string' && key !== 'level' && key !== 'timestamp' && key !== 'service') {
      info[key] = redact(info[key]);
    }
  }

  return info;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    redactSensitive(),
    winston.format.json()
  ),
  defaultMeta: { service: 'wa-tg-bridge' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 10,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        redactSensitive(),
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

module.exports = logger;
