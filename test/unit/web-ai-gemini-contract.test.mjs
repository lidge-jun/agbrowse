import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GEMINI_DEEP_THINK_CONSTRAINTS } from '../../web-ai/vendor-editor-contract.mjs';
import { CONVERSATION_TURN_SELECTOR, INPUT_SELECTORS } from '../../web-ai/chatgpt-composer.mjs';

describe('web-ai Gemini Deep Think contract constraints', () => {
    it('keeps Gemini selectors separate from ChatGPT composer selectors', () => {
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.inputSelectors).toContain('rich-textarea .ql-editor');
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.inputSelectors).toContain('[role="textbox"][aria-label*="prompt" i]');
        expect(INPUT_SELECTORS).not.toContain('rich-textarea .ql-editor');
    });

    it('documents Gemini response and completion signals without enabling the vendor', () => {
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.responseSelectors).toContain('model-response');
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.responseSelectors).toContain('message-content');
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.completionSignals).toContain('.response-footer.complete');
        expect(CONVERSATION_TURN_SELECTOR).not.toContain('model-response');
    });

    it('documents Deep Think mode controls as future constraints', () => {
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.modeSelectors).toContain('button.toolbox-drawer-button');
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.modeSelectors).toContain('[role="menuitemcheckbox"]:has-text("Deep think")');
        expect(GEMINI_DEEP_THINK_CONSTRAINTS.modeSelectors).toContain('button[aria-label*="Deselect Deep think"]');
    });

    it('standalone runtime fails closed when Deep Think chip is not verified', () => {
        const src = readFileSync(new URL('../../web-ai/gemini-live.mjs', import.meta.url), 'utf8');
        expect(src).toContain('active Deep Think chip was not verified');
        expect(src).toContain('provider-select-mode');
        expect(src).not.toContain("usedFallbacks.push('deep-think-not-activated')");
    });

    it('standalone runtime supports observed Gemini mode picker choices', () => {
        const liveSrc = readFileSync(new URL('../../web-ai/gemini-live.mjs', import.meta.url), 'utf8');
        const modelSrc = readFileSync(new URL('../../web-ai/gemini-model.mjs', import.meta.url), 'utf8');
        expect(modelSrc).toContain('bard-mode-menu-button');
        expect(modelSrc).toContain('bard-mode-option-fast');
        expect(modelSrc).toContain('bard-mode-option-thinking');
        expect(modelSrc).toContain('bard-mode-option-pro');
        expect(modelSrc).toContain('deepthink');
        expect(modelSrc).toContain('isGeminiDeepThinkChoice');
        expect(liveSrc).toContain('selectGeminiModel');
        expect(liveSrc).toContain('model selected:');
    });

    it('retries Gemini new-chat clicks when the Angular nav element detaches mid-click', () => {
        const liveSrc = readFileSync(new URL('../../web-ai/gemini-live.mjs', import.meta.url), 'utf8');
        expect(liveSrc).toContain('clickFirstSelectorWithRetry');
        expect(liveSrc).toContain("'gemini new chat'");
        expect(liveSrc).toContain('click retry:${sel}');
        expect(liveSrc).toMatch(/detached\\|Timeout\\|not attached\\|not stable/);
    });

    it('standalone runtime supports observed Gemini file upload with evidence checks', () => {
        const liveSrc = readFileSync(new URL('../../web-ai/gemini-live.mjs', import.meta.url), 'utf8');
        expect(liveSrc).toContain("page.waitForEvent('filechooser'");
        expect(liveSrc).toContain('uploader-file-preview');
        expect(liveSrc).toContain('Gemini sent turn has no attachment evidence');
        expect(liveSrc).toContain('context package attached:');
        expect(liveSrc).not.toContain('gemini context package upload is not implemented');
    });
});
