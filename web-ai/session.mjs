// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
    generateSessionId,
    insertSession,
    listStoredSessions,
    patchSession,
    pruneSessions,
} from './session-store.mjs';

/**
 * @typedef {import('./session-store.mjs').WebAiSession} WebAiSession
 */

/**
 * @typedef {{
 *   vendor?: string,
 *   system?: string,
 *   prompt?: string,
 *   project?: string,
 *   goal?: string,
 *   context?: string,
 *   question?: string,
 *   output?: string,
 *   constraints?: string,
 *   attachmentPolicy?: string,
 *   model?: string,
 *   filePath?: string,
 *   timeout?: number|string,
 *   deadline?: string|number,
 *   deadlineAt?: string|number,
 *   [extra: string]: unknown,
 * }} WebAiEnvelope
 */

/**
 * @typedef {{
 *   vendor: string|null,
 *   url: string|null,
 *   promptHash: string,
 *   assistantCount: number,
 *   textHash: string,
 *   capturedAt: string,
 *   [extra: string]: unknown,
 * }} WebAiBaseline
 */

/** @type {Map<string, WebAiBaseline>} */
const baselines = new Map();
let loaded = false;
const STORE_PATH = join(process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent'), 'web-ai-baselines.json');

/**
 * @param {WebAiEnvelope} envelope
 * @returns {string}
 */
export function hashPrompt(envelope) {
    const payload = {
        vendor: envelope.vendor,
        system: envelope.system || '',
        prompt: envelope.prompt || '',
        project: envelope.project || '',
        goal: envelope.goal || '',
        context: envelope.context || '',
        question: envelope.question || '',
        output: envelope.output || '',
        constraints: envelope.constraints || '',
        attachmentPolicy: envelope.attachmentPolicy || 'inline-only',
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * @param {string|null|undefined} vendor
 * @param {string|null|undefined} url
 * @returns {string}
 */
export function makeBaselineKey(vendor, url) {
    return `${vendor}:${url || 'unknown-url'}`;
}

/**
 * @param {{ vendor: string, url: string, envelope: WebAiEnvelope, assistantCount: number, textHash: string }} input
 * @returns {WebAiBaseline}
 */
export function saveBaseline({ vendor, url, envelope, assistantCount, textHash }) {
    loadStore();
    /** @type {WebAiBaseline} */
    const baseline = {
        vendor,
        url,
        promptHash: hashPrompt(envelope),
        assistantCount,
        textHash,
        capturedAt: new Date().toISOString(),
    };
    baselines.set(makeBaselineKey(vendor, url), baseline);
    saveStore();
    return baseline;
}

/**
 * @param {string} vendor
 * @param {string} url
 * @returns {WebAiBaseline|null}
 */
export function getBaseline(vendor, url) {
    loadStore();
    return baselines.get(makeBaselineKey(vendor, url)) || null;
}

/**
 * @param {string} vendor
 * @param {{ sameHostUrl?: string }} [options]
 * @returns {WebAiBaseline|null}
 */
export function getLatestBaseline(vendor, options = {}) {
    loadStore();
    const sameHost = normalizeHost(options.sameHostUrl);
    const matches = Array.from(baselines.values())
        .filter((baseline) => baseline.vendor === vendor)
        .filter((baseline) => !sameHost || normalizeHost(baseline.url) === sameHost)
        .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
    return matches.at(-1) || null;
}

/**
 * @param {string|null|undefined} url
 * @returns {string}
 */
function normalizeHost(url) {
    try {
        return new URL(/** @type {string} */ (url)).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/**
 * @param {string} vendor
 * @param {string} url
 */
export function clearBaseline(vendor, url) {
    loadStore();
    baselines.delete(makeBaselineKey(vendor, url));
    saveStore();
}

function loadStore() {
    if (loaded) return;
    loaded = true;
    if (!existsSync(STORE_PATH)) return;
    try {
        const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
        for (const baseline of parsed.baselines || []) {
            if (baseline.vendor && baseline.url) baselines.set(makeBaselineKey(baseline.vendor, baseline.url), baseline);
        }
    } catch {
        baselines.clear();
    }
}

function saveStore() {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, `${JSON.stringify({ baselines: Array.from(baselines.values()) }, null, 2)}\n`);
}

// ─── Phase 1 PR1: session API on top of session-store.mjs ─────────────────
// Legacy `saveBaseline`/`getBaseline`/`getLatestBaseline`/`clearBaseline` keep
// writing `web-ai-baselines.json` for one minor release. New code should
// prefer `createSession` / `findActiveSession` / `getSession` / `updateSession`.

/**
 * @param {WebAiEnvelope|null|undefined} envelope
 * @param {{ vendor?: string, deadlineAt?: string|null, targetId?: string|null, tabId?: string|null, tabState?: Record<string, unknown>, originalUrl?: string|null, conversationUrl?: string|null, envelopeSummary?: Record<string, unknown> }} [meta]
 * @returns {WebAiSession}
 */
export function createSession(envelope, meta = {}) {
    const now = new Date().toISOString();
    /** @type {WebAiSession} */
    const session = {
        sessionId: generateSessionId(),
        vendor: envelope?.vendor || meta.vendor || null,
        createdAt: now,
        updatedAt: now,
        deadlineAt: meta.deadlineAt || null,
        targetId: meta.targetId || null,
        tabId: meta.tabId || null,
        tabState: meta.tabState || {
            createdAt: now,
            lastActiveAt: now,
            recoveryCount: 0,
            closeCount: 0,
        },
        originalUrl: meta.originalUrl || null,
        conversationUrl: meta.conversationUrl || meta.originalUrl || null,
        promptHash: `sha256:${hashPrompt(envelope || {})}`,
        envelopeSummary: meta.envelopeSummary || {},
        status: 'sent',
        answer: null,
        lastError: null,
        warnings: [],
        lastDomHash: null,
        lastAxHash: null,
        lastStreamingState: 'unknown',
        lastResponseCharCount: 0,
        trace: [],
    };
    return insertSession(session);
}

/**
 * @param {string} sessionId
 * @param {Partial<WebAiSession> & Record<string, unknown>} [patch]
 * @returns {WebAiSession|null}
 */
export function updateSession(sessionId, patch = {}) {
    return patchSession(sessionId, { ...patch, updatedAt: new Date().toISOString() });
}

/**
 * @param {string|null|undefined} sessionId
 * @returns {WebAiSession|null}
 */
export function getSession(sessionId) {
    if (!sessionId) return null;
    return listStoredSessions({ sessionId, limit: 1 })[0] || null;
}

/**
 * @param {Parameters<typeof listStoredSessions>[0]} [filter]
 * @returns {WebAiSession[]}
 */
export function listSessions(filter = {}) {
    return listStoredSessions(filter);
}

/**
 * @param {{ vendor?: string, targetId?: string, conversationUrl?: string }} [args]
 * @returns {WebAiSession|null}
 */
export function findActiveSession({ vendor, targetId, conversationUrl } = {}) {
    if (!vendor) return null;
    const active = listStoredSessions({ vendor, active: true });
    if (active.length === 0) return null;
    if (targetId) {
        const byTarget = active.find((s) => s.targetId && s.targetId === targetId);
        if (byTarget) return byTarget;
    }
    if (conversationUrl) {
        const byConvo = active.find((s) => s.conversationUrl && s.conversationUrl === conversationUrl);
        if (byConvo) return byConvo;
    }
    return active.at(-1) || null;
}

/**
 * @param {Parameters<typeof pruneSessions>[0]} [input]
 * @returns {ReturnType<typeof pruneSessions>}
 */
export function pruneSessionsOlderThan(input = {}) {
    return pruneSessions(input);
}

// ─── Phase 9.1: Tab Binding ───────────────────────────────────────

/**
 * @param {string} sessionId
 * @param {string} targetId
 * @param {string|null} [tabId]
 * @returns {WebAiSession|null}
 */
export function bindSessionToTab(sessionId, targetId, tabId = null) {
    return updateSession(sessionId, {
        targetId,
        tabId: tabId || targetId,
        tabState: {
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            recoveryCount: 0,
            closeCount: 0,
        },
    });
}

/**
 * @param {string} sessionId
 * @param {Record<string, unknown>} [updates]
 * @returns {WebAiSession|null}
 */
export function updateSessionTabState(sessionId, updates = {}) {
    const session = getSession(sessionId);
    if (!session) return null;

    const current = session.tabState || {};
    return updateSession(sessionId, {
        tabState: {
            ...current,
            ...updates,
            lastActiveAt: new Date().toISOString(),
        },
    });
}

/**
 * @param {string} sessionId
 * @returns {WebAiSession|null}
 */
export function incrementRecoveryCount(sessionId) {
    const session = getSession(sessionId);
    if (!session) return null;

    const current = /** @type {number} */ (session.tabState?.recoveryCount || 0);
    return updateSessionTabState(sessionId, { recoveryCount: current + 1 });
}

/** @type {Record<string, number>} */
const VENDOR_DEFAULT_TIMEOUT_SEC = { chatgpt: 1200, gemini: 1200, grok: 600 };

/**
 * @param {WebAiEnvelope} [input]
 * @param {string} [vendor]
 * @returns {string}
 */
export function resolveDeadlineAt(input = {}, vendor = 'chatgpt') {
    if (input.deadlineAt) return new Date(input.deadlineAt).toISOString();
    if (input.deadline) return new Date(input.deadline).toISOString();
    const seconds = Number(input.timeout) > 0
        ? Number(input.timeout)
        : VENDOR_DEFAULT_TIMEOUT_SEC[vendor] || 1200;
    return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * @param {WebAiEnvelope} [input]
 * @param {{ files?: unknown[], transport?: string } | null} [contextPack]
 * @returns {Record<string, unknown>}
 */
export function summarizeEnvelope(input = {}, contextPack = null) {
    /** @type {Record<string, unknown>} */
    const summary = {};
    if (input.model) summary.model = input.model;
    if (input.attachmentPolicy) summary.attachmentPolicy = input.attachmentPolicy;
    if (input.filePath) summary.filePath = input.filePath;
    if (contextPack?.files?.length) summary.fileCount = contextPack.files.length;
    if (contextPack?.transport) summary.contextTransport = contextPack.transport;
    return summary;
}

/**
 * @param {WebAiSession|null|undefined} session
 * @returns {WebAiBaseline|null}
 */
export function sessionToBaseline(session) {
    if (!session) return null;
    return {
        vendor: session.vendor,
        url: session.conversationUrl || session.originalUrl,
        promptHash: typeof session.promptHash === 'string' && session.promptHash.startsWith('sha256:')
            ? session.promptHash.slice('sha256:'.length)
            : session.promptHash,
        assistantCount: Number(session.envelopeSummary?.assistantCount) || 0,
        textHash: '0',
        capturedAt: session.createdAt,
    };
}
