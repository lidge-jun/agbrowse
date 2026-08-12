import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GEMINI_DEEP_THINK_CONSTRAINTS } from '../../web-ai/vendor-editor-contract.mjs';
import { CONVERSATION_TURN_SELECTOR, INPUT_SELECTORS } from '../../web-ai/chatgpt-composer.mjs';
import { normalizeGeminiModelChoice } from '../../web-ai/gemini-model.mjs';
import {
    isGeminiRepomixAttachmentIncrementReady,
    waitForGeminiRepomixAttachmentCount,
} from '../../web-ai/gemini-live.mjs';

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
        expect(modelSrc).toContain('MODE_OPTION_SELECTOR');
        expect(modelSrc).not.toContain('[role="option"], button');
        expect(modelSrc).toContain('flash-lite');
        expect(modelSrc).toContain('deepthink');
        expect(modelSrc).toContain('isGeminiDeepThinkChoice');
        expect(modelSrc).not.toContain('3.1-pro');
        expect(liveSrc).toContain('selectGeminiModel');
        expect(liveSrc).toContain('model selected:');
    });

    it('normalizes Gemini model labels without pinning the version number', () => {
        expect(normalizeGeminiModelChoice('flash-lite')).toBe('flash-lite');
        expect(normalizeGeminiModelChoice('3.1 Flash-Lite')).toBe('flash-lite');
        expect(normalizeGeminiModelChoice('3 Flash')).toBe('flash');
        expect(normalizeGeminiModelChoice('3.5 Flash')).toBe('flash');
        expect(normalizeGeminiModelChoice('3.1 Pro')).toBe('pro');
        expect(normalizeGeminiModelChoice('3.2 Pro')).toBe('pro');
        expect(normalizeGeminiModelChoice('thinking')).toBe('pro');
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
        expect(liveSrc).toContain('Upload & tools');
        expect(liveSrc).toContain('Upload files');
        expect(liveSrc).toContain('uploader-file-preview');
        expect(liveSrc).toContain('input-area-v2 button[aria-label^="close " i]');
        expect(liveSrc).toContain('input-area-v2 [role="progressbar"]:visible');
        expect(liveSrc).toContain('Gemini sent turn has no attachment evidence');
        expect(liveSrc).toContain('context package attached:');
        expect(liveSrc).not.toContain('gemini context package upload is not implemented');
    });

    it('requires every Repomix upload to increase the visible chip count', () => {
        expect(isGeminiRepomixAttachmentIncrementReady({ busy: 0, chipCount: 2 }, 1)).toBe(true);
        expect(isGeminiRepomixAttachmentIncrementReady({ busy: 0, chipCount: 1 }, 1)).toBe(false);
        expect(isGeminiRepomixAttachmentIncrementReady({ busy: 1, chipCount: 2 }, 1)).toBe(false);
    });

    it('requires the exact final Repomix attachment count', async () => {
        const partial = await waitForGeminiRepomixAttachmentCount(
            createGeminiAttachmentCountPage(1),
            2,
            { timeoutMs: 0 },
        );
        const extra = await waitForGeminiRepomixAttachmentCount(
            createGeminiAttachmentCountPage(3),
            2,
            { timeoutMs: 0 },
        );
        const complete = await waitForGeminiRepomixAttachmentCount(
            createGeminiAttachmentCountPage(2),
            2,
            { timeoutMs: 0 },
        );

        expect(partial).toMatchObject({ ok: false, expectedCount: 2, observedCount: 1 });
        expect(extra).toMatchObject({ ok: false, expectedCount: 2, observedCount: 3 });
        expect(complete).toMatchObject({ ok: true, expectedCount: 2, observedCount: 2 });
    });

    it('ignores historical sent-turn previews in the Repomix composer count', async () => {
        const result = await waitForGeminiRepomixAttachmentCount(
            createGeminiAttachmentCountPage(2, 9),
            2,
            { timeoutMs: 0 },
        );

        expect(result).toMatchObject({ ok: true, expectedCount: 2, observedCount: 2 });
    });

    it('runs Repomix exact-count verification before Gemini submit', () => {
        const liveSrc = readFileSync(new URL('../../web-ai/gemini-live.mjs', import.meta.url), 'utf8');
        const sendBody = liveSrc.slice(
            liveSrc.indexOf('export async function geminiSendWebAi'),
            liveSrc.indexOf('function preflightGeminiUploadFiles'),
        );

        expect(sendBody.indexOf('requireChipCountIncrease: strictRepomixUpload')).toBeLessThan(
            sendBody.indexOf('waitForGeminiRepomixAttachmentCount(page, uploadFiles.length)'),
        );
        expect(sendBody.indexOf('waitForGeminiRepomixAttachmentCount(page, uploadFiles.length)')).toBeLessThan(
            sendBody.indexOf('await page.locator(sendSel).first().click'),
        );
        expect(sendBody).toContain('if (!repomixMode)');
        expect(sendBody).toContain('verifyGeminiSentTurnAttachment(page, fileInfoFromPath(uploadPath))');
        expect(liveSrc).toContain(": 'button[aria-label^=\"Remove file\"]'");
        expect(sendBody).not.toContain('requireExactCount: strictRepomixUpload');
    });
});

function createGeminiAttachmentCountPage(attachmentCount, previewCount = 0) {
    return {
        locator: selector => ({
            count: async () => {
                if (/progressbar|uploading|processing/i.test(selector)) return 0;
                if (selector.includes('input-area-v2 button[aria-label^="close " i]')) return attachmentCount;
                if (/uploader-file-preview|file-preview|attachment-preview/.test(selector)) return previewCount;
                return 0;
            },
        }),
        waitForTimeout: async () => undefined,
    };
}
