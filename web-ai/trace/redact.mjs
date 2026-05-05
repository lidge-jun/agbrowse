// @ts-check

const REDACTIONS = [
    { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[redacted-email]' },
    { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[redacted-jwt]' },
    { name: 'api-key', pattern: /\b(?:sk|pk|xoxb|ghp)[_-][A-Za-z0-9_-]{12,}\b/g, replacement: '[redacted-key]' },
    { name: 'cookie', pattern: /\b(cookie|set-cookie|authorization)\b\s*[:=]\s*[^,\n\r}]+/gi, replacement: '$1:[redacted]' },
    { name: 'storage', pattern: /\b(localStorage|sessionStorage)\b[^,\n\r}]+/gi, replacement: '$1:[redacted]' },
];

const REDACT_KEYS = new Set([
    'prompt',
    'question',
    'answerText',
    'pageText',
    'pageHtml',
    'providerOutput',
    'sourceContext',
    'text',
    'markdown',
    'composerText',
    'cookie',
    'cookies',
    'localStorage',
    'sessionStorage',
    'authorization',
]);

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactTraceValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (Array.isArray(value)) return value.map(redactTraceValue);
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(/** @type {Record<string, unknown>} */ (value)).map(([key, child]) => {
            if (REDACT_KEYS.has(key)) return [key, '[redacted]'];
            return [key, redactTraceValue(child)];
        }));
    }
    return value;
}

/**
 * @param {unknown} text
 * @returns {string}
 */
export function redactString(text) {
    let out = String(text);
    for (const rule of REDACTIONS) out = out.replace(rule.pattern, rule.replacement);
    return out;
}
