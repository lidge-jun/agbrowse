// @ts-check

/**
 * Browser lifecycle management — extracted from browser.mjs (H-011).
 *
 * This module owns Chrome start/stop/connect/status/doctor operations.
 * browser.mjs remains the CLI entry point and command router.
 *
 * @module browser-lifecycle
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import net from 'node:net';
import { acquireProfileLock, releaseProfileLock, readProfileLock, isPidAlive, isStaleLock } from './profile-lock.mjs';
import { recordManagedLaunch, recordExternalConnect, isOwnedEndpoint, clearEndpointIdentity, readEndpointIdentity } from './endpoint-identity.mjs';

const DATA_DIR = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const STATE_FILE = join(DATA_DIR, 'browser-state.json');

/**
 * Read persisted browser state from disk.
 * @returns {Record<string, unknown>|null}
 */
export function readPersistedState() {
    if (!existsSync(STATE_FILE)) return null;
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

/**
 * Write browser state to disk.
 * @param {Record<string, unknown>} state
 */
export function writePersistedState(state) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Check if a TCP port is listening.
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export function isPortListening(port, host = '127.0.0.1') {
    return new Promise(resolve => {
        const sock = net.createConnection({ port, host });
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 500);
        sock.once('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
        sock.once('error', () => { clearTimeout(timer); resolve(false); });
    });
}

/**
 * Wait for CDP to be ready on a port.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function waitForCdpReady(port, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const resp = await fetch('http://127.0.0.1:' + port + '/json/version', {
                signal: AbortSignal.timeout(2000),
            });
            if (resp.ok) return true;
        } catch { /* not ready */ }
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

/**
 * Get browser status.
 * @param {number} [port]
 * @returns {Promise<{ running: boolean, tabs: number, cdpUrl: string|null }>}
 */
export async function getBrowserStatus(port) {
    const defaultPort = Number(process.env.CDP_PORT || '9222');
    const p = port || defaultPort;
    const listening = await isPortListening(p);
    if (!listening) return { running: false, tabs: 0, cdpUrl: null };
    try {
        const resp = await fetch('http://127.0.0.1:' + p + '/json/list', {
            signal: AbortSignal.timeout(2000),
        });
        const tabs = resp.ok ? (await resp.json()).length : 0;
        return { running: true, tabs, cdpUrl: 'http://127.0.0.1:' + p };
    } catch {
        return { running: true, tabs: 0, cdpUrl: 'http://127.0.0.1:' + p };
    }
}

// Re-export endpoint identity for consumers
export { isOwnedEndpoint, readEndpointIdentity, clearEndpointIdentity, recordManagedLaunch, recordExternalConnect };
