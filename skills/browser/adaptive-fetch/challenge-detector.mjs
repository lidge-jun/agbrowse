// @ts-check

import { findBoundaryMarkers } from './validators.mjs';
import { WAF_PROFILES, scoreProfile } from './waf-profiles.mjs';

/**
 * @param {{ url?: string, status?: number, text?: string, title?: string }} input
 */
export function detectChallengeMarkers(input = {}) {
    return findBoundaryMarkers(`${input.url || ''}\n${input.status || ''}\n${input.title || ''}\n${input.text || ''}`);
}

/**
 * @param {{ kind: string }[]} markers
 */
export function classifyAccessBoundary(markers = []) {
    if (markers.some(marker => marker.kind === 'auth')) return 'auth_required';
    if (markers.some(marker => marker.kind === 'paywall')) return 'paywall';
    if (markers.some(marker => marker.kind === 'challenge')) return 'challenge';
    return null;
}

/**
 * @param {{ status?: number, headers?: Record<string, string>, body?: string, cookies?: string[] }} response
 */
export function detectWafChallenge(response) {
    const signals = {
        cookies: response.cookies || parseCookieNames(response.headers || {}),
        headers: response.headers || {},
        body: response.body?.substring(0, 50000) ?? '',
        status: response.status || 0,
    };

    const matches = WAF_PROFILES
        .map(p => ({ profile: p, score: scoreProfile(p, signals) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score);

    return {
        detected: matches.length > 0,
        profiles: matches,
        primary: matches[0] ?? null,
        signals: { cookieCount: signals.cookies.length, status: signals.status },
    };
}

/**
 * @param {string} text
 */
export function detectLoginWall(text) {
    const markers = findBoundaryMarkers(text);
    const authMarkers = markers.filter(m => m.kind === 'auth');
    return { detected: authMarkers.length > 0, markers: authMarkers };
}

/**
 * @param {string} text
 */
export function detectPaywall(text) {
    const markers = findBoundaryMarkers(text);
    const paywallMarkers = markers.filter(m => m.kind === 'paywall');
    return { detected: paywallMarkers.length > 0, markers: paywallMarkers };
}

/**
 * @param {{ status?: number, headers?: Record<string, string>, body?: string, cookies?: string[] }} response
 */
export function classifyChallengeType(response) {
    const waf = detectWafChallenge(response);
    const textContent = (response.body || '').substring(0, 50000);
    const login = detectLoginWall(textContent);
    const paywall = detectPaywall(textContent);

    if (waf.detected) return { type: 'challenge', ...waf };
    if (login.detected) return { type: /** @type {const} */ ('auth_required'), ...login };
    if (paywall.detected) return { type: /** @type {const} */ ('paywall'), ...paywall };
    return { type: null };
}

/**
 * @param {Record<string, string>} headers
 */
function parseCookieNames(headers) {
    const setCookie = headers['set-cookie'] || headers['Set-Cookie'] || '';
    if (!setCookie) return [];
    return setCookie.split(/,(?=[^;]*=)/).map(c => {
        const name = c.trim().split('=')[0];
        return name || '';
    }).filter(Boolean);
}
