// @ts-check
import { createEvalError } from './types.mjs';

const UNSAFE_PATTERNS = [
    { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
    { name: 'phone', pattern: /\+?\d[\d ().-]{8,}\d/ },
    { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
    { name: 'api-key', pattern: /\b(?:sk|pk|xoxb|ghp)_[A-Za-z0-9_-]{16,}\b/ },
    { name: 'cookie-storage', pattern: /\b(?:cookie|localStorage|sessionStorage)\b/i },
    { name: 'conversation-id', pattern: /\b(?:conversation|thread|session)[_-]?id["'=:\s-]+[A-Za-z0-9_-]{12,}\b/i },
    { name: 'avatar-url', pattern: /https?:\/\/[^"'\s>]*(?:avatar|profile|photo)[^"'\s>]*/i },
    { name: 'prompt-answer-marker', pattern: /\b(?:USER_PROMPT|ASSISTANT_ANSWER|SECRET_[A-Z0-9_]+)\b/ },
];

/**
 * @param {string} html
 * @param {{ forbiddenText?: string[] }} [options]
 * @returns {string}
 */
export function scrubProviderDom(html, { forbiddenText = [] } = {}) {
    let scrubbed = String(html || '');
    scrubbed = scrubbed.replace(UNSAFE_PATTERNS[0].pattern, '[redacted-email]');
    scrubbed = scrubbed.replace(UNSAFE_PATTERNS[2].pattern, '[redacted-jwt]');
    scrubbed = scrubbed.replace(UNSAFE_PATTERNS[3].pattern, '[redacted-key]');
    scrubbed = scrubbed.replace(UNSAFE_PATTERNS[1].pattern, '[redacted-phone]');
    scrubbed = scrubbed.replace(UNSAFE_PATTERNS[6].pattern, '[redacted-avatar-url]');
    for (const text of forbiddenText) {
        if (!text) continue;
        scrubbed = scrubbed.split(String(text)).join('[redacted-forbidden-text]');
    }
    return scrubbed;
}

/**
 * @param {string} html
 * @param {{ forbiddenText?: string[] }} [options]
 * @returns {true}
 */
export function assertScrubbedSafe(html, { forbiddenText = [] } = {}) {
    /** @type {string[]} */
    const issues = [];
    for (const entry of UNSAFE_PATTERNS) {
        if (entry.pattern.test(html)) issues.push(entry.name);
    }
    for (const text of forbiddenText) {
        if (text && String(html).includes(String(text))) issues.push(`forbidden:${text}`);
    }
    if (issues.length > 0) {
        throw createEvalError('eval.fixture-not-scrubbed', 'fixture-safety', 'provider fixture contains unsafe or unsanitized content', {
            issues,
        });
    }
    return true;
}
