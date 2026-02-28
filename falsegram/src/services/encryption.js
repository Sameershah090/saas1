const crypto = require('crypto');
const { config } = require('../config');
const logger = require('../utils/logger');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const ENCODING = 'base64';

class EncryptionService {
    constructor() {
        this._key = null;
    }

    /**
     * Derive a 32-byte key from the configured encryption key using SHA-256.
     */
    _getKey() {
        if (!this._key) {
            this._key = crypto.createHash('sha256').update(config.security.encryptionKey).digest();
        }
        return this._key;
    }

    /**
     * Encrypt a plaintext string. Returns base64-encoded ciphertext with IV + tag prepended.
     */
    encrypt(plaintext) {
        if (!plaintext) return plaintext;
        try {
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ALGORITHM, this._getKey(), iv);
            let encrypted = cipher.update(plaintext, 'utf8', ENCODING);
            encrypted += cipher.final(ENCODING);
            const tag = cipher.getAuthTag();

            // Format: base64(iv) + ':' + base64(tag) + ':' + base64(ciphertext)
            return iv.toString(ENCODING) + ':' + tag.toString(ENCODING) + ':' + encrypted;
        } catch (error) {
            logger.error('Encryption failed:', error);
            return plaintext; // Fallback to plaintext on error
        }
    }

    /**
     * Decrypt an encrypted string. Returns the original plaintext.
     */
    decrypt(encryptedText) {
        if (!encryptedText) return encryptedText;
        try {
            const parts = encryptedText.split(':');
            if (parts.length !== 3) return encryptedText; // Not encrypted, return as-is

            const iv = Buffer.from(parts[0], ENCODING);
            const tag = Buffer.from(parts[1], ENCODING);
            const ciphertext = parts[2];

            if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
                return encryptedText; // Not a valid encrypted string
            }

            const decipher = crypto.createDecipheriv(ALGORITHM, this._getKey(), iv);
            decipher.setAuthTag(tag);
            let decrypted = decipher.update(ciphertext, ENCODING, 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            // Likely not encrypted or wrong key — return as-is
            return encryptedText;
        }
    }

    /**
     * Check if a string looks like it's been encrypted by this service.
     */
    isEncrypted(text) {
        if (!text || typeof text !== 'string') return false;
        const parts = text.split(':');
        if (parts.length !== 3) return false;
        try {
            const iv = Buffer.from(parts[0], ENCODING);
            const tag = Buffer.from(parts[1], ENCODING);
            return iv.length === IV_LENGTH && tag.length === TAG_LENGTH;
        } catch {
            return false;
        }
    }
}

module.exports = new EncryptionService();
