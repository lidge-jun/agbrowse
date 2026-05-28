// @ts-check

import { RUNWAY_SURFACES } from './runway-selectors.mjs';

const RUNWAY_ORIGIN = 'https://app.runwayml.com';

export const RUNWAY_SURFACE_PATHS = Object.freeze({
    apps: '/ai-tools/generate?mode=apps',
    'custom-tools': '/ai-tools/generate?mode=tools',
    recents: '/ai-tools/recents',
});

/**
 * @param {string} url
 * @returns {string | null}
 */
export function extractRunwayTeamBase(url = '') {
    const match = String(url).match(/^(https:\/\/app\.runwayml\.com\/video-tools\/teams\/[^/?#]+)/i);
    return match ? match[1] : null;
}

/**
 * @param {string} surface
 * @param {string} currentUrl
 * @returns {string | null}
 */
export function buildRunwaySurfaceUrl(surface, currentUrl = '') {
    const teamBase = extractRunwayTeamBase(currentUrl);
    const path = RUNWAY_SURFACE_PATHS[surface];
    if (teamBase && path) return `${teamBase}${path}`;
    return RUNWAY_SURFACES[surface]?.url || null;
}

/**
 * @param {any} page
 * @param {string} surface
 * @param {{ timeoutMs?: number, discoverTeam?: boolean }} [options]
 * @returns {Promise<{ url: string, warnings: string[] }>}
 */
export async function resolveRunwaySurfaceUrl(page, surface, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || 15000;
    const warnings = [];
    let currentUrl = '';
    try {
        currentUrl = typeof page.url === 'function' ? page.url() : '';
    } catch (error) {
        warnings.push(`current URL unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    let targetUrl = buildRunwaySurfaceUrl(surface, currentUrl);
    if (targetUrl && (!options.discoverTeam || extractRunwayTeamBase(targetUrl) || surface === 'custom-tools')) {
        return { url: targetUrl, warnings };
    }

    const customUrl = RUNWAY_SURFACES['custom-tools']?.url;
    if (options.discoverTeam && customUrl) {
        await page.goto(customUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch (error) {
            warnings.push(`team discovery networkidle skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
            currentUrl = typeof page.url === 'function' ? page.url() : currentUrl;
        } catch (error) {
            warnings.push(`post-discovery URL unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
        targetUrl = buildRunwaySurfaceUrl(surface, currentUrl);
    }

    if (!targetUrl) {
        throw new Error(`Runway ${surface} is surface-only; no navigable URL is available`);
    }
    return { url: targetUrl, warnings };
}

/**
 * @param {any} page
 * @param {string} surface
 * @param {{ timeoutMs?: number, discoverTeam?: boolean }} [options]
 * @returns {Promise<{ url: string, warnings: string[] }>}
 */
export async function navigateRunwaySurface(page, surface, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || 15000;
    const resolved = await resolveRunwaySurfaceUrl(page, surface, options);
    await page.goto(resolved.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    return resolved;
}
