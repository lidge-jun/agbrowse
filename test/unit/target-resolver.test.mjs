import { describe, expect, it, vi } from 'vitest';
import { resolveTargetForIntent } from '../../web-ai/target-resolver.mjs';

describe('target resolver contract', () => {
    it('returns explainable success for a semantic CSS fallback', async () => {
        const page = mockPage();
        const result = await resolveTargetForIntent(page, {
            provider: 'chatgpt',
            intentId: 'composer.fill',
        });

        expect(result.ok).toBe(true);
        expect(result.intent).toMatchObject({
            intentId: 'composer.fill',
            operation: 'fill',
            ambiguityPolicy: 'reject',
        });
        expect(result.target).toMatchObject({
            selector: '#prompt-textarea',
            resolution: 'css-fallback',
        });
        expect(result.resolutionSource).toBe('css-fallback');
        expect(result.attempts[0]).toMatchObject({
            source: 'css-fallback',
            selector: '#prompt-textarea',
            validation: { ok: true },
        });
    });

    it('rejects ambiguous matches with evidence', async () => {
        const page = mockPage({ count: 2 });
        const result = await resolveTargetForIntent(page, {
            provider: 'chatgpt',
            intentId: 'composer.fill',
        });

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('TARGET_UNRESOLVED');
        expect(result.attempts[0].validation).toMatchObject({
            ok: false,
            reason: 'ambiguous-selector',
            count: 2,
        });
    });

    it('rejects hidden targets before returning a selected target', async () => {
        const page = mockPage({ visible: false });
        const result = await resolveTargetForIntent(page, {
            provider: 'chatgpt',
            intentId: 'composer.fill',
        });

        expect(result.ok).toBe(false);
        expect(result.target).toBe(null);
        expect(result.attempts[0].validation.reason).toBe('not-visible');
    });

    it('resolves ChatGPT send buttons through the send.click contract', async () => {
        const page = mockPage({
            matchingSelectors: ['button[data-testid="send-button"]'],
            evalResult: { role: 'button', label: 'Send message', tagName: 'button', isEditable: false },
        });
        const result = await resolveTargetForIntent(page, {
            provider: 'chatgpt',
            intentId: 'send.click',
        });

        expect(result.ok).toBe(true);
        expect(result.intent).toMatchObject({
            intentId: 'send.click',
            feature: 'sendButton',
            operation: 'click',
        });
        expect(result.target.selector).toBe('button[data-testid="send-button"]');
    });

    it('resolves ChatGPT upload surfaces through the upload.attach contract', async () => {
        const page = mockPage({
            matchingSelectors: ['button[aria-label*="Attach" i]'],
            evalResult: { role: 'button', label: 'Attach files', tagName: 'button', isEditable: false },
        });
        const result = await resolveTargetForIntent(page, {
            provider: 'chatgpt',
            intentId: 'upload.attach',
        });

        expect(result.ok).toBe(true);
        expect(result.intent).toMatchObject({
            intentId: 'upload.attach',
            feature: 'uploadSurface',
            operation: 'click',
        });
        expect(result.target.selector).toBe('button[aria-label*="Attach" i]');
    });

    it('resolves ChatGPT copy buttons through the copy.lastResponse contract when unambiguous', async () => {
        const page = mockPage({
            matchingSelectors: ['button[data-testid="copy-turn-action-button"]'],
            evalResult: { role: 'button', label: 'Copy', tagName: 'button', isEditable: false },
        });
        const result = await resolveTargetForIntent(page, {
            provider: 'chatgpt',
            intentId: 'copy.lastResponse',
        });

        expect(result.ok).toBe(true);
        expect(result.intent).toMatchObject({
            intentId: 'copy.lastResponse',
            feature: 'copyButton',
            operation: 'click',
        });
        expect(result.target.selector).toBe('button[data-testid="copy-turn-action-button"]');
    });
});

function mockPage(overrides = {}) {
    const matchingSelectors = new Set(overrides.matchingSelectors || ['#prompt-textarea']);
    return {
        url: vi.fn(() => 'https://chatgpt.com/'),
        locator: vi.fn((selector) => ({
            count: vi.fn(async () => matchingSelectors.has(selector) ? (overrides.count ?? 1) : 0),
            first: vi.fn(() => ({
                isVisible: vi.fn(async () => overrides.visible ?? true),
                isEnabled: vi.fn(async () => overrides.enabled ?? true),
                isEditable: vi.fn(async () => overrides.editable ?? true),
                evaluate: vi.fn(async () => overrides.evalResult || { role: 'textbox', label: 'Message ChatGPT', tagName: 'textarea', isEditable: true }),
            })),
        })),
        getByRole: vi.fn(),
    };
}
