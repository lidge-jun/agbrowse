// @ts-check
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { CACHE_SCHEMA_VERSION } from './constants.mjs';

/**
 * @typedef {{ domHashPrefix?: string|null, axHashPrefix?: string|null }} PageFingerprint
 *
 * @typedef {{
 *   provider?: string|null,
 *   urlHost?: string|null,
 *   intent?: string|null,
 *   actionKind?: string|null,
 *   domHashPrefix?: string|null,
 *   axHashPrefix?: string|null,
 * }} CacheKeyInput
 *
 * @typedef {{
 *   selector: string,
 *   role?: string|null,
 *   nameHash?: string|null,
 *   nameChars?: number,
 *   signatureHash?: string,
 * }} CachedTarget
 *
 * @typedef {{
 *   schemaVersion: number,
 *   provider?: string|null,
 *   intent?: string|null,
 *   actionKind?: string|null,
 *   urlHost?: string|null,
 *   pageFingerprint?: PageFingerprint,
 *   contractVersion?: string,
 *   framePath?: string|null,
 *   browserConfigHash?: string|null,
 *   target: CachedTarget,
 *   stats?: { hitCount?: number, lastValidatedAt?: string },
 * }} CacheEntry
 *
 * @typedef {{ schemaVersion: number, entries: Record<string, CacheEntry> }} ActionCache
 *
 * @typedef {{
 *   provider?: string|null,
 *   intent?: string|null,
 *   actionKind?: string|null,
 *   urlHost?: string|null,
 *   fingerprint?: PageFingerprint|null,
 * }} CacheLookupCtx
 *
 * @typedef {{
 *   selector: string,
 *   role?: string|null,
 *   name?: string|null,
 * }} ResolvedTarget
 */

const DEFAULT_HOME = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const CACHE_FILE = 'action-cache.json';
const STALE_MS = 30 * 86_400_000;

/**
 * @param {CacheKeyInput} input
 * @returns {string}
 */
export function cacheKey({ provider, urlHost, intent, actionKind, domHashPrefix, axHashPrefix }) {
    return [
        'v2',
        provider || '*',
        urlHost || '*',
        intent || '*',
        actionKind || '*',
        domHashPrefix || '*',
        axHashPrefix || '*',
    ].join('|');
}

/**
 * @param {string} [homeDir]
 * @returns {ActionCache}
 */
export function loadActionCache(homeDir = DEFAULT_HOME) {
    const path = join(homeDir, CACHE_FILE);
    if (!existsSync(path)) return createEmptyCache();
    try {
        const raw = JSON.parse(readFileSync(path, 'utf8'));
        if (raw.schemaVersion !== CACHE_SCHEMA_VERSION) {
            return createEmptyCache();
        }
        const now = Date.now();
        /** @type {Record<string, CacheEntry>} */
        const entries = {};
        for (const [key, entry] of Object.entries(raw.entries || {})) {
            const e = /** @type {CacheEntry} */ (entry);
            const lastValidated = e.stats?.lastValidatedAt ? new Date(e.stats.lastValidatedAt).getTime() : 0;
            if (now - lastValidated < STALE_MS) {
                entries[key] = e;
            }
        }
        return { schemaVersion: CACHE_SCHEMA_VERSION, entries };
    } catch {
        return createEmptyCache();
    }
}

/** @returns {ActionCache} */
function createEmptyCache() {
    return { schemaVersion: CACHE_SCHEMA_VERSION, entries: {} };
}

/**
 * @param {ActionCache} cache
 * @param {string} [homeDir]
 */
export function saveActionCache(cache, homeDir = DEFAULT_HOME) {
    mkdirSync(homeDir, { recursive: true });
    const path = join(homeDir, CACHE_FILE);
    const tmpPath = path + `.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(cache, null, 2));
    renameSync(tmpPath, path);
}

/**
 * @param {ActionCache|null|undefined} cache
 * @param {CacheLookupCtx} ctx
 */
export function getCachedTarget(cache, { provider, intent, actionKind, urlHost, fingerprint }) {
    if (!cache?.entries) return null;
    const key = cacheKey({
        provider,
        urlHost,
        intent,
        actionKind,
        domHashPrefix: fingerprint?.domHashPrefix || null,
        axHashPrefix: fingerprint?.axHashPrefix || null,
    });
    const entry = cache.entries[key];
    if (!entry) return null;
    return {
        target: {
            ...entry.target,
            schemaVersion: entry.schemaVersion,
            contractVersion: entry.contractVersion,
            framePath: entry.framePath,
            browserConfigHash: entry.browserConfigHash,
        },
        key,
        entry,
    };
}

/**
 * @param {ActionCache|null|undefined} cache
 * @param {{ provider?: string|null, intent?: string|null, actionKind?: string|null, urlHost?: string|null }} ctx
 * @param {ResolvedTarget|null|undefined} resolvedTarget
 * @param {PageFingerprint|null|undefined} fingerprint
 * @param {{ contractVersion?: string, framePath?: string|null, browserConfigHash?: string|null }} [meta]
 */
export function updateCacheEntry(cache, ctx, resolvedTarget, fingerprint, {
    contractVersion = '1.0',
    framePath = null,
    browserConfigHash = null,
} = {}) {
    if (!cache || !resolvedTarget?.selector) return;
    const { provider, intent, actionKind, urlHost } = ctx;
    const key = cacheKey({
        provider,
        urlHost,
        intent,
        actionKind,
        domHashPrefix: fingerprint?.domHashPrefix || null,
        axHashPrefix: fingerprint?.axHashPrefix || null,
    });
    const existing = cache.entries[key];
    cache.entries[key] = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider,
        intent,
        actionKind,
        urlHost: urlHost || null,
        pageFingerprint: fingerprint || {},
        contractVersion,
        framePath,
        browserConfigHash,
        target: {
            selector: resolvedTarget.selector,
            role: resolvedTarget.role || null,
            nameHash: resolvedTarget.name ? hashField(resolvedTarget.name) : null,
            nameChars: resolvedTarget.name ? String(resolvedTarget.name).length : 0,
            signatureHash: signatureHash({ provider, intent, actionKind, role: resolvedTarget.role, selector: resolvedTarget.selector }),
        },
        stats: {
            hitCount: (existing?.stats?.hitCount || 0) + 1,
            lastValidatedAt: new Date().toISOString(),
        },
    };
}

/** @param {string|number|boolean} value */
function hashField(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}

/**
 * @param {{ provider?: string|null, intent?: string|null, actionKind?: string|null, role?: string|null, selector: string }} input
 */
function signatureHash({ provider, intent, actionKind, role, selector }) {
    const input = [provider, intent, actionKind, role, selector].join('|');
    return `sha256:${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

/** @param {string} [homeDir] */
export function createActionCacheHandle(homeDir = DEFAULT_HOME) {
    const cache = loadActionCache(homeDir);
    return {
        /** @param {CacheLookupCtx} lookupCtx */
        get(lookupCtx) {
            return getCachedTarget(cache, lookupCtx);
        },
        /**
         * @param {{ provider?: string|null, intent?: string|null, actionKind?: string|null, urlHost?: string|null }} ctx
         * @param {ResolvedTarget|null|undefined} resolvedTarget
         * @param {PageFingerprint|null|undefined} fingerprint
         * @param {{ contractVersion?: string, framePath?: string|null, browserConfigHash?: string|null }} [meta]
         */
        update(ctx, resolvedTarget, fingerprint, meta) {
            updateCacheEntry(cache, ctx, resolvedTarget, fingerprint, meta);
        },
        save() {
            saveActionCache(cache, homeDir);
        },
        raw() {
            return cache;
        },
    };
}
