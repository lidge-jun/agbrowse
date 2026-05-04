import { describe, expect, it } from 'vitest';
import { createActionIntent, serializeActionIntent } from '../../web-ai/action-intent.mjs';

describe('ActionIntent contract', () => {
    it('derives composer fill evidence from provider semantic targets', () => {
        const intent = createActionIntent({
            provider: 'chatgpt',
            intentId: 'composer.fill',
        });

        expect(intent).toMatchObject({
            intentId: 'composer.fill',
            provider: 'chatgpt',
            feature: 'composer',
            operation: 'fill',
            roleHints: ['textbox'],
            requiredEvidence: ['visible', 'enabled', 'editable'],
            ambiguityPolicy: 'reject',
            required: true,
        });
        expect(intent.nameHints).toContain('message');
        expect(intent.cssFallbacks).toContain('#prompt-textarea');
        expect(intent.semanticTarget).toBeTruthy();
    });

    it('serializes without RegExp or semantic target internals', () => {
        const serialized = serializeActionIntent({
            provider: 'grok',
            intentId: 'copy.lastResponse',
        });

        expect(serialized.intentId).toBe('copy.lastResponse');
        expect(serialized.operation).toBe('click');
        expect(serialized.semanticTarget).toBeUndefined();
        expect(serialized.nameHints.every(hint => typeof hint === 'string')).toBe(true);
    });

    it('derives send click as a send button action', () => {
        const intent = createActionIntent({
            provider: 'chatgpt',
            intentId: 'send.click',
        });

        expect(intent).toMatchObject({
            intentId: 'send.click',
            feature: 'sendButton',
            operation: 'click',
            roleHints: ['button'],
            requiredEvidence: ['visible', 'enabled'],
        });
        expect(intent.cssFallbacks).toContain('button[data-testid="send-button"]');
    });

    it('rejects unknown intents unless a feature is explicit', () => {
        expect(() => createActionIntent({ intentId: 'unknown.action' })).toThrow(/unknown action intent/);
        const intent = createActionIntent({
            provider: 'chatgpt',
            intentId: 'custom.action',
            feature: 'composer',
            operation: 'fill',
        });
        expect(intent.feature).toBe('composer');
    });
});
