import { describe, expect, it } from 'vitest';
import { contextError, providerError, toErrorJson, WebAiError, wrapError } from '../../web-ai/errors.mjs';

describe('web-ai WebAiError', () => {
    it('constructs with sane defaults when fields are missing', () => {
        const err = new WebAiError({ message: 'something' });
        expect(err.name).toBe('WebAiError');
        expect(err.errorCode).toBe('internal.unhandled');
        expect(err.stage).toBe('internal');
        expect(err.retryHint).toBe('report');
        expect(err.mutationAllowed).toBe(false);
        expect(err.selectorsTried).toEqual([]);
        expect(err.evidence).toBeNull();
        expect(err.message).toBe('something');
    });

    it('preserves all catalog fields and serializes them deterministically', () => {
        const err = new WebAiError({
            errorCode: 'cdp.target-mismatch',
            stage: 'connect',
            vendor: 'chatgpt',
            retryHint: 'tab-switch',
            message: 'active tab is not ChatGPT',
            mutationAllowed: false,
            selectorsTried: [],
            evidence: { url: 'https://example.com/' },
        });
        const json = err.toJSON();
        expect(json).toEqual({
            name: 'WebAiError',
            errorCode: 'cdp.target-mismatch',
            stage: 'connect',
            message: 'active tab is not ChatGPT',
            retryHint: 'tab-switch',
            vendor: 'chatgpt',
            mutationAllowed: false,
            selectorsTried: [],
            evidence: { url: 'https://example.com/' },
        });
    });

    it('omits undefined keys from the JSON envelope', () => {
        const err = new WebAiError({
            errorCode: 'context.symlink-rejected',
            stage: 'context-preflight',
            retryHint: 'path-list',
            message: 'symlink rejected',
        });
        const json = err.toJSON();
        expect(json.vendor).toBeUndefined();
        expect(Object.keys(json)).not.toContain('vendor');
        expect(json.evidence).toBeNull();
    });

    it('JSON.stringify(err) round-trips through toJSON', () => {
        const err = new WebAiError({
            errorCode: 'provider.composer-not-visible',
            stage: 'composer-prereq',
            vendor: 'grok',
            retryHint: 're-snapshot',
            message: 'grok composer not visible',
            selectorsTried: ['.ProseMirror'],
        });
        const parsed = JSON.parse(JSON.stringify(err));
        expect(parsed.errorCode).toBe('provider.composer-not-visible');
        expect(parsed.selectorsTried).toEqual(['.ProseMirror']);
        expect(parsed.vendor).toBe('grok');
    });
});

describe('web-ai wrapError', () => {
    it('passes through an existing WebAiError unchanged', () => {
        const original = new WebAiError({ errorCode: 'provider.poll-timeout', stage: 'poll', retryHint: 'poll-or-resume', message: 'timeout' });
        expect(wrapError(original)).toBe(original);
    });

    it('wraps a plain Error with internal.unhandled defaults', () => {
        const wrapped = wrapError(new Error('boom'));
        expect(wrapped).toBeInstanceOf(WebAiError);
        expect(wrapped.errorCode).toBe('internal.unhandled');
        expect(wrapped.stage).toBe('internal');
        expect(wrapped.retryHint).toBe('report');
        expect(wrapped.message).toBe('boom');
        expect(wrapped.cause).toBeInstanceOf(Error);
        expect(wrapped.cause.message).toBe('boom');
    });

    it('lets fallback init override the wrapping defaults', () => {
        const wrapped = wrapError(new Error('mismatch'), {
            errorCode: 'cdp.target-mismatch',
            stage: 'connect',
            retryHint: 'tab-switch',
            vendor: 'chatgpt',
        });
        expect(wrapped.errorCode).toBe('cdp.target-mismatch');
        expect(wrapped.vendor).toBe('chatgpt');
        expect(wrapped.message).toBe('mismatch');
    });

    it('handles non-Error throws (string, undefined) gracefully', () => {
        expect(wrapError('plain string').message).toBe('plain string');
        expect(wrapError(undefined).errorCode).toBe('internal.unhandled');
    });
});

describe('web-ai providerError + contextError factories', () => {
    it('providerError stamps the vendor field', () => {
        const err = providerError('gemini', {
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            retryHint: 'inline-only-or-file',
            message: 'gemini upload requested without a file',
        });
        expect(err.vendor).toBe('gemini');
        expect(err.errorCode).toBe('provider.attachment-preflight');
    });

    it('contextError leaves vendor unset by design', () => {
        const err = contextError({
            errorCode: 'context.over-budget',
            stage: 'context-preflight',
            retryHint: 'reduce-files',
            message: 'over budget',
        });
        expect(err.vendor).toBeUndefined();
    });
});

describe('web-ai toErrorJson', () => {
    it('serializes a WebAiError-like object whose own toJSON is bypassed', () => {
        const json = toErrorJson({
            name: 'WebAiError',
            errorCode: 'grok.context-pack-not-allowed',
            stage: 'grok-context-pack-not-allowed',
            message: 'override required',
            retryHint: 'inline-only-or-allow-flag',
            vendor: 'grok',
            mutationAllowed: false,
        });
        expect(json.errorCode).toBe('grok.context-pack-not-allowed');
        expect(json.vendor).toBe('grok');
    });
});
