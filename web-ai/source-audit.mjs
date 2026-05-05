// @ts-check

/**
 * @typedef {{ id: string, text: string, sources: string[] }} Claim
 * @typedef {{
 *   claimId: string,
 *   source: string,
 *   host: string|null,
 *   quality: 'primary'|'research'|'secondary'|'unknown',
 * }} SourceQualityRow
 * @typedef {{ code: string, message: string }} AuditGap
 * @typedef {{
 *   requiredSourceRatio?: number,
 *   checkedScope?: string|null,
 *   checkedDate?: string|null,
 * }} AuditOptions
 * @typedef {{
 *   claims: Claim[],
 *   claimsWithInlineSource: Claim[],
 *   unsourcedClaims: Claim[],
 *   sourceQualityRows: SourceQualityRow[],
 *   gaps: AuditGap[],
 *   ok: boolean,
 *   checkedScope: string|null,
 *   checkedDate: string|null,
 * }} AuditResult
 */

const SENTENCE_SPLIT = /(?<=[.!?])\s+/u;
const MARKDOWN_LINK = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s)]+/g;
const ABSENCE_PATTERN = /\b(no|none|never|not found|not available|does not exist|cannot find)\b/i;

/**
 * @param {string} text
 * @param {AuditOptions} [options]
 * @returns {AuditResult}
 */
export function auditSources(text, {
    requiredSourceRatio = 1,
    checkedScope = null,
    checkedDate = null,
} = {}) {
    const claims = extractClaims(text);
    const claimsWithInlineSource = claims.filter(claim => claim.sources.length > 0);
    const unsourcedClaims = claims.filter(claim => claim.sources.length === 0);
    const sourceQualityRows = buildSourceQualityRows(claims);
    const gaps = [];

    if (claims.length && claimsWithInlineSource.length / claims.length < requiredSourceRatio) {
        gaps.push({
            code: 'unsourced-claims',
            message: `${unsourcedClaims.length} claim(s) lack inline sources`,
        });
    }

    const absenceClaims = claims.filter(claim => ABSENCE_PATTERN.test(claim.text));
    if (absenceClaims.length && (!checkedScope || !checkedDate)) {
        gaps.push({
            code: 'absence-scope-missing',
            message: 'absence claims require checkedScope and checkedDate',
        });
    }

    return {
        claims,
        claimsWithInlineSource,
        unsourcedClaims,
        sourceQualityRows,
        gaps,
        ok: gaps.length === 0,
        checkedScope,
        checkedDate,
    };
}

/**
 * @param {string} [text]
 * @returns {Claim[]}
 */
export function extractClaims(text = '') {
    const claims = [];
    const normalized = stripCodeFences(String(text));
    let index = 0;

    for (const rawLine of normalized.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || /^>\s*출처:/.test(line)) continue;
        const parts = line
            .replace(/^[-*]\s+/, '')
            .split(SENTENCE_SPLIT)
            .map(part => part.trim())
            .filter(Boolean);

        for (const part of parts) {
            if (!looksLikeClaim(part)) continue;
            const sources = extractInlineSources(part);
            claims.push({
                id: `claim-${String(index + 1).padStart(3, '0')}`,
                text: part,
                sources,
            });
            index += 1;
        }
    }

    return claims;
}

/**
 * @param {string} [text]
 * @returns {string[]}
 */
export function extractInlineSources(text = '') {
    const sources = new Set();
    for (const match of String(text).matchAll(MARKDOWN_LINK)) {
        sources.add(cleanUrl(match[1]));
    }
    for (const match of String(text).matchAll(BARE_URL)) {
        sources.add(cleanUrl(match[0]));
    }
    return Array.from(sources).filter(Boolean);
}

/**
 * @param {Claim[]} claims
 * @returns {SourceQualityRow[]}
 */
function buildSourceQualityRows(claims) {
    const rows = [];
    for (const claim of claims) {
        for (const source of claim.sources) {
            rows.push({
                claimId: claim.id,
                source,
                host: hostOf(source),
                quality: classifySourceQuality(source),
            });
        }
    }
    return rows;
}

/** @param {string} text */
function stripCodeFences(text) {
    return text.replace(/```[\s\S]*?```/g, '');
}

/** @param {string} text */
function looksLikeClaim(text) {
    return /[A-Za-z0-9가-힣]/.test(text) && text.length >= 8;
}

/** @param {string} url */
function cleanUrl(url) {
    return String(url).replace(/[.,;:!?]+$/g, '');
}

/**
 * @param {string} url
 * @returns {string|null}
 */
function hostOf(url) {
    try {
        return new URL(url).host;
    } catch {
        return null;
    }
}

/**
 * @param {string} url
 * @returns {'primary'|'research'|'secondary'|'unknown'}
 */
function classifySourceQuality(url) {
    const host = hostOf(url) || '';
    if (/\b(openai|google|microsoft|github|npmjs|mozilla|w3|chromium)\b/i.test(host)) return 'primary';
    if (/\b(arxiv|doi|acm|ieee|nature|science)\b/i.test(host)) return 'research';
    if (host) return 'secondary';
    return 'unknown';
}

