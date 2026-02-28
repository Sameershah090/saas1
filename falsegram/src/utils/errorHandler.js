const logger = require('./logger');

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

function handleError(error, context = '') {
  const prefix = context ? '[' + context + '] ' : '';
  if (error instanceof AppError && error.isOperational) {
    logger.warn(prefix + 'Operational error: ' + error.message);
  } else {
    logger.error(prefix + 'Unexpected error: ' + error.message, {
      stack: error.stack,
      context,
    });
  }
}

/**
 * Returns a sanitized error message safe to send to end users.
 * Strips stack traces, file paths, and internal details.
 */
function getSafeErrorMessage(error) {
  if (error instanceof AppError && error.isOperational) {
    return error.message;
  }
  // Generic message for unexpected errors — don't leak internals
  return 'An internal error occurred. Check server logs for details.';
}

function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
    // Give logger time to flush then exit
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', {
      reason: reason?.message || String(reason),
      stack: reason?.stack,
    });
    // Don't crash on unhandled rejections — log and continue
  });
}

module.exports = { AppError, handleError, getSafeErrorMessage, setupGlobalErrorHandlers };
