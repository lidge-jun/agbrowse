import { describe, expect, it } from 'vitest';
import {
    normalizeFailureStage,
    redactDiagnosticText,
    emptyDiagnostics,
    toWebAiErrorEnvelope,
} from '../../web-ai/failure-diagnostics.mjs';
import { WebAiError } from '../../web-ai/errors.mjs';

// Parity catalog 201 #6 (P2): richer diagnostics stage taxonomy + stage-typed envelope.
describe('web-ai failure diagnostics taxonomy (201#6 enrichment)', () => {
    it('normalizeFailureStage keeps known stages, falls back to unknown', () => {
        expect(normalizeFailureStage('send-click')).toBe('send-click');
        expect(normalizeFailureStage('commit-verify')).toBe('commit-verify'); // 105.7 happy-path label
        expect(normalizeFailureStage('not-a-stage')).toBe('unknown');
        expect(normalizeFailureStage(42)).toBe('unknown');
    });

    it('redactDiagnosticText scrubs secrets, strips code fences, and caps length', () => {
        const out = redactDiagnosticText('token bearer abc123 sk-abcdefgh12345 a@b.com DEADBEEFDEADBEEFDEADBEEFDEADBEEF');
        expect(out).toMatch(/bearer \[redacted\]/);
        expect(out).toMatch(/sk-\[redacted\]/);
        expect(out).toMatch(/\[email redacted\]/);
        expect(out).toMatch(/\[hex redacted\]/);
        expect(redactDiagnosticText('a```secret```b', { stripCodeFences: true })).toBe('a[code redacted]b');
        expect(redactDiagnosticText('x'.repeat(200), { maxChars: 64 })).toMatch(/…\[truncated\]$/);
    });

    it('emptyDiagnostics returns the richer envelope shape', () => {
        const d = emptyDiagnostics('poll-timeout');
        expect(d.stage).toBe('poll-timeout');
        expect(d.selectorCounts).toEqual({});
        expect(d.sendButtonStates).toEqual([]);
        expect(d.conversationTurnCount).toBe(0);
        expect(d.stopVisible).toBe(false);
    });

    it('toWebAiErrorEnvelope preserves a typed WebAiError shape + stage', () => {
        const err = new WebAiError({ errorCode: 'provider.composer-not-visible', stage: 'composer-prereq', retryHint: 'retry', vendor: 'chatgpt', message: 'composer missing' });
        const env = toWebAiErrorEnvelope(err, 'unknown', emptyDiagnostics('composer-prereq'));
        expect(env.ok).toBe(false);
        expect(env.stage).toBe('composer-prereq');
        expect(env.errorCode).toBe('provider.composer-not-visible');
        expect(env.retryHint).toBe('retry');
        expect(env.vendor).toBe('chatgpt');
        expect(env.diagnostics.stage).toBe('composer-prereq');
    });

    it('toWebAiErrorEnvelope handles a plain error with a fallback stage', () => {
        const env = toWebAiErrorEnvelope(new Error('boom'), 'send-click');
        expect(env).toMatchObject({ ok: false, error: 'boom', stage: 'send-click' });
        expect(env.errorCode).toBeUndefined();
    });
});
