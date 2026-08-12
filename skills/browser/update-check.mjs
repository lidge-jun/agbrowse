// @ts-check

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 1200;
const CACHE_FILE = 'update-check.json';
const PACKAGE_NAME = 'agbrowse';

export const SKIP_COMMANDS = new Set([
    'help',
    'skills',
    'install-skills',
    'research',
]);

export const KNOWN_ROOT_COMMANDS = new Set([
    'active-tab',
    'action-memory',
    'check',
    'click',
    'console',
    'doctor',
    'drag',
    'evaluate',
    'fetch',
    'get-dom',
    'hover',
    'mouse-click',
    'mouse-down',
    'mouse-up',
    'move-mouse',
    'navigate',
    'network',
    'new-tab',
    'observe-actions',
    'observe-bundle',
    'press',
    'reload',
    'reset',
    'resize',
    'runway',
    'screenshot',
    'scroll',
    'select',
    'select-tab',
    'snapshot',
    'start',
    'status',
    'stop',
    'tab-cleanup',
    'tab-close',
    'tab-switch',
    'tabs',
    'text',
    'type',
    'uncheck',
    'upload',
    'wait',
    'wait-for',
    'wait-for-selector',
    'wait-for-text',
    'web-ai',
]);

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function parseDurationMs(value, fallback = DEFAULT_TTL_MS) {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : fallback;
    }
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i);
    if (!match) return fallback;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) return fallback;
    const unit = (match[2] || 'ms').toLowerCase();
    if (unit === 'ms') return amount;
    if (unit === 's') return amount * 1000;
    if (unit === 'm') return amount * 60 * 1000;
    if (unit === 'h') return amount * 60 * 60 * 1000;
    if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
    return fallback;
}

/**
 * @param {string} version
 */
function parseSemver(version) {
    const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) return null;
    return match.slice(1, 4).map(part => Number(part));
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {-1|0|1|null}
 */
export function compareSemver(left, right) {
    const a = parseSemver(left);
    const b = parseSemver(right);
    if (!a || !b) return null;
    for (let i = 0; i < 3; i += 1) {
        if (a[i] > b[i]) return 1;
        if (a[i] < b[i]) return -1;
    }
    return 0;
}

/**
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv }} opts
 */
export function shouldSkipUpdateNotice({ argv = [], env = process.env } = {}) {
    if (env.AGBROWSE_UPDATE_CHECK === '0') return true;
    if (argv.includes('--json')) return true;
    if (argv.includes('--help')) return true;
    if (env.AGBROWSE_JSON_ERRORS === '1') return true;

    const command = argv[0] || '';
    if (!command || command.startsWith('-')) return true;
    if (SKIP_COMMANDS.has(command)) return true;
    if (!KNOWN_ROOT_COMMANDS.has(command)) return true;
    if (command === 'web-ai' && argv[1] === 'mcp-server') return true;

    const forced = env.AGBROWSE_UPDATE_CHECK === '1';
    if (!forced && env.CI) return true;
    return false;
}

/**
 * @param {string} packageRoot
 */
function readCurrentVersion(packageRoot) {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
}

/**
 * @param {string} dataDir
 */
function readCache(dataDir) {
    const path = join(dataDir, CACHE_FILE);
    if (!existsSync(path)) return null;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.latest !== 'string') return null;
        if (!Number.isFinite(Number(parsed.checkedAt))) return null;
        return { latest: parsed.latest, checkedAt: Number(parsed.checkedAt) };
    } catch {
        return null;
    }
}

/**
 * @param {string} dataDir
 * @param {{ latest: string, checkedAt: number }} cache
 */
function writeCache(dataDir, cache) {
    try {
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(join(dataDir, CACHE_FILE), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    } catch {
        // Cache writes are best-effort; update checks must never block CLI work.
    }
}

/**
 * @param {{ fetchImpl?: typeof fetch, packageName?: string, timeoutMs?: number }} opts
 */
async function fetchLatestVersion({
    fetchImpl = fetch,
    packageName = PACKAGE_NAME,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return typeof payload?.version === 'string' ? payload.version : null;
}

/**
 * @param {{
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   dataDir: string,
 *   packageRoot: string,
 *   now?: number,
 *   fetchImpl?: typeof fetch,
 *   packageName?: string,
 *   timeoutMs?: number,
 * }} opts
 */
export async function getUpdateNoticeLines(opts) {
    const {
        argv = [],
        env = process.env,
        dataDir,
        packageRoot,
        now = Date.now(),
        fetchImpl = fetch,
        packageName = PACKAGE_NAME,
        timeoutMs = DEFAULT_TIMEOUT_MS,
    } = opts;
    if (shouldSkipUpdateNotice({ argv, env })) return [];

    try {
        const current = readCurrentVersion(packageRoot);
        if (!current) return [];

        let latest = env.AGBROWSE_UPDATE_CHECK_LATEST || null;
        if (!latest) {
            const ttlMs = parseDurationMs(env.AGBROWSE_UPDATE_CHECK_TTL, DEFAULT_TTL_MS);
            const cache = readCache(dataDir);
            if (cache && now - cache.checkedAt >= 0 && now - cache.checkedAt < ttlMs) {
                latest = cache.latest;
            } else {
                latest = await fetchLatestVersion({ fetchImpl, packageName, timeoutMs });
                if (latest) writeCache(dataDir, { latest, checkedAt: now });
            }
        }

        if (!latest || compareSemver(latest, current) !== 1) return [];
        return [
            `[agbrowse] new version is available: ${current} -> ${latest}`,
            '[agbrowse] npm install -g agbrowse@latest to update',
            '[agbrowse] tell the user before updating this global CLI',
            '[agbrowse] set AGBROWSE_UPDATE_CHECK=0 to hide this notice',
        ];
    } catch {
        return [];
    }
}

/**
 * @param {Parameters<typeof getUpdateNoticeLines>[0]} opts
 */
export async function maybeEmitUpdateNotice(opts) {
    const lines = await getUpdateNoticeLines(opts);
    for (const line of lines) console.error(line);
    return lines;
}
