import { describe, expect, it } from 'vitest';
import { validateWebAiToolInput, isKnownWebAiTool } from '../../web-ai/tool-schema.mjs';

describe('web-ai tool input validation', () => {
    it('accepts valid web_ai_submit_prompt input', () => {
        expect(validateWebAiToolInput('web_ai_submit_prompt', {
            provider: 'chatgpt',
            prompt: 'hello',
        })).toBe(true);
    });

    it('rejects web_ai_submit_prompt without required prompt', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            provider: 'chatgpt',
        })).toThrow(/prompt.*required/i);
    });

    it('rejects invalid provider enum', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            provider: 'bard',
            prompt: 'hello',
        })).toThrow(/not in enum/i);
    });

    it('accepts valid web_ai_copy_markdown input', () => {
        expect(validateWebAiToolInput('web_ai_copy_markdown', {
            provider: 'grok',
        })).toBe(true);
    });

    it('accepts documented web_ai compatibility fields', () => {
        expect(validateWebAiToolInput('web_ai_submit_prompt', {
            provider: 'chatgpt',
            vendor: 'chatgpt',
            prompt: 'hello',
            filePath: '/tmp/context.txt',
            reasoningEffort: 'high',
            maxUploadFileSize: 1024,
            attachmentUploadTimeoutMs: 120000,
            policy: { version: 1 },
        })).toBe(true);
    });

    it('intentionally rejects deferred advanced MCP fields', () => {
        for (const field of ['outputImage', 'research', 'browserResearchMode', 'followUps', 'archive', 'project_sources']) {
            expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
                provider: 'chatgpt',
                prompt: 'hello',
                [field]: field === 'followUps' ? ['next'] : 'value',
            })).toThrow(new RegExp(`unknown property ${field}`));
        }
    });

    it('rejects unknown web_ai input fields', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            provider: 'chatgpt',
            prompt: 'hello',
            polciy: { version: 1 },
        })).toThrow(/unknown property polciy/i);
    });

    it('keeps provider aliases strict to supported vendors', () => {
        expect(validateWebAiToolInput('web_ai_wait_response', {
            sessionId: 'session-1',
            vendor: 'grok',
        })).toBe(true);
        expect(() => validateWebAiToolInput('web_ai_wait_response', {
            sessionId: 'session-1',
            vendor: 'claude',
        })).toThrow(/vendor not in enum/i);
    });

    it('throws for unknown tool name', () => {
        expect(() => validateWebAiToolInput('fake_tool', {})).toThrow('unknown web-ai tool');
    });

    it('isKnownWebAiTool correctly identifies web-ai tools', () => {
        expect(isKnownWebAiTool('web_ai_submit_prompt')).toBe(true);
        expect(isKnownWebAiTool('web_ai_copy_markdown')).toBe(true);
        expect(isKnownWebAiTool('browser_click_ref')).toBe(false);
    });
});
