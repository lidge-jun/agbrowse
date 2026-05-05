// @ts-check
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { domHashAround, selectorMatchSummary } from './dom-hash.mjs';
import { findActiveSession } from './session.mjs';
import { CHATGPT_COPY_SELECTORS, GEMINI_COPY_SELECTORS, GROK_COPY_SELECTORS } from './copy-markdown.mjs';
import { CHATGPT_MODEL_SELECTOR_BUTTONS } from './chatgpt-model.mjs';
import { buildWebAiSnapshot, summarizeSnapshotForDoctor } from './ax-snapshot.mjs';
import { observeProviderTargets } from './observe-targets.mjs';
import { editorContractForVendor } from './vendor-editor-contract.mjs';
import { reportCacheMetricsFromEvents } from './cache-metrics.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('./vendor-editor-contract.mjs').VendorName} VendorName */
/** @typedef {{ feature: string, selectors: readonly string[] }} FeatureDefinition */

const CHATGPT_FEATURES = [
    { feature: 'composer', selectors: ['#prompt-textarea', '[data-testid="composer-textarea"]', 'div[contenteditable="true"]'] },
    { feature: 'model-picker', selectors: CHATGPT_MODEL_SELECTOR_BUTTONS },
    { feature: 'upload', selectors: ['button[aria-label*="Upload" i]', 'button[aria-label*="Attach" i]', 'button[data-testid*="plus" i]'] },
    { feature: 'response-feed', selectors: ['[data-message-author-role="assistant"]', '[data-turn="assistant"]', 'article[data-testid^="conversation-turn"]'] },
    { feature: 'copy-fallback', selectors: CHATGPT_COPY_SELECTORS.copyButtonSelectors },
    { feature: 'streaming-indicator', selectors: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'] },
];

const GEMINI_FEATURES = [
    { feature: 'composer', selectors: ['rich-textarea .ql-editor', '[role="textbox"][aria-label*="prompt" i]', 'div[contenteditable="true"]'] },
    { feature: 'model-picker', selectors: ['button[data-test-id="bard-mode-menu-button"]', 'button[aria-label="Open mode picker"]'] },
    { feature: 'upload', selectors: ['button[aria-label="Open upload file menu"]', 'button[aria-label*="upload file menu" i]'] },
    { feature: 'response-feed', selectors: ['model-response', '[data-response-index]'] },
    { feature: 'copy-fallback', selectors: GEMINI_COPY_SELECTORS.copyButtonSelectors },
    { feature: 'streaming-indicator', selectors: ['.response-footer.complete', 'message-actions', '[aria-label*="Good response" i]'] },
];

const GROK_FEATURES = [
    { feature: 'composer', selectors: ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"].ProseMirror'] },
    { feature: 'model-picker', selectors: ['button[aria-label="Model select"]', 'button[aria-label*="Model select" i]'] },
    { feature: 'upload', selectors: ['button[aria-label*="Upload" i]', 'button[aria-label*="Attach" i]', 'button[data-testid*="plus" i]'] },
    { feature: 'response-feed', selectors: ['[data-testid="assistant-message"]', '[id^="response-"]:has([data-testid="assistant-message"])'] },
    { feature: 'copy-fallback', selectors: GROK_COPY_SELECTORS.copyButtonSelectors },
    { feature: 'streaming-indicator', selectors: ['button[aria-label*="Stop" i]'] },
];

/** @type {Readonly<Record<string, Set<string>>>} */
const PROVIDER_HOSTS = {
    chatgpt: new Set(['chatgpt.com', 'chat.openai.com']),
    gemini: new Set(['gemini.google.com']),
    grok: new Set(['grok.com']),
};

const DEFAULT_MAX_REPORT_BYTES = 4096;
const FULL_MAX_REPORT_BYTES = 16384;

/**
 * @param {string} vendor
 * @returns {FeatureDefinition[]}
 */
export function featureDefinitionsForVendor(vendor) {
    /** @param {FeatureDefinition} f */
    const deepCopy = f => ({ ...f, selectors: [...f.selectors] });
    switch (vendor) {
        case 'chatgpt': return CHATGPT_FEATURES.map(deepCopy);
        case 'gemini': return GEMINI_FEATURES.map(deepCopy);
        case 'grok': return GROK_FEATURES.map(deepCopy);
        default: return [];
    }
}

/**
 * @param {Page} page
 * @param {FeatureDefinition} feature
 * @param {Record<string, any>} [options]
 */
export async function diagnoseFeature(page, feature, options = {}) {
    const matches = await selectorMatchSummary(page, /** @type {string[]} */ (/** @type {unknown} */ (feature.selectors)));
    const anyVisible = matches.some(m => m.visible);
    const anyMatched = matches.some(m => m.matched > 0);
    const totalMatches = matches.reduce((s, m) => s + m.matched, 0);
    return {
        feature: feature.feature,
        selectorsTried: feature.selectors,
        selectorMatches: matches.filter(m => m.matched > 0),
        selectorCounts: { tried: feature.selectors.length, matched: matches.filter(m => m.matched > 0).length, total: totalMatches },
        state: anyVisible ? 'ok' : anyMatched ? 'warn' : 'fail',
        domHash: await domHashAround(page, /** @type {string[]} */ (/** @type {unknown} */ (feature.selectors)), options),
    };
}

/**
 * @param {{ getPage: () => Promise<Page> }} deps
 * @param {Record<string, any>} [options]
 */
export async function runDoctor(deps, options = {}) {
    const page = await deps.getPage();
    const vendor = options.vendor || 'chatgpt';
    const url = await page.url();
    const warnings = [];

    const allowedHosts = PROVIDER_HOSTS[vendor];
    let hostOk = false;
    if (allowedHosts) {
        try { hostOk = allowedHosts.has(new URL(url).hostname); } catch { hostOk = false; }
    }
    if (!hostOk) {
        warnings.push(`host-mismatch:expected=${[...(allowedHosts || [])].join(',')}`);
    }

    const features = hostOk
        ? await Promise.all(featureDefinitionsForVendor(vendor).map(f => diagnoseFeature(page, f, options)))
        : featureDefinitionsForVendor(vendor).map(f => ({
            feature: f.feature, selectorsTried: f.selectors, selectorMatches: [],
            selectorCounts: { tried: f.selectors.length, matched: 0, total: 0 },
            state: 'fail', domHash: null,
        }));

    let snapshotSummary = null;
    let semanticTargets = null;
    if (options.snapshot === true || options.snapshot === 'interactive') {
        try {
            const snapshot = await buildWebAiSnapshot(page, {
                provider: vendor,
                compact: true,
                interactiveOnly: true,
                maxDepth: options.snapshotMaxDepth || 6,
            });
            snapshotSummary = summarizeSnapshotForDoctor(snapshot);
            semanticTargets = sanitizeObservedTargetsForDoctor(
                await observeProviderTargets(page, {
                    provider: vendor,
                    featureMap: /** @type {any} */ (editorContractForVendor(vendor)),
                    snapshot,
                }),
            );
        } catch (err) {
            warnings.push(`snapshot-failed:${(/** @type {any} */ (err))?.errorCode || (/** @type {any} */ (err))?.message || String(err)}`);
            snapshotSummary = {
                enabled: false,
                contentSafe: true,
                errorCode: (/** @type {any} */ (err))?.errorCode || 'snapshot.failed',
                retryHint: (/** @type {any} */ (err))?.retryHint || 're-run-without-snapshot',
            };
        }
    }

    const lastSession = findActiveSession({ vendor, conversationUrl: url });
    /** @type {Record<string, any>} */
    const report = {
        vendor,
        url: redactUrl(url),
        capturedAt: new Date().toISOString(),
        features,
        ...(snapshotSummary ? { snapshot: snapshotSummary } : {}),
        ...(semanticTargets ? { semanticTargets } : {}),
        lastSession: lastSession ? (/** @type {any} */ (summarizeSessionForDoctor))(lastSession, options) : null,
        warnings,
    };

    if (options.cacheMetrics) {
        const homeDir = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
        const metrics = reportCacheMetricsFromEvents(homeDir);
        report.cacheMetrics = metrics;
    }

    const maxBytes = options.full ? FULL_MAX_REPORT_BYTES : DEFAULT_MAX_REPORT_BYTES;
    return clampReport(report, maxBytes);
}

/**
 * @param {string} url
 */
function redactUrl(url) {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch {
        return url;
    }
}

/**
 * @param {any} session
 */
function summarizeSessionForDoctor(session) {
    return {
        sessionId: session.sessionId,
        status: session.status,
        deadlineAt: session.deadlineAt || null,
        composerBeforeChars: session.composerBefore?.length ?? null,
        composerAfterChars: session.composerAfter?.length ?? null,
    };
}

/**
 * @param {Record<string, any[]>} [observed]
 */
function sanitizeObservedTargetsForDoctor(observed = {}) {
    /** @type {Record<string, any[]>} */
    const out = {};
    for (const [feature, candidates] of Object.entries(observed)) {
        out[feature] = (candidates || []).slice(0, 8).map(/** @param {any} candidate */ candidate => {
            const { name, ...rest } = candidate;
            return {
                ...rest,
                ...(name !== undefined ? {
                    nameHash: name ? doctorHashField(name) : null,
                    nameChars: name ? String(name).length : 0,
                } : {}),
            };
        });
    }
    return out;
}

/**
 * @param {unknown} value
 */
function doctorHashField(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}

/**
 * @param {string} str
 */
function byteLength(str) {
    return Buffer.byteLength(str, 'utf8');
}

/**
 * @param {Record<string, any>} report
 * @param {number} maxBytes
 */
function clampReport(report, maxBytes) {
    if (byteLength(JSON.stringify(report)) <= maxBytes) return report;
    const rawBytes = byteLength(JSON.stringify(report));
    /** @type {Record<string, any>} */
    const clamped = { ...report, truncated: true, maxBytes };
    clamped.features = clamped.features.map(/** @param {any} f */ f => ({
        feature: f.feature,
        selectorCounts: f.selectorCounts,
        state: f.state,
        domHash: f.domHash,
    }));
    clamped.lastSession = null;
    clamped.warnings = [...(clamped.warnings || []), `report-clamped:${rawBytes}→${maxBytes}`];
    if (byteLength(JSON.stringify(clamped)) > maxBytes) {
        clamped.features = clamped.features.map(/** @param {any} f */ f => ({ feature: f.feature, state: f.state }));
        clamped.warnings = [`report-clamped:${rawBytes}→${maxBytes}`];
    }
    if (byteLength(JSON.stringify(clamped)) > maxBytes) {
        clamped.url = clamped.url?.slice(0, 64) || null;
    }
    if (byteLength(JSON.stringify(clamped)) > maxBytes) {
        return { vendor: clamped.vendor, truncated: true, maxBytes, features: [], warnings: [`report-clamped:${rawBytes}→${maxBytes}`] };
    }
    return clamped;
}
