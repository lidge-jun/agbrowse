import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    CHATGPT_COPY_SELECTORS,
    GEMINI_COPY_SELECTORS,
    captureCopiedResponseText,
    preferCopiedText,
} from '../../web-ai/copy-markdown.mjs';

describe('web-ai copy markdown helper', () => {
    it('documents observed provider copy selectors', () => {
        expect(CHATGPT_COPY_SELECTORS.copyButtonSelectors).toContain('button[data-testid="copy-turn-action-button"]');
        expect(GEMINI_COPY_SELECTORS.turnSelectors).toContain('model-response');
        expect(GEMINI_COPY_SELECTORS.copyButtonSelectors).toContain('button[data-test-id="copy-button"]');
    });

    it('captures intercepted clipboard text without OS clipboard read', async () => {
        const page = { evaluate: async () => ({ ok: true, text: 'copied markdown' }) };
        await expect(captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS)).resolves.toEqual({ ok: true, text: 'copied markdown' });

        const src = readFileSync(new URL('../../web-ai/copy-markdown.mjs', import.meta.url), 'utf8');
        expect(src).toContain('writeText');
        expect(src).toContain("Object.defineProperty(clipboard, 'write'");
        expect(src).not.toMatch(/readText\s*\(/);
    });

    it('prioritizes a resolver-selected copy target inside the last turn', async () => {
        let payload = null;
        const page = {
            evaluate: async (_fn, arg) => {
                payload = arg;
                return { ok: true, text: 'copied markdown' };
            },
        };

        await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS, {
            copyTarget: { selector: 'button[data-testid="resolved-copy-button"]', resolution: 'css-fallback' },
        });

        expect(payload.selectorSet.copyButtonSelectors[0]).toBe('button[data-testid="resolved-copy-button"]');
        expect(new Set(payload.selectorSet.copyButtonSelectors).size).toBe(payload.selectorSet.copyButtonSelectors.length);
    });

    it('keeps ChatGPT response-copy selectors ahead of generic resolver matches', async () => {
        let payload = null;
        const page = {
            evaluate: async (_fn, arg) => {
                payload = arg;
                return { ok: true, text: 'turn-level markdown' };
            },
        };

        await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS, {
            copyTarget: { selector: 'button[aria-label*="Copy" i]', resolution: 'css-fallback' },
        });

        expect(payload.selectorSet.copyButtonSelectors).toEqual(CHATGPT_COPY_SELECTORS.copyButtonSelectors);
        expect(payload.selectorSet.copyButtonSelectors[0]).toBe('button[data-testid="copy-turn-action-button"]');
    });

    it('rejects copied text that is probably truncated', () => {
        expect(preferCopiedText('a'.repeat(200), { ok: true, text: 'short' })).toBeUndefined();
        expect(preferCopiedText('dom answer', { ok: true, text: 'copied answer' })).toBe('copied answer');
    });
});
