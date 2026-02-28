/**
 * Unit tests for database models.
 * These tests use an in-memory SQLite database.
 */

// Setup: override config before any imports
process.env.TELEGRAM_BOT_TOKEN = 'test_token';
process.env.TELEGRAM_ADMIN_CHAT_ID = '123456';
process.env.ADMIN_PASSWORD = 'test_password';
process.env.ENCRYPTION_KEY = 'test_encryption_key_32_chars_xx';
process.env.DB_PATH = ':memory:';

const assert = require('assert');

// We need to manually initialize the database and run migrations
const { getDatabase, closeDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrations');

let db;

function setup() {
    db = getDatabase();
    runMigrations();
}

function teardown() {
    closeDatabase();
}

// ============================
// Contact Model Tests
// ============================

function testContactUpsertAndFind() {
    const Contact = require('../src/database/models/Contact');

    // Create a new contact
    const contact = Contact.upsert({
        waId: '919876543210@c.us',
        phone: '919876543210',
        pushName: 'Test User',
        savedName: 'Saved Name',
        isGroup: false,
    });

    assert(contact, 'Contact should be created');
    assert.strictEqual(contact.wa_id, '919876543210@c.us');
    assert.strictEqual(contact.phone, '919876543210');
    assert.strictEqual(contact.push_name, 'Test User');
    assert.strictEqual(contact.saved_name, 'Saved Name');

    // Find by WA ID
    const found = Contact.findByWaId('919876543210@c.us');
    assert(found, 'Should find contact by WA ID');
    assert.strictEqual(found.wa_id, '919876543210@c.us');

    // Update existing contact
    const updated = Contact.upsert({
        waId: '919876543210@c.us',
        phone: '919876543210',
        pushName: 'New Push Name',
        savedName: null,
        isGroup: false,
    });
    assert.strictEqual(updated.push_name, 'New Push Name');
    assert.strictEqual(updated.saved_name, 'Saved Name'); // Should keep old saved_name (COALESCE)

    console.log('  ✅ Contact upsert and find');
}

function testContactAlias() {
    const Contact = require('../src/database/models/Contact');

    Contact.upsert({ waId: 'alias_test@c.us', phone: '111', pushName: 'Original', isGroup: false });
    Contact.setAlias('alias_test@c.us', 'Boss');
    const found = Contact.findByWaId('alias_test@c.us');
    assert.strictEqual(found.alias, 'Boss');
    assert.strictEqual(Contact.getDisplayName(found), 'Boss'); // Alias takes priority

    console.log('  ✅ Contact alias');
}

function testContactMuteAndArchive() {
    const Contact = require('../src/database/models/Contact');

    Contact.upsert({ waId: 'mute_test@c.us', phone: '222', pushName: 'Muted Guy', isGroup: false });

    Contact.setMuted('mute_test@c.us', true);
    const muted = Contact.getMuted();
    assert(muted.some((c) => c.wa_id === 'mute_test@c.us'), 'Should be in muted list');

    Contact.setArchived('mute_test@c.us', true);
    const archived = Contact.getArchived();
    assert(archived.some((c) => c.wa_id === 'mute_test@c.us'), 'Should be in archived list');

    // Archived contacts shouldn't show in getAll()
    const all = Contact.getAll();
    assert(!all.some((c) => c.wa_id === 'mute_test@c.us'), 'Archived should not be in getAll()');

    console.log('  ✅ Contact mute and archive');
}

function testContactSearch() {
    const Contact = require('../src/database/models/Contact');

    Contact.upsert({ waId: 'search_test@c.us', phone: '333', pushName: 'SearchUser', isGroup: false });
    Contact.setAlias('search_test@c.us', 'FindMe');

    const results = Contact.search('FindMe');
    assert(results.length > 0, 'Should find by alias');

    const results2 = Contact.search('333');
    assert(results2.length > 0, 'Should find by phone');

    console.log('  ✅ Contact search (including alias)');
}

// ============================
// MessageMap Model Tests
// ============================

function testMessageMapCrud() {
    const MessageMap = require('../src/database/models/MessageMap');

    MessageMap.create({
        waMessageId: 'wa_msg_001',
        telegramMessageId: 100,
        telegramChatId: 'chat_001',
        telegramTopicId: 10,
        contactId: 1,
        direction: 'incoming',
        messageType: 'text',
        content: 'Hello world',
    });

    const found = MessageMap.findByWaMessageId('wa_msg_001');
    assert(found, 'Should find by WA message ID');
    assert.strictEqual(found.telegram_message_id, 100);
    assert.strictEqual(found.content, 'Hello world');

    const byTg = MessageMap.findByTelegramMessageId(100, 'chat_001');
    assert(byTg, 'Should find by TG message ID');

    console.log('  ✅ MessageMap CRUD');
}

function testMessageMapSearch() {
    const MessageMap = require('../src/database/models/MessageMap');

    MessageMap.create({
        waMessageId: 'wa_msg_search_001',
        telegramMessageId: 200,
        telegramChatId: 'chat_001',
        telegramTopicId: 10,
        contactId: 1,
        direction: 'incoming',
        messageType: 'text',
        content: 'This is a test message for searching',
    });

    const results = MessageMap.searchContent('test message');
    assert(results.length > 0, 'Should find by content search');

    const count = MessageMap.getCount();
    assert(count > 0, 'Should count messages');

    console.log('  ✅ MessageMap search and count');
}

// ============================
// ScheduledMessage Model Tests
// ============================

function testScheduledMessages() {
    const ScheduledMessage = require('../src/database/models/ScheduledMessage');

    const id = ScheduledMessage.create({
        targetWaId: '919876543210@c.us',
        targetPhone: '919876543210',
        message: 'Scheduled hello!',
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
    });
    assert(id, 'Should create scheduled message');

    const upcoming = ScheduledMessage.getUpcoming();
    assert(upcoming.length > 0, 'Should have upcoming messages');

    // Cancel
    const cancelled = ScheduledMessage.cancel(id);
    assert(cancelled, 'Should cancel successfully');

    const upcoming2 = ScheduledMessage.getUpcoming();
    const stillThere = upcoming2.find((m) => m.id === id);
    assert(!stillThere, 'Cancelled message should not be in upcoming');

    console.log('  ✅ ScheduledMessage CRUD');
}

// ============================
// CallRecord Model Tests
// ============================

function testCallRecords() {
    const CallRecord = require('../src/database/models/CallRecord');
    const Contact = require('../src/database/models/Contact');

    const contact = Contact.upsert({ waId: 'call_test@c.us', phone: '444', pushName: 'Caller', isGroup: false });

    const id = CallRecord.create({
        waId: 'call_001',
        contactId: contact.id,
        callType: 'voice',
        direction: 'incoming',
        duration: 0,
    });
    assert(id, 'Should create call record');

    CallRecord.setTelegramMessageId(id, 999);

    const recent = CallRecord.getRecent(10);
    assert(recent.length > 0, 'Should have recent calls');
    assert.strictEqual(recent[0].push_name, 'Caller');

    console.log('  ✅ CallRecord CRUD');
}

// ============================
// Encryption Service Tests
// ============================

function testEncryption() {
    const encryption = require('../src/services/encryption');

    const plaintext = 'Hello, this is a secret message!';
    const encrypted = encryption.encrypt(plaintext);
    assert(encrypted !== plaintext, 'Encrypted should differ from plaintext');
    assert(encryption.isEncrypted(encrypted), 'Should detect as encrypted');

    const decrypted = encryption.decrypt(encrypted);
    assert.strictEqual(decrypted, plaintext, 'Decrypted should match original');

    // Non-encrypted text should pass through
    const plain = 'Just normal text';
    assert(!encryption.isEncrypted(plain), 'Should not detect as encrypted');
    assert.strictEqual(encryption.decrypt(plain), plain, 'Non-encrypted should pass through');

    // Null handling
    assert.strictEqual(encryption.encrypt(null), null);
    assert.strictEqual(encryption.decrypt(null), null);

    console.log('  ✅ Encryption service');
}

// ============================
// Security Middleware Tests
// ============================

function testSecurityMiddleware() {
    const Security = require('../src/middleware/security');

    // Auth check
    assert(Security.isAuthorizedTelegramUser('123456'), 'Should authorize admin');
    assert(!Security.isAuthorizedTelegramUser('999999'), 'Should reject non-admin');

    // Phone validation
    assert(Security.isValidPhoneNumber('919876543210'), 'Valid phone');
    assert(Security.isValidPhoneNumber('+919876543210'), 'Valid phone with +');
    assert(!Security.isValidPhoneNumber('123'), 'Too short');
    assert(!Security.isValidPhoneNumber('abcdefghij'), 'Non-numeric');

    // File path validation
    assert(!Security.isValidFilePath('/etc/passwd'), 'Should reject outside media dir');

    // Message size check
    assert(Security.checkMessageSize('Hello'), 'Normal text should pass');
    assert(!Security.checkMessageSize('x'.repeat(100000)), 'Huge text should fail');

    // Command sanitization
    assert.strictEqual(Security.sanitizeCommand('hello\0world'), 'helloworld');
    assert.strictEqual(Security.sanitizeCommand(''), '');

    // WA ID validation
    assert(Security.isValidWaId('919876543210@c.us'), 'Valid contact ID');
    assert(Security.isValidWaId('919876543210@g.us'), 'Valid group ID');
    assert(!Security.isValidWaId('invalid'), 'Invalid WA ID');

    console.log('  ✅ Security middleware');
}

// ============================
// Sanitizer Tests
// ============================

function testSanitizer() {
    const { escapeHTML, sanitizeContactName, sanitizePhoneNumber, safeFilename } = require('../src/utils/sanitizer');

    assert.strictEqual(escapeHTML('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.strictEqual(escapeHTML(''), '');
    assert.strictEqual(escapeHTML(null), '');

    assert.strictEqual(sanitizeContactName(''), 'Unknown');
    assert.strictEqual(sanitizeContactName(null), 'Unknown');
    assert.strictEqual(sanitizeContactName('John'), 'John');

    assert.strictEqual(sanitizePhoneNumber('+91-9876-543210'), '+919876543210');

    const safe = safeFilename('../../../etc/passwd');
    assert(!safe.includes('..'), 'Should remove path traversal');

    console.log('  ✅ Sanitizer functions');
}

// ============================
// Run all tests
// ============================

function runTests() {
    console.log('\n🧪 Running tests...\n');

    setup();

    let passed = 0;
    let failed = 0;
    const tests = [
        ['Contact upsert and find', testContactUpsertAndFind],
        ['Contact alias', testContactAlias],
        ['Contact mute and archive', testContactMuteAndArchive],
        ['Contact search', testContactSearch],
        ['MessageMap CRUD', testMessageMapCrud],
        ['MessageMap search', testMessageMapSearch],
        ['ScheduledMessage CRUD', testScheduledMessages],
        ['CallRecord CRUD', testCallRecords],
        ['Encryption service', testEncryption],
        ['Security middleware', testSecurityMiddleware],
        ['Sanitizer functions', testSanitizer],
    ];

    for (const [name, fn] of tests) {
        try {
            fn();
            passed++;
        } catch (error) {
            console.log('  ❌ ' + name + ': ' + error.message);
            failed++;
        }
    }

    teardown();

    console.log('\n' + '='.repeat(40));
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('='.repeat(40) + '\n');

    if (failed > 0) process.exit(1);
}

runTests();
