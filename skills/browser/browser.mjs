#!/usr/bin/env node
// @ts-check

/**
 * agbrowse — agent-first browser automation and web-ai CLI
 * Extracted from cli-jaw browser. Zero external dependencies beyond playwright-core.
 *
 * Usage:  agbrowse <command> [args] [--flags]
 *
 * Commands:
 *   start [--port N] [--headless|--headed] [--chrome-path PATH]  Start Chrome with CDP
 *   stop                             Stop Chrome
 *   status                           Connection status
 *   snapshot [--interactive] [--max-nodes N]  Accessibility tree with ref IDs
 *   observe-bundle [--screenshot] [--boxes] [--json] [--max-text-chars N]  ObservationBundleV1 (G06)
 *   observe-actions <instruction> [--json] [--top-n N] [--include-disabled]  Rank candidate next actions (G02)
 *   runway <command>                    Runway full-surface CLI (13 commands, 3 safety levels)
 *   research plan --query <problem> [--json]  Korean query rewrite and evidence plan
 *   research normalize-results --file <json> [--backend name] [--json]  Normalize search URL candidates
 *   research enrich-fetch --plan <json> --results <json> [--json]  Fetch original-page evidence
 *   research browse-plan --plan <json> --enrichment <json> [--json]  Plan browser escalation actions
 *   screenshot [--full-page] [--ref eN] [--json]  Capture screenshot
 *   mouse-click <x> <y> [--double]  Click at pixel coordinates
 *   move-mouse <x> <y>               Move mouse without clicking
 *   mouse-down [--right]             Hold mouse button
 *   mouse-up [--right]               Release mouse button
 *   click <ref> [--double] [--right] Click element
 *   type <ref> <text> [--submit]     Type into element
 *   press <key>                      Press key (Enter, Tab, Escape…)
 *   hover <ref>                      Hover element
 *   navigate <url>                   Go to URL
 *   fetch <url> [--json] [--trace] [--browser auto|never|required]
 *         [--browser-session none|isolated|existing|user|interactive]
 *         [--identity auto|minimal|chrome]
 *                                    Adaptive URL reading (6-phase ladder, not generic search)
 *   reload                           Reload current page
 *   resize <w> <h> [--fullscreen]    Resize browser window or viewport
 *   tabs [--json]                    List open tabs
 *   active-tab --json                 Show active tab target-id contract
 *   new-tab <url> [--no-activate] [--json]  Create a browser tab
 *   tab-close <targetId> [--json]     Close a browser tab
 *   tab-switch <index-or-targetId> [--json] [--force]  Activate a tab
 *   select-tab <index-or-targetId> [--json] [--force]  Alias for tab-switch
 *   tab-cleanup [--provider chatgpt --keep-provider-tabs 1]  Close idle/overflow tabs
 *   text [--format html]             Get page text
 *   get-dom [--selector CSS] [--max-chars N]  Get current DOM
 *   console [--duration ms] [--clear] [--reload] [--expression js]  Read buffered console logs
 *   network [--duration ms] [--filter text] [--reload]  Inspect network requests
 *   evaluate <js>                     Execute JavaScript
 *   scroll <dir> [--amount N] [--json]  Scroll page
 *   wait <ms> [--json]               Wait fixed duration
 *   wait-for-selector <css> [--timeout ms] [--json]  Wait for selector
 *   wait-for-text <text> [--timeout ms] [--json]  Wait for text
 *   select <ref> <value> [--json]    Select option by ref
 *   check <ref> [--json]             Check checkbox/radio by ref
 *   uncheck <ref> [--json]           Uncheck checkbox by ref
 *   reset [--force]                  Clear profile + screenshots
 *   skills get core --full           Print agent operating guide + bundled skills
 *   skills install --target <dir>    Install bundled SKILL.md directories
 *   install-skills --target <dir>    Legacy alias for skills install
 */

import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, openSync, closeSync, statSync } from 'node:fs';
import net from 'node:net';
import {
    parseAriaYaml,
    parseCdpAxTree,
    annotateNodeOccurrences,
    filterRequests,
    dedupeRequests,
} from './browser-core.mjs';
import { runInstallSkillsCli, runSkillsCli } from './skill-install.mjs';
import { acquireProfileLock, releaseProfileLock, updateLockPid, readProfileLock, isPidAlive, isStaleLock } from './profile-lock.mjs';
import { runWebAiCli } from '../../web-ai/cli.mjs';
import { cleanupPoolTabs } from '../../web-ai/tab-pool.mjs';
import { listActiveCommands } from '../../web-ai/active-command-store.mjs';
import { enforcePolicy } from '../../web-ai/policy/enforce.mjs';
import { createTab, closeTab, switchToTab, listManagedTabs } from './tab-manager.mjs';
import { cleanupIdleTabs, planCleanupIdleTabs, pickCleanupCandidates, isPinned, parseDuration, DEFAULT_MAX_TABS } from './tab-lifecycle.mjs';
import { runAdaptiveFetchCli } from './adaptive-fetch/index.mjs';
import { runRunwayCli } from './runway.mjs';
import { maybeEmitUpdateNotice } from './update-check.mjs';
import { planKoreanResearch } from './search-research/search-strategy.mjs';
import { normalizeSearchResults } from './search-research/normalizer.mjs';
import { enrichSearchResultsWithFetch } from './search-research/fetch-enrichment.mjs';
import { planBrowseEscalation } from './search-research/browse-escalation.mjs';

// ─── Config ──────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');
const SKILLS_ROOT = join(PACKAGE_ROOT, 'skills');
const DATA_DIR = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const PROFILE_DIR = join(DATA_DIR, 'browser-profile');
const SCREENSHOTS_DIR = join(DATA_DIR, 'screenshots');
const STATE_FILE = join(DATA_DIR, 'browser-state.json');
const SNAPSHOT_FILE = join(DATA_DIR, 'last-snapshot.json');
const SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots');
const DEFAULT_CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CUSTOM_CHROME_PATH = process.env.CHROME_BINARY_PATH || null;

/**
 * @param {any} ms
 */
function formatRelativeAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'untracked';
    if (ms < 1000) return 'now';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

/**
 * @param {any} tab
 * @param {any} now
 */
function tabDisplayState(tab, now = Date.now()) {
    const idleForMs = Number.isFinite(tab.lastActiveAt) && tab.lastActiveAt > 0
        ? now - tab.lastActiveAt
        : null;
    return {
        ...tab,
        pinned: isPinned(tab.targetId),
        idleForMs,
        idleFor: idleForMs === null ? 'untracked' : formatRelativeAge(idleForMs),
        lastActiveAtIso: tab.lastActiveAt ? new Date(tab.lastActiveAt).toISOString() : null,
    };
}

/**
 * @param {any} command
 */
function activeCommandSummary(command) {
    if (!command) return null;
    return {
        commandId: command.commandId,
        command: command.command,
        provider: command.provider,
        owner: command.owner,
        sessionId: command.sessionId,
        expiresAt: command.expiresAt,
    };
}

// ─── State ───────────────────────────────────────
/** @type {any} */
let cached = null;   // { browser, cdpUrl }
/** @type {any} */
let chromeProc = null;
/** @type {any} */
let activePort = null;
/** @type {any} */
let activeLockToken = null;

// ─── ANSI colors ─────────────────────────────────
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m',
};

// ═══════════════════════════════════════════════════
//  Connection Layer (from cli-jaw src/browser/connection.ts)
// ═══════════════════════════════════════════════════

/**
 * @param {any} port
 * @param {any} host
 */
function isPortListening(port, host = '127.0.0.1') {
    return new Promise(resolve => {
        const sock = net.createConnection({ port, host });
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 500);
        sock.once('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
        sock.once('error', () => { clearTimeout(timer); resolve(false); });
    });
}

/**
 * @param {any} port
 * @param {any} timeoutMs
 */
async function waitForCdpReady(port, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.timeout(2000),
            });
            if (resp.ok) return true;
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

function isWSL() {
    if (process.platform !== 'linux') return false;
    try {
        return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
    } catch { return false; }
}

/**
 * Best-effort description of which process holds a TCP port.
 * Returns "<exe> (PID N)" or null on failure / unsupported platform.
 * @param {number} port
 * @returns {Promise<string | null>}
 */
async function describePortHolder(port) {
    try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
            const out = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'], {
                encoding: 'utf8',
                timeout: 2000,
            });
            if (out.status === 0 && out.stdout) {
                const lines = out.stdout.trim().split('\n');
                if (lines.length >= 2) {
                    const cols = lines[1].split(/\s+/);
                    const exe = cols[0];
                    const pid = cols[1];
                    if (pid && exe) return `${exe} (PID ${pid})`;
                }
            }
        } else if (process.platform === 'win32') {
            const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 2000 });
            if (out.status === 0 && out.stdout) {
                const re = new RegExp(`\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
                const m = out.stdout.match(re);
                if (m && m[1]) return `PID ${m[1]}`;
            }
        }
    } catch { /* best effort */ }
    return null;
}

/**
 * Diagnose why `agbrowse start` may fail.
 * Returns a structured report with checks: lock / port / cdp-ours / env-leak / display.
 * @param {{ port?: number }} [opts]
 */
async function runStartDoctor(opts = {}) {
    const port = Number(opts.port || DEFAULT_CDP_PORT);
    /** @type {{ id: string, ok: boolean, severity: 'info'|'warn'|'fail', detail: string, fix?: string }[]} */
    const checks = [];

    // 1. Profile lock + PID alive
    const lock = readProfileLock(DATA_DIR);
    if (!lock) {
        checks.push({ id: 'profile-lock', ok: true, severity: 'info', detail: 'no profile.lock present' });
    } else if (isStaleLock(lock)) {
        checks.push({
            id: 'profile-lock',
            ok: false,
            severity: 'warn',
            detail: `stale profile.lock from PID ${lock.pid} (acquired ${lock.acquiredAt})`,
            fix: `rm ${join(DATA_DIR, 'profile.lock')}   # or: agbrowse stop`,
        });
    } else if (lock.pid && !isPidAlive(lock.pid)) {
        checks.push({
            id: 'profile-lock',
            ok: false,
            severity: 'fail',
            detail: `profile.lock claims PID ${lock.pid} but that process is not alive`,
            fix: `rm ${join(DATA_DIR, 'profile.lock')}`,
        });
    } else {
        checks.push({
            id: 'profile-lock',
            ok: true,
            severity: 'info',
            detail: `profile.lock held by live PID ${lock.pid}`,
        });
    }

    // 2 + 3. Port listening + ownership
    const listening = await isPortListening(port);
    const persisted = readPersistedState();
    if (!listening) {
        checks.push({
            id: 'port-listen',
            ok: true,
            severity: 'info',
            detail: `port ${port} is free`,
        });
    } else {
        const holder = await describePortHolder(port);
        const persistedPid = persisted?.pid;
        const ours = !!(persistedPid && holder && holder.includes(`PID ${persistedPid}`));
        if (ours) {
            checks.push({
                id: 'port-cdp-ownership',
                ok: true,
                severity: 'info',
                detail: `port ${port} held by our agbrowse Chrome (${holder})`,
            });
        } else {
            // Probe whether it's a CDP endpoint
            let isCdp = false;
            try {
                const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
                isCdp = r.ok;
            } catch { /* not CDP */ }
            if (isCdp) {
                checks.push({
                    id: 'port-cdp-foreign',
                    ok: false,
                    severity: 'warn',
                    detail: `port ${port} responds as CDP but not from our agbrowse Chrome${holder ? ` (held by ${holder})` : ''}`,
                    fix: `agbrowse stop will NOT close it. Close manually, or use --port ${port + 1}.`,
                });
            } else {
                checks.push({
                    id: 'port-foreign',
                    ok: false,
                    severity: 'fail',
                    detail: `port ${port} held by ${holder || 'another process'} but is not CDP`,
                    fix: `Stop the conflicting process or: agbrowse start --port ${port + 1}`,
                });
            }
        }
    }

    // 4. Env-var leak
    const envLeaks = [];
    if (process.env.CHROME_HEADLESS === '1') envLeaks.push('CHROME_HEADLESS=1');
    if (process.env.AGBROWSE_HEAVY_SITE_COMPAT === '1') envLeaks.push('AGBROWSE_HEAVY_SITE_COMPAT=1');
    if (process.env.AGBROWSE_KEEP_BG_NETWORKING === '1') envLeaks.push('AGBROWSE_KEEP_BG_NETWORKING=1');
    if (process.env.AGBROWSE_CHROME_FLAGS) envLeaks.push(`AGBROWSE_CHROME_FLAGS=${process.env.AGBROWSE_CHROME_FLAGS}`);
    if (process.env.AGBROWSE_ENABLE_AUTOMATION === '1') envLeaks.push('AGBROWSE_ENABLE_AUTOMATION=1');
    if (envLeaks.length === 0) {
        checks.push({ id: 'env-vars', ok: true, severity: 'info', detail: 'no agbrowse env-var overrides set' });
    } else {
        checks.push({
            id: 'env-vars',
            ok: true,
            severity: 'warn',
            detail: `env overrides active: ${envLeaks.join(', ')}`,
            fix: envLeaks.includes('CHROME_HEADLESS=1')
                ? 'CHROME_HEADLESS=1 will force headless even with --headed. unset CHROME_HEADLESS to use --headed.'
                : 'unset these to launch with default flags.',
        });
    }

    // 5. Chrome singleton detection (all platforms)
    if (process.platform === 'darwin') {
        try {
            const ps = spawnSync('pgrep', ['-fa', 'Google Chrome'], { encoding: 'utf8', timeout: 2000 });
            const lines = (ps.stdout || '').trim().split('\n').filter(Boolean);
            const usingOurProfile = lines.filter(l => l.includes(PROFILE_DIR));
            const otherInstances = lines.filter(l => !l.includes(PROFILE_DIR));
            if (usingOurProfile.length > 0 && lock && !isStaleLock(lock) && lock.pid && isPidAlive(lock.pid)) {
                checks.push({
                    id: 'chrome-singleton',
                    ok: true,
                    severity: 'info',
                    detail: `Chrome.app already bound to our profile (expected: lock=${lock.pid})`,
                });
            } else if (usingOurProfile.length > 0) {
                checks.push({
                    id: 'chrome-singleton',
                    ok: false,
                    severity: 'fail',
                    detail: `another Chrome.app is bound to ${PROFILE_DIR} but profile.lock is missing/stale`,
                    fix: `Quit that Chrome.app, then: agbrowse start --headed`,
                });
            } else if (otherInstances.length > 0) {
                checks.push({
                    id: 'chrome-singleton',
                    ok: true,
                    severity: 'warn',
                    detail: `${otherInstances.length} other Chrome.app instance(s) running (different profile) — macOS may absorb our launch`,
                    fix: `If start hangs: quit all Chrome windows first.`,
                });
            } else {
                checks.push({
                    id: 'chrome-singleton',
                    ok: true,
                    severity: 'info',
                    detail: 'no other Chrome.app processes running',
                });
            }
        } catch {
            checks.push({ id: 'chrome-singleton', ok: true, severity: 'info', detail: 'pgrep unavailable; skipped' });
        }
    } else if (process.platform === 'win32') {
        try {
            const ps = spawnSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'], {
                encoding: 'utf8', timeout: 3000,
            });
            const chromeLines = (ps.stdout || '').trim().split('\n')
                .filter(l => l.toLowerCase().includes('chrome.exe'));
            if (chromeLines.length > 0) {
                checks.push({
                    id: 'chrome-singleton',
                    ok: true,
                    severity: 'warn',
                    detail: `${chromeLines.length} chrome.exe process(es) running — singleton risk if profile dir creation fails`,
                    fix: 'agbrowse uses unique profile to avoid absorption. If launch fails, close all Chrome windows.',
                });
            } else {
                checks.push({ id: 'chrome-singleton', ok: true, severity: 'info', detail: 'no chrome.exe running' });
            }
        } catch {
            checks.push({ id: 'chrome-singleton', ok: true, severity: 'info', detail: 'tasklist unavailable; skipped' });
        }
    } else {
        const singletonLock = join(PROFILE_DIR, 'SingletonLock');
        if (existsSync(singletonLock)) {
            checks.push({
                id: 'chrome-singleton',
                ok: true,
                severity: 'warn',
                detail: `stale SingletonLock found at ${singletonLock}`,
                fix: `rm -f "${PROFILE_DIR}/Singleton*" then retry`,
            });
        } else {
            checks.push({ id: 'chrome-singleton', ok: true, severity: 'info', detail: 'no singleton lock conflict' });
        }
    }

    // 6. Display available
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        checks.push({
            id: 'display',
            ok: false,
            severity: 'warn',
            detail: 'no $DISPLAY or $WAYLAND_DISPLAY — headed Chrome will fail',
            fix: 'CHROME_HEADLESS=1 agbrowse start',
        });
    } else {
        checks.push({ id: 'display', ok: true, severity: 'info', detail: 'display available (or platform is darwin/win32)' });
    }

    const ok = !checks.some(c => c.severity === 'fail');
    return { ok, port, dataDir: DATA_DIR, profileDir: PROFILE_DIR, persisted, lock, checks };
}

/**
 * @param {Awaited<ReturnType<typeof runStartDoctor>>} report
 */
function formatDoctorReport(report) {
    /** @type {string[]} */
    const lines = [];
    lines.push(`agbrowse doctor — port ${report.port}`);
    lines.push(`  data: ${report.dataDir}`);
    if (report.lock) {
        lines.push(`  lock: PID ${report.lock.pid} (acquired ${report.lock.acquiredAt})`);
    } else {
        lines.push(`  lock: (none)`);
    }
    if (report.persisted) {
        lines.push(`  state: PID ${report.persisted.pid} port ${report.persisted.port} headless=${report.persisted.headless}`);
    }
    lines.push('');
    for (const ck of report.checks) {
        const icon = ck.severity === 'fail' ? '✖' : ck.severity === 'warn' ? '⚠' : '✓';
        lines.push(`${icon} ${ck.id}: ${ck.detail}`);
        if (ck.fix) lines.push(`    → ${ck.fix}`);
    }
    lines.push('');
    lines.push(report.ok ? '✅ start should succeed' : '❌ start may fail — fix the items above');
    return lines.join('\n');
}


function readPersistedState() {
    if (!existsSync(STATE_FILE)) return null;
    try {
        return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * @param {any} state
 */
function writePersistedState(state) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * @param {any} patch
 */
function updatePersistedState(patch) {
    writePersistedState({
        ...(readPersistedState() || {}),
        ...patch,
    });
}

function clearPersistedState() {
    rmSync(STATE_FILE, { force: true });
}

/**
 * @param {any} targetId
 */
function getSnapshotFile(targetId = null) {
    if (targetId) return join(SNAPSHOTS_DIR, `${targetId}.json`);
    return SNAPSHOT_FILE;
}

/**
 * @param {any} targetId
 */
function readPersistedSnapshot(targetId = null) {
    const file = getSnapshotFile(targetId);
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * @param {any} snapshotState
 * @param {any} targetId
 */
function writePersistedSnapshot(snapshotState, targetId = null) {
    const file = getSnapshotFile(targetId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(snapshotState, null, 2));
}

/**
 * @param {any} targetId
 */
function clearPersistedSnapshot(targetId = null) {
    if (targetId) {
        rmSync(getSnapshotFile(targetId), { force: true });
        return;
    }
    rmSync(SNAPSHOT_FILE, { force: true });
    // Also clear per-tab snapshots on global clear
    if (existsSync(SNAPSHOTS_DIR)) {
        for (const f of readdirSync(SNAPSHOTS_DIR)) {
            rmSync(join(SNAPSHOTS_DIR, f), { force: true });
        }
    }
}

function getCliPort() {
    const index = process.argv.indexOf('--port');
    if (index === -1) return null;
    const raw = process.argv[index + 1];
    const port = parseInt(raw, 10);
    if (Number.isNaN(port)) {
        throw new Error(`Invalid --port value: ${raw}`);
    }
    return port;
}

/**
 * @param {any} args
 */
function parseClipArgs(args = []) {
    const index = args.indexOf('--clip');
    if (index === -1) return null;
    const values = args.slice(index + 1, index + 5).map((/** @type {any} */ value) => parseInt(value, 10));
    if (values.length < 4 || values.some((/** @type {any} */ value) => Number.isNaN(value))) {
        throw new Error('Invalid --clip arguments. Usage: --clip <x> <y> <width> <height>');
    }
    return {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
    };
}

/**
 * @param {any} pid
 */
async function killPersistedChrome(pid) {
    if (!pid) return false;

    if (process.platform === 'win32') {
        await new Promise((/** @type {any} */ resolve, /** @type {any} */ reject) => {
            const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
            child.once('exit', code => {
                if (code === 0 || code === 128) resolve();
                else reject(new Error(`taskkill exited with code ${code}`));
            });
            child.once('error', reject);
        });
        return true;
    }

    try {
        process.kill(-pid, 'SIGTERM');
        return true;
    } catch (error) {
        if ((/** @type {any} */ (error))?.code === 'ESRCH') return false;
        if ((/** @type {any} */ (error))?.code !== 'EINVAL') throw error;
    }

    try {
        process.kill(pid, 'SIGTERM');
        return true;
    } catch (error) {
        if ((/** @type {any} */ (error))?.code === 'ESRCH') return false;
        throw error;
    }
}

/** @param {string} dir */
function validateProfileDir(dir) {
    const probe = join(dir, '.agbrowse-probe');
    try {
        writeFileSync(probe, 'ok', { flag: 'w' });
        rmSync(probe, { force: true });
    } catch (err) {
        throw new Error(
            `Profile directory is not writable: ${dir}\n` +
            `Chrome will silently fall back to the default profile and singleton-absorb.\n` +
            `Fix: ensure the directory exists and is writable, or set BROWSER_AGENT_HOME to a writable path.\n` +
            `Original error: ${/** @type {any} */ (err).message}`
        );
    }
}

/**
 * @param {any} customChromePath
 * @param {{ preferAlternate?: boolean }} [findOpts]
 */
function findChrome(customChromePath = CUSTOM_CHROME_PATH, { preferAlternate = false } = {}) {
    if (customChromePath) {
        if (existsSync(customChromePath)) return customChromePath;
        throw new Error(`Custom Chrome path not found: ${customChromePath}`);
    }

    const platform = process.platform;
    const stable = [];
    const alternate = [];

    if (platform === 'darwin') {
        stable.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        );
        alternate.push(
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        );
    } else if (platform === 'win32') {
        const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
        const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const local = process.env.LOCALAPPDATA || '';
        stable.push(
            `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
            `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome\\Application\\chrome.exe`,
        );
        alternate.push(
            `${local}\\Google\\Chrome SxS\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome Dev\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome Beta\\Application\\chrome.exe`,
            `${local}\\Chromium\\Application\\chrome.exe`,
            `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        );
    } else {
        stable.push(
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
        );
        alternate.push(
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/usr/bin/brave-browser',
        );
        if (isWSL()) {
            stable.push(
                '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
                '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            );
        }
    }

    const ordered = preferAlternate
        ? [...alternate, ...stable]
        : [...stable, ...alternate];
    for (const p of ordered) {
        if (p && existsSync(p)) return p;
    }
    throw new Error('Chrome not found — install Google Chrome or Chromium');
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function launchChrome(port = DEFAULT_CDP_PORT, opts = {}) {
    const headless = resolveHeadlessMode(opts);
    // CDP already responding → reuse
    if (await isPortListening(port)) {
        let resp;
        try {
            resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.timeout(2000),
            });
        } catch {
            throw new Error(
                `Port ${port} is in use but not responding as CDP. ` +
                `Another process may be occupying the port. Try --port <other> or stop the conflicting process.`
            );
        }
        if (resp.ok) {
            const previousState = readPersistedState();
            const isStaleState = previousState?.startedAt
                && Date.now() - Date.parse(previousState.startedAt) > 60 * 60 * 1000;
            if (opts.headed === true && previousState?.headless === true) {
                throw new Error(
                    `CDP port ${port} is already backed by a headless agbrowse Chrome. ` +
                    `Run "agbrowse stop" first, then "agbrowse start --headed".`
                );
            }
            if (!previousState || previousState.port !== port || isStaleState) {
                console.warn(`[browser] warning: CDP port ${port} appears foreign or stale — agbrowse is attaching to an existing Chrome it did not start; verify --user-data-dir matches if you depend on profile state`);
            }
            const chromePath = opts.chromePath || previousState?.chromePath || CUSTOM_CHROME_PATH;
            clearPersistedSnapshot();
            writePersistedState({
                pid: previousState?.port === port ? previousState.pid ?? null : null,
                port,
                chromePath,
                startedAt: previousState?.startedAt || new Date().toISOString(),
                headless: previousState?.headless ?? headless,
                reused: true,
            });
            if (!headless) await foregroundCdpWindow(port, chromePath);
            console.log(`[browser] CDP already listening on port ${port} — reusing existing instance`);
            activePort = port;
            return;
        }
    }

    if (chromeProc && !chromeProc.killed) return;

    const lockResult = acquireProfileLock(DATA_DIR);
    activeLockToken = lockResult.token;
    try {
        mkdirSync(PROFILE_DIR, { recursive: true });
        validateProfileDir(PROFILE_DIR);
        const chrome = findChrome(opts.chromePath);
        const noSandbox = process.env.CHROME_NO_SANDBOX === '1';

        // Minimum window size to prevent responsive layout shifts
        // that cause Playwright "element is not stable" errors
        const minWidth = Math.max(opts.width || 1440, 1280);
        const minHeight = Math.max(opts.height || 900, 720);

        const extraFlags = (process.env.AGBROWSE_CHROME_FLAGS || '').split(/\s+/).filter(Boolean);
        const enableAutomation = process.env.AGBROWSE_ENABLE_AUTOMATION === '1';
        const baseFlags = [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${PROFILE_DIR}`,
            `--window-size=${minWidth},${minHeight}`,
            '--no-first-run', '--no-default-browser-check',
            '--disable-dev-shm-usage',
            ...(enableAutomation ? ['--enable-automation'] : []),
        ];
        const networkingFlag = process.env.AGBROWSE_KEEP_BG_NETWORKING === '1'
            ? []
            : ['--disable-background-networking'];
        // Heavy-site compat: relax cross-origin isolation to load sites that gate
        // on permissive embedder/opener policies (nytimes/amazon-class). Does NOT
        // include any stealth / anti-fingerprint flags — those are forbidden by
        // the gate:no-cloud-stealth-claims invariant.
        const compatFlags = process.env.AGBROWSE_HEAVY_SITE_COMPAT === '1'
            ? ['--disable-features=CrossOriginOpenerPolicy,CrossOriginEmbedderPolicy']
            : [];
        const stderrPath = join(DATA_DIR, 'chrome-stderr.log');
        const stderrFd = openSync(stderrPath, 'w');
        console.error(`[browser] launching: ${chrome}`);
        console.error(`[browser] user-data-dir: ${PROFILE_DIR}`);
        chromeProc = spawn(chrome, [
            ...baseFlags,
            ...networkingFlag,
            ...compatFlags,
            ...extraFlags,
            ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
            ...(headless ? ['--headless=new'] : []),
            'about:blank',
        ], { detached: true, stdio: ['ignore', 'ignore', stderrFd] });
        chromeProc.unref();
        closeSync(stderrFd);

        updateLockPid(DATA_DIR, lockResult.token, /** @type {number} */ (chromeProc.pid));

        const ready = await waitForCdpReady(port);
        if (ready) {
            activePort = port;
            clearPersistedSnapshot();
            writePersistedState({
                pid: chromeProc.pid,
                port,
                chromePath: chrome,
                startedAt: new Date().toISOString(),
                headless,
                lockToken: lockResult.token,
            });
            if (!headless) await foregroundCdpWindow(port, chrome);
        } else {
            const stderr = existsSync(stderrPath)
                ? readFileSync(stderrPath, 'utf8').trim().slice(-2000) : '';
            if (chromeProc && !chromeProc.killed) {
                console.error(`[browser] failed launch: spawned PID ${chromeProc.pid} but CDP did not respond after 10s`);
                if (stderr) console.error(`[browser] chrome stderr:\n${stderr}`);
                chromeProc.kill('SIGTERM');
                chromeProc = null;
            }
            clearPersistedState();

            if (!opts._retried && !opts.chromePath) {
                const altChrome = findChrome(null, { preferAlternate: true });
                if (altChrome !== chrome) {
                    console.warn(`[browser] retrying with alternate browser: ${basename(altChrome)}`);
                    releaseProfileLock(DATA_DIR, lockResult.token);
                    activeLockToken = null;
                    return launchChrome(port, { ...opts, chromePath: altChrome, _retried: true });
                }
            }

            const lockPath = join(DATA_DIR, 'profile.lock');
            const portInfo = await describePortHolder(port).catch(() => null);
            const portLine = portInfo
                ? `Port ${port} held by ${portInfo}.`
                : `Port ${port} held by another process.`;
            const canaryHint = process.platform === 'win32'
                ? 'Install Chrome Canary → https://www.google.com/chrome/canary/'
                : process.platform === 'darwin'
                    ? 'brew install --cask google-chrome-canary'
                    : '';
            throw new Error(
                `Chrome CDP not responding on port ${port} after 10s.\n` +
                `\n` +
                `Diagnose: agbrowse doctor\n` +
                (stderr ? `Chrome stderr: ${stderr.slice(0, 200)}\n` : '') +
                `\n` +
                `Likely causes (most common first):\n` +
                `  1. Chrome singleton absorbed the launch.\n` +
                `       → Close all Chrome windows, then: agbrowse start --headed\n` +
                (canaryHint ? `       → Or: ${canaryHint}\n` : '') +
                `  2. ${portLine}\n` +
                `       → agbrowse start --port ${port + 1}\n` +
                `  3. Stale profile lock at ${lockPath}.\n` +
                `       → agbrowse stop  (or: rm ${lockPath})\n` +
                `  4. No display available.\n` +
                `       → CHROME_HEADLESS=1 agbrowse start\n`
            );
        }
    } catch (err) {
        releaseProfileLock(DATA_DIR, lockResult.token);
        activeLockToken = null;
        throw err;
    }
}

/**
 * @param {any} opts
 */
function resolveHeadlessMode(opts = {}) {
    if (opts.headed === true) return false;
    if (opts.headless === true) return true;
    if (process.env.CHROME_HEADLESS === '1') {
        console.warn('[browser] note: CHROME_HEADLESS=1 in env → starting headless. Pass --headed to override.');
        return true;
    }
    return false;
}

/**
 * @param {any} chromePath
 */
function focusChromeApp(chromePath) {
    if (process.platform !== 'darwin' || !chromePath) return;
    const appName = macAppNameFromChromePath(chromePath);
    if (!appName) return;
    const result = spawnSync('open', ['-a', appName], { stdio: 'ignore' });
    if (result.status !== 0) {
        console.warn(`[browser] warning: Chrome started headed but macOS foreground activation failed for ${appName}`);
    }
}

/**
 * @param {any} port
 * @param {any} chromePath
 */
async function foregroundCdpWindow(port, chromePath) {
    try {
        const { browser } = await connectCdp(port, 2);
        const page = browser.contexts().flatMap((/** @type {any} */ context) => context.pages())[0];
        if (!page) {
            focusChromeApp(chromePath);
            return;
        }
        await page.bringToFront?.().catch(() => undefined);
        const cdp = await page.context().newCDPSession(page);
        try {
            const { targetInfo } = await cdp.send('Target.getTargetInfo');
            const targetId = targetInfo?.targetId;
            if (targetId) {
                const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId });
                await cdp.send('Browser.setWindowBounds', {
                    windowId,
                    bounds: { windowState: 'normal' },
                });
                await cdp.send('Target.activateTarget', { targetId });
            }
        } finally {
            await cdp.detach().catch(() => undefined);
        }
    } catch {
        // macOS app activation is best-effort; CDP readiness remains the source of truth.
    }
    focusChromeApp(chromePath);
}

/**
 * @param {any} chromePath
 */
function macAppNameFromChromePath(chromePath) {
    const marker = '.app/';
    const idx = String(chromePath).indexOf(marker);
    if (idx === -1) return null;
    const appPath = String(chromePath).slice(0, idx + 4);
    return basename(appPath, '.app');
}

function getPort() {
    const cliPort = getCliPort();
    if (cliPort) {
        activePort = cliPort;
        return cliPort;
    }
    if (activePort) return activePort;
    const state = readPersistedState();
    if (state?.port) {
        activePort = state.port;
        return state.port;
    }
    return DEFAULT_CDP_PORT;
}

/**
 * @param {any} port
 */
async function connectCdp(port = getPort(), retries = 4) {
    const { chromium } = await loadPlaywright();
    const cdpUrl = `http://127.0.0.1:${port}`;
    if (cached?.cdpUrl === cdpUrl && cached.browser.isConnected()) return cached;

    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10000 });
            cached = { browser, cdpUrl };
            browser.on('disconnected', () => { cached = null; });
            return cached;
        } catch (e) {
            lastError = e;
            if (i < retries - 1) {
                const delay = Math.min(1000 * Math.pow(2, i), 8000); // exponential backoff: 1s, 2s, 4s
                console.warn(`[browser] CDP connect attempt ${i + 1}/${retries} failed, retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw new Error(
        `CDP connection failed after ${retries} attempts: ${(/** @type {any} */ (lastError))?.message}\n` +
        `  💡 Fix: Ensure Chrome is running (agbrowse start) or check port ${port}`
    );
}

async function loadPlaywright() {
    try {
        return await import('playwright-core');
    } catch (error) {
        if ((/** @type {any} */ (error))?.code === 'ERR_MODULE_NOT_FOUND' || String((/** @type {any} */ (error))?.message || '').includes('playwright-core')) {
            throw new Error(
                `playwright-core is required.\n` +
                `  💡 Fix: cd <project-root> && npm install playwright-core`
            );
        }
        throw error;
    }
}

/**
 * @param {any} port
 */
async function closeBrowserViaCdp(port = getPort()) {
    const { chromium } = await loadPlaywright();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
    try {
        if (typeof browser.newBrowserCDPSession === 'function') {
            const cdp = await browser.newBrowserCDPSession();
            await cdp.send('Browser.close');
            await cdp.detach().catch(() => { });
            return;
        }

        const page = browser.contexts().flatMap((/** @type {any} */ context) => context.pages())[0];
        if (!page) throw new Error('No page available for Browser.close');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Browser.close');
        await cdp.detach().catch(() => { });
    } finally {
        await browser.close().catch(() => { });
    }
}

/**
 * @param {any} port
 */
async function getActivePage(port = getPort()) {
    const { browser } = await connectCdp(port);
    const pages = browser.contexts().flatMap((/** @type {any} */ c) => c.pages());
    const state = readPersistedState();
    const activeTargetId = state?.activeTargetId;
    if (activeTargetId) {
        for (const page of pages) {
            const pageTargetId = await getPageTargetId(page).catch(() => null);
            if (pageTargetId === activeTargetId) return page;
        }
        const tabs = await listTabs(port).catch(() => []);
        if (tabs.some((/** @type {any} */ t) => t.id === activeTargetId)) {
            throw new Error(`active target ${activeTargetId} is present in CDP but not attached as a Playwright page`);
        }
    }
    return pages[pages.length - 1] || null;
}

/**
 * @param {any} page
 */
async function getPageTargetId(page) {
    const session = await page.context().newCDPSession(page);
    try {
        const info = await session.send('Target.getTargetInfo');
        return info?.targetInfo?.targetId || null;
    } finally {
        await session.detach().catch(() => { });
    }
}

/**
 * @param {any} port
 */
async function getActiveTargetId(port = getPort()) {
    const page = await getActivePage(port);
    if (!page) return null;
    return getPageTargetId(page);
}

/**
 * @param {any} port
 */
async function getActiveTabInfo(port = getPort()) {
    const state = readPersistedState() || {};
    const persistedTargetId = state.activeTargetId || null;
    const page = await getActivePage(port);
    const currentTargetId = page ? await getPageTargetId(page).catch(() => null) : null;
    const tabs = await listManagedTabs(port).catch(() => []);
    const tab = tabs.find((/** @type {any} */ row) => row.targetId === currentTargetId)
        || tabs.find((/** @type {any} */ row) => row.targetId === persistedTargetId)
        || null;
    return {
        ok: Boolean(currentTargetId),
        port,
        persistedTargetId,
        currentTargetId,
        targetId: currentTargetId,
        tab: tab ? tabDisplayState(tab) : null,
        url: page?.url?.() || tab?.url || null,
        title: page ? await page.title().catch(() => tab?.title || '') : tab?.title || '',
        source: persistedTargetId ? 'persisted-active-target' : 'current-playwright-page',
    };
}

/**
 * @param {any} port
 */
async function listTabs(port = getPort()) {
    const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await resp.json()).filter((/** @type {any} */ t) => t.type === 'page');
}

/**
 * @param {any} port
 */
async function getBrowserStatus(port = getPort()) {
    try {
        const tabs = await listTabs(port);
        return { running: true, tabs: tabs.length, cdpUrl: `http://127.0.0.1:${port}` };
    } catch { return { running: false, tabs: 0 }; }
}

/**
 * @param {any} port
 */
async function getCdpSession(port = getPort()) {
    const page = await getActivePage(port);
    if (!page) return null;
    return page.context().newCDPSession(page);
}

async function closeBrowser() {
    const state = readPersistedState();
    const port = activePort || state?.port || DEFAULT_CDP_PORT;

    if (state?.pid) {
        await killPersistedChrome(state.pid).catch(() => false);
        await waitMs(300);
    }

    let status = await getBrowserStatus(port).catch(() => ({ running: false }));
    if (status.running) {
        await closeBrowserViaCdp(port).catch(() => { });
        await waitMs(300);
        status = await getBrowserStatus(port).catch(() => ({ running: false }));
    }

    if (status.running) {
        throw new Error(`Chrome is still running on port ${port} after stop attempts`);
    }

    cached = null;
    chromeProc = null;
    const lockToken = activeLockToken || state?.lockToken || null;
    clearPersistedState();
    clearPersistedSnapshot();
    releaseProfileLock(DATA_DIR, lockToken);
    activeLockToken = null;
    activePort = null;
}

// ═══════════════════════════════════════════════════
//  Actions Layer (from cli-jaw src/browser/actions.ts)
// ═══════════════════════════════════════════════════

const INTERACTIVE_ROLES = ['button', 'link', 'textbox', 'checkbox',
    'radio', 'combobox', 'menuitem', 'tab', 'slider', 'searchbox',
    'option', 'switch', 'spinbutton'];
const TELEMETRY_MAX_ENTRIES = 200;

/**
 * @param {any} maxEntries
 */
function telemetryInitScript(maxEntries) {
    const g = globalThis;
    const state = (/** @type {any} */ (g)).__browserAgentTelemetry || {
        console: [],
        maxEntries,
    };
    state.maxEntries = Math.max(state.maxEntries || 0, maxEntries);
    (/** @type {any} */ (g)).__browserAgentTelemetry = state;

    const push = (/** @type {any} */ entry) => {
        state.console.push({ ...entry, ts: Date.now() });
        if (state.console.length > state.maxEntries) {
            state.console.splice(0, state.console.length - state.maxEntries);
        }
    };

    const toText = (/** @type {any} */ value) => {
        if (typeof value === 'string') return value;
        if (value instanceof Error) return value.stack || value.message;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    };

    if (!(/** @type {any} */ (g)).__browserAgentConsolePatched && g.console) {
        (/** @type {any} */ (g)).__browserAgentConsolePatched = true;
        for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
            const original = (/** @type {any} */ (g.console))[level]?.bind(g.console);
            if (!original) continue;
            (/** @type {any} */ (g.console))[level] = (/** @type {...any} */ ...args) => {
                push({ type: level, text: args.map(toText).join(' ') });
                return original(...args);
            };
        }
    }

    if (!(/** @type {any} */ (g)).__browserAgentErrorPatched) {
        (/** @type {any} */ (g)).__browserAgentErrorPatched = true;
        g.addEventListener('error', event => {
            push({
                type: 'pageerror',
                text: event.error?.stack || event.message || 'Unknown page error',
            });
        });
        g.addEventListener('unhandledrejection', event => {
            push({
                type: 'unhandledrejection',
                text: toText(event.reason),
            });
        });
    }
}

/**
 * @param {any} page
 */
async function ensureTelemetry(page) {
    await page.addInitScript(telemetryInitScript, TELEMETRY_MAX_ENTRIES);
    await page.evaluate(telemetryInitScript, TELEMETRY_MAX_ENTRIES).catch(() => { });
}

/**
 * @param {any} port
 */
async function getReadyPage(port = getPort()) {
    const page = await getActivePage(port);
    if (!page) throw new Error('No active page — run `start` first, then `navigate <url>`');
    await ensureTelemetry(page);
    return page;
}

/**
 * @param {any} page
 */
async function clearConsoleBuffer(page) {
    await page.evaluate(() => {
        const state = (/** @type {any} */ (globalThis)).__browserAgentTelemetry;
        if (state) state.console = [];
    });
}

/**
 * @param {any} page
 * @param {any} limit
 */
async function readConsoleBuffer(page, limit) {
    return await page.evaluate((/** @type {any} */ max) => {
        const logs = (/** @type {any} */ (globalThis)).__browserAgentTelemetry?.console || [];
        return logs.slice(-max);
    }, limit);
}

/**
 * @param {any} page
 */
async function getViewportInfo(page) {
    return await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
    }));
}

/**
 * @param {any} clip
 * @param {any} viewport
 */
function normalizeClip(clip, viewport) {
    const x = Math.max(0, Math.round(clip.x));
    const y = Math.max(0, Math.round(clip.y));
    const maxWidth = Math.max(0, viewport.width - x);
    const maxHeight = Math.max(0, viewport.height - y);
    const width = Math.min(Math.max(1, Math.round(clip.width)), maxWidth);
    const height = Math.min(Math.max(1, Math.round(clip.height)), maxHeight);

    if (width <= 0 || height <= 0) {
        throw new Error(`Clip is outside viewport: ${JSON.stringify({ clip, viewport })}`);
    }

    return { x, y, width, height };
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function snapshot(port, opts = {}) {
    const page = await getReadyPage(port);
    const targetId = await getPageTargetId(page).catch(() => null);

    let nodes;

    // Strategy 1: locator.ariaSnapshot()
    try {
        const yaml = await page.locator('body').ariaSnapshot({ timeout: 10000 });
        nodes = parseAriaYaml(yaml);
    } catch (e1) {
        // Strategy 2: direct CDP Accessibility.getFullAXTree
        try {
            const cdp = await getCdpSession(port);
            const { nodes: axNodes } = await cdp.send('Accessibility.getFullAXTree');
            nodes = parseCdpAxTree(axNodes);
            await cdp.detach().catch(() => { });
        } catch (e2) {
            throw new Error(
                `Snapshot failed.\n  ariaSnapshot: ${(/** @type {any} */ (e1)).message}\n  CDP fallback: ${(/** @type {any} */ (e2)).message}\n` +
                `  💡 Fix: Try navigating to a page first, or use 'screenshot' for visual inspection`
            );
        }
    }

    nodes = annotateNodeOccurrences(nodes);

    if (opts.interactive) {
        nodes = nodes.filter(n => INTERACTIVE_ROLES.includes(n.role));
    }
    // Token budget: limit output nodes
    if (opts.maxNodes && nodes.length > opts.maxNodes) {
        const totalNodes = nodes.length;
        nodes = nodes.slice(0, opts.maxNodes);
        nodes.push(/** @type {any} */ ({ ref: '...', role: 'note', name: `${opts.maxNodes} of ${totalNodes} shown (--max-nodes)`, depth: 0 }));
    }

    if (opts.persist) {
        const snapshotData = {
            url: page.url(),
            interactive: Boolean(opts.interactive),
            maxNodes: opts.maxNodes ?? null,
            savedAt: new Date().toISOString(),
            targetId,
            nodes,
        };
        // Phase 9.1: per-tab snapshots for isolation
        if (targetId) writePersistedSnapshot(snapshotData, targetId);
        // DEPRECATED: global snapshot is kept for backward compatibility during transition
        // but will be removed in a future release. Use per-tab snapshots only.
        writePersistedSnapshot(snapshotData);
    }
    return nodes;
}

/**
 * @param {any} page
 * @param {any} node
 */
function locatorForSnapshotNode(page, node) {
    const base = node.name
        ? page.getByRole(node.role, { name: node.name })
        : page.getByRole(node.role);
    return base.nth(node.occurrence ?? 0);
}

/**
 * @param {any} page
 * @param {any} port
 * @param {any} ref
 */
async function refToLocator(page, port, ref) {
    const targetId = await getPageTargetId(page).catch(() => null);
    const persisted = targetId ? readPersistedSnapshot(targetId) : null;
    if (!persisted?.nodes) {
        throw new Error(
            `ref ${ref}: no per-tab snapshot found\n` +
            `  💡 Fix: Run 'snapshot' first to generate a per-tab snapshot`
        );
    }
    if (persisted?.url && persisted.url !== page.url()) {
        throw new Error(
            `ref ${ref} is stale because the page changed.\n` +
            `  💡 Fix: Re-run snapshot on ${page.url()} before using refs`
        );
    }

    const node = persisted.nodes.find((/** @type {any} */ n) => n.ref === ref);
    if (!node) throw new Error(`ref ${ref} not found — re-run snapshot`);
    return locatorForSnapshotNode(page, node);
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function screenshotAction(port, opts = {}) {
    const page = await getReadyPage(port);
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    const type = opts.type || 'png';
    const filename = `screenshot_${Date.now()}.${type}`;
    const filepath = join(SCREENSHOTS_DIR, filename);
    const viewport = await getViewportInfo(page);

    let clip = null;

    if (opts.ref && opts.clip) {
        throw new Error('Use either --ref or --clip, not both');
    }

    if (opts.ref) {
        const locator = await refToLocator(page, port, opts.ref);
        await locator.screenshot({ path: filepath, type });
    } else if (opts.clip) {
        clip = normalizeClip(opts.clip, viewport);
        await page.screenshot({ path: filepath, type, clip });
    } else {
        await page.screenshot({ path: filepath, fullPage: opts.fullPage, type });
    }

    return {
        path: filepath,
        url: page.url(),
        targetId: `cdp:${port}`,
        dpr: viewport.dpr,
        viewport: { width: viewport.width, height: viewport.height },
        clip,
    };
}

/**
 * @param {any} port
 * @param {any} ref
 * @param {any} opts
 */
async function click(port, ref, opts = {}) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    if (opts.doubleClick) await locator.dblclick();
    else if (opts.rightClick) await locator.click({ button: 'right' });
    else await locator.click();
    return { ok: true, url: page.url() };
}

/**
 * @param {any} port
 * @param {any} ref
 * @param {any} text
 * @param {any} opts
 */
async function typeAction(port, ref, text, opts = {}) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.fill(text);
    if (opts.submit) await page.keyboard.press('Enter');
    return { ok: true };
}

/**
 * @param {any} port
 * @param {any} key
 */
async function press(port, key) {
    const page = await getReadyPage(port);
    await page.keyboard.press(key);
    return { ok: true };
}

/**
 * @param {any} port
 * @param {any} ref
 */
async function hover(port, ref) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.hover();
    return { ok: true };
}

/**
 * @param {any} port
 * @param {any} url
 * @param {{ waitUntil?: string, timeout?: number }} [opts]
 */
async function navigate(port, url, opts = {}) {
    const page = await getReadyPage(port);
    const waitUntil = opts.waitUntil || 'domcontentloaded';
    const timeout = Number.isFinite(opts.timeout) ? opts.timeout : 30000;
    let degraded = null;
    /** @param {any} e */
    const isCoopBlock = (e) => /ERR_BLOCKED_BY_RESPONSE|Cross-Origin-Opener-Policy/i.test((e && e.message) || String(e));
    /** @param {any} e */
    const isTimeout = (e) => /Timeout|timeout/.test((e && e.message) || String(e));
    /** Some sites (e.g. anti-bot interstitials, COOP-restrictive sites) leave
     *  the destination page in a 0-width state where snapshot/screenshot/text
     *  all return empty. Detect that and re-navigate via about:blank to
     *  reset the viewport context. */
    const checkHealthy = async () => {
        try {
            const dims = await page.evaluate(() => ({
                w: (typeof window !== 'undefined' && window.innerWidth) || 0,
                h: (typeof window !== 'undefined' && window.innerHeight) || 0,
            }));
            return dims && dims.w > 0 && dims.h > 0;
        } catch { return false; }
    };
    try {
        await page.goto(url, { waitUntil, timeout });
    } catch (err) {
        if (isCoopBlock(err)) {
            try {
                await page.goto('about:blank', { waitUntil: 'commit', timeout: 5000 });
                await page.goto(url, { waitUntil, timeout });
                degraded = `fallback:about:blank (COOP block on direct navigate)`;
            } catch (err2) {
                if (isTimeout(err2)) {
                    await page.goto(url, { waitUntil: 'commit', timeout });
                    degraded = `fallback:about:blank+commit (COOP + timeout)`;
                } else {
                    throw err2;
                }
            }
        } else if (isTimeout(err) && waitUntil !== 'commit') {
            await page.goto(url, { waitUntil: 'commit', timeout });
            degraded = `fallback:commit (initial waitUntil=${waitUntil} timed out)`;
        } else {
            throw err;
        }
    }
    if (!(await checkHealthy())) {
        try {
            await page.goto('about:blank', { waitUntil: 'commit', timeout: 5000 });
            await page.goto(url, { waitUntil, timeout });
            degraded = `${degraded ? degraded + '; ' : ''}fallback:about:blank (post-nav 0-width recovery)`;
        } catch { /* ignore: keep whatever state we landed in */ }
    }
    const targetId = await getPageTargetId(page).catch(() => null);
    clearPersistedSnapshot(targetId);
    clearPersistedSnapshot();
    return { ok: true, url: page.url(), degraded };
}

/**
 * @param {any} port
 * @param {any} expression
 * @param {any} opts
 */
async function evaluate(port, expression, opts = {}) {
    enforcePolicy(opts.policy || {}, {
        evaluate: true,
        unsafeAllow: opts.unsafeAllow || [],
    });
    const page = await getReadyPage(port);
    enforcePolicy(opts.policy || {}, {
        url: page.url?.(),
        evaluate: true,
        unsafeAllow: opts.unsafeAllow || [],
    });
    const result = await page.evaluate(expression);
    return { ok: true, result };
}

/**
 * @param {any} port
 * @param {any} format
 */
async function getPageText(port, format = 'text') {
    const page = await getReadyPage(port);
    if (format === 'html') return { text: await page.content() };
    return { text: await page.innerText('body') };
}

/**
 * @param {any} port
 * @param {any} x
 * @param {any} y
 * @param {any} opts
 */
async function mouseClick(port, x, y, opts = {}) {
    const page = await getReadyPage(port);
    if (opts.doubleClick) await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y);
    return { success: true, clicked: { x, y } };
}

// ═══════════════════════════════════════════════════
//  Extended Actions (v2)
// ═══════════════════════════════════════════════════

/**
 * @param {any} port
 * @param {any} direction
 * @param {any} opts
 */
async function scroll(port, direction, opts = {}) {
    const page = await getReadyPage(port);
    const amount = opts.amount || 500;
    const deltaMap = {
        down: [0, amount], up: [0, -amount],
        right: [amount, 0], left: [-amount, 0],
    };
    const [dx, dy] = (/** @type {any} */ (deltaMap))[direction] || [0, amount];

    if (opts.ref) {
        const locator = await refToLocator(page, port, opts.ref);
        await locator.scrollIntoViewIfNeeded();
        await locator.hover();
        await page.mouse.wheel(dx, dy);
        return { ok: true, direction, pixels: amount, ref: opts.ref };
    }

    await page.mouse.wheel(dx, dy);
    return { ok: true, direction, pixels: amount };
}

/**
 * @param {any} port
 * @param {any} ref
 * @param {any} opts
 */
async function waitFor(port, ref, opts = {}) {
    const timeout = opts.timeout || 10000;
    const page = await getReadyPage(port);
    const targetId = await getPageTargetId(page).catch(() => null);
    const persisted = targetId ? readPersistedSnapshot(targetId) : null;
    if (!persisted?.nodes) {
        throw new Error(
            `wait-for: no per-tab snapshot found for ref ${ref}\n` +
            `  💡 Fix: Run 'snapshot' first, or use 'wait-for-selector' / 'wait-for-text'`
        );
    }
    if (persisted.url && persisted.url !== page.url()) {
        throw new Error(
            `wait-for: ref ${ref} is stale because the page changed.\n` +
            `  💡 Fix: Re-run snapshot, or use 'wait-for-selector' / 'wait-for-text' after navigation`
        );
    }

    const node = persisted.nodes.find((/** @type {any} */ entry) => entry.ref === ref);
    if (!node) {
        throw new Error(
            `wait-for: ref ${ref} not found in the last snapshot\n` +
            `  💡 Fix: Run 'snapshot' again, or use 'wait-for-selector' / 'wait-for-text'`
        );
    }

    const locator = locatorForSnapshotNode(page, node);
    await locator.waitFor({ state: opts.state || 'visible', timeout });
    return {
        ok: true,
        ref,
        elapsed: null,
        deprecated: true,
        matched: { role: node.role, name: node.name, occurrence: node.occurrence ?? 0 },
    };
}

/**
 * @param {any} port
 * @param {any} selector
 * @param {any} opts
 */
async function waitForSelector(port, selector, opts = {}) {
    const timeout = opts.timeout || 10000;
    const page = await getReadyPage(port);
    await page.locator(selector).first().waitFor({ state: opts.state || 'visible', timeout });
    return { ok: true, selector, state: opts.state || 'visible' };
}

/**
 * @param {any} port
 * @param {any} text
 * @param {any} opts
 */
async function waitForText(port, text, opts = {}) {
    const timeout = opts.timeout || 10000;
    const page = await getReadyPage(port);
    await page.getByText(text).first().waitFor({ state: opts.state || 'visible', timeout });
    return { ok: true, text, state: opts.state || 'visible' };
}

/**
 * @param {any} port
 * @param {any} target
 * @param {any} opts
 */
async function tabSwitch(port, target, opts = {}) {
    const tabs = await listTabs(port);
    const wantedIndex = Number(target);
    const wanted = Number.isInteger(wantedIndex)
        ? tabs[wantedIndex - 1]
        : tabs.find((/** @type {any} */ t) => t.id === target);
    if (!wanted) {
        throw new Error(
            `Tab ${target} not found\n` +
            `  💡 Fix: Run 'tabs' and use a valid index or target id`
        );
    }
    /** @type {any[]|undefined} */
    let activeCommands;
    try {
        activeCommands = await listActiveCommands({
            browserProfileKey: String(port),
            targetId: wanted.id,
            active: true,
        });
    } catch (cause) {
        if (opts.force === true) activeCommands = [];
        else {
            const error = new Error(
                `cannot verify active-command ownership for tab ${wanted.id}\n` +
                `  💡 Fix: retry, inspect ${(/** @type {any} */ (cause))?.message || 'active-command store'}, or pass --force if you are sure`
            );
            (/** @type {any} */ (error)).code = 'active-command.store-unavailable';
            error.cause = cause;
            throw error;
        }
    }
    if (activeCommands.length > 0 && opts.force !== true) {
        const owner = activeCommands[0];
        const error = new Error(
            `tab ${wanted.id} is owned by active command ${owner.commandId}\n` +
            `  💡 Fix: wait for the command to finish, or pass --force if you are sure`
        );
        (/** @type {any} */ (error)).code = 'active-command.target-owned';
        (/** @type {any} */ (error)).command = owner;
        throw error;
    }
    const { browser } = await connectCdp(port);
    if (!wanted.id) throw new Error(`Could not switch to tab ${target}: target id missing`);
    const cdp = await browser.newBrowserCDPSession();
    try {
        await cdp.send('Target.activateTarget', { targetId: wanted.id });
    } finally {
        await cdp.detach().catch(() => { });
    }
    updatePersistedState({
        port,
        activeTargetId: wanted.id,
    });
    clearPersistedSnapshot();
    return { ok: true, tab: Number.isInteger(wantedIndex) ? wantedIndex : null, targetId: wanted.id, title: wanted?.title };
}

/**
 * @param {any} port
 * @param {any} ref
 * @param {any} value
 */
async function selectOption(port, ref, value) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.selectOption(value);
    return { ok: true, ref, value };
}

/**
 * @param {any} port
 * @param {any} ref
 * @param {any} checked
 */
async function setChecked(port, ref, checked) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    if (checked) await locator.check();
    else await locator.uncheck();
    return { ok: true, ref, checked };
}

/**
 * @param {any} port
 * @param {any} fromRef
 * @param {any} toRef
 */
async function drag(port, fromRef, toRef) {
    const page = await getReadyPage(port);
    const fromLocator = await refToLocator(page, port, fromRef);
    const toLocator = await refToLocator(page, port, toRef);
    await fromLocator.dragTo(toLocator);
    return { ok: true, from: fromRef, to: toRef };
}

/**
 * @param {any} port
 * @param {any} ref
 * @param {string[]} files
 */
async function uploadFiles(port, ref, files) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.setInputFiles(files);
    return { ok: true, ref, files };
}

/**
 * @param {any} ms
 */
async function waitMs(ms) {
    await new Promise(r => setTimeout(r, ms));
    return { ok: true, waited: ms };
}

/**
 * @param {any} port
 */
async function reload(port) {
    const page = await getReadyPage(port);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const targetId = await getPageTargetId(page).catch(() => null);
    clearPersistedSnapshot(targetId);
    clearPersistedSnapshot();
    return { ok: true, url: page.url() };
}

/**
 * @param {any} port
 * @param {any} width
 * @param {any} height
 * @param {any} opts
 */
async function resize(port, width, height, opts = {}) {
    const page = await getReadyPage(port);

    const cdp = await getCdpSession(port);
    if (!cdp) throw new Error('Could not open CDP session for resize');

    try {
        const { targetInfo } = await cdp.send('Target.getTargetInfo');
        const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });

        if (opts.fullscreen) {
            try {
                await cdp.send('Browser.setWindowBounds', {
                    windowId,
                    bounds: { windowState: 'fullscreen' },
                });
                const viewport = await getViewportInfo(page);
                return { ok: true, mode: 'fullscreen', strategy: 'window-bounds', viewport };
            } catch (error) {
                await page.setViewportSize({ width: 1920, height: 1080 });
                const viewport = await getViewportInfo(page);
                return {
                    ok: true,
                    mode: 'fullscreen',
                    strategy: 'viewport-fallback',
                    viewport,
                    warning: (/** @type {any} */ (error)).message,
                };
            }
        }

        await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'normal', width, height },
        });
        const viewport = await getViewportInfo(page);
        return { ok: true, width: viewport.width, height: viewport.height, strategy: 'window-bounds' };
    } catch (error) {
        const fallbackWidth = opts.fullscreen ? 1920 : width;
        const fallbackHeight = opts.fullscreen ? 1080 : height;
        await page.setViewportSize({ width: fallbackWidth, height: fallbackHeight });
        const viewport = await getViewportInfo(page);
        return {
            ok: true,
            width: viewport.width,
            height: viewport.height,
            strategy: 'viewport-fallback',
            warning: (/** @type {any} */ (error)).message,
        };
    } finally {
        await cdp.detach().catch(() => { });
    }
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function getDom(port, opts = {}) {
    const page = await getReadyPage(port);

    let html;
    if (opts.selector) {
        html = await page.locator(opts.selector).first().evaluate((/** @type {any} */ node) => node.outerHTML);
    } else {
        html = await page.content();
    }

    if (opts.maxChars && html.length > opts.maxChars) {
        return {
            html: html.slice(0, opts.maxChars),
            truncated: true,
            shownChars: opts.maxChars,
            totalChars: html.length,
        };
    }
    return { html, truncated: false, shownChars: html.length, totalChars: html.length };
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function captureConsole(port, opts = {}) {
    const page = await getReadyPage(port);
    const duration = opts.duration ?? 0;

    if (opts.clear) {
        await clearConsoleBuffer(page);
    }
    if (opts.reload) {
        await page.reload({ waitUntil: 'domcontentloaded' });
    }
    if (opts.expression) {
        enforcePolicy(opts.policy || {}, {
            evaluate: true,
            unsafeAllow: opts.unsafeAllow || [],
        });
        await page.evaluate(opts.expression);
    }
    if (duration > 0) {
        await new Promise(r => setTimeout(r, duration));
    }

    const limit = opts.limit || 50;
    const logs = await readConsoleBuffer(page, limit);
    return { logs, count: logs.length, duration, buffered: true };
}

/**
 * @param {any} page
 */
async function collectPerformanceRequests(page) {
    return page.evaluate(() => {
        const normalize = (/** @type {any} */ url, /** @type {any} */ type, /** @type {any} */ source) => ({
            method: 'GET',
            url,
            type,
            source,
        });
        const out = [];
        const seen = new Set();

        const navEntries = performance.getEntriesByType('navigation');
        for (const entry of navEntries) {
            const url = entry.name || location.href;
            const key = `navigation:${url}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(normalize(url, 'document', 'performance'));
            }
        }

        const resourceEntries = performance.getEntriesByType('resource');
        for (const entry of resourceEntries) {
            const url = entry.name;
            const type = (/** @type {any} */ (entry)).initiatorType || 'resource';
            const key = `${type}:${url}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(normalize(url, type, 'performance'));
            }
        }

        return out;
    });
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function captureNetwork(port, opts = {}) {
    const page = await getReadyPage(port);
    const duration = opts.duration ?? 5000;
    /** @type {any[]} */
    const liveRequests = [];
    const shouldCaptureLive = opts.reload || duration > 0;

    if (opts.clear) {
        await page.evaluate(() => performance.clearResourceTimings());
    }

    if (shouldCaptureLive) {
        const cdp = await getCdpSession(port);
        if (!cdp) throw new Error('Could not open CDP session for network capture');

        const handler = (/** @type {any} */ params) => {
            liveRequests.push({
                method: params.request.method,
                url: params.request.url,
                type: params.type || 'request',
                source: 'live',
            });
        };

        await cdp.send('Network.enable');
        cdp.on('Network.requestWillBeSent', handler);

        try {
            if (opts.reload) {
                await page.reload({ waitUntil: 'load' });
            }
            if (duration > 0) {
                await new Promise(r => setTimeout(r, duration));
            }
        } finally {
            cdp.removeListener('Network.requestWillBeSent', handler);
            await cdp.send('Network.disable').catch(() => { });
            await cdp.detach().catch(() => { });
        }
    }

    const existing = opts.includeExisting === false ? [] : await collectPerformanceRequests(page);
    const filteredExisting = filterRequests(existing, opts.filter);
    const filteredLive = filterRequests(liveRequests, opts.filter);
    const requests = dedupeRequests([...filteredExisting, ...filteredLive]);
    return {
        requests,
        count: requests.length,
        duration,
        existingCount: filteredExisting.length,
        liveCount: filteredLive.length,
    };
}

/**
 * @param {any} port
 * @param {any} x
 * @param {any} y
 */
async function moveMouse(port, x, y) {
    const page = await getReadyPage(port);
    await page.mouse.move(x, y);
    return { ok: true, position: { x, y } };
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function mouseDown(port, opts = {}) {
    const page = await getReadyPage(port);
    await page.mouse.down({ button: opts.button || 'left' });
    return { ok: true, button: opts.button || 'left' };
}

/**
 * @param {any} port
 * @param {any} opts
 */
async function mouseUp(port, opts = {}) {
    const page = await getReadyPage(port);
    await page.mouse.up({ button: opts.button || 'left' });
    return { ok: true, button: opts.button || 'left' };
}

// ═══════════════════════════════════════════════════
//  CLI Layer
// ═══════════════════════════════════════════════════

const sub = process.argv[2];
const browserDeps = {
    getPage: () => getReadyPage(getPort()),
    createIsolatedPage: async () => {
        const { browser } = await connectCdp(getPort());
        const context = await browser.newContext();
        const page = await context.newPage();
        return { page, cleanup: async () => context.close().catch(() => undefined) };
    },
    getCdpSession: () => getCdpSession(getPort()),
    getPort: () => getPort(),
    getTargetId: () => getActiveTargetId(getPort()),
    getBrowserStatus: (port = getPort()) => getBrowserStatus(Number(port)),
    readBrowserState: () => readPersistedState(),
    ensureStarted: (options = {}) => launchChrome(Number((/** @type {any} */ (options)).port || getPort()), options),
};

/**
 * @param {string[]} argv
 */
async function runResearchCli(argv = []) {
    const command = argv[0] || 'help';
    if (command === 'plan') {
        const { values } = parseArgs({
            args: argv.slice(1),
            options: {
                query: { type: 'string' },
                json: { type: 'boolean', default: false },
                'max-queries': { type: 'string' },
            },
            strict: false,
        });
        const query = typeof values.query === 'string' ? values.query.trim() : '';
        if (!query) {
            return {
                exitCode: 1,
                stderr: 'Usage: browser.mjs research plan --query <problem> [--max-queries N] [--json]',
            };
        }
        const maxQueries = values['max-queries'] ? Number(values['max-queries']) : undefined;
        const plan = planKoreanResearch(query, { maxQueries: Number.isFinite(maxQueries) ? maxQueries : undefined });
        return values.json
            ? { stdout: JSON.stringify(plan, null, 2) }
            : { stdout: formatResearchPlan(plan) };
    }

    if (command === 'normalize-results') {
        const { values } = parseArgs({
            args: argv.slice(1),
            options: {
                file: { type: 'string' },
                backend: { type: 'string' },
                query: { type: 'string' },
                json: { type: 'boolean', default: false },
            },
            strict: false,
        });
        const file = typeof values.file === 'string' ? values.file.trim() : '';
        if (!file) {
            return {
                exitCode: 1,
                stderr: 'Usage: browser.mjs research normalize-results --file <json> [--backend name] [--query query] [--json]',
            };
        }
        const input = JSON.parse(readFileSync(file, 'utf8'));
        const normalized = normalizeSearchResults(input, {
            backend: typeof values.backend === 'string' ? values.backend : undefined,
            query: typeof values.query === 'string' ? values.query : undefined,
        });
        return values.json
            ? { stdout: JSON.stringify(normalized, null, 2) }
            : { stdout: formatNormalizedSearchResults(normalized) };
    }

    if (command === 'enrich-fetch') {
        const { values } = parseArgs({
            args: argv.slice(1),
            options: {
                plan: { type: 'string' },
                results: { type: 'string' },
                json: { type: 'boolean', default: false },
                browser: { type: 'string', default: 'never' },
                trace: { type: 'boolean', default: false },
                'max-results': { type: 'string' },
                'timeout-ms': { type: 'string' },
                'max-bytes': { type: 'string' },
            },
            strict: false,
        });
        const planFile = typeof values.plan === 'string' ? values.plan.trim() : '';
        const resultsFile = typeof values.results === 'string' ? values.results.trim() : '';
        if (!planFile || !resultsFile) {
            return {
                exitCode: 1,
                stderr: 'Usage: browser.mjs research enrich-fetch --plan <json> --results <json> [--browser never|auto|required] [--max-results N] [--json]',
            };
        }
        const plan = JSON.parse(readFileSync(planFile, 'utf8'));
        const normalized = JSON.parse(readFileSync(resultsFile, 'utf8'));
        const enriched = await enrichSearchResultsWithFetch(plan, normalized, {
            browser: /** @type {any} */ (values.browser),
            trace: Boolean(values.trace),
            maxResults: values['max-results'] === undefined ? undefined : Number(values['max-results']),
            timeoutMs: values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']),
            maxBytes: values['max-bytes'] === undefined ? undefined : Number(values['max-bytes']),
        });
        return values.json
            ? { stdout: JSON.stringify(enriched, null, 2) }
            : { stdout: formatFetchEnrichment(enriched) };
    }

    if (command === 'browse-plan') {
        const { values } = parseArgs({
            args: argv.slice(1),
            options: {
                plan: { type: 'string' },
                enrichment: { type: 'string' },
                json: { type: 'boolean', default: false },
                'max-actions': { type: 'string' },
            },
            strict: false,
        });
        const planFile = typeof values.plan === 'string' ? values.plan.trim() : '';
        const enrichmentFile = typeof values.enrichment === 'string' ? values.enrichment.trim() : '';
        if (!planFile || !enrichmentFile) {
            return {
                exitCode: 1,
                stderr: 'Usage: browser.mjs research browse-plan --plan <json> --enrichment <json> [--max-actions N] [--json]',
            };
        }
        const plan = JSON.parse(readFileSync(planFile, 'utf8'));
        const enrichment = JSON.parse(readFileSync(enrichmentFile, 'utf8'));
        const browsePlan = planBrowseEscalation(plan, enrichment, {
            maxActions: values['max-actions'] === undefined ? undefined : Number(values['max-actions']),
        });
        return values.json
            ? { stdout: JSON.stringify(browsePlan, null, 2) }
            : { stdout: formatBrowseEscalation(browsePlan) };
    }

    return {
        stdout: `agbrowse research <command>

Commands:
  plan --query <problem> [--max-queries N] [--json]
      Rewrite a Korean research problem into constraints, focused queries, and fetch/browse policy.
  normalize-results --file <json> [--backend name] [--query query] [--json]
      Normalize provider search rows into URL candidates. Snippets are not final evidence.
  enrich-fetch --plan <json> --results <json> [--browser never|auto|required] [--max-results N] [--json]
      Fetch original pages for normalized URL candidates and update the constraint ledger.
  browse-plan --plan <json> --enrichment <json> [--max-actions N] [--json]
      Plan explicit browser commands for candidates fetch could not fully verify.`,
    };
}

/**
 * @param {ReturnType<typeof planKoreanResearch>} plan
 */
function formatResearchPlan(plan) {
    return [
        `research plan: ${plan.schemaVersion}`,
        `problem: ${plan.problem}`,
        `constraints: ${plan.constraints.length}`,
        `source hints: ${plan.sourceHints.join(', ') || 'none'}`,
        'queries:',
        ...plan.atomicQueries.map((query, index) => `  ${index + 1}. [${query.purpose}] ${query.query}`),
        `fetch original pages: ${plan.followUp.fetchOriginalPages ? 'yes' : 'no'}`,
        `browse required: ${plan.followUp.browseRequired ? plan.followUp.browseReasons.join(', ') || 'yes' : 'no'}`,
    ].join('\n');
}

/**
 * @param {ReturnType<typeof normalizeSearchResults>} normalized
 */
function formatNormalizedSearchResults(normalized) {
    return [
        `search results: ${normalized.schemaVersion}`,
        `backend: ${normalized.backend}`,
        `query: ${normalized.query || '(empty)'}`,
        `url candidates: ${normalized.results.length}`,
        `dropped: ${normalized.dropped.length}`,
        ...normalized.results.map(result => `  ${result.rank}. ${result.title || '(untitled)'} - ${result.url}`),
        'snippets are not final evidence',
    ].join('\n');
}

/**
 * @param {Awaited<ReturnType<typeof enrichSearchResultsWithFetch>>} enriched
 */
function formatFetchEnrichment(enriched) {
    return [
        `fetch enrichment: ${enriched.schemaVersion}`,
        `query: ${enriched.query || '(empty)'}`,
        `candidates fetched: ${enriched.candidates.length}`,
        `ledger: ${enriched.summary.status}`,
        `supported: ${enriched.summary.supported.join(', ') || 'none'}`,
        `pending: ${enriched.summary.pending.join(', ') || 'none'}`,
        `next step: ${enriched.nextStep.type} (${enriched.nextStep.reason})`,
    ].join('\n');
}

/**
 * @param {ReturnType<typeof planBrowseEscalation>} browsePlan
 */
function formatBrowseEscalation(browsePlan) {
    return [
        `browse escalation: ${browsePlan.schemaVersion}`,
        `needs browse: ${browsePlan.needsBrowse ? 'yes' : 'no'}`,
        `actions: ${browsePlan.summary.actionCount}`,
        `reasons: ${browsePlan.summary.reasons.join(', ') || 'none'}`,
        `pending: ${browsePlan.summary.pending.join(', ') || 'none'}`,
        ...browsePlan.actions.map(action => [
            `  ${action.rank}. ${action.priority} ${action.url}`,
            `     reasons: ${action.reasons.join(', ')}`,
            ...action.commands.map(command => `     $ ${command}`),
        ].join('\n')),
    ].join('\n');
}

try {
    await maybeEmitUpdateNotice({
        argv: process.argv.slice(2),
        dataDir: DATA_DIR,
        packageRoot: PACKAGE_ROOT,
    });
    switch (sub) {
        case 'research': {
            const result = await runResearchCli(process.argv.slice(3));
            if (result.stderr) {
                console.error(result.stderr);
                process.exit(result.exitCode || 1);
            }
            console.log(result.stdout);
            break;
        }
        case 'skills': {
            const result = runSkillsCli(process.argv.slice(3), { sourceRoot: SKILLS_ROOT });
            if (result.type === 'json') {
                console.log(JSON.stringify(result.skills, null, 2));
            } else if (result.type === 'list') {
                for (const skill of result.skills) {
                    const status = skill.available ? 'available' : 'missing';
                    console.log(`${skill.name.padEnd(12)} ${status.padEnd(9)} ${skill.description}`);
                    console.log(`             ${skill.path}`);
                }
            } else if (result.type === 'install') {
                if ((/** @type {any} */ (result.result)).help) {
                    console.log((/** @type {any} */ (result.result)).usage);
                } else if (result.result.json) {
                    console.log(JSON.stringify(result.result, null, 2));
                } else {
                    console.log(`installed ${(/** @type {any} */ (result.result)).installed.length} skills to ${(/** @type {any} */ (result.result)).targetRoot}`);
                    for (const item of (/** @type {any} */ (result.result)).installed) {
                        console.log(`  ${item.action.padEnd(6)} ${item.name} -> ${item.path}`);
                    }
                }
            } else {
                console.log((/** @type {any} */ (result)).text);
            }
            break;
        }
        case 'install-skills': {
            const result = runInstallSkillsCli(process.argv.slice(3), { sourceRoot: SKILLS_ROOT });
            if ((/** @type {any} */ (result)).help) {
                console.log((/** @type {any} */ (result)).usage);
                break;
            }
            if (result.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(`installed ${(/** @type {any} */ (result)).installed.length} skills to ${(/** @type {any} */ (result)).targetRoot}`);
                for (const item of (/** @type {any} */ (result)).installed) {
                    console.log(`  ${item.action.padEnd(6)} ${item.name} -> ${item.path}`);
                }
            }
            break;
        }
        case 'web-ai':
            await runWebAiCli(process.argv.slice(3), browserDeps);
            break;
        case 'runway':
            await runRunwayCli(process.argv.slice(3), browserDeps);
            break;
        case 'fetch':
            await runAdaptiveFetchCli(process.argv.slice(3), browserDeps);
            break;
        case 'start': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    port: { type: 'string', default: String(DEFAULT_CDP_PORT) },
                    headless: { type: 'boolean', default: false },
                    headed: { type: 'boolean', default: false },
                    'chrome-path': { type: 'string' },
                    'heavy-site-compat': { type: 'boolean', default: false },
                    'keep-bg-networking': { type: 'boolean', default: false },
                }, strict: false,
            });
            if (values['heavy-site-compat']) process.env.AGBROWSE_HEAVY_SITE_COMPAT = '1';
            if (values['keep-bg-networking']) process.env.AGBROWSE_KEEP_BG_NETWORKING = '1';
            await launchChrome(Number(values.port), {
                headless: values.headless,
                headed: values.headed,
                chromePath: values['chrome-path'],
            });
            const r = await getBrowserStatus(Number(values.port));
            console.log(r.running ? `🌐 Chrome started (CDP: ${r.cdpUrl})` : '❌ Failed');
            break;
        }
        case 'stop':
            await closeBrowser();
            console.log('🌐 Chrome stopped');
            break;
        case 'status': {
            const r = await getBrowserStatus();
            console.log(`running: ${r.running}\ntabs: ${r.tabs}\ncdpUrl: ${r.cdpUrl || 'n/a'}`);
            break;
        }
        case 'doctor': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    port: { type: 'string', default: String(DEFAULT_CDP_PORT) },
                    json: { type: 'boolean', default: false },
                },
                strict: false,
            });
            const r = await runStartDoctor({ port: Number(values.port) });
            if (values.json) {
                console.log(JSON.stringify(r, null, 2));
            } else {
                console.log(formatDoctorReport(r));
            }
            if (!r.ok) process.exit(2);
            break;
        }
        case 'snapshot': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    interactive: { type: 'boolean', default: false },
                    'max-nodes': { type: 'string' },
                }, strict: false,
            });
            const maxNodes = values['max-nodes'] ? parseInt(/** @type {string} */ (values['max-nodes'])) : undefined;
            const nodes = await snapshot(getPort(), { interactive: values.interactive, maxNodes, persist: true });
            for (const n of nodes) {
                const indent = '  '.repeat(n.depth);
                const val = (/** @type {any} */ (n)).value ? ` = "${(/** @type {any} */ (n)).value}"` : '';
                console.log(`${n.ref.padEnd(4)} ${indent}${n.role.padEnd(10)} "${n.name}"${val}`);
            }
            break;
        }
        case 'observe-bundle': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    json: { type: 'boolean', default: false },
                    screenshot: { type: 'boolean', default: false },
                    boxes: { type: 'boolean', default: false },
                    'max-text-chars': { type: 'string' },
                    'max-nodes': { type: 'string' },
                },
                strict: false,
            });
            const maxNodes = values['max-nodes'] ? parseInt(/** @type {string} */ (values['max-nodes'])) : undefined;
            const maxTextChars = values['max-text-chars'] ? parseInt(/** @type {string} */ (values['max-text-chars'])) : undefined;
            const page = await getReadyPage(getPort());
            const url = page.url();
            const targetId = `cdp:${getPort()}`;
            let title = '';
            try { title = await page.title(); } catch { /* best-effort */ }
            const viewport = page.viewportSize() || { width: 0, height: 0 };
            let dpr = 1;
            try { dpr = await page.evaluate(() => window.devicePixelRatio || 1); } catch { /* best-effort */ }
            const nodes = await snapshot(getPort(), { interactive: true, maxNodes, persist: true });
            let screenshotPath = null;
            if (values.screenshot) {
                try {
                    const r = await screenshotAction(getPort(), {});
                    screenshotPath = r.path;
                } catch (err) {
                    console.error(`observe-bundle: screenshot failed: ${(err && /** @type {any} */ (err).message) || err}`);
                }
            }
            /** @type {Record<string,{x:number,y:number,width:number,height:number}>} */
            const boxes = {};
            if (values.boxes) {
                try {
                    const cdp = await getCdpSession(getPort());
                    for (const n of nodes) {
                        if (!n.ref || !/^@?e\d+$/.test(n.ref)) continue;
                        try {
                            const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
                            const sel = `[aria-label="${(n.name || '').replace(/"/g, '\\"')}"]`;
                            if (!sel || sel === '[aria-label=""]') continue;
                            const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
                            if (!nodeId) continue;
                            const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
                            if (model && Array.isArray(model.content) && model.content.length >= 8) {
                                const c = model.content;
                                boxes[n.ref] = { x: Math.round(c[0]), y: Math.round(c[1]), width: Math.round(model.width), height: Math.round(model.height) };
                            }
                        } catch { /* best-effort per-node */ }
                        if (boxes[n.ref] || !n.role || !n.name) continue;
                        try {
                            const box = await page.getByRole(String(n.role), { name: String(n.name), exact: true }).first().boundingBox({ timeout: 500 });
                            if (box) {
                                boxes[n.ref] = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
                            }
                        } catch { /* best-effort per-node */ }
                    }
                    await cdp.detach().catch(() => { });
                } catch (err) {
                    console.error(`observe-bundle: box-model capture failed: ${(err && /** @type {any} */ (err).message) || err}`);
                }
            }
            let textSummary = '';
            try {
                textSummary = await page.evaluate(() => (document.body && document.body.innerText) || '');
            } catch { /* best-effort */ }
            const { buildObservationBundle, formatObservationBundle } = await import('../../web-ai/observation-bundle.mjs');
            const bundle = buildObservationBundle({
                url,
                title,
                targetId,
                viewport,
                dpr,
                snapshotNodes: nodes,
                boxes,
                screenshotPath,
                textSummary,
                maxTextChars,
            });
            if (values.json) console.log(JSON.stringify(bundle, null, 2));
            else console.log(formatObservationBundle(bundle));
            break;
        }
        case 'observe-actions': {
            const { values, positionals } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    json: { type: 'boolean', default: false },
                    'top-n': { type: 'string' },
                    'include-disabled': { type: 'boolean', default: false },
                },
                allowPositionals: true,
                strict: false,
            });
            const instruction = positionals.join(' ').trim();
            const topN = values['top-n'] ? parseInt(/** @type {string} */ (values['top-n'])) : 8;
            const nodes = await snapshot(getPort(), { interactive: true, persist: true });
            /** @type {Record<string, any>} */
            const refs = {};
            for (const n of nodes) {
                if (!n.ref || n.ref === '...') continue;
                refs[n.ref] = {
                    role: n.role,
                    name: n.name,
                    occurrenceIndex: (/** @type {any} */ (n)).occurrenceIndex ?? n.occurrence,
                    disabled: Boolean(/** @type {any} */ (n).disabled),
                    readonly: Boolean(/** @type {any} */ (n).readonly),
                    required: Boolean(/** @type {any} */ (n).required),
                };
            }
            const { buildObserveActions, formatObserveActions } = await import('../../web-ai/observe-actions.mjs');
            const result = buildObserveActions(
                { url: null, refs },
                instruction,
                { topN, includeDisabled: Boolean(values['include-disabled']) },
            );
            if (values.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(formatObserveActions(result));
            }
            break;
        }
        case 'screenshot': {
            const clip = parseClipArgs(process.argv.slice(3));
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: { 'full-page': { type: 'boolean' }, ref: { type: 'string' }, json: { type: 'boolean', default: false } }, strict: false,
            });
            const r = await screenshotAction(getPort(), { fullPage: values['full-page'], ref: values.ref, clip });
            if (values.json) console.log(JSON.stringify(r));
            else console.log(r.path);
            break;
        }
        case 'click': {
            const ref = process.argv[3];
            if (!ref) { console.error('Usage: browser.mjs click <ref>'); process.exit(1); }
            const opts = {};
            if (process.argv.includes('--double')) opts.doubleClick = true;
            if (process.argv.includes('--right')) opts.rightClick = true;
            await click(getPort(), ref, opts);
            console.log(`clicked ${ref}`);
            break;
        }
        case 'type': {
            const [ref, ...rest] = process.argv.slice(3);
            const text = rest.filter(a => !a.startsWith('--')).join(' ');
            const submit = rest.includes('--submit');
            await typeAction(getPort(), ref, text, { submit });
            console.log(`typed into ${ref}`);
            break;
        }
        case 'press':
            await press(getPort(), process.argv[3]);
            console.log(`pressed ${process.argv[3]}`);
            break;
        case 'hover': {
            const ref = process.argv[3];
            await hover(getPort(), ref);
            console.log(`hovered ${ref}`);
            break;
        }
        case 'mouse-click': {
            const mx = parseInt(process.argv[3]);
            const my = parseInt(process.argv[4]);
            if (isNaN(mx) || isNaN(my)) {
                console.error('Usage: browser.mjs mouse-click <x> <y> [--double]');
                process.exit(1);
            }
            const mOpts = {};
            if (process.argv.includes('--double')) mOpts.doubleClick = true;
            await mouseClick(getPort(), mx, my, mOpts);
            console.log(`🖱️ clicked at (${mx}, ${my})`);
            break;
        }
        case 'move-mouse': {
            const mx = parseInt(process.argv[3]);
            const my = parseInt(process.argv[4]);
            if (isNaN(mx) || isNaN(my)) {
                console.error('Usage: browser.mjs move-mouse <x> <y>');
                process.exit(1);
            }
            await moveMouse(getPort(), mx, my);
            console.log(`mouse moved to (${mx}, ${my})`);
            break;
        }
        case 'mouse-down': {
            const button = process.argv.includes('--right') ? 'right' : 'left';
            const r = await mouseDown(getPort(), { button });
            console.log(`mouse down (${r.button})`);
            break;
        }
        case 'mouse-up': {
            const button = process.argv.includes('--right') ? 'right' : 'left';
            const r = await mouseUp(getPort(), { button });
            console.log(`mouse up (${r.button})`);
            break;
        }
        case 'navigate': {
            const url = process.argv[3];
            if (!url) { console.error('Usage: browser.mjs navigate <url> [--wait-until commit|load|domcontentloaded|networkidle] [--timeout ms]'); process.exit(1); }
            const wuIdx = process.argv.indexOf('--wait-until');
            const tIdx = process.argv.indexOf('--timeout');
            const opts = {};
            if (wuIdx > 0 && process.argv[wuIdx + 1]) opts.waitUntil = process.argv[wuIdx + 1];
            if (tIdx > 0 && process.argv[tIdx + 1]) opts.timeout = parseInt(process.argv[tIdx + 1], 10);
            const r = await navigate(getPort(), url, opts);
            console.log(`navigated → ${r.url}${r.degraded ? ` [${r.degraded}]` : ''}`);
            break;
        }
        case 'reload': {
            const r = await reload(getPort());
            console.log(`reloaded → ${r.url}`);
            break;
        }
        case 'resize': {
            const width = parseInt(process.argv[3]);
            const height = parseInt(process.argv[4]);
            if (process.argv.includes('--fullscreen')) {
                const r = await resize(getPort(), 0, 0, { fullscreen: true });
                if (r.warning) console.warn(`[browser] resize fallback: ${r.warning}`);
                console.log(`resized to ${r.mode} (${r.strategy})`);
                break;
            }
            if (isNaN(width) || isNaN(height)) {
                console.error('Usage: browser.mjs resize <width> <height> [--fullscreen]');
                process.exit(1);
            }
            const r = await resize(getPort(), width, height);
            if (r.warning) console.warn(`[browser] resize fallback: ${r.warning}`);
            console.log(`resized to ${r.width}x${r.height} (${r.strategy})`);
            break;
        }
        case 'tabs': {
            const json = process.argv.includes('--json');
            const inspect = process.argv.includes('--inspect');
            const activeCommands = await listActiveCommands({
                browserProfileKey: String(getPort()),
                active: true,
            }).catch(() => []);
            const activeByTargetId = new Map(activeCommands.map(command => [command.targetId, command]));

            if (inspect) {
                const { collectTabs } = await import('../../web-ai/tab-inspect.mjs');
                const activeTargetIds = new Set(/** @type {string[]} */ (
                    activeCommands.map(c => c.targetId).filter((id) => typeof id === 'string' && id.length > 0)
                ));
                const inspected = await collectTabs(getPort(), { activeTargetIds });
                if (json) {
                    console.log(JSON.stringify(inspected.map((t, i) => ({ index: i + 1, ...t })), null, 2));
                } else {
                    inspected.forEach((t, i) => {
                        const flags = [t.state, t.inUse ? 'in-use' : '', t.modelLabel || ''].filter(Boolean).join(', ');
                        console.log(`${i + 1}. ${t.title || '(untitled)'} [${flags}]`);
                        console.log(`   ${t.url}`);
                        if (t.lastAssistantSnippet) console.log(`   snippet: ${t.lastAssistantSnippet.slice(0, 120)}...`);
                    });
                    console.log(`\ntotal ChatGPT tabs: ${inspected.length}`);
                }
                break;
            }

            const managedTabs = await listManagedTabs(getPort()).catch(error => {
                if (json) return [];
                throw error;
            });
            const tabs = managedTabs.map(tab => {
                const displayed = tabDisplayState(tab);
                const activeCommand = activeCommandSummary(activeByTargetId.get(displayed.targetId));
                return activeCommand ? { ...displayed, activeCommand } : displayed;
            });
            const MAX = Number(process.env.AGBROWSE_MAX_TABS || DEFAULT_MAX_TABS);
            const trackedCount = tabs.filter(t => t.idleForMs !== null).length;
            const untrackedCount = tabs.length - trackedCount;
            if (json) {
                console.log(JSON.stringify(tabs.map((t, i) => ({ index: i + 1, ...t })), null, 2));
            } else {
                tabs.forEach((t, i) => {
                    const state = `${t.pinned ? 'pinned, ' : ''}${t.activeCommand ? 'active-command, ' : ''}idle ${t.idleFor}`;
                    console.log(`${i + 1}. ${t.title || '(untitled)'} [${state}]`);
                    console.log(`   ${t.url}`);
                    console.log(`   targetId: ${t.targetId}`);
                });
                console.log(`\ntotal: ${tabs.length}/${MAX}  tracked: ${trackedCount}  untracked: ${untrackedCount}`);
                if (tabs.length >= Math.max(1, MAX - 2)) {
                    const advisor = pickCleanupCandidates(tabs, MAX);
                    if (advisor.length) {
                        console.log(`⚠ approaching MAX_TABS — suggested close (oldest-idle first):`);
                        advisor.forEach(a => {
                            console.log(`   • ${a.targetId}  ${(a.title || '(untitled)').slice(0, 60)}  idle=${a.idleFor || 'untracked'}`);
                        });
                        console.log(`Run: agbrowse tab-cleanup --dry-run   (or --force to actually close)`);
                    }
                } else {
                    console.log(`Tip: run "agbrowse tab-cleanup" to close idle/overflow tabs.`);
                }
            }
            break;
        }
        case 'tab-switch': {
            const json = process.argv.includes('--json');
            const force = process.argv.includes('--force');
            const target = process.argv[3];
            if (!target) { console.error('Usage: browser.mjs tab-switch <index-or-targetId> [--json] [--force]'); process.exit(1); }
            const ts = await tabSwitch(getPort(), target, { force });
            if (json) console.log(JSON.stringify(ts, null, 2));
            else console.log(`switched to ${ts.tab ? `tab ${ts.tab}` : ts.targetId}: ${ts.title}`);
            break;
        }
        case 'select-tab': {
            const json = process.argv.includes('--json');
            const force = process.argv.includes('--force');
            const target = process.argv[3];
            if (!target) { console.error('Usage: browser.mjs select-tab <index-or-targetId> [--json] [--force]'); process.exit(1); }
            const ts = await tabSwitch(getPort(), target, { force });
            if (json) console.log(JSON.stringify({ ...ts, alias: 'select-tab' }, null, 2));
            else console.log(`switched to ${ts.tab ? `tab ${ts.tab}` : ts.targetId}: ${ts.title}`);
            break;
        }
        case 'active-tab': {
            const json = process.argv.includes('--json');
            const info = await getActiveTabInfo(getPort());
            if (json) {
                console.log(JSON.stringify(info, null, 2));
            } else if (info.targetId) {
                console.log(`active tab: ${info.targetId} ${info.title || ''}`);
                if (info.url) console.log(`   ${info.url}`);
            } else {
                console.log('active tab: none');
            }
            break;
        }
        case 'new-tab': {
            const { values, positionals } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    json: { type: 'boolean', default: false },
                    'no-activate': { type: 'boolean', default: false },
                },
                allowPositionals: true,
                strict: false,
            });
            const json = values.json;
            const noActivate = values['no-activate'];
            const url = positionals[0] || 'about:blank';
            const tab = await createTab(getPort(), url, { activate: !noActivate });
            if (tab.activated) {
                updatePersistedState({ port: getPort(), activeTargetId: tab.targetId });
                clearPersistedSnapshot();
            }
            if (json) console.log(JSON.stringify({ ok: true, status: 'created', ...tab }, null, 2));
            else console.log(`created tab: ${tab.targetId} (${tab.url})${tab.activated ? '' : ' [not activated]'}`);
            break;
        }
        case 'tab-close': {
            const { values, positionals } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    json: { type: 'boolean', default: false },
                },
                allowPositionals: true,
                strict: false,
            });
            const json = values.json;
            const target = positionals[0];
            if (!target) { console.error('Usage: browser.mjs tab-close <targetId> [--json]'); process.exit(1); }
            const result = await closeTab(getPort(), target);
            const state = readPersistedState();
            if (state?.activeTargetId === target) {
                updatePersistedState({ activeTargetId: null });
                clearPersistedSnapshot();
            }
            if (json) console.log(JSON.stringify({ ok: true, status: 'closed', ...result }, null, 2));
            else console.log(`closed tab: ${result.targetId}`);
            break;
        }
        case 'tab-cleanup': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    json: { type: 'boolean', default: false },
                    'idle-after': { type: 'string' },
                    'max-tabs': { type: 'string' },
                    'include-untracked': { type: 'boolean', default: false },
                    provider: { type: 'string' },
                    'keep-provider-tabs': { type: 'string' },
                    force: { type: 'boolean', default: false },
                    'dry-run': { type: 'boolean', default: false },
                },
                strict: false,
            });
            if (values['include-untracked'] === true && values.force !== true) {
                console.error('error: tab-cleanup --include-untracked requires --force');
                process.exit(1);
            }
            const cleanupOpts = {
                idleTimeoutMs: values['idle-after'] ? parseDuration(values['idle-after']) : undefined,
                maxTabs: values['max-tabs'] ? parseInt(/** @type {string} */ (values['max-tabs']), 10) : undefined,
                includeUntracked: values['include-untracked'] === true,
                provider: /** @type {any} */ (values.provider),
                keepProviderTabs: values['keep-provider-tabs'] ? parseInt(/** @type {string} */ (values['keep-provider-tabs']), 10) : undefined,
            };
            if (values['dry-run']) {
                const plan = await planCleanupIdleTabs(getPort(), cleanupOpts);
                if (values.json) {
                    console.log(JSON.stringify({ ok: true, dryRun: true, ...plan }, null, 2));
                } else {
                    console.log(`tab-cleanup --dry-run`);
                    console.log(`tabs: ${plan.tabsTotal}/${plan.maxTabs}  wouldClose: ${plan.wouldClose.length}`);
                    if (plan.wouldClose.length === 0) {
                        console.log(`  (nothing to close)`);
                    } else {
                        plan.wouldClose.forEach(t => {
                            const idle = t.idleForMs === null ? 'untracked' : `${Math.round(t.idleForMs / 1000)}s`;
                            console.log(`  • ${t.targetId}  ${(t.title || '(untitled)').slice(0, 60)}  reason=${t.reason}  idle=${idle}`);
                        });
                    }
                    console.log(`\nNo tabs were closed. Re-run without --dry-run to actually close.`);
                }
                break;
            }
            const leaseResult = await cleanupPoolTabs(getPort());
            const result = await cleanupIdleTabs(getPort(), cleanupOpts);
            const combined = {
                ...result,
                closed: result.closed + (leaseResult.closed || 0),
                leaseClosed: leaseResult.closed || 0,
                leaseClosedTabs: leaseResult.closedTabs || [],
            };
            if (values.json) console.log(JSON.stringify(combined, null, 2));
            else {
                console.log(`closed tabs: ${combined.closed}`);
                console.log(`  lease pool: ${combined.leaseClosed}`);
                console.log(`  idle timeout: ${result.idleClosed}`);
                console.log(`  max-tabs: ${result.limitClosed}`);
                console.log(`  untracked: ${result.untrackedClosed}`);
                console.log(`  provider: ${result.providerClosed}`);
            }
            break;
        }
        case 'text': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: { format: { type: 'string', default: 'text' } }, strict: false,
            });
            const r = await getPageText(getPort(), values.format);
            console.log(r.text);
            break;
        }
        case 'get-dom': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    selector: { type: 'string' },
                    'max-chars': { type: 'string' },
                }, strict: false,
            });
            const maxChars = values['max-chars'] ? parseInt(/** @type {string} */ (values['max-chars'])) : undefined;
            const r = await getDom(getPort(), { selector: values.selector, maxChars });
            if (r.truncated) {
                console.error(`[truncated: ${r.shownChars}/${r.totalChars} chars]`);
            }
            console.log(r.html);
            break;
        }
        case 'console': {
            const consoleUnsafeIndex = process.argv.indexOf('--unsafe-allow');
            const consoleUnsafeAllow = consoleUnsafeIndex === -1 ? [] : [process.argv[consoleUnsafeIndex + 1]].filter(Boolean);
            const { values } = parseArgs({
                args: process.argv.slice(3).filter((arg, index, args) => arg !== '--unsafe-allow' && args[index - 1] !== '--unsafe-allow'),
                options: {
                    duration: { type: 'string' },
                    expression: { type: 'string' },
                    limit: { type: 'string' },
                    clear: { type: 'boolean', default: false },
                    reload: { type: 'boolean', default: false },
                }, strict: false,
            });
            const duration = values.duration ? parseInt(/** @type {string} */ (values.duration), 10) : 0;
            const limit = values.limit ? parseInt(/** @type {string} */ (values.limit), 10) : 50;
            const r = await captureConsole(getPort(), {
                duration,
                expression: values.expression,
                limit,
                clear: values.clear,
                reload: values.reload,
                unsafeAllow: consoleUnsafeAllow,
            });
            for (const log of r.logs) {
                console.log(`[${log.type}] ${log.text}`);
            }
            if (r.count === 0) console.log('(no console output captured)');
            break;
        }
        case 'network': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    duration: { type: 'string' },
                    filter: { type: 'string' },
                    'live-only': { type: 'boolean', default: false },
                    clear: { type: 'boolean', default: false },
                    reload: { type: 'boolean', default: false },
                }, strict: false,
            });
            const duration = values.duration ? parseInt(/** @type {string} */ (values.duration), 10) : 0;
            const r = await captureNetwork(getPort(), {
                duration,
                filter: values.filter,
                includeExisting: !values['live-only'],
                clear: values.clear,
                reload: values.reload,
            });
            for (const req of r.requests) {
                console.log(`${req.method.padEnd(6)} ${(req.type || '').padEnd(10)} ${req.url} ${req.source ? `[${req.source}]` : ''}`.trimEnd());
            }
            console.log(`\n${r.count} requests captured (${r.existingCount} existing, ${r.liveCount} live)`);
            break;
        }
        case 'evaluate': {
            const unsafeIndex = process.argv.indexOf('--unsafe-allow');
            const unsafeAllow = unsafeIndex === -1 ? [] : [process.argv[unsafeIndex + 1]].filter(Boolean);
            const expression = process.argv.slice(3)
                .filter((arg, index, args) => arg !== '--unsafe-allow' && args[index - 1] !== '--unsafe-allow')
                .join(' ');
            const r = await evaluate(getPort(), expression, { unsafeAllow });
            console.log(JSON.stringify(r.result, null, 2));
            break;
        }
        case 'scroll': {
            const json = process.argv.includes('--json');
            const dir = process.argv[3];
            const scrollRef = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : null;
            const scrollAmount = process.argv.includes('--amount') ? parseInt(process.argv[process.argv.indexOf('--amount') + 1]) : undefined;
            if (!dir || !['up', 'down', 'left', 'right'].includes(dir)) {
                console.error('Usage: browser.mjs scroll <up|down|left|right> [--amount N] [--ref eN] [--json]');
                process.exit(1);
            }
            if (scrollRef) {
                const sr = await scroll(getPort(), dir, { amount: scrollAmount, ref: scrollRef });
                if (json) console.log(JSON.stringify(sr, null, 2));
                else console.log(`scrolled ${sr.direction} ${sr.pixels}px on ${sr.ref}`);
            } else {
                const sr = await scroll(getPort(), dir, { amount: scrollAmount });
                if (json) console.log(JSON.stringify(sr, null, 2));
                else console.log(`scrolled ${sr.direction} ${sr.pixels}px`);
            }
            break;
        }
        case 'wait-for': {
            const json = process.argv.includes('--json');
            const wRef = process.argv[3];
            if (!wRef) { console.error('Usage: browser.mjs wait-for <ref> [--timeout ms] [--json]'); process.exit(1); }
            const wTimeout = process.argv.includes('--timeout') ? parseInt(process.argv[process.argv.indexOf('--timeout') + 1]) : undefined;
            const wr = await waitFor(getPort(), wRef, { timeout: wTimeout });
            console.warn('[browser] wait-for <ref> is deprecated. Prefer wait-for-selector or wait-for-text.');
            if (json) console.log(JSON.stringify(wr, null, 2));
            else console.log(`found ${wr.ref}`);
            break;
        }
        case 'wait-for-selector': {
            const json = process.argv.includes('--json');
            const selector = process.argv[3];
            if (!selector) { console.error('Usage: browser.mjs wait-for-selector <selector> [--timeout ms] [--json]'); process.exit(1); }
            const timeout = process.argv.includes('--timeout') ? parseInt(process.argv[process.argv.indexOf('--timeout') + 1]) : undefined;
            const wr = await waitForSelector(getPort(), selector, { timeout });
            if (json) console.log(JSON.stringify(wr, null, 2));
            else console.log(`found selector ${wr.selector}`);
            break;
        }
        case 'wait-for-text': {
            const json = process.argv.includes('--json');
            const timeoutIndex = process.argv.indexOf('--timeout');
            const textArgs = [];
            for (let i = 3; i < process.argv.length; i++) {
                if (i === timeoutIndex) {
                    i += 1;
                    continue;
                }
                if (process.argv[i].startsWith('--')) continue;
                textArgs.push(process.argv[i]);
            }
            const text = textArgs.join(' ');
            if (!text) { console.error('Usage: browser.mjs wait-for-text <text> [--timeout ms] [--json]'); process.exit(1); }
            const timeout = timeoutIndex !== -1 ? parseInt(process.argv[timeoutIndex + 1]) : undefined;
            const wr = await waitForText(getPort(), text, { timeout });
            if (json) console.log(JSON.stringify(wr, null, 2));
            else console.log(`found text ${wr.text}`);
            break;
        }
        case 'wait': {
            const json = process.argv.includes('--json');
            const wMs = parseInt(process.argv[3]);
            if (isNaN(wMs)) { console.error('Usage: browser.mjs wait <milliseconds> [--json]'); process.exit(1); }
            await waitMs(wMs);
            const result = { ok: true, waitedMs: wMs };
            if (json) console.log(JSON.stringify(result, null, 2));
            else console.log(`waited ${wMs}ms`);
            break;
        }
        case 'select': {
            const json = process.argv.includes('--json');
            const sRef = process.argv[3];
            const sVal = process.argv[4];
            if (!sRef || !sVal) { console.error('Usage: browser.mjs select <ref> <value> [--json]'); process.exit(1); }
            const result = await selectOption(getPort(), sRef, sVal);
            if (json) console.log(JSON.stringify(result, null, 2));
            else console.log(`selected "${sVal}" in ${sRef}`);
            break;
        }
        case 'check': {
            const json = process.argv.includes('--json');
            const ref = process.argv[3];
            if (!ref) { console.error('Usage: browser.mjs check <ref> [--json]'); process.exit(1); }
            const result = await setChecked(getPort(), ref, true);
            if (json) console.log(JSON.stringify(result, null, 2));
            else console.log(`checked ${ref}`);
            break;
        }
        case 'uncheck': {
            const json = process.argv.includes('--json');
            const ref = process.argv[3];
            if (!ref) { console.error('Usage: browser.mjs uncheck <ref> [--json]'); process.exit(1); }
            const result = await setChecked(getPort(), ref, false);
            if (json) console.log(JSON.stringify(result, null, 2));
            else console.log(`unchecked ${ref}`);
            break;
        }
        case 'drag': {
            const dFrom = process.argv[3];
            const dTo = process.argv[4];
            if (!dFrom || !dTo) { console.error('Usage: browser.mjs drag <fromRef> <toRef>'); process.exit(1); }
            await drag(getPort(), dFrom, dTo);
            console.log(`dragged ${dFrom} → ${dTo}`);
            break;
        }
        case 'upload': {
            const json = process.argv.includes('--json');
            const uRef = process.argv[3];
            const uFiles = process.argv.slice(4).filter(arg => !arg.startsWith('--'));
            if (!uRef || uFiles.length === 0) { console.error('Usage: browser.mjs upload <ref> <file>... [--json]'); process.exit(1); }
            const result = await uploadFiles(getPort(), uRef, uFiles);
            if (json) console.log(JSON.stringify(result, null, 2));
            else console.log(`uploaded ${uFiles.length} file(s) to ${uRef}`);
            break;
        }
        case 'action-memory': {
            // EXPERIMENTAL: persistent action cache. Off by default at the
            // resolver level; this CLI surface only inspects/clears the store.
            const sub = process.argv[3];
            const json = process.argv.includes('--json');
            const memPath = join(DATA_DIR, 'action-memory.json');
            const { createActionMemory } = await import('../../web-ai/action-memory.mjs');
            /** @type {any} */
            let initial;
            try {
                if (existsSync(memPath)) initial = JSON.parse(readFileSync(memPath, 'utf8'));
            } catch { initial = undefined; }
            const mem = createActionMemory(initial ? { initial } : undefined);
            if (!sub || sub === 'list') {
                const origin = process.argv.includes('--origin')
                    ? process.argv[process.argv.indexOf('--origin') + 1]
                    : undefined;
                const entries = mem.list(origin);
                if (json) console.log(JSON.stringify({ count: entries.length, entries }, null, 2));
                else {
                    console.log(`action-memory: ${entries.length} entry(ies)${origin ? ` for origin=${origin}` : ''}`);
                    for (const e of entries) {
                        console.log(`  ${e.origin} :: ${e.intentId} :: sig=${e.signature.slice(0, 8)} ref=${e.ref} hits=${e.hits} ok/fail=${e.validations.ok}/${e.validations.fail}`);
                    }
                    if (entries.length === 0) console.log('  (empty — experimental cache; not yet wired into resolver)');
                }
            } else if (sub === 'clear') {
                mem.clear();
                try { writeFileSync(memPath, JSON.stringify(mem.snapshot(), null, 2)); } catch {}
                if (json) console.log(JSON.stringify({ ok: true, cleared: true }));
                else console.log('action-memory: cleared');
            } else {
                console.error('Usage: browser.mjs action-memory [list|clear] [--origin <url>] [--json]');
                process.exit(1);
            }
            break;
        }
        case 'reset': {
            const force = process.argv.includes('--force');
            if (!force) {
                const { createInterface } = await import('node:readline');
                const rl = createInterface({ input: process.stdin, output: process.stdout });
                const answer = await new Promise(r => {
                    rl.question(`\n  ${c.yellow}⚠️  Reset browser data.${c.reset}\n  Profile, screenshots, and CDP cache will be deleted.\n  Continue? (y/N): `, r);
                });
                rl.close();
                if (answer.toLowerCase() !== 'y') {
                    console.log('  Cancelled.\n');
                    break;
                }
            }

            console.log(`\n  ${c.bold}🔄 Resetting browser data...${c.reset}\n`);

            // Stop browser
            try {
                await closeBrowser();
                console.log(`  ${c.dim}✓ browser stopped${c.reset}`);
            } catch {
                console.log(`  ${c.dim}✓ browser not running${c.reset}`);
            }

            // Clear profile
            if (existsSync(PROFILE_DIR)) {
                rmSync(PROFILE_DIR, { recursive: true, force: true });
                console.log(`  ${c.dim}✓ cleared ${PROFILE_DIR}${c.reset}`);
            }

            // Clear screenshots
            if (existsSync(SCREENSHOTS_DIR)) {
                rmSync(SCREENSHOTS_DIR, { recursive: true, force: true });
                console.log(`  ${c.dim}✓ cleared ${SCREENSHOTS_DIR}${c.reset}`);
            }

            clearPersistedSnapshot();

            console.log(`\n  ${c.green}✅ Browser reset complete!${c.reset}\n`);
            break;
        }
        default:
            console.log(`
  🌐 agbrowse — agent-first browser automation and web-ai CLI

  Positioning:
    Local Chrome / CDP only. No hosted/cloud browser, no remote CDP server,
    no stealth, no CAPTCHA/Cloudflare bypass, no benchmark leaderboard claim.
    See docs/comparison.md and run "agbrowse web-ai claim-audit" to verify.

  Usage:
    agbrowse <command> [args] [--flags]    (try: agbrowse start --headed)

  Quick start:
    agbrowse start --headed                  Launch a visible Chrome
    agbrowse navigate https://example.com    Open a URL
    agbrowse fetch https://example.com --json Read one URL for agent evidence
    agbrowse research plan --query "한국어 검색 질문" --json  Plan focused queries
    agbrowse snapshot --interactive          Get refs (e1, e2, …)
    agbrowse click e1                        Click ref e1
    agbrowse runway status                   Inspect Runway tab (plan, model, mode)
    agbrowse runway generate --prompt "..." --allow-submit  Full generation pipeline
    agbrowse stop                            Close Chrome

  Stuck? Run:
    agbrowse doctor                          Diagnose start/CDP/profile issues
    agbrowse tabs                            See open tabs + cleanup advice
    agbrowse tab-cleanup --dry-run           Preview cleanup without closing

  Common failures:
    "❌ Failed" / "Chrome CDP not responding"
        → run: agbrowse doctor
    "Port 9222 in use but not responding as CDP"
        → another process holds the port. Use --port 9223 or stop it.
    "CDP port X is already backed by a headless agbrowse Chrome"
        → agbrowse stop && agbrowse start --headed
    "tab-cleanup --include-untracked requires --force"
        → safety; add --force only after reviewing --dry-run output.

  Heavy / anti-bot sites (nytimes, amazon class):
    AGBROWSE_HEAVY_SITE_COMPAT=1 agbrowse start --headed
    agbrowse navigate <url> --wait-until commit --timeout 60000

  Start here:
    npm install -g agbrowse
    agbrowse skills get core --full
    agbrowse skills get web-ai
    agbrowse skills install --target ~/.cli-jaw-3460/skills
    agbrowse start
    agbrowse navigate "https://example.com"
    agbrowse snapshot --interactive --max-nodes 120

  Agent decision loop:
    1. Observe before acting: status → tabs/open/navigate → snapshot --interactive.
    2. Prefer snapshot refs for actions: click e3, type e5 "text" --submit.
    3. Re-run snapshot after navigation, reload, submit, or any major UI change.
    4. Use screenshot/mouse-click only when no DOM ref exists and coordinates are visible.
    5. Use --json on automation commands when another tool will parse the result.
    6. Stop on errors, inspect state, then choose the narrow next command.

  Skill installation:
    skills list [--json]
      List bundled agent skills and their package paths.

    skills get core [--full]
      Print the recommended agent operating guide. --full includes all bundled SKILL.md files.

    skills get <browser|web-ai|vision-click>
      Print one bundled SKILL.md so an agent can load exact workflow rules.

    skills path [skill]
      Print the package skills directory or one bundled skill directory.

    skills install --target <dir> [--link] [--force] [--json]
      Install bundled SKILL.md directories into an explicit agent skill root.

    install-skills --target <dir> [--link] [--force] [--json]
      Legacy alias for "skills install".

      Examples:
        agbrowse skills list
        agbrowse skills get core --full
        agbrowse skills path web-ai
        agbrowse skills install --target ~/.cli-jaw-3460/skills
        agbrowse skills install --target ~/.codex/skills --link
        agbrowse install-skills --target ./tmp-skills --force --json

      Installs:
        browser       Chrome/CDP browser control skill
        web-ai        ChatGPT, Gemini, and Grok browser web-ai workflow skill
        vision-click  Screenshot-to-coordinate click helper skill

  Research planning:
    research plan --query <problem> [--max-queries N] [--json]
      Rewrite a Korean external/source-sensitive problem into constraints,
      focused URL-candidate queries, route URLs, and fetch/browse policy.

    research normalize-results --file <json> [--backend name] [--query query] [--json]
      Normalize Exa/Tavily/Perplexity/Brave/browser-SERP rows into one
      search-results-v1 URL-candidate envelope. Snippets are not final evidence.

    research enrich-fetch --plan <json> --results <json> [--browser never|auto|required] [--max-results N] [--json]
      Fetch original pages for normalized URL candidates, attach adaptive-fetch
      results, and update the constraint ledger from fetched text only.

    research browse-plan --plan <json> --enrichment <json> [--max-actions N] [--json]
      Plan explicit browser commands for candidates fetch could not fully verify.
      Does not run Chrome, search, or mutate browser state.

  Browser lifecycle:
    start [--port <9222>] [--headless|--headed] [--chrome-path PATH]
                           [--heavy-site-compat] [--keep-bg-networking]
                           Start Chrome (--headed overrides CHROME_HEADLESS=1)
                           --heavy-site-compat: relax COEP/COOP for sites that
                             gate on permissive cross-origin isolation
                             (helps nytimes/amazon-class). No stealth flags.
                           --keep-bg-networking: omit --disable-background-networking
    stop                   Stop Chrome
    status                 Connection status
    doctor                 Diagnose start/CDP/profile issues (run when start fails)
    reset [--force]        Reset (clear profile + screenshots)

  Observe:
    snapshot               Page snapshot with ref IDs
      --interactive        Interactive elements only
      --max-nodes <N>      Limit output nodes (token budget)
    screenshot             Capture screenshot
      --full-page          Full page
      --ref <ref>          Specific element only
      --clip x y w h       Capture a clipped region in CSS pixels
      --json               Output JSON (path, dpr, viewport)
    text                   Page text [--format text|html]
    get-dom                Get current DOM [--selector CSS] [--max-chars N]

      Agent rule:
        Use snapshot first for actions. Use get-dom only for selector debugging or content not exposed in refs.

  Interact:
    click <ref>            Click element [--double] [--right]
    type <ref> <text>      Type text [--submit]
    press <key>            Press key (Enter, Tab, Escape…)
    hover <ref>            Hover element
     select <ref> <value>   Select dropdown option [--json]
     check <ref>            Check checkbox/radio [--json]
     uncheck <ref>          Uncheck checkbox [--json]
     drag <from> <to>       Drag element to another
    mouse-click <x> <y>    Click at pixel coordinates [--double]
    move-mouse <x> <y>     Move mouse without clicking
    mouse-down             Hold mouse button [--right]
    mouse-up               Release mouse button [--right]

  Navigation:
    navigate <url>         Go to URL [--wait-until <commit|domcontentloaded|load>] [--timeout ms]
                              ex: agbrowse navigate https://github.com --wait-until commit
    fetch <url>            Read one URL via 6-phase adaptive ladder [--json] [--trace]
                              [--browser auto|never|required]
                              [--browser-session none|isolated|existing|user|interactive]
                              [--identity auto|minimal|chrome]
                              [--no-browser] [--max-bytes N] [--timeout-ms N]
                              [--selector CSS] [--allow-third-party-reader]
                              [--no-public-endpoints] [--allow-archive]
                              Not generic search; use after a candidate URL exists.
    reload                 Reload current page
    resize <w> <h>         Resize browser window / viewport [--fullscreen]
     tabs                   List tabs [--json]
     active-tab             Show active tab target-id contract [--json]
     new-tab <url>          Create a browser tab [--no-activate] [--json]
     tab-switch <target>    Switch to tab index or CDP target id [--json] [--force]
     select-tab <target>    Alias for tab-switch [--json] [--force]
     tab-close <targetId>   Close a browser tab [--json]
     tab-cleanup            Close idle/overflow tabs
       --dry-run            Preview cleanup plan without closing any tabs
       --idle-after <30m>   Override idle threshold for this cleanup
       --max-tabs <N>       Override max tab limit for this cleanup
       --provider <vendor>  Close extra inactive provider tabs by origin
       --keep-provider-tabs <N>
                            Keep newest N inactive provider tabs (default 1)
       --include-untracked  Also close tabs without activity metadata
       --force              Required with --include-untracked
      --json               Output cleanup counts, providerClosed, leaseClosed, and leaseClosedTabs as JSON
     scroll <dir>           Scroll up|down|left|right [--amount N] [--ref eN] [--json]

   Wait:
     wait <ms>              Wait milliseconds [--json]
     wait-for-selector <s>  Wait for CSS selector [--timeout ms] [--json]
     wait-for-text <text>   Wait for visible text [--timeout ms] [--json]
     wait-for <ref>         Deprecated: wait for last-snapshot ref [--timeout ms] [--json]

  Diagnostics:
    console                Read buffered console logs [--clear] [--reload]
                           [--duration ms] [--limit N]
                           [--expression "console.log('hi')"]
    network                Inspect requests [--duration ms] [--filter text]
                           [--clear] [--reload] [--live-only]
     evaluate <js>          Execute JavaScript

	  Web AI:
      Before agent-run Web AI automation:
        agbrowse skills get web-ai
        agbrowse skills install --target <agent-skill-root>
      Load/install the bundled web-ai skill; help shows flags, the skill gives
      workflow policy. Skills are never installed implicitly.
	    web-ai render          Render the provider prompt without a browser
	    web-ai status          Check active provider tab state
	    web-ai send            Send a prompt; returns a sessionId for later resume
	    web-ai poll            Poll a session (or latest baseline) for completion
	    web-ai query           send + poll in one call
	    web-ai code            ChatGPT-only code generation + verified zip retrieval
	    web-ai code-extract    Re-retrieve ChatGPT code zip artifacts without prompting
	    web-ai stop            Send Escape to the active provider tab
	    web-ai watch           Watch a persisted session until terminal status
	    web-ai snapshot        Compact accessibility snapshot for provider tab
	    web-ai sessions        list/show/resume/reattach/doctor/prune sessions
	    web-ai doctor          Provider diagnostics and target candidates
	    web-ai project-sources ChatGPT Project Sources list/add
	    web-ai context-dry-run Build a context package without sending
	    web-ai context-render  Render full prompt/context package text
	    web-ai claim-audit     Scan repo docs for forbidden hosted/cloud claims

      Common flags:
        --vendor <chatgpt|gemini|grok>
        --model <alias>                ChatGPT: pro/thinking/instant
                                       Gemini:  flash-lite/flash/pro + tool deepthink
                                       Grok:    heavy/expert/thinking/fast/auto
        --effort <alias>               ChatGPT only; requires --model
                                       Pro: standard/extended
                                       Thinking: light/standard/extended/heavy
        --reasoning-effort <alias>     Alias for --effort
        --url <conversation-or-provider-url>
        --inline-only | --file <path> | --context-from-files <glob>
        --context-transport <upload|inline>
        --allow-copy-markdown-fallback Capture provider Copy button output
        --allow-grok-context-pack      Override Grok hard-gate (prefer inline)
        --timeout <sec>                Default 1200 ChatGPT/Gemini · 600 Grok
        --session <id>                 Resume a previous session; surviving
                                       shell exit + OS sleep
        --deadline <iso>               Override session deadline
        --navigate                     Allow resume to switch tabs if needed
         --new-tab                      Force a fresh provider tab for send/query
                                        (default reuses pooled/inactive provider tabs first)
         --parallel                     Alias for --new-tab. Use to run a query
                                        without contending with another in-flight one.
        --reuse-tab                    Reuse active tab (legacy behavior)
        --json                         JSON output (or AGBROWSE_JSON_ERRORS=1)

      Tab lease policy:
        Completed provider tabs are runtime leases. Defaults: maxPerKey=3,
        globalMax=8, TTL=30m. Override via AGBROWSE_PROVIDER_POOL_MAX_PER_KEY,
        AGBROWSE_PROVIDER_POOL_GLOBAL_MAX, AGBROWSE_PROVIDER_POOL_TTL.
        Active session caps default to per-key=5 and global=14. Override via
        AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY and AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX.
        Use --new-tab / --parallel to bypass pool reuse for a single call.
        Run tab-cleanup --json to inspect leaseClosedTabs.

      Failure envelope when --json or AGBROWSE_JSON_ERRORS=1:
        { ok:false, status:"error", error:{ name, errorCode, stage, message,
          retryHint, vendor?, mutationAllowed, selectorsTried, evidence } }

      Sessions persist at $BROWSER_AGENT_HOME/web-ai-sessions.json
      (default ~/.browser-agent). Use --session to resume long Pro / Deep
      Think runs from a fresh shell.
      Provider commands auto-start headed Chrome when CDP is not running.
      Set AGBROWSE_WEB_AI_AUTO_START=0 to fail closed instead.

      Examples:
        agbrowse web-ai render --vendor chatgpt --prompt "hello" --json
        agbrowse web-ai query  --vendor grok    --inline-only --prompt "Reply OK"
        agbrowse web-ai query  --vendor gemini  --model deepthink --inline-only --prompt "Reply OK"
        agbrowse web-ai query  --vendor chatgpt --context-from-files "src/**/*.ts" \\
                                                --context-transport upload --prompt "Review this"
        SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \\
                --prompt "long Pro prompt" --json | jq -r .sessionId)
        agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800

  Runway (run "agbrowse runway help" for full usage):
    Level 0 — read-only (default; never submits a generation):
      runway selectors       Print selector contract [--surface apps|custom-tools|recents|all] [--json]
      runway status          Inspect current tab: plan, model, mode, quota [--json]
      runway open            Navigate to a surface and inspect [--surface apps|custom-tools|recents]
      runway preflight       Alias for open + status; never submits a generation
      runway poll            Poll queue/completion signals [--timeout 600000] [--interval 5000] [--json]
      runway recents         Parse asset cards from Recents [--limit 20] [--type image|video|all]
    Level 1 — mutation (requires --allow-mutation):
      runway setup           Set prompt/model/params without clicking Generate [--prompt TEXT]
      runway upload          Upload file via browser file input [--file PATH]
    Level 2 — submit (requires --allow-submit):
      runway generate        Full pipeline: setup → Generate → poll → download [--prompt TEXT]
      runway multishot        Multi-scene video [--shots "s1" "s2" | --story TEXT]
      runway product-ad      Product marketing video [--prompt TEXT --product-url URL]
      runway sequence        Custom Tools continuity chain [--story TEXT | --shots "s1" "s2"]
      runway download        Download latest generated asset [--index 0 --output PATH]
      runway screenshot      Screenshot current Runway tab [--output PATH]

  Vision click:
    agbrowse-vision-click "<target description>" [--double] [--prepare-stable]
    Use when snapshot refs are unavailable after trying snapshot --interactive.

  Environment:
    BROWSER_AGENT_HOME     Data directory (default: ~/.browser-agent).
                           Holds web-ai-sessions.json (Phase 1 store) +
                           web-ai-baselines.json (legacy) + browser profile.
    CDP_PORT               Default CDP port (default: 9222)
    AGBROWSE_MAX_TABS      Max open tabs before cleanup closes oldest (default: 20)
    AGBROWSE_TAB_IDLE      Idle threshold for cleanup (default: 30m)
    AGBROWSE_REUSE_TAB=1   Legacy web-ai behavior: reuse active tab
    AGBROWSE_WEB_AI_AUTO_START=0
                           Disable web-ai headed auto-start
    AGBROWSE_JSON_ERRORS=1 Force JSON failure envelopes regardless of --json
    AGBROWSE_UPDATE_CHECK=0
                           Hide npm latest-version update notices
    AGBROWSE_UPDATE_CHECK=1
                           Force update notices outside JSON/MCP/help surfaces
    AGBROWSE_UPDATE_CHECK_TTL=24h
                           Cache TTL for update notices
    AGBROWSE_UPDATE_CHECK_LATEST=0.1.16
                           Override latest version for tests/diagnosis
    AGBROWSE_HEAVY_SITE_COMPAT=1
                           Relax COEP/COOP + hide automation hint at launch
                           (or pass: agbrowse start --heavy-site-compat)
    AGBROWSE_KEEP_BG_NETWORKING=1
                           Don't pass --disable-background-networking
    AGBROWSE_CHROME_FLAGS  Extra Chrome launch flags (space-separated)
    CHROME_HEADLESS=1      Force headless mode unless start --headed is passed
    CHROME_NO_SANDBOX=1    Disable sandbox (Docker/CI)
    AGBROWSE_ENABLE_AUTOMATION=1
                           Pass --enable-automation to Chrome (drops singleton
                           notifications but sets navigator.webdriver=true)
    CHROME_BINARY_PATH     Custom Chrome/Canary/Chromium binary path.
                           Win Canary: %LOCALAPPDATA%\\Google\\Chrome SxS\\Application\\chrome.exe
                           macOS Canary: /Applications/Google Chrome Canary.app/.../Google Chrome Canary

  Configuration model:
    npm package files include bin/, skills/, and web-ai/.
    Browser state lives under BROWSER_AGENT_HOME, defaulting to ~/.browser-agent.
    Default CDP port is stable at 9222 unless --port or CDP_PORT is set.
    Skills are not installed implicitly; agents must choose a target with skills install --target.

  Notes:
    - Help output is intended to be enough for an agent to pick the next command.
    - Use tab-switch with a target id when multiple tabs are open.
    - install-skills never overwrites existing skills unless --force is passed.
    - Prefer "agbrowse skills get core --full" before long or risky UI automation.
    - Run "agbrowse web-ai --help" for provider-specific web-ai flags.
`);
    }
    // Force exit — playwright CDP WebSocket keeps event loop alive
    process.exit(0);
} catch (e) {
    if (!(/** @type {any} */ (e))?.alreadyReported) console.error(`❌ ${(/** @type {any} */ (e)).message}`);
    process.exit(1);
}
