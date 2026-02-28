const { ScheduledMessage } = require('../database');
const logger = require('../utils/logger');

class SchedulerService {
    constructor() {
        this.interval = null;
        this.sendCallback = null;
        this.notifyCallback = null;
    }

    /**
     * Start the scheduler loop. Checks for pending messages every 30 seconds.
     * @param {Function} sendCallback - async function(targetWaId, message) to send messages
     * @param {Function} notifyCallback - async function(text) to notify admin
     */
    start(sendCallback, notifyCallback) {
        this.sendCallback = sendCallback;
        this.notifyCallback = notifyCallback;

        this.interval = setInterval(() => {
            this._processPending().catch((err) => {
                logger.error('Scheduler error:', err);
            });
        }, 30000); // Check every 30 seconds

        logger.info('Scheduler started (30s interval)');
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger.info('Scheduler stopped');
        }
    }

    async _processPending() {
        const pending = ScheduledMessage.getPending();
        for (const msg of pending) {
            try {
                if (!this.sendCallback) {
                    logger.warn('Scheduler: no send callback configured');
                    return;
                }
                await this.sendCallback(msg.target_wa_id, msg.message);
                ScheduledMessage.markSent(msg.id);
                logger.info('Scheduled message sent: ID ' + msg.id + ' to ' + msg.target_phone);

                if (this.notifyCallback) {
                    await this.notifyCallback(
                        '⏰ <b>Scheduled message sent!</b>\n' +
                        '📱 To: +' + (msg.target_phone || 'Unknown') + '\n' +
                        '💬 ' + msg.message.substring(0, 100) + (msg.message.length > 100 ? '...' : '')
                    );
                }
            } catch (error) {
                ScheduledMessage.markFailed(msg.id);
                logger.error('Failed to send scheduled message ID ' + msg.id + ':', error);

                if (this.notifyCallback) {
                    try {
                        await this.notifyCallback(
                            '❌ <b>Scheduled message failed!</b>\n' +
                            '📱 To: +' + (msg.target_phone || 'Unknown') + '\n' +
                            '⚠️ Check logs for details.'
                        );
                    } catch (e) { }
                }
            }
        }
    }

    /**
     * Schedule a new message.
     */
    schedule(targetWaId, targetPhone, message, scheduledAt) {
        return ScheduledMessage.create({
            targetWaId,
            targetPhone,
            message,
            scheduledAt,
        });
    }
}

module.exports = new SchedulerService();
