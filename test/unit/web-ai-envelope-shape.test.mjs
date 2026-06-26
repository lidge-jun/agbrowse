import { describe, expect, it } from 'vitest';
import { toWebAiErrorEnvelope } from '../../web-ai/failure-diagnostics.mjs';
import { WebAiError } from '../../web-ai/errors.mjs';

class ProviderRuntimeDisabledError extends WebAiError {
    constructor(message, opts = {}) {
        super({ errorCode: 'provider.runtime-disabled', stage: 'provider-check', message, ...opts });
        this.name = 'ProviderRuntimeDisabledError';
    }
}

describe('R1: toWebAiErrorEnvelope shape-based recognition', () => {
    it('preserves errorCode/retryHint/vendor from WebAiError subclasses', () => {
        const err = new ProviderRuntimeDisabledError('chatgpt disabled', {
            retryHint: 'enable-provider',
            vendor: 'chatgpt',
        });
        const envelope = toWebAiErrorEnvelope(err);
        expect(envelope.ok).toBe(false);
        expect(envelope.errorCode).toBe('provider.runtime-disabled');
        expect(envelope.retryHint).toBe('enable-provider');
        expect(envelope.vendor).toBe('chatgpt');
    });

    it('preserves errorCode from base WebAiError', () => {
        const err = new WebAiError({ errorCode: 'composer.not-found', stage: 'send', message: 'no composer' });
        const envelope = toWebAiErrorEnvelope(err, 'send');
        expect(envelope.errorCode).toBe('composer.not-found');
    });

    it('does not match plain Error objects', () => {
        const err = new Error('generic error');
        const envelope = toWebAiErrorEnvelope(err);
        expect(envelope.errorCode).toBeUndefined();
        expect(envelope.error).toBe('generic error');
    });

    it('does not match objects with errorCode but no toJSON', () => {
        const fake = { errorCode: 'spoofed', message: 'not a real WebAiError' };
        const envelope = toWebAiErrorEnvelope(fake);
        expect(envelope.errorCode).toBeUndefined();
    });
});
