// @ts-check

// Parity catalog 201 #4 (P1): unified interstitial detector. agbrowse scattered
// per-vendor cloudflare/login patterns across chatgpt/grok/gemini-live; this is one
// typed detector (cloudflare-challenge / login-required / empty-shell / loading / none)
// with a retryHint, plus isPageDeathError. Reverse port of cli-jaw web-ai/interstitial.ts.
// classifyInterstitial is pure (all page signals passed in) so it is fully unit-testable.

/**
 * @typedef {'cloudflare-challenge'|'login-required'|'empty-shell'|'loading'|'none'} InterstitialKind
 * @typedef {{ kind: InterstitialKind, evidence: string, url: string, retryHint: 'wait-and-retry'|'login'|'navigate'|'none' }} InterstitialResult
 */

const CLOUDFLARE_PATTERNS = [
    'just a moment',
    'checking if the site connection is secure',
    'enable javascript and cookies',
    'ray id',
];

const LOGIN_PATTERNS = [
    'log in',
    'sign in',
    'sign up',
    'create an account',
    'welcome back',
];

const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="composer-textarea"]',
    'div[contenteditable="true"]',
];

const ASSISTANT_TURN_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    'article[data-testid^="conversation-turn"]',
];

/**
 * Classify an interstitial from already-gathered page signals (pure).
 * @param {{ url?: string, bodyText?: string, hasComposer?: boolean, hasTurns?: boolean }} signals
 * @returns {InterstitialResult}
 */
export function classifyInterstitial({ url = '', bodyText = '', hasComposer = false, hasTurns = false } = {}) {
    const lower = bodyText.toLowerCase();

    if (CLOUDFLARE_PATTERNS.some((p) => lower.includes(p))) {
        const matched = CLOUDFLARE_PATTERNS.find((p) => lower.includes(p)) || 'cloudflare';
        return { kind: 'cloudflare-challenge', evidence: matched, url, retryHint: 'wait-and-retry' };
    }

    if (/^https:\/\/auth0?\.|\/auth\/|\/login/i.test(url)) {
        return { kind: 'login-required', evidence: `auth URL: ${url}`, url, retryHint: 'login' };
    }
    if (LOGIN_PATTERNS.some((p) => lower.includes(p)) && bodyText.length < 2000) {
        const matched = LOGIN_PATTERNS.find((p) => lower.includes(p)) || 'login';
        return { kind: 'login-required', evidence: matched, url, retryHint: 'login' };
    }

    const isChatGptUrl = /chatgpt\.com|chat\.openai\.com/.test(url);
    if (isChatGptUrl && !hasComposer && !hasTurns && bodyText.length < 500) {
        return { kind: 'empty-shell', evidence: 'no composer and no turns', url, retryHint: 'wait-and-retry' };
    }

    return { kind: 'none', evidence: '', url, retryHint: 'none' };
}

/**
 * Detect an interstitial on a live page (gathers body text + composer/turn presence).
 * @param {any} page
 * @returns {Promise<InterstitialResult>}
 */
export async function detectInterstitial(page) {
    const url = page?.url?.() || '';
    try {
        const bodyText = await page.innerText('body').catch(() => '');
        const hasComposer = await hasAnySelector(page, COMPOSER_SELECTORS);
        const hasTurns = await hasAnySelector(page, ASSISTANT_TURN_SELECTORS);
        return classifyInterstitial({ url, bodyText, hasComposer, hasTurns });
    } catch {
        return { kind: 'none', evidence: 'detection failed', url, retryHint: 'none' };
    }
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPageDeathError(err) {
    const msg = String((/** @type {{message?: string}} */ (err))?.message || err || '').toLowerCase();
    return msg.includes('target closed') || msg.includes('page closed') || msg.includes('browser has been closed') || msg.includes('crash');
}

/**
 * @param {any} page
 * @param {string[]} selectors
 * @returns {Promise<boolean>}
 */
async function hasAnySelector(page, selectors) {
    for (const sel of selectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) return true;
    }
    return false;
}
