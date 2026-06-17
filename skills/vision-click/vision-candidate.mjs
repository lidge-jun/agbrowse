// @ts-check

/**
 * @typedef {Object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} BBox
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} Viewport
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} Clip
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} VisionCandidate
 * @property {'vision-candidate-v1'} schemaVersion
 * @property {boolean} found
 * @property {'vision_bbox'|'coordinate'|'not_found'} kind
 * @property {BBox|null} bbox
 * @property {Point} point
 * @property {number} confidence
 * @property {string} [description]
 * @property {string} [reason]
 * @property {string[]} riskFlags
 */

/**
 * @param {unknown} raw
 * @returns {VisionCandidate|null}
 */
export function normalizeVisionCandidate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const obj = /** @type {any} */ (raw);
    if (typeof obj.found !== 'boolean') return null;
    if (!obj.found) {
        return {
            schemaVersion: 'vision-candidate-v1',
            found: false,
            kind: 'not_found',
            bbox: null,
            point: { x: 0, y: 0 },
            confidence: 0,
            description: typeof obj.description === 'string' ? obj.description : 'not found',
            reason: 'target_not_found',
            riskFlags: [],
        };
    }
    const bbox = normalizeBBox(obj.bbox);
    const rawPoint = normalizePoint(obj.point) || (typeof obj.x === 'number' && typeof obj.y === 'number' ? { x: obj.x, y: obj.y } : null);
    if (!bbox && !rawPoint) return null;
    const point = rawPoint || centerOfBBox(/** @type {BBox} */ (bbox));
    const pointOnly = !bbox;
    const confidence = normalizeConfidence(obj.confidence, pointOnly ? 0.5 : 0.8);
    return {
        schemaVersion: 'vision-candidate-v1',
        found: true,
        kind: bbox ? 'vision_bbox' : 'coordinate',
        bbox,
        point,
        confidence,
        description: typeof obj.description === 'string' ? obj.description : undefined,
        reason: typeof obj.reason === 'string' ? obj.reason : undefined,
        riskFlags: [
            ...(Array.isArray(obj.riskFlags) ? obj.riskFlags.filter(isString) : []),
            ...(pointOnly ? ['point_only'] : []),
        ],
    };
}

/**
 * @param {string} text
 * @returns {VisionCandidate|null}
 */
export function extractVisionCandidateJson(text) {
    const candidates = extractJsonObjects(String(text || ''));
    for (const candidate of candidates.reverse()) {
        try {
            const parsed = normalizeVisionCandidate(JSON.parse(candidate));
            if (parsed) return parsed;
        } catch {
            // Skip malformed JSON candidates and keep scanning.
        }
    }
    return null;
}

/**
 * @param {VisionCandidate} candidate
 * @param {{ viewport?: Viewport|null, dpr?: number, clip?: Clip|null }} observation
 */
export function validateVisionCandidate(candidate, observation = {}) {
    if (!candidate.found) {
        throw new Error(candidate.reason || 'target not found');
    }
    if (!Number.isFinite(candidate.point.x) || !Number.isFinite(candidate.point.y)) {
        throw new Error('invalid vision candidate point');
    }
    if (candidate.bbox) {
        const values = [candidate.bbox.x, candidate.bbox.y, candidate.bbox.width, candidate.bbox.height];
        if (!values.every((n) => Number.isFinite(n)) || candidate.bbox.width <= 0 || candidate.bbox.height <= 0) {
            throw new Error('invalid vision candidate bbox');
        }
    }
    const dpr = typeof observation.dpr === 'number' && observation.dpr > 0 ? observation.dpr : 1;
    const viewport = observation.viewport || null;
    if (viewport) {
        const clip = observation.clip || null;
        const maxX = (clip ? clip.width : viewport.width) * dpr;
        const maxY = (clip ? clip.height : viewport.height) * dpr;
        if (candidate.point.x < 0 || candidate.point.y < 0 || candidate.point.x >= maxX || candidate.point.y >= maxY) {
            throw new Error('vision candidate point is outside the captured image');
        }
    }
    return candidate;
}

/**
 * @param {VisionCandidate} candidate
 * @returns {Point}
 */
export function candidateCenter(candidate) {
    return candidate.bbox
        ? { x: Math.round(candidate.bbox.x + candidate.bbox.width / 2), y: Math.round(candidate.bbox.y + candidate.bbox.height / 2) }
        : candidate.point;
}

/**
 * @param {VisionCandidate} candidate
 * @param {number} [threshold]
 */
export function isLowConfidence(candidate, threshold = 0.75) {
    return !candidate.found || candidate.confidence < threshold;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractJsonObjects(text) {
    const objects = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === '{') {
            if (depth === 0) start = i;
            depth += 1;
        } else if (ch === '}') {
            if (depth === 0) continue;
            depth -= 1;
            if (depth === 0 && start !== -1) {
                objects.push(text.slice(start, i + 1));
                start = -1;
            }
        }
    }

    return objects;
}

/**
 * @param {BBox} bbox
 * @returns {Point}
 */
function centerOfBBox(bbox) {
    return {
        x: Math.round(bbox.x + bbox.width / 2),
        y: Math.round(bbox.y + bbox.height / 2),
    };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeConfidence(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : fallback;
}

/**
 * @param {unknown} value
 * @returns {Point|null}
 */
function normalizePoint(value) {
    if (!value || typeof value !== 'object') return null;
    const point = /** @type {any} */ (value);
    if (typeof point.x !== 'number' || typeof point.y !== 'number') return null;
    return { x: point.x, y: point.y };
}

/**
 * @param {unknown} value
 * @returns {BBox|null}
 */
function normalizeBBox(value) {
    if (!value || typeof value !== 'object') return null;
    const box = /** @type {any} */ (value);
    if (
        typeof box.x !== 'number' ||
        typeof box.y !== 'number' ||
        typeof box.width !== 'number' ||
        typeof box.height !== 'number'
    ) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isString(value) {
    return typeof value === 'string';
}
