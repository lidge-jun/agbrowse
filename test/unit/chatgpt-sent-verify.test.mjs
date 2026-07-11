import { afterEach, describe, expect, it } from 'vitest';
import { WebAiError } from '../../web-ai/errors.mjs';
import { verifySentAttachments } from '../../web-ai/chatgpt.mjs';

describe('ChatGPT sent attachment verification policy', () => {
    afterEach(() => {
        delete process.env.AGBROWSE_SENT_ATTACHMENT_POLICY;
    });

    it('fails closed when sent-turn attachment evidence is missing', async () => {
        const evidence = { usedFallbacks: [], attachmentWarnings: [] };
        const action = verifySentAttachments({}, [{ basename: 'report.pdf' }], evidence, async () => ({
            ok: false,
            error: 'sent turn has no attachment evidence',
        }));

        await expect(action).rejects.toMatchObject({
            errorCode: 'provider.sent-attachment-missing',
            stage: 'attachment-verify',
            vendor: 'chatgpt',
            retryHint: 're-upload',
            mutationAllowed: true,
        });
        await expect(action).rejects.toBeInstanceOf(WebAiError);
        await expect(action).rejects.toThrow(/report\.pdf.*sent turn has no attachment evidence/);
    });

    it('keeps the legacy warning behavior when policy is warn', async () => {
        process.env.AGBROWSE_SENT_ATTACHMENT_POLICY = 'warn';
        const evidence = { usedFallbacks: [], attachmentWarnings: [] };

        await expect(verifySentAttachments({}, [{ basename: 'report.pdf' }], evidence, async () => ({
            ok: false,
            error: 'sent turn has no attachment evidence',
        }))).resolves.toBeUndefined();
        expect(evidence.usedFallbacks).toContain('sent-attachment-evidence-unavailable');
        expect(evidence.attachmentWarnings).toEqual([
            'sent attachment evidence unavailable after submit (report.pdf): sent turn has no attachment evidence',
        ]);
    });
});
