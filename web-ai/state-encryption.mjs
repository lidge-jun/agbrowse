// @ts-check

/**
 * AES-256-GCM encryption/decryption for session state files.
 *
 * Key source priority:
 * 1. AGBROWSE_STATE_KEY environment variable (hex-encoded 32 bytes)
 * 2. Auto-generated key stored at BROWSER_AGENT_HOME/state.key
 *
 * Encrypted files start with the magic bytes "agb-enc-v1:" followed by
 * base64-encoded iv:authTag:ciphertext. Plaintext files (migration) are
 * detected and read as-is, then re-written encrypted on next save.
 *
 * @module state-encryption
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAGIC_PREFIX = 'agb-enc-v1:';

/**
 * Get or create the encryption key.
 * @returns {Buffer}
 */
export function getEncryptionKey() {
    const envKey = process.env.AGBROWSE_STATE_KEY;
    if (envKey) {
        const buf = Buffer.from(envKey, 'hex');
        if (buf.length !== KEY_BYTES) {
            throw new Error('AGBROWSE_STATE_KEY must be 64 hex characters (32 bytes)');
        }
        return buf;
    }

    const home = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
    const keyPath = join(home, 'state.key');

    if (existsSync(keyPath)) {
        const hex = readFileSync(keyPath, 'utf8').trim();
        const buf = Buffer.from(hex, 'hex');
        if (buf.length === KEY_BYTES) return buf;
    }

    // Generate new key
    mkdirSync(home, { recursive: true });
    const key = randomBytes(KEY_BYTES);
    writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    return key;
}

/**
 * Encrypt plaintext string to the agb-enc-v1 format.
 * @param {string} plaintext
 * @param {Buffer} [key]
 * @returns {string}
 */
export function encryptState(plaintext, key) {
    const k = key || getEncryptionKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, k, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
    return MAGIC_PREFIX + payload;
}

/**
 * Decrypt an agb-enc-v1 encrypted string.
 * @param {string} encrypted
 * @param {Buffer} [key]
 * @returns {string}
 */
export function decryptState(encrypted, key) {
    if (!encrypted.startsWith(MAGIC_PREFIX)) {
        throw new Error('Not an encrypted state file');
    }
    const k = key || getEncryptionKey();
    const payload = Buffer.from(encrypted.slice(MAGIC_PREFIX.length), 'base64');
    const iv = payload.subarray(0, IV_BYTES);
    const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, k, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Check if a string is encrypted (starts with magic prefix).
 * @param {string} content
 * @returns {boolean}
 */
export function isEncryptedState(content) {
    return content.startsWith(MAGIC_PREFIX);
}

/**
 * Read a state file, transparently decrypting if needed.
 * Supports migration: plaintext JSON files are read as-is.
 * @param {string} filePath
 * @param {Buffer} [key]
 * @returns {string} the plaintext content
 */
export function readStateFile(filePath, key) {
    const content = readFileSync(filePath, 'utf8');
    if (isEncryptedState(content)) {
        return decryptState(content, key);
    }
    // Plaintext — transparent migration
    return content;
}

/**
 * Write a state file with encryption.
 * @param {string} filePath
 * @param {string} plaintext
 * @param {Buffer} [key]
 */
export function writeStateFile(filePath, plaintext, key) {
    const encrypted = encryptState(plaintext, key);
    writeFileSync(filePath, encrypted);
}
