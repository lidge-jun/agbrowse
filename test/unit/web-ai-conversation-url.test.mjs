import { describe, expect, it, vi } from 'vitest';

const { createTab } = vi.hoisted(() => ({ createTab: vi.fn() }));

vi.mock('../../skills/browser/tab-manager.mjs', () => ({
    createTab,
    isTabAlive: vi.fn(),
    getPageByTargetId: vi.fn(),
    waitForPageByTargetId: vi.fn(),
    listManagedTabs: vi.fn(),
    closeTab: vi.fn(),
}));

import {
    extractDurableConversationId,
    isDurableConversationUrl,
} from '../../web-ai/conversation-url.mjs';
import { openConversationInNewTab } from '../../web-ai/tab-recovery.mjs';

describe('durable ChatGPT conversation URL', () => {
    it('accepts segment-bounded conversation paths on supported hosts', () => {
        expect(extractDurableConversationId('https://chatgpt.com/c/abc-123')).toBe('abc-123');
        expect(extractDurableConversationId('https://chat.openai.com/g/gpt-slug/c/ABC-123/')).toBe('ABC-123');
    });

    it('rejects transient and invalid id alphabets without a partial match', () => {
        for (const candidate of [
            'https://chatgpt.com/c/WEB:request-id',
            'https://chatgpt.com/c/abc_def',
            'https://chatgpt.com/c/abc:123',
        ]) {
            expect(isDurableConversationUrl(candidate)).toBe(false);
        }
    });

    it('rejects roots, project paths, foreign hosts, HTTP, explicit ports, and non-path hints', () => {
        for (const candidate of [
            'https://chatgpt.com/',
            'https://chatgpt.com/g/gpt-slug',
            'https://example.com/c/abc-123',
            'http://chatgpt.com/c/abc-123',
            'https://chatgpt.com:443/c/abc-123',
            'https://chatgpt.com/?next=/c/abc-123',
            'https://chatgpt.com/#/c/abc-123',
        ]) {
            expect(isDurableConversationUrl(candidate)).toBe(false);
        }
    });

    it('does not reject suspicious characters confined to query or fragment', () => {
        expect(isDurableConversationUrl('https://chatgpt.com/c/abc-123?next=..\\x#\0')).toBe(true);
    });

    it('WEB: reattach fails closed before createTab is called', async () => {
        const result = await openConversationInNewTab(
            { getPort: () => 9222 },
            { conversationUrl: 'https://chatgpt.com/c/WEB:request-id' },
        );

        expect(result).toEqual({ opened: false, reason: 'unsafe-conversation-url' });
        expect(createTab).not.toHaveBeenCalled();
    });
});
