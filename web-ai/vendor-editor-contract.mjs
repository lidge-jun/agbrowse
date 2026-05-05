// @ts-check
import {
    INPUT_SELECTORS as CHATGPT_INPUT_SELECTORS,
    SEND_BUTTON_SELECTORS as CHATGPT_SEND_BUTTON_SELECTORS,
    countConversationTurns,
    insertPromptIntoComposer,
    submitPromptFromComposer,
    verifyPromptCommitted,
} from './chatgpt-composer.mjs';
import { CHATGPT_COPY_SELECTORS, GEMINI_COPY_SELECTORS, GROK_COPY_SELECTORS } from './copy-markdown.mjs';
import { CHATGPT_MODEL_SELECTOR_BUTTONS } from './chatgpt-model.mjs';
import { UPLOAD_BUTTON_SELECTORS as CHATGPT_UPLOAD_BUTTON_SELECTORS } from './chatgpt-attachments.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('./chatgpt-composer.mjs').ComposerOptions} ComposerOptions */
/** @typedef {import('./chatgpt-composer.mjs').SubmitResult} SubmitResult */

/**
 * @typedef {Object} EditorAdapterBaseline
 * @property {number} turnsCount
 */

/**
 * @typedef {Object} EditorAdapter
 * @property {'chatgpt'} vendor
 * @property {() => Promise<void>} waitForReady
 * @property {() => Promise<EditorAdapterBaseline>} getCommitBaseline
 * @property {(text: string) => Promise<void>} insertPrompt
 * @property {(submitOptions?: ComposerOptions) => Promise<SubmitResult>} submitPrompt
 * @property {(prompt: string, baseline?: Partial<EditorAdapterBaseline>) => Promise<{ turnsCount: number }>} verifyPromptCommitted
 */

/**
 * @typedef {'chatgpt' | 'gemini' | 'grok'} VendorName
 */

/**
 * @typedef {Object} SemanticTarget
 * @property {readonly string[]} roles
 * @property {readonly RegExp[]} [names]
 * @property {readonly RegExp[]} [excludeNames]
 * @property {readonly string[]} cssFallbacks
 * @property {boolean} [required]
 */

/**
 * @typedef {Object} EditorContract
 * @property {VendorName} vendor
 * @property {Readonly<Record<string, SemanticTarget>>} semanticTargets
 */

/**
 * @param {Page} page
 * @param {ComposerOptions} [options]
 * @returns {EditorAdapter}
 */
export function createChatGptEditorAdapter(page, options = {}) {
    return {
        vendor: 'chatgpt',
        async waitForReady() {
            const selector = options.composerTarget?.selector || '#prompt-textarea, .ProseMirror, [contenteditable="true"]';
            await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10_000 });
        },
        async getCommitBaseline() {
            return { turnsCount: await countConversationTurns(page) };
        },
        async insertPrompt(text) {
            await insertPromptIntoComposer(page, text, options);
        },
        async submitPrompt(submitOptions = {}) {
            return submitPromptFromComposer(page, { ...options, ...submitOptions });
        },
        async verifyPromptCommitted(prompt, baseline = {}) {
            return verifyPromptCommitted(page, prompt, { baselineTurns: baseline.turnsCount });
        },
    };
}

export const GEMINI_DEEP_THINK_CONSTRAINTS = {
    inputSelectors: ['rich-textarea .ql-editor', '[role="textbox"][aria-label*="prompt" i]', 'div[contenteditable="true"]'],
    responseSelectors: ['model-response', 'message-content', '.model-response-text message-content'],
    completionSignals: ['.response-footer.complete', '[role="progressbar"]'],
    modeSelectors: [
        'button[aria-label="New chat"]:not([aria-disabled="true"]):not(.disabled)',
        'button.toolbox-drawer-button',
        '[role="menuitemcheckbox"]:has-text("Deep think")',
        'button[aria-label*="Deselect Deep think"]',
    ],
};

// --- Phase 7: Semantic target contracts per vendor ---

export const CHATGPT_COMPOSER_SELECTORS = CHATGPT_INPUT_SELECTORS;
export const CHATGPT_SEND_SELECTORS = CHATGPT_SEND_BUTTON_SELECTORS;
export const CHATGPT_UPLOAD_SELECTORS = CHATGPT_UPLOAD_BUTTON_SELECTORS;
export const CHATGPT_RESPONSE_SELECTORS = ['[data-message-author-role="assistant"]', '[data-turn="assistant"]', 'article[data-testid^="conversation-turn"]'];
export const CHATGPT_STREAMING_SELECTORS = ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'];

export const GEMINI_COMPOSER_SELECTORS = ['rich-textarea .ql-editor', '[role="textbox"][aria-label*="prompt" i]', 'div[contenteditable="true"]'];
export const GEMINI_MODEL_SELECTOR_BUTTONS = ['button[data-test-id="bard-mode-menu-button"]', 'button[aria-label="Open mode picker"]'];
export const GEMINI_UPLOAD_SELECTORS = ['button[aria-label="Open upload file menu"]', 'button[aria-label*="upload file menu" i]'];
export const GEMINI_RESPONSE_SELECTORS = ['model-response', '[data-response-index]'];
export const GEMINI_STREAMING_SELECTORS = ['.response-footer.complete', 'message-actions', '[aria-label*="Good response" i]'];

export const GROK_COMPOSER_SELECTORS = ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"].ProseMirror'];
export const GROK_MODEL_SELECTOR_BUTTONS = ['button[aria-label="Model select"]', 'button[aria-label*="Model select" i]'];
export const GROK_UPLOAD_SELECTORS = ['button[aria-label*="Upload" i]', 'button[aria-label*="Attach" i]', 'button[data-testid*="plus" i]'];
export const GROK_RESPONSE_SELECTORS = ['[data-testid="assistant-message"]', '[id^="response-"]:has([data-testid="assistant-message"])'];
export const GROK_STREAMING_SELECTORS = ['button[aria-label*="Stop" i]'];

export const CHATGPT_EDITOR_CONTRACT = Object.freeze({
    vendor: 'chatgpt',
    semanticTargets: {
        composer: { roles: ['textbox'], names: [/message/i, /prompt/i, /chatgpt/i], excludeNames: [/search/i], cssFallbacks: CHATGPT_COMPOSER_SELECTORS, required: true },
        sendButton: { roles: ['button'], names: [/send/i, /submit/i], cssFallbacks: CHATGPT_SEND_SELECTORS },
        modelPicker: { roles: ['button', 'combobox'], names: [/model/i, /gpt/i], cssFallbacks: CHATGPT_MODEL_SELECTOR_BUTTONS },
        uploadSurface: { roles: ['button'], names: [/attach/i, /upload/i, /file/i, /add/i], cssFallbacks: CHATGPT_UPLOAD_SELECTORS },
        responseFeed: { roles: ['article', 'region', 'group'], names: [/assistant/i, /response/i], cssFallbacks: CHATGPT_RESPONSE_SELECTORS },
        copyButton: { roles: ['button'], names: [/copy/i], cssFallbacks: CHATGPT_COPY_SELECTORS.copyButtonSelectors },
        streamingIndicator: { roles: ['button'], names: [/stop/i], cssFallbacks: CHATGPT_STREAMING_SELECTORS },
    },
});

export const GEMINI_EDITOR_CONTRACT = Object.freeze({
    vendor: 'gemini',
    semanticTargets: {
        composer: { roles: ['textbox'], names: [/prompt/i, /message/i, /ask/i], excludeNames: [/search/i], cssFallbacks: GEMINI_COMPOSER_SELECTORS, required: true },
        modelPicker: { roles: ['button', 'combobox'], names: [/model/i, /mode/i, /picker/i], cssFallbacks: GEMINI_MODEL_SELECTOR_BUTTONS },
        uploadSurface: { roles: ['button'], names: [/upload/i, /file/i, /attach/i], cssFallbacks: GEMINI_UPLOAD_SELECTORS },
        responseFeed: { roles: ['article', 'region', 'group'], names: [/response/i, /gemini/i], cssFallbacks: GEMINI_RESPONSE_SELECTORS },
        copyButton: { roles: ['button'], names: [/copy/i], cssFallbacks: GEMINI_COPY_SELECTORS.copyButtonSelectors },
        streamingIndicator: { roles: ['button', 'status'], names: [/stop/i, /response/i], cssFallbacks: GEMINI_STREAMING_SELECTORS },
    },
});

export const GROK_EDITOR_CONTRACT = Object.freeze({
    vendor: 'grok',
    semanticTargets: {
        composer: { roles: ['textbox'], names: [/message/i, /prompt/i, /ask/i, /grok/i], excludeNames: [/search/i], cssFallbacks: GROK_COMPOSER_SELECTORS, required: true },
        modelPicker: { roles: ['button', 'combobox'], names: [/model/i], cssFallbacks: GROK_MODEL_SELECTOR_BUTTONS },
        uploadSurface: { roles: ['button'], names: [/upload/i, /attach/i, /file/i], cssFallbacks: GROK_UPLOAD_SELECTORS },
        responseFeed: { roles: ['article', 'region', 'group'], names: [/assistant/i, /response/i], cssFallbacks: GROK_RESPONSE_SELECTORS },
        copyButton: { roles: ['button'], names: [/copy/i], cssFallbacks: GROK_COPY_SELECTORS.copyButtonSelectors },
        streamingIndicator: { roles: ['button'], names: [/stop/i], cssFallbacks: GROK_STREAMING_SELECTORS },
    },
});

export const EDITOR_CONTRACT_BY_VENDOR = Object.freeze({
    chatgpt: CHATGPT_EDITOR_CONTRACT,
    gemini: GEMINI_EDITOR_CONTRACT,
    grok: GROK_EDITOR_CONTRACT,
});

/**
 * @param {VendorName} [vendor]
 * @returns {EditorContract}
 */
export function editorContractForVendor(vendor = 'chatgpt') {
    return EDITOR_CONTRACT_BY_VENDOR[vendor] || CHATGPT_EDITOR_CONTRACT;
}

/**
 * @param {VendorName} [vendor]
 * @returns {Readonly<Record<string, SemanticTarget>>}
 */
export function semanticTargetsForVendor(vendor = 'chatgpt') {
    return editorContractForVendor(vendor).semanticTargets;
}
