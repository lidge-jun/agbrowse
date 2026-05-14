// @ts-check

const CHALLENGE_PATTERNS = [
    /\bcaptcha\b/i,
    /checking your browser/i,
    /verify you are human/i,
    /are you a robot/i,
    /cloudflare/i,
    /attention required/i,
    /security check/i,
];

const LOGIN_PATTERNS = [
    /\bsign in\b/i,
    /\blog in\b/i,
    /create an account/i,
    /authentication required/i,
];

const PAYWALL_PATTERNS = [
    /\bsubscribe\b/i,
    /\bsubscription\b/i,
    /continue reading/i,
    /members only/i,
];

/**
 * @param {{ html?: string, text?: string, title?: string, positiveProof?: string[] }} input
 */
export function classifyHtmlStrength(input = {}) {
    const text = normalizeText(input.text || stripHtml(input.html || ''));
    const title = normalizeText(input.title || '');
    const markers = findBoundaryMarkers(`${title}\n${text}`);
    const positiveProof = Array.isArray(input.positiveProof) ? input.positiveProof.filter(Boolean) : [];
    const textLength = text.length;
    if (markers.some(m => m.kind === 'challenge') && textLength < 1000) {
        return { ok: false, verdict: 'challenge', reason: 'challenge-marker', markers, textLength };
    }
    if (markers.some(m => m.kind === 'auth')) {
        return { ok: false, verdict: 'auth_required', reason: 'auth-marker', markers, textLength };
    }
    if (markers.some(m => m.kind === 'paywall') && textLength < 1500) {
        return { ok: false, verdict: 'paywall', reason: 'paywall-marker', markers, textLength };
    }
    if (positiveProof.length > 0 && textLength >= 120) {
        return { ok: true, verdict: 'strong_ok', reason: 'positive-proof', markers, textLength };
    }
    if (textLength >= 1200) return { ok: true, verdict: 'strong_ok', reason: 'readable-text', markers, textLength };
    if (textLength >= 120) return { ok: true, verdict: 'weak_ok', reason: 'limited-text', markers, textLength };
    return { ok: false, verdict: 'blocked', reason: 'empty-or-too-short', markers, textLength };
}

/**
 * @param {{ status?: number, headers?: Record<string, unknown>, text?: string, url?: string }} input
 */
export function classifyBoundarySignals(input = {}) {
    const status = Number(input.status || 0);
    const markers = findBoundaryMarkers(input.text || '');
    if (status === 401) return { verdict: 'auth_required', markers, reason: 'http-401' };
    if (status === 402) return { verdict: 'paywall', markers, reason: 'http-402' };
    if (status === 403) return { verdict: markers.length ? 'challenge' : 'blocked', markers, reason: 'http-403' };
    if (status === 429) return { verdict: 'blocked', markers, reason: 'http-429' };
    if (markers.some(m => m.kind === 'auth')) return { verdict: 'auth_required', markers, reason: 'auth-marker' };
    if (markers.some(m => m.kind === 'paywall')) return { verdict: 'paywall', markers, reason: 'paywall-marker' };
    if (markers.some(m => m.kind === 'challenge')) return { verdict: 'challenge', markers, reason: 'challenge-marker' };
    return { verdict: null, markers, reason: null };
}

/**
 * @param {string} text
 */
export function findBoundaryMarkers(text) {
    /** @type {{ kind: 'challenge'|'auth'|'paywall', pattern: string }[]} */
    const markers = [];
    for (const pattern of CHALLENGE_PATTERNS) {
        if (pattern.test(text)) markers.push({ kind: 'challenge', pattern: pattern.source });
    }
    for (const pattern of LOGIN_PATTERNS) {
        if (pattern.test(text)) markers.push({ kind: 'auth', pattern: pattern.source });
    }
    for (const pattern of PAYWALL_PATTERNS) {
        if (pattern.test(text)) markers.push({ kind: 'paywall', pattern: pattern.source });
    }
    return markers;
}

/**
 * @param {string} html
 */
function stripHtml(html) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
}

/**
 * @param {string} text
 */
function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

