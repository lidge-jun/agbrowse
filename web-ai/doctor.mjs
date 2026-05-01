import { createHash } from 'node:crypto';
import { domHashAround, selectorMatchSummary } from './dom-hash.mjs';
import { findActiveSession } from './session.mjs';
import { CHATGPT_COPY_SELECTORS, GEMINI_COPY_SELECTORS, GROK_COPY_SELECTORS } from './copy-markdown.mjs';
import { CHATGPT_MODEL_SELECTOR_BUTTONS } from './chatgpt-model.mjs';

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

const PROVIDER_HOSTS = {
    chatgpt: new Set(['chatgpt.com', 'chat.openai.com']),
    gemini: new Set(['gemini.google.com']),
    grok: new Set(['grok.com']),
};

const DEFAULT_MAX_REPORT_BYTES = 4096;
const FULL_MAX_REPORT_BYTES = 16384;

export function featureDefinitionsForVendor(vendor) {
    switch (vendor) {
        case 'chatgpt': return CHATGPT_FEATURES.map(f => ({ ...f }));
        case 'gemini': return GEMINI_FEATURES.map(f => ({ ...f }));
        case 'grok': return GROK_FEATURES.map(f => ({ ...f }));
        default: return [];
    }
}

export async function diagnoseFeature(page, feature, options = {}) {
    const matches = await selectorMatchSummary(page, feature.selectors);
    const anyVisible = matches.some(m => m.visible);
    const anyMatched = matches.some(m => m.matched > 0);
    const totalMatches = matches.reduce((s, m) => s + m.matched, 0);
    return {
        feature: feature.feature,
        selectorsTried: feature.selectors,
        selectorMatches: matches.filter(m => m.matched > 0),
        selectorCounts: { tried: feature.selectors.length, matched: matches.filter(m => m.matched > 0).length, total: totalMatches },
        state: anyVisible ? 'ok' : anyMatched ? 'warn' : 'fail',
        domHash: await domHashAround(page, feature.selectors, options),
    };
}

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

    const lastSession = findActiveSession({ vendor, conversationUrl: url });
    const report = {
        vendor,
        url: redactUrl(url),
        capturedAt: new Date().toISOString(),
        features,
        lastSession: lastSession ? summarizeSessionForDoctor(lastSession, options) : null,
        warnings,
    };
    const maxBytes = options.full ? FULL_MAX_REPORT_BYTES : DEFAULT_MAX_REPORT_BYTES;
    return clampReport(report, maxBytes);
}

function redactUrl(url) {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch {
        return url;
    }
}

function summarizeSessionForDoctor(session, options = {}) {
    const base = {
        sessionId: session.sessionId,
        status: session.status,
        deadlineAt: session.deadlineAt || null,
    };
    if (session.composerBefore) base.composerBeforeChars = session.composerBefore.length;
    if (session.composerAfter) {
        base.composerAfterChars = session.composerAfter.length;
        base.composerAfterHash = `sha256:${createHash('sha256').update(session.composerAfter).digest('hex').slice(0, 16)}`;
    }
    return base;
}

function byteLength(str) {
    return Buffer.byteLength(str, 'utf8');
}

function clampReport(report, maxBytes) {
    const raw = JSON.stringify(report);
    if (byteLength(raw) <= maxBytes) return report;
    const rawBytes = byteLength(raw);
    const clamped = { ...report, truncated: true, maxBytes };
    clamped.features = clamped.features.map(f => ({
        feature: f.feature,
        selectorCounts: f.selectorCounts,
        state: f.state,
        domHash: f.domHash,
    }));
    if (clamped.lastSession?.composerBefore) delete clamped.lastSession.composerBefore;
    if (clamped.lastSession?.composerAfter) delete clamped.lastSession.composerAfter;
    clamped.warnings = [...(clamped.warnings || []), `report-clamped:${rawBytes}→${maxBytes}`];
    const clampedJson = JSON.stringify(clamped);
    if (byteLength(clampedJson) > maxBytes) {
        clamped.features = clamped.features.map(f => ({ feature: f.feature, state: f.state }));
        clamped.lastSession = null;
    }
    return clamped;
}
