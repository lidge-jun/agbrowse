// @ts-check

/**
 * @typedef {'cloudflare-challenge'|'login-required'|'empty-shell'|'loading'|'none'} InterstitialKind
 * @typedef {{ kind: InterstitialKind, evidence: string, url: string, retryHint: 'wait-and-retry'|'login'|'navigate'|'none' }} InterstitialResult
 * @typedef {'strong'|'shell-vetoed'|'weak'|'none'} CloudflareEvidenceKind
 * @typedef {{ kind: CloudflareEvidenceKind, evidence: string }} CloudflareVerdict
 * @typedef {{ url: string, title: string, bodyText: string, hasComposer: boolean, hasTurns: boolean, hasChallengeWidget: boolean, hasChallengeScript: boolean }} InterstitialSignals
 * @typedef {{ composer: readonly string[], turns: readonly string[] }} ShellSelectors
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} Scheduler
 */

const GENERIC_CHALLENGE_PATTERNS = [
    /verify(?:ing)? you are human/,
    /checking your browser/,
    /needs to review the security of your connection/,
    /checking if the site connection is secure/,
    /enable javascript and cookies/,
    /just a moment/,
    /ray id/,
];

const LOGIN_PATTERNS = ['log in', 'sign in', 'sign up', 'create an account', 'welcome back'];
const CHALLENGE_WIDGET_SELECTORS = [
    '#challenge-form',
    '#challenge-running',
    '#cf-challenge-running',
    '[class*="cf-challenge"]',
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="/cdn-cgi/challenge-platform/"]',
];
const CHALLENGE_SCRIPT_SELECTORS = ['script[src*="/cdn-cgi/challenge-platform/"]'];

export const INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER = Object.freeze({
    chatgpt: Object.freeze({
        composer: Object.freeze(['#prompt-textarea', '[data-testid="composer-textarea"]', 'div[contenteditable="true"]']),
        turns: Object.freeze(['[data-message-author-role="assistant"]', '[data-turn="assistant"]', 'article[data-testid^="conversation-turn"]']),
    }),
    grok: Object.freeze({
        composer: Object.freeze(['.ProseMirror', '[contenteditable="true"]']),
        turns: Object.freeze(['[data-testid="assistant-message"]']),
    }),
    gemini: Object.freeze({
        composer: Object.freeze(['rich-textarea [contenteditable="true"]', 'textarea']),
        turns: Object.freeze(['model-response', '[data-response-index]']),
    }),
});

export const CLOUDFLARE_SHORT_BODY_LENGTH = 600;

// Hosts whose empty hydrated shell is a recognized failure mode.
// ChatGPT keeps its historical SINGLE-SNAPSHOT judgment so its behavior is
// unchanged; Grok and Gemini were added in round 5 behind a hydration grace,
// because we have not characterized their loading behavior and turning a slow
// load into a hard error would be worse than the imprecise hint it replaces.
const EMPTY_SHELL_HOSTS_IMMEDIATE = new Set(['chatgpt.com', 'chat.openai.com']);
const EMPTY_SHELL_HOSTS_GRACED = new Set(['grok.com', 'gemini.google.com']);

/**
 * Classify a URL's host for empty-shell purposes. Parsed, never pattern-matched:
 * a bare regex would accept `notgrok.com` and any URL merely CONTAINING
 * `x.com/i/grok` in a query string.
 *
 * @param {string} url
 * @returns {'immediate'|'graced'|'none'}
 */
export function emptyShellHostKind(url) {
    let parsed;
    try {
        parsed = new URL(String(url));
    } catch {
        return 'none';
    }
    // Provider pages are HTTP(S) only; an ftp:// URL naming the same host is not
    // one of them.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'none';
    // A single terminal dot is a DNS-equivalent FQDN form ("grok.com." === "grok.com").
    const host = parsed.hostname.replace(/\.$/, '').replace(/^www\./, '');
    if (EMPTY_SHELL_HOSTS_IMMEDIATE.has(host)) return 'immediate';
    if (EMPTY_SHELL_HOSTS_GRACED.has(host)) return 'graced';
    // Grok on X lives at a specific path, not anywhere on the host. The bound
    // matters: `/i/groking` is a different page.
    if (host === 'x.com' && (parsed.pathname === '/i/grok' || parsed.pathname.startsWith('/i/grok/'))) return 'graced';
    return 'none';
}
const CLOUDFLARE_HYDRATION_GRACE_MS = 12_000;
const CLOUDFLARE_REPROBE_INTERVAL_MS = 500;
const PROBE_TIMEOUT_MS = 250;
const MIN_REPROBE_INTERVAL_MS = 1;

/** @param {Partial<InterstitialSignals>} signals @returns {CloudflareVerdict} */
export function classifyCloudflareVerdict({
    title = '', bodyText = '', hasComposer = false, hasTurns = false,
    hasChallengeWidget = false, hasChallengeScript = false,
} = {}) {
    const normalizedTitle = title.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedBody = bodyText.toLowerCase().replace(/\s+/g, ' ').trim();
    if (hasComposer || hasTurns) return { kind: 'shell-vetoed', evidence: hasComposer ? 'composer' : 'conversation turn' };

    const titleSaysChallenge = normalizedTitle.includes('just a moment')
        || (normalizedTitle.includes('attention required') && normalizedTitle.includes('cloudflare'));
    if (titleSaysChallenge) return { kind: 'strong', evidence: 'challenge title' };
    if (hasChallengeWidget) return { kind: 'strong', evidence: 'challenge widget' };

    const isShortPage = normalizedBody.length < CLOUDFLARE_SHORT_BODY_LENGTH;
    const matchedCopy = isShortPage ? GENERIC_CHALLENGE_PATTERNS.find((pattern) => pattern.test(normalizedBody)) : undefined;
    if (matchedCopy) return { kind: 'strong', evidence: `challenge copy: ${matchedCopy.source}` };
    if (isShortPage && hasChallengeScript) return { kind: 'weak', evidence: 'challenge script on short page' };
    return { kind: 'none', evidence: '' };
}

/** @param {Partial<InterstitialSignals>} signals @returns {InterstitialResult} */
export function classifyInterstitial({ url = '', bodyText = '', hasComposer = false, hasTurns = false, ...rest } = {}) {
    const cloudflare = classifyCloudflareVerdict({ bodyText, hasComposer, hasTurns, ...rest });
    if (cloudflare.kind === 'strong') {
        return { kind: 'cloudflare-challenge', evidence: cloudflare.evidence, url, retryHint: 'wait-and-retry' };
    }
    const lower = bodyText.toLowerCase();
    if (/^https:\/\/auth0?\.|\/auth\/|\/login/i.test(url)) {
        return { kind: 'login-required', evidence: `auth URL: ${url}`, url, retryHint: 'login' };
    }
    if (LOGIN_PATTERNS.some((pattern) => lower.includes(pattern)) && bodyText.length < 2000) {
        const matched = LOGIN_PATTERNS.find((pattern) => lower.includes(pattern)) || 'login';
        return { kind: 'login-required', evidence: matched, url, retryHint: 'login' };
    }
    if (!hasComposer && !hasTurns && bodyText.length < 500 && emptyShellHostKind(url) !== 'none') {
        return { kind: 'empty-shell', evidence: 'no composer and no turns', url, retryHint: 'wait-and-retry' };
    }
    return { kind: 'none', evidence: '', url, retryHint: 'none' };
}

/**
 * @param {any} page
 * @param {{ graceMs?: number, intervalMs?: number, probeTimeoutMs?: number, shellSelectors?: ShellSelectors, scheduler?: Scheduler }} [options]
 * @returns {Promise<InterstitialResult>}
 */
export async function detectInterstitial(page, {
    graceMs = CLOUDFLARE_HYDRATION_GRACE_MS,
    intervalMs = CLOUDFLARE_REPROBE_INTERVAL_MS,
    probeTimeoutMs = PROBE_TIMEOUT_MS,
    shellSelectors = { composer: [], turns: [] },
    scheduler = { now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
} = {}) {
    const url = page?.url?.() || '';
    const boundedGraceMs = Math.max(0, Number.isFinite(graceMs) ? graceMs : CLOUDFLARE_HYDRATION_GRACE_MS);
    const boundedIntervalMs = Math.max(MIN_REPROBE_INTERVAL_MS, Number.isFinite(intervalMs) ? intervalMs : CLOUDFLARE_REPROBE_INTERVAL_MS);
    const boundedProbeMs = Math.max(1, Number.isFinite(probeTimeoutMs) ? probeTimeoutMs : PROBE_TIMEOUT_MS);
    const deadline = scheduler.now() + boundedGraceMs;
    for (;;) {
        const signals = await gatherInterstitialSignals(page, url, shellSelectors, boundedProbeMs, scheduler);
        const verdict = classifyCloudflareVerdict(signals);
        if (verdict.kind === 'strong') return cloudflareResult(url, verdict.evidence);
        if (verdict.kind === 'shell-vetoed') return classifyInterstitial(signals);
        if (verdict.kind === 'none') {
            const result = classifyInterstitial(signals);
            // Only the graced providers re-probe. ChatGPT returns immediately, so
            // its behavior is byte-identical. `graced` never enters the verdict:
            // the loop knows about the grace, the public result does not.
            const graced = result.kind === 'empty-shell' && emptyShellHostKind(url) === 'graced';
            if (!graced || scheduler.now() >= deadline) return result;
            await scheduler.sleep(Math.min(boundedIntervalMs, Math.max(MIN_REPROBE_INTERVAL_MS, deadline - scheduler.now())));
            continue;
        }
        if (scheduler.now() >= deadline) return cloudflareResult(url, verdict.evidence);
        await scheduler.sleep(Math.min(boundedIntervalMs, Math.max(MIN_REPROBE_INTERVAL_MS, deadline - scheduler.now())));
    }
}

/** @param {string} url @param {string} evidence @returns {InterstitialResult} */
function cloudflareResult(url, evidence) {
    return { kind: 'cloudflare-challenge', evidence, url, retryHint: 'wait-and-retry' };
}

/** @param {any} page @param {string} url @param {ShellSelectors} shellSelectors @param {number} timeoutMs @param {Scheduler} scheduler @returns {Promise<InterstitialSignals>} */
async function gatherInterstitialSignals(page, url, shellSelectors, timeoutMs, scheduler) {
    const [title, bodyText, hasComposer, hasTurns, hasChallengeWidget, hasChallengeScript] = await Promise.all([
        boundedProbe(() => page.title(), '', timeoutMs, scheduler),
        boundedProbe(() => page.innerText('body'), '', timeoutMs, scheduler),
        hasAnySelector(page, shellSelectors.composer || [], timeoutMs, scheduler),
        hasAnySelector(page, shellSelectors.turns || [], timeoutMs, scheduler),
        hasAnySelector(page, CHALLENGE_WIDGET_SELECTORS, timeoutMs, scheduler),
        hasAnySelector(page, CHALLENGE_SCRIPT_SELECTORS, timeoutMs, scheduler),
    ]);
    return { url, title, bodyText, hasComposer, hasTurns, hasChallengeWidget, hasChallengeScript };
}

/** @template T @param {() => Promise<T>} probe @param {T} fallback @param {number} timeoutMs @param {Scheduler} scheduler @returns {Promise<T>} */
async function boundedProbe(probe, fallback, timeoutMs, scheduler) {
    try {
        return await Promise.race([Promise.resolve().then(probe), scheduler.sleep(timeoutMs).then(() => fallback)]);
    } catch {
        return fallback;
    }
}

/** @param {any} page @param {readonly string[]} selectors @param {number} timeoutMs @param {Scheduler} scheduler */
async function hasAnySelector(page, selectors, timeoutMs, scheduler) {
    for (const selector of selectors) {
        const count = await boundedProbe(() => page.locator(selector).count(), 0, timeoutMs, scheduler);
        if (count > 0) return true;
    }
    return false;
}

/** @param {unknown} err @returns {boolean} */
export function isPageDeathError(err) {
    const msg = String((/** @type {{message?: string}} */ (err))?.message || err || '').toLowerCase();
    return msg.includes('target closed') || msg.includes('page closed') || msg.includes('browser has been closed') || msg.includes('crash');
}
