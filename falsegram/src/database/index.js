const { getDatabase, closeDatabase } = require('./connection');
const Contact = require('./models/Contact');
const MessageMap = require('./models/MessageMap');
const CallRecord = require('./models/CallRecord');
const ScheduledMessage = require('./models/ScheduledMessage');
const ReactionMap = require('./models/ReactionMap');

module.exports = { getDatabase, closeDatabase, Contact, MessageMap, CallRecord, ScheduledMessage, ReactionMap };
