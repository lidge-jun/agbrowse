// @ts-check
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    encryptState,
    decryptState,
    isEncryptedState,
    readStateFile,
    writeStateFile,
} from '../../web-ai/state-encryption.mjs';

const testKey = randomBytes(32);
const testDir = mkdtempSync(join(tmpdir(), 'agb-enc-test-'));

describe('state-encryption (H-009)', () => {
    it('encrypts and decrypts round-trip', () => {
        const plaintext = JSON.stringify({ sessions: [], version: 1 });
        const encrypted = encryptState(plaintext, testKey);
        expect(isEncryptedState(encrypted)).toBe(true);
        expect(encrypted).toMatch(/^agb-enc-v1:/);
        const decrypted = decryptState(encrypted, testKey);
        expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
        const plaintext = 'test data';
        const a = encryptState(plaintext, testKey);
        const b = encryptState(plaintext, testKey);
        expect(a).not.toBe(b);
        expect(decryptState(a, testKey)).toBe(plaintext);
        expect(decryptState(b, testKey)).toBe(plaintext);
    });

    it('rejects wrong key', () => {
        const encrypted = encryptState('secret', testKey);
        const wrongKey = randomBytes(32);
        expect(() => decryptState(encrypted, wrongKey)).toThrow();
    });

    it('rejects tampered ciphertext', () => {
        const encrypted = encryptState('secret', testKey);
        const tampered = encrypted.slice(0, -2) + 'XX';
        expect(() => decryptState(tampered, testKey)).toThrow();
    });

    it('readStateFile handles plaintext (migration)', () => {
        const path = join(testDir, 'plain.json');
        writeFileSync(path, '{"version":1}');
        const content = readStateFile(path, testKey);
        expect(content).toBe('{"version":1}');
    });

    it('writeStateFile + readStateFile round-trip', () => {
        const path = join(testDir, 'encrypted.json');
        const data = '{"sessions":[]}';
        writeStateFile(path, data, testKey);
        const raw = readFileSync(path, 'utf8');
        expect(isEncryptedState(raw)).toBe(true);
        const decrypted = readStateFile(path, testKey);
        expect(decrypted).toBe(data);
    });
});
