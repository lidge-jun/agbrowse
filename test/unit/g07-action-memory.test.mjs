// @ts-check
import { describe, it, expect } from 'vitest';
import {
    createActionMemory,
    validateMemoryHit,
    actionMemoryKey,
    ACTION_MEMORY_SCHEMA_VERSION,
} from '../../web-ai/action-memory.mjs';

describe('G07 — action memory cache', () => {
    it('stores and retrieves by (origin,intent,signature)', () => {
        const m = createActionMemory();
        const e = m.put({
            origin: 'https://x.test',
            intentId: 'send.click',
            signature: 'sig-A',
            ref: '@e3',
            hits: 0,
            validations: { ok: 0, fail: 0 },
            lastGoodAt: '',
        });
        expect(e.ref).toBe('@e3');
        const got = m.get('https://x.test', 'send.click', 'sig-A');
        expect(got && got.ref).toBe('@e3');
    });

    it('returns null on signature drift (safe-replay invariant)', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://x.test', intentId: 'send.click', signature: 'sig-A', ref: '@e3', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        const stale = m.get('https://x.test', 'send.click', 'sig-B');
        expect(stale).toBeNull();
    });

    it('validateMemoryHit guards against signature drift', () => {
        const m = createActionMemory();
        const entry = m.put({ origin: 'https://x.test', intentId: 'send.click', signature: 'sig-A', ref: '@e3', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        expect(validateMemoryHit(entry, 'sig-A')).toEqual(entry);
        expect(validateMemoryHit(entry, 'sig-B')).toBeNull();
        expect(validateMemoryHit(null, 'sig-A')).toBeNull();
    });

    it('records replay outcomes', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://x.test', intentId: 'send.click', signature: 'sig-A', ref: '@e3', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        m.recordReplay('https://x.test', 'send.click', 'sig-A', 'ok');
        m.recordReplay('https://x.test', 'send.click', 'sig-A', 'ok');
        m.recordReplay('https://x.test', 'send.click', 'sig-A', 'fail');
        const e = m.get('https://x.test', 'send.click', 'sig-A');
        expect(e && e.hits).toBe(2);
        expect(e && e.validations).toEqual({ ok: 2, fail: 1 });
    });

    it('lists by origin and clears', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://a.test', intentId: 'i1', signature: 's1', ref: '@e1', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        m.put({ origin: 'https://b.test', intentId: 'i2', signature: 's2', ref: '@e2', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        expect(m.list().length).toBe(2);
        expect(m.list('https://a.test').length).toBe(1);
        m.clear();
        expect(m.size()).toBe(0);
    });

    it('snapshot/restore round-trips', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://x.test', intentId: 'i', signature: 's', ref: '@e1', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        const snap = m.snapshot();
        expect(snap.schemaVersion).toBe(ACTION_MEMORY_SCHEMA_VERSION);
        const m2 = createActionMemory({ initial: snap });
        expect(m2.size()).toBe(1);
        expect(m2.get('https://x.test', 'i', 's')).toBeTruthy();
    });

    it('rejects malformed put input', () => {
        const m = createActionMemory();
        expect(() => m.put(/** @type {any} */({ origin: 'x' }))).toThrow();
    });

    it('actionMemoryKey is stable', () => {
        expect(actionMemoryKey('https://x.test', 'send.click', 'sig-A')).toBe('https://x.test::send.click::sig-A');
    });
});
