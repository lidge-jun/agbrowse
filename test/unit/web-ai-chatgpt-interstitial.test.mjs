import { describe, expect, it, vi } from 'vitest';
import { WebAiError } from '../../web-ai/errors.mjs';
import { waitForChatGptComposerReady } from '../../web-ai/chatgpt.mjs';

describe('ChatGPT composer readiness interstitial preflight', () => {
    it('converts a non-none detector verdict to the structured provider-interstitial error', async () => {
        const readinessFailure = new Error('composer unavailable');
        const waitForReady = vi.fn().mockRejectedValue(readinessFailure);
        const detect = vi.fn().mockResolvedValue({
            kind: 'cloudflare-challenge', evidence: 'challenge title', url: 'https://chatgpt.com/', retryHint: 'wait-and-retry',
        });

        const pending = waitForChatGptComposerReady({}, { waitForReady }, { detect });
        await expect(pending).rejects.toMatchObject({
            errorCode: 'provider.interstitial', stage: 'provider-interstitial', vendor: 'chatgpt',
            retryHint: 'wait-and-retry', mutationAllowed: false,
        });
        expect(detect).toHaveBeenCalledWith({}, expect.objectContaining({
            shellSelectors: expect.objectContaining({ composer: expect.arrayContaining(['#prompt-textarea']) }),
        }));
    });

    it('preserves the readiness failure when the detector returns none', async () => {
        const readinessFailure = new WebAiError({ errorCode: 'provider.composer-not-visible', stage: 'composer-prereq' });
        const detect = vi.fn().mockResolvedValue({ kind: 'none', evidence: '', url: 'https://chatgpt.com/', retryHint: 'none' });
        await expect(waitForChatGptComposerReady({}, { waitForReady: async () => { throw readinessFailure; } }, { detect }))
            .rejects.toBe(readinessFailure);
    });

    it('does not probe when readiness succeeds', async () => {
        const detect = vi.fn();
        await expect(waitForChatGptComposerReady({}, { waitForReady: async () => {} }, { detect })).resolves.toBeUndefined();
        expect(detect).not.toHaveBeenCalled();
    });
});
