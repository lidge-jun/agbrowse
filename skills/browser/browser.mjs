#!/usr/bin/env node
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
 *   reload                           Reload current page
 *   resize <w> <h> [--fullscreen]    Resize browser window or viewport
 *   tabs [--json]                    List open tabs
 *   tab-switch <index-or-targetId> [--json] [--force]  Activate a tab
 *   select-tab <index-or-targetId> [--json] [--force]  Alias for tab-switch
 *   tab-cleanup [--provider chatgpt --keep-provider-tabs 1]  Close idle/overflow tabs
 *   text [--format html]             Get page text
 *   get-dom [--selector CSS] [--max-chars N]  Get current DOM
 *   console [--duration ms] [--clear] [--reload]  Read buffered console logs
 *   network [--duration ms] [--filter text] [--reload]  Inspect network requests
 *   evaluate <js> --unsafe-allow evaluate  Execute JavaScript
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
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import {
    parseAriaYaml,
    parseCdpAxTree,
    annotateNodeOccurrences,
    filterRequests,
    dedupeRequests,
} from './browser-core.mjs';
import { runInstallSkillsCli, runSkillsCli } from './skill-install.mjs';
import { acquireProfileLock, releaseProfileLock, updateLockPid } from './profile-lock.mjs';
import { runWebAiCli } from '../../web-ai/cli.mjs';
import { cleanupPoolTabs } from '../../web-ai/tab-pool.mjs';
import { listActiveCommands } from '../../web-ai/active-command-store.mjs';
import { enforcePolicy } from '../../web-ai/policy/enforce.mjs';
import { createTab, closeTab, switchToTab, listManagedTabs } from './tab-manager.mjs';
import { cleanupIdleTabs, isPinned, parseDuration } from './tab-lifecycle.mjs';

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
let cached = null;   // { browser, cdpUrl }
let chromeProc = null;
let activePort = null;
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

function isPortListening(port, host = '127.0.0.1') {
    return new Promise(resolve => {
        const sock = net.createConnection({ port, host });
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 500);
        sock.once('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
        sock.once('error', () => { clearTimeout(timer); resolve(false); });
    });
}

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

function readPersistedState() {
    if (!existsSync(STATE_FILE)) return null;
    try {
        return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return null;
    }
}

function writePersistedState(state) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updatePersistedState(patch) {
    writePersistedState({
        ...(readPersistedState() || {}),
        ...patch,
    });
}

function clearPersistedState() {
    rmSync(STATE_FILE, { force: true });
}

function getSnapshotFile(targetId = null) {
    if (targetId) return join(SNAPSHOTS_DIR, `${targetId}.json`);
    return SNAPSHOT_FILE;
}

function readPersistedSnapshot(targetId = null) {
    const file = getSnapshotFile(targetId);
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function writePersistedSnapshot(snapshotState, targetId = null) {
    const file = getSnapshotFile(targetId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(snapshotState, null, 2));
}

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

function parseClipArgs(args = []) {
    const index = args.indexOf('--clip');
    if (index === -1) return null;
    const values = args.slice(index + 1, index + 5).map(value => parseInt(value, 10));
    if (values.length < 4 || values.some(value => Number.isNaN(value))) {
        throw new Error('Invalid --clip arguments. Usage: --clip <x> <y> <width> <height>');
    }
    return {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
    };
}

async function killPersistedChrome(pid) {
    if (!pid) return false;

    if (process.platform === 'win32') {
        await new Promise((resolve, reject) => {
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
        if (error?.code === 'ESRCH') return false;
        if (error?.code !== 'EINVAL') throw error;
    }

    try {
        process.kill(pid, 'SIGTERM');
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') return false;
        throw error;
    }
}

function findChrome(customChromePath = CUSTOM_CHROME_PATH) {
    if (customChromePath) {
        if (existsSync(customChromePath)) return customChromePath;
        throw new Error(`Custom Chrome path not found: ${customChromePath}`);
    }

    const platform = process.platform;
    const paths = [];

    if (platform === 'darwin') {
        paths.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        );
    } else if (platform === 'win32') {
        const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
        const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const local = process.env.LOCALAPPDATA || '';
        paths.push(
            `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
            `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome\\Application\\chrome.exe`,
            `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        );
    } else {
        paths.push(
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/usr/bin/brave-browser',
        );
        if (isWSL()) {
            paths.push(
                '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
                '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            );
        }
    }

    for (const p of paths) {
        if (p && existsSync(p)) return p;
    }
    throw new Error('Chrome not found — install Google Chrome');
}

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
        mkdirSync(DATA_DIR, { recursive: true });
        const chrome = findChrome(opts.chromePath);
        const noSandbox = process.env.CHROME_NO_SANDBOX === '1';

        // Minimum window size to prevent responsive layout shifts
        // that cause Playwright "element is not stable" errors
        const minWidth = Math.max(opts.width || 1440, 1280);
        const minHeight = Math.max(opts.height || 900, 720);

        chromeProc = spawn(chrome, [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${PROFILE_DIR}`,
            `--window-size=${minWidth},${minHeight}`,
            '--no-first-run', '--no-default-browser-check',
            '--disable-dev-shm-usage',
            '--disable-background-networking',
            ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
            ...(headless ? ['--headless=new'] : []),
            'about:blank',
        ], { detached: true, stdio: 'ignore' });
        chromeProc.unref();

        updateLockPid(DATA_DIR, lockResult.token, chromeProc.pid);

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
            if (chromeProc && !chromeProc.killed) {
                chromeProc.kill('SIGTERM');
                chromeProc = null;
            }
            clearPersistedState();
            throw new Error(
                `Chrome CDP not responding on port ${port} after 10s. ` +
                `Possible causes:\n` +
                `  - Windows: Chrome singleton absorbed the launch (close ALL Chrome windows first)\n` +
                `  - No display available (try --headless or CHROME_HEADLESS=1)\n` +
                `  - Port conflict (try --port <other>)`
            );
        }
    } catch (err) {
        releaseProfileLock(DATA_DIR, lockResult.token);
        activeLockToken = null;
        throw err;
    }
}

function resolveHeadlessMode(opts = {}) {
    if (opts.headed === true) return false;
    return opts.headless === true || process.env.CHROME_HEADLESS === '1';
}

function focusChromeApp(chromePath) {
    if (process.platform !== 'darwin' || !chromePath) return;
    const appName = macAppNameFromChromePath(chromePath);
    if (!appName) return;
    const result = spawnSync('open', ['-a', appName], { stdio: 'ignore' });
    if (result.status !== 0) {
        console.warn(`[browser] warning: Chrome started headed but macOS foreground activation failed for ${appName}`);
    }
}

async function foregroundCdpWindow(port, chromePath) {
    try {
        const { browser } = await connectCdp(port, 2);
        const page = browser.contexts().flatMap(context => context.pages())[0];
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
        `CDP connection failed after ${retries} attempts: ${lastError?.message}\n` +
        `  💡 Fix: Ensure Chrome is running (agbrowse start) or check port ${port}`
    );
}

async function loadPlaywright() {
    try {
        return await import('playwright-core');
    } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND' || String(error?.message || '').includes('playwright-core')) {
            throw new Error(
                `playwright-core is required.\n` +
                `  💡 Fix: cd <project-root> && npm install playwright-core`
            );
        }
        throw error;
    }
}

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

        const page = browser.contexts().flatMap(context => context.pages())[0];
        if (!page) throw new Error('No page available for Browser.close');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Browser.close');
        await cdp.detach().catch(() => { });
    } finally {
        await browser.close().catch(() => { });
    }
}

async function getActivePage(port = getPort()) {
    const { browser } = await connectCdp(port);
    const pages = browser.contexts().flatMap(c => c.pages());
    const state = readPersistedState();
    const activeTargetId = state?.activeTargetId;
    if (activeTargetId) {
        for (const page of pages) {
            const pageTargetId = await getPageTargetId(page).catch(() => null);
            if (pageTargetId === activeTargetId) return page;
        }
        const tabs = await listTabs(port).catch(() => []);
        if (tabs.some(t => t.id === activeTargetId)) {
            throw new Error(`active target ${activeTargetId} is present in CDP but not attached as a Playwright page`);
        }
    }
    return pages[pages.length - 1] || null;
}

async function getPageTargetId(page) {
    const session = await page.context().newCDPSession(page);
    try {
        const info = await session.send('Target.getTargetInfo');
        return info?.targetInfo?.targetId || null;
    } finally {
        await session.detach().catch(() => { });
    }
}

async function getActiveTargetId(port = getPort()) {
    const page = await getActivePage(port);
    if (!page) return null;
    return getPageTargetId(page);
}

async function listTabs(port = getPort()) {
    const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await resp.json()).filter(t => t.type === 'page');
}

async function getBrowserStatus(port = getPort()) {
    try {
        const tabs = await listTabs(port);
        return { running: true, tabs: tabs.length, cdpUrl: `http://127.0.0.1:${port}` };
    } catch { return { running: false, tabs: 0 }; }
}

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

function telemetryInitScript(maxEntries) {
    const g = globalThis;
    const state = g.__browserAgentTelemetry || {
        console: [],
        maxEntries,
    };
    state.maxEntries = Math.max(state.maxEntries || 0, maxEntries);
    g.__browserAgentTelemetry = state;

    const push = entry => {
        state.console.push({ ...entry, ts: Date.now() });
        if (state.console.length > state.maxEntries) {
            state.console.splice(0, state.console.length - state.maxEntries);
        }
    };

    const toText = value => {
        if (typeof value === 'string') return value;
        if (value instanceof Error) return value.stack || value.message;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    };

    if (!g.__browserAgentConsolePatched && g.console) {
        g.__browserAgentConsolePatched = true;
        for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
            const original = g.console[level]?.bind(g.console);
            if (!original) continue;
            g.console[level] = (...args) => {
                push({ type: level, text: args.map(toText).join(' ') });
                return original(...args);
            };
        }
    }

    if (!g.__browserAgentErrorPatched) {
        g.__browserAgentErrorPatched = true;
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

async function ensureTelemetry(page) {
    await page.addInitScript(telemetryInitScript, TELEMETRY_MAX_ENTRIES);
    await page.evaluate(telemetryInitScript, TELEMETRY_MAX_ENTRIES).catch(() => { });
}

async function getReadyPage(port = getPort()) {
    const page = await getActivePage(port);
    if (!page) throw new Error('No active page — run `start` first, then `navigate <url>`');
    await ensureTelemetry(page);
    return page;
}

async function clearConsoleBuffer(page) {
    await page.evaluate(() => {
        const state = globalThis.__browserAgentTelemetry;
        if (state) state.console = [];
    });
}

async function readConsoleBuffer(page, limit) {
    return await page.evaluate(max => {
        const logs = globalThis.__browserAgentTelemetry?.console || [];
        return logs.slice(-max);
    }, limit);
}

async function getViewportInfo(page) {
    return await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
    }));
}

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
                `Snapshot failed.\n  ariaSnapshot: ${e1.message}\n  CDP fallback: ${e2.message}\n` +
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
        nodes.push({ ref: '...', role: 'note', name: `${opts.maxNodes} of ${totalNodes} shown (--max-nodes)`, depth: 0 });
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

function locatorForSnapshotNode(page, node) {
    const base = node.name
        ? page.getByRole(node.role, { name: node.name })
        : page.getByRole(node.role);
    return base.nth(node.occurrence ?? 0);
}

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

    const node = persisted.nodes.find(n => n.ref === ref);
    if (!node) throw new Error(`ref ${ref} not found — re-run snapshot`);
    return locatorForSnapshotNode(page, node);
}

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

    return { path: filepath, dpr: viewport.dpr, viewport: { width: viewport.width, height: viewport.height }, clip };
}

async function click(port, ref, opts = {}) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    if (opts.doubleClick) await locator.dblclick();
    else if (opts.rightClick) await locator.click({ button: 'right' });
    else await locator.click();
    return { ok: true, url: page.url() };
}

async function typeAction(port, ref, text, opts = {}) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.fill(text);
    if (opts.submit) await page.keyboard.press('Enter');
    return { ok: true };
}

async function press(port, key) {
    const page = await getReadyPage(port);
    await page.keyboard.press(key);
    return { ok: true };
}

async function hover(port, ref) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.hover();
    return { ok: true };
}

async function navigate(port, url) {
    const page = await getReadyPage(port);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const targetId = await getPageTargetId(page).catch(() => null);
    clearPersistedSnapshot(targetId);
    clearPersistedSnapshot();
    return { ok: true, url: page.url() };
}

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

async function getPageText(port, format = 'text') {
    const page = await getReadyPage(port);
    if (format === 'html') return { text: await page.content() };
    return { text: await page.innerText('body') };
}

async function mouseClick(port, x, y, opts = {}) {
    const page = await getReadyPage(port);
    if (opts.doubleClick) await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y);
    return { success: true, clicked: { x, y } };
}

// ═══════════════════════════════════════════════════
//  Extended Actions (v2)
// ═══════════════════════════════════════════════════

async function scroll(port, direction, opts = {}) {
    const page = await getReadyPage(port);
    const amount = opts.amount || 500;
    const deltaMap = {
        down: [0, amount], up: [0, -amount],
        right: [amount, 0], left: [-amount, 0],
    };
    const [dx, dy] = deltaMap[direction] || [0, amount];

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

    const node = persisted.nodes.find(entry => entry.ref === ref);
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

async function waitForSelector(port, selector, opts = {}) {
    const timeout = opts.timeout || 10000;
    const page = await getReadyPage(port);
    await page.locator(selector).first().waitFor({ state: opts.state || 'visible', timeout });
    return { ok: true, selector, state: opts.state || 'visible' };
}

async function waitForText(port, text, opts = {}) {
    const timeout = opts.timeout || 10000;
    const page = await getReadyPage(port);
    await page.getByText(text).first().waitFor({ state: opts.state || 'visible', timeout });
    return { ok: true, text, state: opts.state || 'visible' };
}

async function tabSwitch(port, target, opts = {}) {
    const tabs = await listTabs(port);
    const wantedIndex = Number(target);
    const wanted = Number.isInteger(wantedIndex)
        ? tabs[wantedIndex - 1]
        : tabs.find(t => t.id === target);
    if (!wanted) {
        throw new Error(
            `Tab ${target} not found\n` +
            `  💡 Fix: Run 'tabs' and use a valid index or target id`
        );
    }
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
                `  💡 Fix: retry, inspect ${cause?.message || 'active-command store'}, or pass --force if you are sure`
            );
            error.code = 'active-command.store-unavailable';
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
        error.code = 'active-command.target-owned';
        error.command = owner;
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

async function selectOption(port, ref, value) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.selectOption(value);
    return { ok: true, ref, value };
}

async function setChecked(port, ref, checked) {
    const page = await getReadyPage(port);
    const locator = await refToLocator(page, port, ref);
    if (checked) await locator.check();
    else await locator.uncheck();
    return { ok: true, ref, checked };
}

async function drag(port, fromRef, toRef) {
    const page = await getReadyPage(port);
    const fromLocator = await refToLocator(page, port, fromRef);
    const toLocator = await refToLocator(page, port, toRef);
    await fromLocator.dragTo(toLocator);
    return { ok: true, from: fromRef, to: toRef };
}

async function waitMs(ms) {
    await new Promise(r => setTimeout(r, ms));
    return { ok: true, waited: ms };
}

async function reload(port) {
    const page = await getReadyPage(port);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const targetId = await getPageTargetId(page).catch(() => null);
    clearPersistedSnapshot(targetId);
    clearPersistedSnapshot();
    return { ok: true, url: page.url() };
}

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
                    warning: error.message,
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
            warning: error.message,
        };
    } finally {
        await cdp.detach().catch(() => { });
    }
}

async function getDom(port, opts = {}) {
    const page = await getReadyPage(port);

    let html;
    if (opts.selector) {
        html = await page.locator(opts.selector).first().evaluate(node => node.outerHTML);
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
        await page.evaluate(opts.expression);
    }
    if (duration > 0) {
        await new Promise(r => setTimeout(r, duration));
    }

    const limit = opts.limit || 50;
    const logs = await readConsoleBuffer(page, limit);
    return { logs, count: logs.length, duration, buffered: true };
}

async function collectPerformanceRequests(page) {
    return page.evaluate(() => {
        const normalize = (url, type, source) => ({
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
            const type = entry.initiatorType || 'resource';
            const key = `${type}:${url}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(normalize(url, type, 'performance'));
            }
        }

        return out;
    });
}

async function captureNetwork(port, opts = {}) {
    const page = await getReadyPage(port);
    const duration = opts.duration ?? 5000;
    const liveRequests = [];
    const shouldCaptureLive = opts.reload || duration > 0;

    if (opts.clear) {
        await page.evaluate(() => performance.clearResourceTimings());
    }

    if (shouldCaptureLive) {
        const cdp = await getCdpSession(port);
        if (!cdp) throw new Error('Could not open CDP session for network capture');

        const handler = params => {
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

async function moveMouse(port, x, y) {
    const page = await getReadyPage(port);
    await page.mouse.move(x, y);
    return { ok: true, position: { x, y } };
}

async function mouseDown(port, opts = {}) {
    const page = await getReadyPage(port);
    await page.mouse.down({ button: opts.button || 'left' });
    return { ok: true, button: opts.button || 'left' };
}

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
    getCdpSession: () => getCdpSession(getPort()),
    getPort: () => getPort(),
    getTargetId: () => getActiveTargetId(getPort()),
    getBrowserStatus: (port = getPort()) => getBrowserStatus(Number(port)),
    readBrowserState: () => readPersistedState(),
    ensureStarted: (options = {}) => launchChrome(Number(options.port || getPort()), options),
};

try {
    switch (sub) {
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
                if (result.result.help) {
                    console.log(result.result.usage);
                } else if (result.result.json) {
                    console.log(JSON.stringify(result.result, null, 2));
                } else {
                    console.log(`installed ${result.result.installed.length} skills to ${result.result.targetRoot}`);
                    for (const item of result.result.installed) {
                        console.log(`  ${item.action.padEnd(6)} ${item.name} -> ${item.path}`);
                    }
                }
            } else {
                console.log(result.text);
            }
            break;
        }
        case 'install-skills': {
            const result = runInstallSkillsCli(process.argv.slice(3), { sourceRoot: SKILLS_ROOT });
            if (result.help) {
                console.log(result.usage);
                break;
            }
            if (result.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(`installed ${result.installed.length} skills to ${result.targetRoot}`);
                for (const item of result.installed) {
                    console.log(`  ${item.action.padEnd(6)} ${item.name} -> ${item.path}`);
                }
            }
            break;
        }
        case 'web-ai':
            await runWebAiCli(process.argv.slice(3), browserDeps);
            break;
        case 'start': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    port: { type: 'string', default: String(DEFAULT_CDP_PORT) },
                    headless: { type: 'boolean', default: false },
                    headed: { type: 'boolean', default: false },
                    'chrome-path': { type: 'string' },
                }, strict: false,
            });
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
        case 'snapshot': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    interactive: { type: 'boolean', default: false },
                    'max-nodes': { type: 'string' },
                }, strict: false,
            });
            const maxNodes = values['max-nodes'] ? parseInt(values['max-nodes']) : undefined;
            const nodes = await snapshot(getPort(), { interactive: values.interactive, maxNodes, persist: true });
            for (const n of nodes) {
                const indent = '  '.repeat(n.depth);
                const val = n.value ? ` = "${n.value}"` : '';
                console.log(`${n.ref.padEnd(4)} ${indent}${n.role.padEnd(10)} "${n.name}"${val}`);
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
            if (!url) { console.error('Usage: browser.mjs navigate <url>'); process.exit(1); }
            const r = await navigate(getPort(), url);
            console.log(`navigated → ${r.url}`);
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
            const activeCommands = await listActiveCommands({
                browserProfileKey: String(getPort()),
                active: true,
            }).catch(() => []);
            const activeByTargetId = new Map(activeCommands.map(command => [command.targetId, command]));
            const tabs = (await listManagedTabs(getPort())).map(tab => {
                const displayed = tabDisplayState(tab);
                const activeCommand = activeCommandSummary(activeByTargetId.get(displayed.targetId));
                return activeCommand ? { ...displayed, activeCommand } : displayed;
            });
            if (json) {
                console.log(JSON.stringify(tabs.map((t, i) => ({ index: i + 1, ...t })), null, 2));
            } else {
                tabs.forEach((t, i) => {
                    const state = `${t.pinned ? 'pinned, ' : ''}${t.activeCommand ? 'active-command, ' : ''}idle ${t.idleFor}`;
                    console.log(`${i + 1}. ${t.title || '(untitled)'} [${state}]`);
                    console.log(`   ${t.url}`);
                    console.log(`   targetId: ${t.targetId}`);
                });
                console.log(`\nTip: run "agbrowse tab-cleanup" to close idle/overflow tabs.`);
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
        case 'new-tab': {
            const url = process.argv[3] || 'about:blank';
            const tab = await createTab(getPort(), url);
            console.log(`created tab: ${tab.targetId} (${tab.url})`);
            break;
        }
        case 'tab-close': {
            const target = process.argv[3];
            if (!target) { console.error('Usage: browser.mjs tab-close <targetId>'); process.exit(1); }
            const result = await closeTab(getPort(), target);
            console.log(`closed tab: ${result.targetId}`);
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
                },
                strict: false,
            });
            if (values['include-untracked'] === true && values.force !== true) {
                console.error('error: tab-cleanup --include-untracked requires --force');
                process.exit(1);
            }
            const leaseResult = await cleanupPoolTabs(getPort());
            const result = await cleanupIdleTabs(getPort(), {
                idleTimeoutMs: values['idle-after'] ? parseDuration(values['idle-after']) : undefined,
                maxTabs: values['max-tabs'] ? parseInt(values['max-tabs'], 10) : undefined,
                includeUntracked: values['include-untracked'] === true,
                provider: values.provider,
                keepProviderTabs: values['keep-provider-tabs'] ? parseInt(values['keep-provider-tabs'], 10) : undefined,
            });
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
            const maxChars = values['max-chars'] ? parseInt(values['max-chars']) : undefined;
            const r = await getDom(getPort(), { selector: values.selector, maxChars });
            if (r.truncated) {
                console.error(`[truncated: ${r.shownChars}/${r.totalChars} chars]`);
            }
            console.log(r.html);
            break;
        }
        case 'console': {
            const { values } = parseArgs({
                args: process.argv.slice(3),
                options: {
                    duration: { type: 'string' },
                    expression: { type: 'string' },
                    limit: { type: 'string' },
                    clear: { type: 'boolean', default: false },
                    reload: { type: 'boolean', default: false },
                }, strict: false,
            });
            const duration = values.duration ? parseInt(values.duration, 10) : 0;
            const limit = values.limit ? parseInt(values.limit, 10) : 50;
            const r = await captureConsole(getPort(), {
                duration,
                expression: values.expression,
                limit,
                clear: values.clear,
                reload: values.reload,
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
            const duration = values.duration ? parseInt(values.duration, 10) : 0;
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

  Usage:
    agbrowse <command> [args] [--flags]

  Start here:
    npm install -g agbrowse
    agbrowse skills get core --full
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

  Browser lifecycle:
    start [--port <9222>] [--headless|--headed] [--chrome-path PATH]
                           Start Chrome (--headed overrides CHROME_HEADLESS=1)
    stop                   Stop Chrome
    status                 Connection status
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
    navigate <url>         Go to URL
    reload                 Reload current page
    resize <w> <h>         Resize browser window / viewport [--fullscreen]
     tabs                   List tabs [--json]
     tab-switch <target>    Switch to tab index or CDP target id [--json] [--force]
     select-tab <target>    Alias for tab-switch [--json] [--force]
     tab-cleanup            Close idle/overflow tabs
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
     evaluate <js>          Execute JavaScript only with --unsafe-allow evaluate

  Web AI:
    web-ai render          Render the provider prompt without a browser
    web-ai status          Check active provider tab state
    web-ai send            Send a prompt; returns a sessionId for later resume
    web-ai poll            Poll a session (or latest baseline) for completion
    web-ai query           send + poll in one call
    web-ai stop            Send Escape to the active provider tab
    web-ai context-dry-run Build a context package without sending
    web-ai context-render  Render full prompt/context package text

      Common flags:
        --vendor <chatgpt|gemini|grok>
        --model <alias>                ChatGPT: pro/thinking/instant
                                       Gemini:  pro/thinking/fast + tool deepthink
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
        --reuse-tab                    Reuse active tab (legacy behavior)
        --json                         JSON output (or AGBROWSE_JSON_ERRORS=1)

      Tab lease policy:
        Completed provider tabs are runtime leases. The warm pool keeps max 1
        owned tab per owner/vendor/sessionType/origin/profile key for 5m, then
        closes expired or overflow targets. Run tab-cleanup --json to inspect
        leaseClosedTabs.

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

  Vision click:
    agbrowse-vision-click "<target description>" [--double] [--prepare-stable]

  Environment:
    BROWSER_AGENT_HOME     Data directory (default: ~/.browser-agent).
                           Holds web-ai-sessions.json (Phase 1 store) +
                           web-ai-baselines.json (legacy) + browser profile.
    CDP_PORT               Default CDP port (default: 9222)
    AGBROWSE_MAX_TABS      Max open tabs before cleanup closes oldest (default: 10)
    AGBROWSE_TAB_IDLE      Idle threshold for cleanup (default: 30m)
    AGBROWSE_REUSE_TAB=1   Legacy web-ai behavior: reuse active tab
    AGBROWSE_WEB_AI_AUTO_START=0
                           Disable web-ai headed auto-start
    AGBROWSE_JSON_ERRORS=1 Force JSON failure envelopes regardless of --json
    CHROME_HEADLESS=1      Force headless mode unless start --headed is passed
    CHROME_NO_SANDBOX=1    Disable sandbox (Docker/CI)
    CHROME_BINARY_PATH     Custom Chrome/Chromium binary path

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
    if (!e?.alreadyReported) console.error(`❌ ${e.message}`);
    process.exit(1);
}
