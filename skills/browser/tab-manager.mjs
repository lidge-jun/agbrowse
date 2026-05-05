/**
 * Tab Manager — self-contained (no import from browser.mjs to avoid circular deps)
 */
// @ts-check
/// <reference types="playwright-core" />

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('playwright-core').CDPSession} CDPSession
 * @typedef {{ browser: Browser, connectedAt: number }} CdpConnectionEntry
 * @typedef {{ id?: string, type?: string, url?: string, title?: string, attached?: boolean }} RawTab
 * @typedef {{ send: (method: string, params?: Record<string, unknown>) => Promise<any>, detach: () => Promise<void> }} CdpSessionLike
 * @typedef {{ targetId: string, url: string, title: string, activated: boolean, lastActiveAt: number|null, reusedBlank?: boolean }} CreateTabResult
 * @typedef {{ closed: boolean, targetId: string, alreadyClosed?: boolean }} CloseTabResult
 * @typedef {{ active: true, previousTargetId: string|undefined, currentTargetId: string, lastActiveAt: number|null }} SwitchTabResult
 * @typedef {{ targetId: string, url: string, title: string, type: string, attached?: boolean, lastActiveAt: number|null }} ManagedTabRow
 * @typedef {{ targetId: string, url: string, title: string, type: string }} TabInfo
 * @typedef {{ activate?: boolean, reuseBlank?: boolean }} TabOpts
 */

/** @type {Map<number, CdpConnectionEntry>} */
const cdpConnections = new Map();
/** @type {Map<string, number>} */
const tabActivity = new Map();
let tabActivityLoaded = false;

const DATA_DIR = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const TAB_ACTIVITY_FILE = join(DATA_DIR, 'tab-activity.json');

function loadTabActivity() {
    if (tabActivityLoaded) return;
    tabActivityLoaded = true;
    if (!existsSync(TAB_ACTIVITY_FILE)) return;
    try {
        const parsed = /** @type {{ tabs?: Record<string, number> }} */ (JSON.parse(readFileSync(TAB_ACTIVITY_FILE, 'utf8')));
        for (const [targetId, lastActiveAt] of Object.entries(parsed.tabs || {})) {
            if (targetId && Number.isFinite(lastActiveAt)) tabActivity.set(targetId, lastActiveAt);
        }
    } catch {
        tabActivity.clear();
    }
}

function saveTabActivity() {
    mkdirSync(dirname(TAB_ACTIVITY_FILE), { recursive: true });
    const tabs = Object.fromEntries(tabActivity.entries());
    writeFileSync(TAB_ACTIVITY_FILE, `${JSON.stringify({ tabs }, null, 2)}\n`);
}

/**
 * @param {string} targetId
 * @param {number} [at]
 * @returns {number|null}
 */
export function markTabActive(targetId, at = Date.now()) {
    if (!targetId) return null;
    loadTabActivity();
    tabActivity.set(targetId, at);
    saveTabActivity();
    return at;
}

/**
 * @param {string} targetId
 */
export function forgetTabActivity(targetId) {
    if (!targetId) return;
    loadTabActivity();
    tabActivity.delete(targetId);
    saveTabActivity();
}

/**
 * @param {string} targetId
 * @returns {number|null}
 */
export function getTabActivity(targetId) {
    loadTabActivity();
    return tabActivity.get(targetId) || null;
}

/** @returns {Promise<typeof import('playwright-core')>} */
async function loadPlaywright() {
    try {
        return await import('playwright-core');
    } catch (error) {
        const err = /** @type {{ code?: string, message?: string }} */ (error);
        if (err?.code === 'ERR_MODULE_NOT_FOUND' || String(err?.message || '').includes('playwright-core')) {
            throw new Error(
                `playwright-core is required.\n` +
                `  Fix: cd <project-root> && npm install playwright-core`
            );
        }
        throw error;
    }
}

/**
 * @param {number} port
 * @returns {Promise<Browser>}
 */
async function getBrowserForPort(port) {
    const existing = cdpConnections.get(port);
    if (existing?.browser?.isConnected?.()) return existing.browser;

    const { chromium } = await loadPlaywright();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
    browser.on('disconnected', () => cdpConnections.delete(port));
    cdpConnections.set(port, { browser, connectedAt: Date.now() });
    return browser;
}

/**
 * @param {number} port
 * @returns {Promise<{ browser: Browser, cdpUrl: string }>}
 */
async function connectCdp(port) {
    const browser = await getBrowserForPort(port);
    return { browser, cdpUrl: `http://127.0.0.1:${port}` };
}

/**
 * @param {number} port
 * @returns {Promise<Page|null>}
 */
async function getActivePage(port) {
    const browser = await getBrowserForPort(port);
    const pages = browser.contexts().flatMap(c => c.pages());
    return pages[pages.length - 1] || null;
}

/**
 * @param {number} port
 * @returns {Promise<CDPSession|CdpSessionLike|null>}
 */
async function getCdpSession(port) {
    try {
        const page = await getActivePage(port);
        if (page) return page.context().newCDPSession(page);
        const browser = await getBrowserForPort(port);
        if (typeof browser.newBrowserCDPSession === 'function') {
            return browser.newBrowserCDPSession();
        }
    } catch (error) {
        const msg = String(/** @type {{ message?: string }} */ (error)?.message || '');
        if (!msg.includes('Browser.setDownloadBehavior')) throw error;
    }
    return createRawBrowserCdpSession(port);
}

/**
 * @param {number} port
 * @returns {Promise<CdpSessionLike|null>}
 */
async function createRawBrowserCdpSession(port) {
    const version = /** @type {{ webSocketDebuggerUrl?: string }} */ (await fetch(`http://127.0.0.1:${port}/json/version`).then(resp => resp.json()));
    const endpoint = version?.webSocketDebuggerUrl;
    if (!endpoint || typeof WebSocket !== 'function') return null;
    const ws = new WebSocket(endpoint);
    let nextId = 1;
    /** @type {Map<number, { resolve: (value: any) => void, reject: (reason?: unknown) => void }>} */
    const pending = new Map();
    ws.addEventListener('message', event => {
        /** @type {{ id?: number, error?: { message?: string }, result?: unknown } | null} */
        let payload = null;
        try { payload = JSON.parse(String(/** @type {{ data: unknown }} */ (event).data)); } catch { return; }
        if (!payload?.id || !pending.has(payload.id)) return;
        const entry = /** @type {{ resolve: (value: any) => void, reject: (reason?: unknown) => void }} */ (pending.get(payload.id));
        const { resolve, reject } = entry;
        pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message || JSON.stringify(payload.error)));
        else resolve(payload.result || {});
    });
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve(undefined), { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    return {
        async send(method, params = {}) {
            const id = nextId++;
            const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
            ws.send(JSON.stringify({ id, method, params }));
            return promise;
        },
        async detach() {
            for (const { reject } of pending.values()) reject(new Error('CDP session detached'));
            pending.clear();
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        }
    };
}

/**
 * @param {number} port
 * @returns {Promise<RawTab[]>}
 */
async function listTabs(port) {
    const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
    const all = /** @type {RawTab[]} */ (await resp.json());
    return all.filter(t => t.type === 'page');
}

/**
 * @param {RawTab} tab
 * @param {RawTab[]} [allTabs]
 */
function isReusableBlankTab(tab, allTabs = []) {
    const url = String(tab?.url || '').toLowerCase();
    if (!tab?.id || !(url === 'about:blank' || url === '')) return false;
    // Safe automatic reuse: only the single startup blank is implicitly ours.
    return allTabs.length === 1;
}

// ─── Tab operations ──────────────────────────────────────

/**
 * Create a new browser tab and optionally navigate to URL
 * @param {number} port - CDP port
 * @param {string} [url] - Initial URL
 * @param {TabOpts} [opts] - Options
 * @returns {Promise<CreateTabResult>}
 */
export async function createTab(port, url = 'about:blank', opts = {}) {
    const cdp = await getCdpSession(port);
    if (!cdp) throw new Error('No CDP session available for tab creation');

    try {
        if (url !== 'about:blank' && opts.reuseBlank !== false) {
            const tabs = await listTabs(port);
            const blank = tabs.find(tab => isReusableBlankTab(tab, tabs));
            if (blank?.id) {
                const page = await waitForPageByTargetId(port, blank.id);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                if (opts.activate !== false) {
                    await cdp.send('Target.activateTarget', { targetId: blank.id });
                }
                const now = markTabActive(blank.id);
                return {
                    targetId: blank.id,
                    url: page.url(),
                    title: await page.title().catch(() => 'New Tab'),
                    activated: opts.activate !== false,
                    lastActiveAt: now,
                    reusedBlank: true
                };
            }
        }

        const created = /** @type {{ targetId: string }} */ (await createTargetWithWindowFallback(cdp, url, opts));
        const { targetId } = created;

        await new Promise(r => setTimeout(r, 100));

        const tabs = await listTabs(port);
        const tab = tabs.find(t => t.id === targetId);
        const now = markTabActive(targetId);

        return {
            targetId,
            url: tab?.url || url,
            title: tab?.title || 'New Tab',
            activated: opts.activate !== false,
            lastActiveAt: now
        };
    } finally {
        await cdp.detach().catch(() => { });
    }
}

/**
 * @param {CDPSession|CdpSessionLike} cdp
 * @param {string} url
 * @param {TabOpts} [opts]
 * @returns {Promise<{ targetId: string }>}
 */
async function createTargetWithWindowFallback(cdp, url, opts = {}) {
    try {
        return await cdp.send('Target.createTarget', {
            url,
            newWindow: false,
            background: !opts.activate
        });
    } catch (error) {
        const msg = String(/** @type {{ message?: string }} */ (error)?.message || '');
        if (!msg.includes('no browser is open')) throw error;
        return cdp.send('Target.createTarget', {
            url,
            newWindow: true,
            background: false
        });
    }
}

/**
 * Close a tab by targetId
 * @param {number} port - CDP port
 * @param {string} targetId - CDP target ID
 * @returns {Promise<CloseTabResult>}
 */
export async function closeTab(port, targetId) {
    const cdp = await getCdpSession(port);
    if (!cdp) throw new Error('No CDP session available for tab close');

    try {
        await cdp.send('Target.closeTarget', { targetId });
        forgetTabActivity(targetId);
        return { closed: true, targetId };
    } catch (error) {
        const msg = /** @type {{ message?: string }} */ (error)?.message;
        if (msg?.includes('No target')) {
            forgetTabActivity(targetId);
            return { closed: true, targetId, alreadyClosed: true };
        }
        throw error;
    } finally {
        await cdp.detach().catch(() => { });
    }
}

/**
 * Switch active tab to targetId
 * @param {number} port - CDP port
 * @param {string} targetId - CDP target ID
 * @returns {Promise<SwitchTabResult>}
 */
export async function switchToTab(port, targetId) {
    const cdp = await getCdpSession(port);
    if (!cdp) throw new Error('No CDP session available for tab switch');

    try {
        const info = /** @type {{ targetInfo?: { targetId?: string } }} */ (await cdp.send('Target.getTargetInfo'));
        const previousTargetId = info?.targetInfo?.targetId;

        await cdp.send('Target.activateTarget', { targetId });
        const now = markTabActive(targetId);

        return {
            active: true,
            previousTargetId,
            currentTargetId: targetId,
            lastActiveAt: now
        };
    } finally {
        await cdp.detach().catch(() => { });
    }
}

/**
 * List all managed tabs with metadata
 * @param {number} port - CDP port
 * @returns {Promise<ManagedTabRow[]>}
 */
export async function listManagedTabs(port) {
    const tabs = await listTabs(port);
    return tabs.map(t => ({
        targetId: /** @type {string} */ (t.id),
        url: /** @type {string} */ (t.url),
        title: /** @type {string} */ (t.title),
        type: /** @type {string} */ (t.type),
        attached: t.attached,
        lastActiveAt: getTabActivity(/** @type {string} */ (t.id))
    }));
}

/**
 * Get info for a specific tab
 * @param {number} port - CDP port
 * @param {string} targetId - Tab target ID
 * @returns {Promise<TabInfo>}
 */
export async function getTabInfo(port, targetId) {
    const tabs = await listTabs(port);
    const tab = tabs.find(t => t.id === targetId);
    if (!tab) throw new Error(`Tab not found: ${targetId}`);

    return {
        targetId: /** @type {string} */ (tab.id),
        url: /** @type {string} */ (tab.url),
        title: /** @type {string} */ (tab.title),
        type: /** @type {string} */ (tab.type)
    };
}

/**
 * Check if a tab is still alive
 * @param {number} port - CDP port
 * @param {string} targetId - Tab target ID
 * @returns {Promise<boolean>}
 */
export async function isTabAlive(port, targetId) {
    try {
        const tabs = await listTabs(port);
        return tabs.some(t => t.id === targetId);
    } catch {
        return false;
    }
}

/**
 * Wait for a page to be attached for a given targetId
 * @param {number} port - CDP port
 * @param {string} targetId - Tab target ID
 * @param {number} [timeoutMs] - Max wait time
 * @returns {Promise<Page>}
 */
export async function waitForPageByTargetId(port, targetId, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const page = await getPageByTargetId(port, targetId);
        if (page && !page.isClosed?.()) return page;
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`new tab page not found for targetId ${targetId}`);
}

/**
 * Get Playwright page by targetId via CDP (uses cached browser connection)
 * @param {number} port - CDP port
 * @param {string} targetId - Tab target ID
 * @returns {Promise<Page|null>}
 */
export async function getPageByTargetId(port, targetId) {
    const browser = await getBrowserForPort(port);
    const contexts = browser.contexts();
    for (const context of contexts) {
        for (const page of context.pages()) {
            const session = await context.newCDPSession(page);
            try {
                const info = /** @type {{ targetInfo?: { targetId?: string } }} */ (await session.send('Target.getTargetInfo'));
                if (info.targetInfo?.targetId === targetId) {
                    markTabActive(targetId);
                    return page;
                }
            } finally {
                await session.detach().catch(() => { });
            }
        }
    }
    return null;
}
