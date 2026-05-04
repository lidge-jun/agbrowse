import { findVisibleCandidate } from './browser-primitives.mjs';
import { WebAiError } from './errors.mjs';

export const INPUT_SELECTORS = [
    'textarea[data-id="prompt-textarea"]',
    'textarea[placeholder*="Send a message"]',
    'textarea[aria-label="Message ChatGPT"]',
    'textarea:not([disabled])',
    'textarea[name="prompt-textarea"]',
    '#prompt-textarea',
    '.ProseMirror',
    '[contenteditable="true"][data-virtualkeyboard="true"]',
    '[contenteditable="true"]',
];

export const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-testid*="composer-send"]',
    'button[type="submit"][data-testid*="send"]',
    'button[aria-label*="Send prompt" i]',
    'button[aria-label*="Send message" i]',
];

export const STOP_BUTTON_SELECTOR = '[data-testid="stop-button"]';
export const ASSISTANT_ROLE_SELECTOR = '[data-message-author-role="assistant"], [data-turn="assistant"]';
export const CONVERSATION_TURN_SELECTOR = [
    'article[data-testid^="conversation-turn"]',
    'div[data-testid^="conversation-turn"]',
    'section[data-testid^="conversation-turn"]',
    'article[data-message-author-role]',
    'div[data-message-author-role]',
    'section[data-message-author-role]',
    'article[data-turn]',
    'div[data-turn]',
    'section[data-turn]',
].join(', ');

const INSERT_SETTLE_MS = 500;
const DEFAULT_COMMIT_TIMEOUT_MS = 60_000;

export async function findComposerCandidate(page, options = {}) {
    if (options.composerTarget?.selector) {
        return {
            selector: options.composerTarget.selector,
            locator: page.locator(options.composerTarget.selector).first(),
        };
    }
    const candidate = await findVisibleCandidate(page, INPUT_SELECTORS, { allowFirstCandidateFallback: true });
    if (candidate) return { selector: candidate.selector, locator: candidate.locator };
    throw new WebAiError({
        errorCode: 'provider.composer-not-visible',
        stage: 'composer-prereq',
        vendor: 'chatgpt',
        retryHint: 're-snapshot',
        message: `ChatGPT composer not found. Tried: ${INPUT_SELECTORS.join(', ')}`,
        selectorsTried: [...INPUT_SELECTORS],
    });
}

export async function insertPromptIntoComposer(page, text, options = {}) {
    const candidate = await findComposerCandidate(page, options);
    await focusComposerLikeUser(candidate.locator);
    try {
        await insertTextLikeProvider(page, text, options);
    } catch {
        await writeComposerFallback(page, candidate.locator, text);
    }
    await page.waitForTimeout?.(INSERT_SETTLE_MS);
    const state = await readComposerState(page, candidate.locator);
    if (!hasInsertedText(state, text)) {
        await writeComposerFallback(page, candidate.locator, text);
        await page.waitForTimeout?.(INSERT_SETTLE_MS);
    }
    const verified = await readComposerState(page, candidate.locator);
    if (!hasInsertedText(verified, text)) {
        throw new WebAiError({
            errorCode: 'provider.commit-not-verified',
            stage: 'commit-verify',
            vendor: 'chatgpt',
            retryHint: 're-snapshot',
            message: 'composer verification failed after prompt insertion',
            mutationAllowed: true,
        });
    }
    if (text.length >= 50_000 && maxComposerLength(verified) > 0 && maxComposerLength(verified) < text.length - 2_000) {
        throw new WebAiError({
            errorCode: 'provider.commit-not-verified',
            stage: 'commit-verify',
            vendor: 'chatgpt',
            retryHint: 're-snapshot',
            message: 'Prompt appears truncated in the composer',
            mutationAllowed: true,
        });
    }
}

export async function submitPromptFromComposer(page, options = {}) {
    if (options.sendTarget?.selector) {
        const clickedResolved = await clickResolvedSendButton(page, options.sendTarget);
        if (clickedResolved) {
            return {
                method: 'button',
                selector: options.sendTarget.selector,
                resolution: options.sendTarget.resolution || null,
            };
        }
    }
    const clicked = await clickEnabledSendButton(page);
    if (clicked) return { method: 'button' };
    await page.keyboard.press('Enter');
    return { method: 'enter' };
}

export async function verifyPromptCommitted(page, prompt, options = {}) {
    const timeoutMs = Number(options.timeoutMs || DEFAULT_COMMIT_TIMEOUT_MS);
    const baselineTurns = Number.isFinite(Number(options.baselineTurns)) ? Number(options.baselineTurns) : -1;
    const deadline = Date.now() + timeoutMs;
    const normalizedPrompt = normalizePrompt(prompt);
    const promptPrefix = normalizedPrompt.slice(0, 120);

    while (Date.now() <= deadline) {
        const [turns, composerState, stopVisible, assistantVisible] = await Promise.all([
            readConversationTurns(page),
            readComposerState(page).catch(() => ({ editorText: '', fallbackValue: '', activeValue: '' })),
            locatorExists(page, STOP_BUTTON_SELECTOR),
            locatorExists(page, ASSISTANT_ROLE_SELECTOR),
        ]);
        const normalizedTurns = turns.map(normalizePrompt);
        const hasPrompt = normalizedTurns.some(turn => turn.includes(normalizedPrompt) || (promptPrefix.length > 30 && turn.includes(promptPrefix)));
        const hasNewTurn = baselineTurns < 0 ? turns.length > 0 : turns.length > baselineTurns;
        const composerCleared = !maxComposerLength(composerState);
        if (hasPrompt && hasNewTurn) return { turnsCount: turns.length };
        if (composerCleared && hasNewTurn && (stopVisible || assistantVisible)) return { turnsCount: turns.length };
        await page.waitForTimeout?.(100);
    }
    throw new WebAiError({
        errorCode: 'provider.commit-not-verified',
        stage: 'commit-verify',
        vendor: 'chatgpt',
        retryHint: 're-snapshot',
        message: 'Prompt did not appear in conversation before timeout (send may have failed)',
        mutationAllowed: true,
    });
}

export async function countConversationTurns(page) {
    return (await readConversationTurns(page)).length;
}

async function focusComposerLikeUser(locator) {
    await locator.click().catch(() => undefined);
    await locator.evaluate?.((node) => {
        const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        for (const type of types) {
            const common = { bubbles: true, cancelable: true, view: window };
            const event = type.startsWith('pointer') && 'PointerEvent' in window
                ? new PointerEvent(type, { ...common, pointerId: 1, pointerType: 'mouse' })
                : new MouseEvent(type, common);
            node.dispatchEvent(event);
        }
        if (typeof node.focus === 'function') node.focus();
        const selection = node.ownerDocument?.getSelection?.();
        if (selection && typeof node.ownerDocument?.createRange === 'function') {
            const range = node.ownerDocument.createRange();
            range.selectNodeContents(node);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }).catch(() => undefined);
}

async function insertTextLikeProvider(page, text, options = {}) {
    if (typeof options.insertText === 'function') {
        await options.insertText(text);
        return;
    }
    if (typeof options.getCdpSession === 'function') {
        const cdp = await options.getCdpSession();
        try {
            await cdp.send('Input.insertText', { text });
        } finally {
            await cdp.detach?.().catch(() => undefined);
        }
        return;
    }
    await page.keyboard.insertText(text);
}

async function writeComposerFallback(page, locator, text) {
    if (typeof page.evaluate === 'function') {
        const wrote = await page.evaluate(({ selectors, value }) => {
            const write = (node) => {
                if (!node) return false;
                if ('value' in node) {
                    node.value = value;
                    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
                    node.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                node.textContent = value;
                node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
                return true;
            };
            let wroteAny = false;
            wroteAny = write(document.querySelector('textarea[name="prompt-textarea"]')) || wroteAny;
            wroteAny = write(document.querySelector('#prompt-textarea')) || wroteAny;
            for (const selector of selectors) {
                const node = document.querySelector(selector);
                wroteAny = write(node) || wroteAny;
            }
            return wroteAny;
        }, { selectors: INPUT_SELECTORS, value: text }).catch(() => false);
        if (wrote) return;
    }
    await locator.evaluate((node, value) => {
        if ('value' in node) {
            node.value = value;
            node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
        node.textContent = value;
        node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
    }, text);
}

async function readComposerState(page, fallbackLocator) {
    if (typeof page.evaluate === 'function') {
        const value = await page.evaluate((selectors) => {
            const read = (node) => {
                if (!node) return '';
                if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value || '';
                return node.innerText || node.textContent || '';
            };
            const isVisible = (node) => {
                if (!node || typeof node.getBoundingClientRect !== 'function') return false;
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const nodes = selectors.map(selector => document.querySelector(selector)).filter(Boolean);
            const active = nodes.find(isVisible) || nodes[0] || null;
            return {
                editorText: read(document.querySelector('#prompt-textarea')),
                fallbackValue: read(document.querySelector('textarea[name="prompt-textarea"]')),
                activeValue: read(active),
            };
        }, INPUT_SELECTORS).catch(() => null);
        if (value) return value;
    }
    if (!fallbackLocator) {
        const candidate = await findComposerCandidate(page);
        fallbackLocator = candidate.locator;
    }
    const actual = await fallbackLocator.inputValue?.().catch(async () => fallbackLocator.innerText?.()).catch(() => '');
    return { editorText: String(actual || ''), fallbackValue: '', activeValue: String(actual || '') };
}

async function clickEnabledSendButton(page) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        const result = await page.evaluate(({ inputSelectors, sendSelectors }) => {
            const dispatchClickSequence = (target) => {
                if (!target || !(target instanceof EventTarget)) return false;
                for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                    const common = { bubbles: true, cancelable: true, view: window };
                    const event = type.startsWith('pointer') && 'PointerEvent' in window
                        ? new PointerEvent(type, { ...common, pointerId: 1, pointerType: 'mouse' })
                        : new MouseEvent(type, common);
                    target.dispatchEvent(event);
                }
                return true;
            };
            const isVisible = (node) => {
                if (!node || typeof node.getBoundingClientRect !== 'function') return false;
                const rect = node.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return false;
                const style = window.getComputedStyle?.(node);
                return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
            };
            const promptNode = inputSelectors
                .flatMap(selector => Array.from(document.querySelectorAll(selector)))
                .find(isVisible) ?? inputSelectors.map(selector => document.querySelector(selector)).find(Boolean);
            const root = promptNode?.closest?.('[data-testid*="composer"]') ??
                promptNode?.closest?.('form') ??
                promptNode?.parentElement ??
                document;
            const candidates = [
                ...sendSelectors.flatMap(selector => Array.from(root.querySelectorAll(selector))),
                ...sendSelectors.flatMap(selector => Array.from(document.querySelectorAll(selector))),
            ];
            const seen = new Set();
            for (const button of candidates) {
                if (!button || seen.has(button)) continue;
                seen.add(button);
                const style = window.getComputedStyle?.(button);
                const disabled = button.hasAttribute?.('disabled') ||
                    button.getAttribute?.('aria-disabled') === 'true' ||
                    button.getAttribute?.('data-disabled') === 'true' ||
                    style?.pointerEvents === 'none' ||
                    style?.display === 'none' ||
                    style?.visibility === 'hidden';
                if (disabled || !isVisible(button)) continue;
                dispatchClickSequence(button);
                return 'clicked';
            }
            return candidates.length > 0 ? 'disabled' : 'missing';
        }, { inputSelectors: INPUT_SELECTORS, sendSelectors: SEND_BUTTON_SELECTORS }).catch(() => 'missing');
        if (result === 'clicked') return true;
        if (result === 'missing') return false;
        await page.waitForTimeout?.(100);
    }
    return false;
}

async function clickResolvedSendButton(page, target) {
    const button = page.locator(target.selector).first();
    const visible = typeof button.isVisible === 'function'
        ? await button.isVisible().catch(() => false)
        : true;
    const enabled = typeof button.isEnabled === 'function'
        ? await button.isEnabled().catch(() => false)
        : true;
    if (!visible || !enabled) return false;
    try {
        await button.click({ timeout: 5_000 });
        return true;
    } catch {
        try {
            await button.click({ timeout: 2_000, force: true });
            return true;
        } catch {
            return false;
        }
    }
}

async function readConversationTurns(page) {
    const locators = await page.locator(CONVERSATION_TURN_SELECTOR).all().catch(() => []);
    const turns = [];
    for (const locator of locators) {
        const text = String(await locator.innerText().catch(() => '')).trim();
        if (text) turns.push(text);
    }
    return turns;
}

async function locatorExists(page, selector) {
    return (await page.locator(selector).first().count().catch(() => 0)) > 0;
}

function hasInsertedText(state, expected) {
    const prefix = normalizePrompt(expected).slice(0, Math.min(normalizePrompt(expected).length, 120));
    return [state.editorText, state.fallbackValue, state.activeValue].some(value => normalizePrompt(value).includes(prefix));
}

function maxComposerLength(state) {
    return Math.max(String(state.editorText || '').length, String(state.fallbackValue || '').length, String(state.activeValue || '').length);
}

function normalizePrompt(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
