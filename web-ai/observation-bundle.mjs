// @ts-check
/**
 * G06 — observation-bundle: pure assembler for ObservationBundleV1.
 *
 * Combines URL + title + viewport + DPR + snapshot refs + (optional) bounding
 * boxes + (optional) screenshot path + text summary into a single record so
 * agents and benchmarks can reproduce a single observation step without
 * juggling six independent commands.
 *
 * Pure function: takes already-captured inputs, returns a structured bundle.
 * All capture (screenshot, box-model) happens in the CLI wrapper, which keeps
 * this builder safe to test offline.
 *
 * Forbidden scope (gate:no-cloud-claims): no hosted/cloud, no stealth,
 * no CAPTCHA bypass, no external CDP.
 */

/**
 * @typedef {Object} ObservationBundleInput
 * @property {string} url
 * @property {string} [title]
 * @property {string} [observationId]
 * @property {string} [targetId]
 * @property {{width:number,height:number}} viewport
 * @property {number} [dpr]
 * @property {Array<{ref:string,role:string,name?:string,depth?:number,occurrenceIndex?:number}>} snapshotNodes
 * @property {Record<string,{x:number,y:number,width:number,height:number}>} [boxes]
 * @property {string|null} [screenshotPath]
 * @property {string} [textSummary]
 * @property {number} [maxTextChars]
 * @property {string} [capturedAt]
 */

/**
 * @typedef {Object} ObservationBundleV1
 * @property {'observation-bundle-v1'} schemaVersion
 * @property {string} observationId
 * @property {string} targetId
 * @property {string} url
 * @property {string} title
 * @property {{width:number,height:number}} viewport
 * @property {number} dpr
 * @property {string} capturedAt
 * @property {Array<{ref:string,role:string,name:string,depth:number,occurrenceIndex?:number,box?:{x:number,y:number,width:number,height:number}}>} refs
 * @property {string|null} screenshot
 * @property {string} textSummary
 * @property {{url:string,targetId:string,viewport:{width:number,height:number},dpr:number,capturedAt:string}} basis
 * @property {{refCount:number,boxCount:number,textChars:number,hasScreenshot:boolean}} stats
 */

const SCHEMA_VERSION = /** @type {const} */ ('observation-bundle-v1');
const DEFAULT_MAX_TEXT_CHARS = 2000;

/**
 * @param {string} s
 * @param {number} [max]
 */
function clampText(s, max = DEFAULT_MAX_TEXT_CHARS) {
    const limit = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_TEXT_CHARS;
    const str = String(s || '');
    if (str.length <= limit) return str;
    return `${str.slice(0, limit - 3)}...`;
}

/**
 * @param {ObservationBundleInput} input
 * @returns {ObservationBundleV1}
 */
export function buildObservationBundle(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('buildObservationBundle: input is required');
    }
    if (typeof input.url !== 'string' || input.url.length === 0) {
        throw new Error('buildObservationBundle: input.url is required (string)');
    }
    if (!input.viewport || typeof input.viewport.width !== 'number' || typeof input.viewport.height !== 'number') {
        throw new Error('buildObservationBundle: input.viewport {width,height} is required');
    }
    if (!Array.isArray(input.snapshotNodes)) {
        throw new Error('buildObservationBundle: input.snapshotNodes must be an array');
    }
    const boxes = input.boxes && typeof input.boxes === 'object' ? input.boxes : {};
    /** @type {ObservationBundleV1['refs']} */
    const refs = [];
    for (const node of input.snapshotNodes) {
        if (!node || typeof node.ref !== 'string') continue;
        if (!isElementRef(node.ref)) continue;
        const row = {
            ref: node.ref,
            role: String(node.role || ''),
            name: String(node.name || ''),
            depth: typeof node.depth === 'number' ? node.depth : 0,
        };
        if (typeof node.occurrenceIndex === 'number') {
            /** @type {any} */ (row).occurrenceIndex = node.occurrenceIndex;
        }
        const box = boxes[node.ref];
        if (box && [box.x, box.y, box.width, box.height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
            /** @type {any} */ (row).box = { x: box.x, y: box.y, width: box.width, height: box.height };
        }
        refs.push(row);
    }
    const dpr = typeof input.dpr === 'number' && input.dpr > 0 ? input.dpr : 1;
    const textSummary = clampText(input.textSummary || '', input.maxTextChars);
    const screenshot = input.screenshotPath || null;
    const capturedAt = input.capturedAt || new Date().toISOString();
    const observationId = input.observationId || `obs-${hashBasis(input.url, capturedAt, refs.length)}`;
    const targetId = input.targetId || '';
    let boxCount = 0;
    for (const r of refs) if (r.box) boxCount += 1;
    return {
        schemaVersion: SCHEMA_VERSION,
        observationId,
        targetId,
        url: input.url,
        title: String(input.title || ''),
        viewport: { width: input.viewport.width, height: input.viewport.height },
        dpr,
        capturedAt,
        refs,
        screenshot,
        textSummary,
        basis: {
            url: input.url,
            targetId,
            viewport: { width: input.viewport.width, height: input.viewport.height },
            dpr,
            capturedAt,
        },
        stats: {
            refCount: refs.length,
            boxCount,
            textChars: textSummary.length,
            hasScreenshot: Boolean(screenshot),
        },
    };
}

/**
 * @param {string} ref
 */
function isElementRef(ref) {
    return /^@?e\d+$/.test(ref);
}

/**
 * @param {string} url
 * @param {string} capturedAt
 * @param {number} refCount
 */
function hashBasis(url, capturedAt, refCount) {
    let hash = 2166136261;
    const input = `${url}|${capturedAt}|${refCount}`;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

/**
 * @param {ObservationBundleV1} bundle
 * @returns {string}
 */
export function formatObservationBundle(bundle) {
    const lines = [
        `observation-bundle-v1  url=${JSON.stringify(bundle.url)}  title=${JSON.stringify(bundle.title)}`,
        `  viewport=${bundle.viewport.width}x${bundle.viewport.height} dpr=${bundle.dpr}  refs=${bundle.stats.refCount}  boxes=${bundle.stats.boxCount}  text=${bundle.stats.textChars}ch  screenshot=${bundle.stats.hasScreenshot ? bundle.screenshot : '∅'}`,
    ];
    for (const r of bundle.refs.slice(0, 20)) {
        const box = r.box ? `  box=${r.box.x},${r.box.y},${r.box.width}x${r.box.height}` : '';
        lines.push(`  ${r.ref.padEnd(4)} ${r.role.padEnd(10)} ${JSON.stringify(r.name)}${box}`);
    }
    if (bundle.refs.length > 20) lines.push(`  ... ${bundle.refs.length - 20} more refs`);
    return lines.join('\n');
}

export const OBSERVATION_BUNDLE_SCHEMA_VERSION = SCHEMA_VERSION;
