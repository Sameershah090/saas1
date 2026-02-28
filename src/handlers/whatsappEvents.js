const telegramService = require('../services/telegram');
const whatsappService = require('../services/whatsapp');
const messageMapper = require('../services/messageMapper');
const { MessageMap, Contact, ReactionMap } = require('../database');
const logger = require('../utils/logger');
const { escapeHTML } = require('../utils/sanitizer');

class WhatsAppEventsHandler {
    /**
     * Handle message acknowledgment (delivery/read receipts).
     * ack values: -1 = error, 0 = pending, 1 = sent, 2 = delivered, 3 = read, 4 = played
     */
    async handleMessageAck(msg, ack) {
        try {
            if (!msg.fromMe) return; // Only track our own messages

            const mapped = MessageMap.findByWaMessageId(msg.id._serialized);
            if (!mapped) return;

            const chatId = telegramService.forumGroupId || telegramService.adminChatId;
            let emoji = null;

            switch (ack) {
                case 2: emoji = '✅'; break;  // Delivered
                case 3: emoji = '👀'; break;  // Read
                case 4: emoji = '🔊'; break; // Played (voice/video)
                default: return;
            }

            if (emoji) {
                try {
                    await telegramService.getBot().setMessageReaction(chatId, mapped.telegram_message_id, {
                        reaction: [{ type: 'emoji', emoji }],
                    });
                } catch (e) {
                    // Some messages might not support reactions in TG
                }
            }
        } catch (error) {
            logger.error('Error handling message ack:', error);
        }
    }

    /**
     * Handle message reactions from WhatsApp.
     */
    async handleMessageReaction(reaction) {
        try {
            const msgId = reaction.msgId._serialized;
            const mapped = MessageMap.findByWaMessageId(msgId);
            if (!mapped) return;

            const chatId = telegramService.forumGroupId || telegramService.adminChatId;
            const senderWaId = reaction.senderId;
            const emoji = reaction.reaction;

            if (emoji) {
                // Reaction added
                try {
                    ReactionMap.create({
                        waMessageId: msgId,
                        telegramMessageId: mapped.telegram_message_id,
                        telegramChatId: chatId.toString(),
                        emoji,
                        senderWaId,
                    });

                    // Set reaction on TG message
                    await telegramService.getBot().setMessageReaction(chatId, mapped.telegram_message_id, {
                        reaction: [{ type: 'emoji', emoji }],
                    });
                } catch (e) {
                    // Emoji might not be supported by TG
                    logger.debug('Could not set reaction on TG message:', e.message);
                }
            } else {
                // Reaction removed
                ReactionMap.deleteByWaMessageId(msgId, senderWaId);
                try {
                    await telegramService.getBot().setMessageReaction(chatId, mapped.telegram_message_id, {
                        reaction: [],
                    });
                } catch (e) { }
            }
        } catch (error) {
            logger.error('Error handling message reaction:', error);
        }
    }

    /**
     * Handle message deletion (revoke for everyone).
     */
    async handleMessageRevoke(after, before) {
        try {
            if (!before) return;

            const mapped = MessageMap.findByWaMessageId(before.id._serialized);
            if (!mapped) return;

            const chatId = telegramService.forumGroupId || telegramService.adminChatId;

            // Get sender info
            let senderName = 'Someone';
            if (before.fromMe) {
                senderName = 'You';
            } else {
                try {
                    const contactInfo = await whatsappService.getContactInfo(before.from);
                    const contact = Contact.findByWaId(before.from);
                    senderName = Contact.getDisplayName(contact || contactInfo);
                } catch (e) { }
            }

            // Send notification about deletion
            const text = '🗑 <b>' + escapeHTML(senderName) + '</b> deleted a message';
            try {
                await telegramService.getBot().sendMessage(chatId, text, {
                    parse_mode: 'HTML',
                    message_thread_id: mapped.telegram_topic_id,
                    reply_to_message_id: mapped.telegram_message_id,
                });
            } catch (e) {
                // Fallback: just send without reply
                await telegramService.sendMessageToTopic(mapped.telegram_topic_id, text);
            }
        } catch (error) {
            logger.error('Error handling message revoke:', error);
        }
    }

    /**
     * Handle message edits.
     */
    async handleMessageEdit(msg, newBody, oldBody) {
        try {
            const mapped = MessageMap.findByWaMessageId(msg.id._serialized);
            if (!mapped) return;

            const chatId = telegramService.forumGroupId || telegramService.adminChatId;

            let senderName = 'Someone';
            if (msg.fromMe) {
                senderName = 'You';
            } else {
                try {
                    const contact = Contact.findByWaId(msg.from);
                    if (contact) senderName = Contact.getDisplayName(contact);
                } catch (e) { }
            }

            const text =
                '✏️ <b>' + escapeHTML(senderName) + '</b> edited a message:\n' +
                '<s>' + escapeHTML(oldBody || '').substring(0, 200) + '</s>\n' +
                '➡️ ' + escapeHTML(newBody || '').substring(0, 500);

            try {
                await telegramService.getBot().sendMessage(chatId, text, {
                    parse_mode: 'HTML',
                    message_thread_id: mapped.telegram_topic_id,
                    reply_to_message_id: mapped.telegram_message_id,
                });
            } catch (e) {
                await telegramService.sendMessageToTopic(mapped.telegram_topic_id, text);
            }

            // Update stored content
            try {
                const { getDatabase } = require('../database/connection');
                const db = getDatabase();
                db.prepare('UPDATE message_map SET content = ? WHERE wa_message_id = ?').run(newBody, msg.id._serialized);
            } catch (e) { }
        } catch (error) {
            logger.error('Error handling message edit:', error);
        }
    }

    /**
     * Handle group member join.
     */
    async handleGroupJoin(notification) {
        try {
            const chat = await notification.getChat();
            const contact = Contact.findByWaId(chat.id._serialized);
            if (!contact || !contact.telegram_topic_id) return;

            const addedIds = notification.recipientIds || [];
            const addedNames = [];

            for (const id of addedIds) {
                try {
                    const info = await whatsappService.getContactInfo(id);
                    addedNames.push(info.savedName || info.pushName || info.phone || id);
                } catch (e) {
                    addedNames.push(id);
                }
            }

            if (addedNames.length > 0) {
                const text = '👥➕ <b>' + addedNames.map(escapeHTML).join(', ') + '</b> joined the group';
                await telegramService.sendMessageToTopic(contact.telegram_topic_id, text);
            }
        } catch (error) {
            logger.error('Error handling group join:', error);
        }
    }

    /**
     * Handle group member leave.
     */
    async handleGroupLeave(notification) {
        try {
            const chat = await notification.getChat();
            const contact = Contact.findByWaId(chat.id._serialized);
            if (!contact || !contact.telegram_topic_id) return;

            const removedIds = notification.recipientIds || [];
            const removedNames = [];

            for (const id of removedIds) {
                try {
                    const info = await whatsappService.getContactInfo(id);
                    removedNames.push(info.savedName || info.pushName || info.phone || id);
                } catch (e) {
                    removedNames.push(id);
                }
            }

            if (removedNames.length > 0) {
                const text = '👥➖ <b>' + removedNames.map(escapeHTML).join(', ') + '</b> left the group';
                await telegramService.sendMessageToTopic(contact.telegram_topic_id, text);
            }
        } catch (error) {
            logger.error('Error handling group leave:', error);
        }
    }

    /**
     * Handle group info updates (name, description, picture changes).
     */
    async handleGroupUpdate(notification) {
        try {
            const chat = await notification.getChat();
            const contact = Contact.findByWaId(chat.id._serialized);
            if (!contact || !contact.telegram_topic_id) return;

            let text = '👥🔄 <b>Group updated</b>';

            if (notification.type === 'subject') {
                text = '👥🔄 Group renamed to: <b>' + escapeHTML(chat.name || 'Unknown') + '</b>';
                Contact.upsert({
                    waId: chat.id._serialized,
                    phone: null,
                    pushName: null,
                    savedName: null,
                    isGroup: true,
                    groupName: chat.name,
                });
            } else if (notification.type === 'description') {
                text = '👥🔄 Group description updated';
            }

            await telegramService.sendMessageToTopic(contact.telegram_topic_id, text);
        } catch (error) {
            logger.error('Error handling group update:', error);
        }
    }
}

module.exports = new WhatsAppEventsHandler();
