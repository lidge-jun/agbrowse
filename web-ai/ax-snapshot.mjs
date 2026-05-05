// @ts-check
/// <reference types="playwright-core" />
import { createHash, randomUUID } from 'node:crypto';
import { domHashAround } from './dom-hash.mjs';
import { WebAiError } from './errors.mjs';

/**
 * @typedef {{
 *   role?: string,
 *   name?: string,
 *   value?: string|number|boolean,
 *   description?: string,
 *   keyshortcuts?: string,
 *   roledescription?: string,
 *   valuetext?: string,
 *   disabled?: boolean,
 *   expanded?: boolean,
 *   focused?: boolean,
 *   focusable?: boolean,
 *   modal?: boolean,
 *   multiline?: boolean,
 *   multiselectable?: boolean,
 *   readonly?: boolean,
 *   required?: boolean,
 *   selected?: boolean,
 *   checked?: boolean|'mixed',
 *   pressed?: boolean|'mixed',
 *   level?: number,
 *   valuemin?: number,
 *   valuemax?: number,
 *   autocomplete?: string,
 *   haspopup?: string,
 *   invalid?: string,
 *   orientation?: string,
 *   children?: AxNode[],
 *   [key: string]: unknown,
 * }} AxNode
 *
 * @typedef {{
 *   ref: string,
 *   role: string,
 *   name: string,
 *   occurrenceIndex: number,
 *   selector: string|null,
 *   framePath: string[],
 *   shadowPath: string[],
 *   signatureHash: string,
 * }} InteractiveRef
 *
 * @typedef {{
 *   compact: boolean,
 *   maxDepth: number,
 *   refPrefix: string,
 *   redactText: boolean,
 * }} SerializeOptions
 *
 * @typedef {SerializeOptions & {
 *   refs: Record<string, InteractiveRef>,
 *   nextRef: number,
 *   nodeCount: number,
 *   occurrenceCounts: Map<string, number>,
 * }} SerializeContext
 *
 * @typedef {{
 *   snapshotId: string,
 *   provider: string|null,
 *   url: string|null,
 *   domHash: string|null,
 *   axHash: string,
 *   text: string,
 *   refs: Record<string, InteractiveRef>,
 *   stats: { nodeCount: number, interactiveCount: number, tokenEstimate: number },
 * }} WebAiSnapshot
 */

export const DEFAULT_SNAPSHOT_MAX_DEPTH = 6;
export const DEFAULT_MAX_NAME_CHARS = 900;
/** @type {Set<string>} */
export const DEFAULT_INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
    'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab',
    'slider', 'spinbutton', 'treeitem', 'listbox', 'gridcell', 'cell',
]);

/**
 * @param {import('playwright-core').Page} page
 * @param {{
 *   provider?: string|null,
 *   compact?: boolean,
 *   interactiveOnly?: boolean,
 *   maxDepth?: number,
 *   rootSelector?: string|null,
 *   refPrefix?: string,
 *   redactText?: boolean,
 *   includeDomHash?: boolean,
 *   domHashMaxChars?: number,
 * }} [options]
 * @returns {Promise<WebAiSnapshot>}
 */
export async function buildWebAiSnapshot(page, {
    provider = null,
    compact = true,
    interactiveOnly = true,
    maxDepth = DEFAULT_SNAPSHOT_MAX_DEPTH,
    rootSelector = null,
    refPrefix = '@e',
    redactText = false,
    includeDomHash = true,
    domHashMaxChars = 32768,
} = {}) {
    const tree = await captureAccessibilitySnapshot(page, { interactiveOnly, rootSelector });
    const serialized = serializeAxTree(tree, { compact, maxDepth, refPrefix, redactText });
    const domHash = includeDomHash
        ? await domHashAround(page, rootSelector ? [rootSelector] : ['body'], { maxChars: domHashMaxChars }).catch(() => null)
        : null;
    const text = serialized.text || '- document';
    return {
        snapshotId: randomUUID(),
        provider,
        url: page.url?.() || null,
        domHash,
        axHash: hashAccessibilitySnapshot(text),
        text,
        refs: serialized.refs,
        stats: {
            nodeCount: serialized.nodeCount,
            interactiveCount: Object.keys(serialized.refs).length,
            tokenEstimate: estimateSnapshotTokens(text),
        },
    };
}

/** @param {string} snapshotText */
export function estimateSnapshotTokens(snapshotText) {
    return Math.ceil(String(snapshotText || '').length / 4);
}

/** @param {string} snapshotText */
export function hashAccessibilitySnapshot(snapshotText) {
    const normalized = String(snapshotText || '').replace(/\s+/g, ' ').trim();
    return `sha256:${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

/**
 * @param {WebAiSnapshot|AxNode|null|undefined} snapshot
 * @param {string} [prefix]
 * @returns {Record<string, InteractiveRef>}
 */
export function extractInteractiveRefs(snapshot, prefix = '@e') {
    if (snapshot && /** @type {WebAiSnapshot} */ (snapshot).refs && typeof /** @type {WebAiSnapshot} */ (snapshot).refs === 'object' && !(/** @type {AxNode} */ (snapshot).role)) {
        return { .../** @type {WebAiSnapshot} */ (snapshot).refs };
    }
    /** @type {Record<string, InteractiveRef>} */
    const refs = {};
    let counter = 1;
    /** @type {Map<string, number>} */
    const occurrenceCounts = new Map();
    walkAx(/** @type {AxNode} */ (snapshot), (node, depth, path) => {
        if (!isInteractiveNode(node)) return;
        const ref = `${prefix}${counter++}`;
        const name = truncateName(node.name || '');
        const role = String(node.role || 'unknown');
        const occurrenceKey = roleNameKey(role, name);
        const occurrenceIndex = occurrenceCounts.get(occurrenceKey) || 0;
        occurrenceCounts.set(occurrenceKey, occurrenceIndex + 1);
        refs[ref] = {
            ref,
            role,
            name,
            occurrenceIndex,
            selector: null,
            framePath: [],
            shadowPath: [],
            signatureHash: hashElementSignature({ role, name, depth, path }),
        };
    });
    return refs;
}

/**
 * @param {WebAiSnapshot|null|undefined} snapshot
 * @param {{ maxRefs?: number }} [options]
 */
export function summarizeSnapshotForDoctor(snapshot, { maxRefs = 8 } = {}) {
    const refs = Object.values(snapshot?.refs || {}).slice(0, maxRefs);
    return {
        enabled: true,
        contentSafe: true,
        snapshotId: snapshot?.snapshotId || null,
        axHash: snapshot?.axHash || null,
        domHash: snapshot?.domHash || null,
        interactiveCount: snapshot?.stats?.interactiveCount || 0,
        tokenEstimate: snapshot?.stats?.tokenEstimate || 0,
        topRefs: refs.map(ref => ({
            ref: ref.ref,
            role: ref.role,
            nameHash: ref.name ? hashDoctorField(ref.name) : null,
            nameChars: ref.name ? ref.name.length : 0,
        })),
    };
}

/**
 * @param {import('playwright-core').Page} page
 * @param {{ interactiveOnly: boolean, rootSelector: string|null }} options
 * @returns {Promise<AxNode|null>}
 */
async function captureAccessibilitySnapshot(page, { interactiveOnly, rootSelector }) {
    const ax = /** @type {{ snapshot?: (opts: { interestingOnly?: boolean, root?: unknown }) => Promise<AxNode|null> } | undefined} */ (
        /** @type {{ accessibility?: unknown } | null | undefined} */ (/** @type {unknown} */ (page))?.accessibility
    );
    if (!ax || typeof ax.snapshot !== 'function') {
        throw new WebAiError({
            errorCode: 'snapshot.unavailable',
            stage: 'snapshot-capture',
            retryHint: 'pin-playwright-or-add-cdp-fallback',
            message: 'page.accessibility.snapshot() is not available in this Playwright runtime',
        });
    }
    /** @type {import('playwright-core').ElementHandle|null} */
    let root = null;
    try {
        if (rootSelector) {
            root = await page.locator(rootSelector).elementHandle().catch(() => null);
            if (!root) {
                throw new WebAiError({
                    errorCode: 'snapshot.root-not-found',
                    stage: 'snapshot-capture',
                    retryHint: 'fix-root-selector',
                    message: `snapshot root selector did not match: ${rootSelector}`,
                    evidence: { rootSelector },
                });
            }
        }
        return await ax.snapshot({
            interestingOnly: interactiveOnly,
            ...(root ? { root } : {}),
        });
    } finally {
        await root?.dispose?.().catch(() => undefined);
    }
}

/**
 * @param {AxNode|null|undefined} tree
 * @param {SerializeOptions} options
 */
function serializeAxTree(tree, options) {
    /** @type {SerializeContext} */
    const ctx = { ...options, refs: {}, nextRef: 1, nodeCount: 0, occurrenceCounts: new Map() };
    const lines = serializeNode(tree || { role: 'document', name: '' }, 0, ctx, []);
    return { text: lines.join('\n'), refs: ctx.refs, nodeCount: ctx.nodeCount };
}

/**
 * @param {AxNode|null|undefined} node
 * @param {number} depth
 * @param {SerializeContext} ctx
 * @param {number[]} path
 * @returns {string[]}
 */
function serializeNode(node, depth, ctx, path) {
    if (!node || depth > ctx.maxDepth) return [];
    ctx.nodeCount += 1;
    const role = sanitizeRole(node.role || 'generic');
    const rawName = truncateName(node.name || '');
    const name = ctx.redactText && rawName ? `[redacted:${hashDoctorField(rawName)}]` : rawName;
    const indent = '  '.repeat(depth);
    /** @type {string[]} */
    const attrs = [];

    if (isInteractiveNode(node)) {
        const ref = `${ctx.refPrefix}${ctx.nextRef++}`;
        const occurrenceKey = roleNameKey(role, rawName);
        const occurrenceIndex = ctx.occurrenceCounts.get(occurrenceKey) || 0;
        ctx.occurrenceCounts.set(occurrenceKey, occurrenceIndex + 1);
        attrs.push(`ref=${ref}`);
        ctx.refs[ref] = {
            ref, role, name: rawName,
            occurrenceIndex,
            selector: null, framePath: [], shadowPath: [],
            signatureHash: hashElementSignature({ role, name: rawName, depth, path }),
        };
    }
    for (const attr of ['checked', 'disabled', 'expanded', 'selected', 'pressed', 'level', 'value']) {
        const v = /** @type {Record<string, unknown>} */ (node)[attr];
        if (v !== undefined && v !== null && v !== '') {
            attrs.push(`${attr}=${formatAttrValue(v)}`);
        }
    }

    const children = Array.isArray(node.children) ? node.children : [];
    const singleText = ctx.compact ? singleTextChild(node) : null;

    if (role === 'text') return [`${indent}- text: ${quoteAxString(name)}`];

    if (singleText && !name) {
        const renderedText = ctx.redactText ? `[redacted:${hashDoctorField(singleText)}]` : truncateName(singleText);
        return [`${indent}- ${role}: ${quoteAxString(renderedText)}${attrs.length ? ` [${attrs.join(' ')}]` : ''}`];
    }

    const head = `${indent}- ${role}${name ? ` ${quoteAxString(name)}` : ''}${attrs.length ? ` [${attrs.join(' ')}]` : ''}${children.length ? ':' : ''}`;
    const out = [head];
    children.forEach((child, index) => out.push(...serializeNode(child, depth + 1, ctx, [...path, index])));
    return out;
}

/**
 * @param {AxNode|null|undefined} node
 * @param {(node: AxNode, depth: number, path: number[]) => void} visit
 * @param {number} [depth]
 * @param {number[]} [path]
 */
function walkAx(node, visit, depth = 0, path = []) {
    if (!node) return;
    visit(node, depth, path);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child, index) => walkAx(child, visit, depth + 1, [...path, index]));
}

/** @param {AxNode|null|undefined} node */
function isInteractiveNode(node) {
    if (!node?.role) return false;
    if (DEFAULT_INTERACTIVE_ROLES.has(String(node.role))) return true;
    return node.focused === true || node.focusable === true;
}

/** @param {AxNode|null|undefined} node */
function singleTextChild(node) {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length !== 1) return null;
    const child = children[0];
    if (child?.role !== 'text' || !child.name) return null;
    return child.name;
}

/**
 * @param {string} value
 * @param {number} [max]
 */
function truncateName(value, max = DEFAULT_MAX_NAME_CHARS) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

/** @param {string} role */
function sanitizeRole(role) {
    return String(role || 'generic').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

/** @param {unknown} value */
function quoteAxString(value) {
    return JSON.stringify(String(value || ''));
}

/** @param {unknown} value */
function formatAttrValue(value) {
    if (typeof value === 'string') return JSON.stringify(truncateName(value, 120));
    return String(value);
}

/** @param {unknown} input */
function hashElementSignature(input) {
    return `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)}`;
}

/** @param {string} role @param {string} name */
function roleNameKey(role, name) {
    return `${String(role || 'unknown')}\u0000${String(name || '')}`;
}

/** @param {unknown} value */
export function hashDoctorField(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}
