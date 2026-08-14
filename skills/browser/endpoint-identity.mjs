// @ts-check

/**
 * Endpoint identity and ownership tracking.
 *
 * Records whether the current CDP endpoint was launched by agbrowse (managed)
 * or connected to externally (external). External endpoints have restricted
 * operations: agbrowse cannot close the browser or manage tabs it did not open.
 *
 * @module endpoint-identity
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const IDENTITY_FILE = join(DATA_DIR, 'endpoint-identity.json');

/**
 * @typedef {'managed' | 'profile-copy' | 'external'} EndpointMode
 */

/**
 * @typedef {Object} EndpointIdentity
 * @property {EndpointMode} mode
 * @property {string} endpoint - CDP URL or WebSocket URL
 * @property {number} port
 * @property {boolean} owned - true if agbrowse launched this Chrome
 * @property {number|null} pid - Chrome process PID (null for external)
 * @property {string} connectedAt - ISO timestamp
 * @property {string|null} profileDir - profile directory path
 * @property {string[]} ownedTabIds - tab target IDs that agbrowse opened
 */

/**
 * Read the current endpoint identity from disk.
 * @returns {EndpointIdentity|null}
 */
export function readEndpointIdentity() {
    if (!existsSync(IDENTITY_FILE)) return null;
    try {
        return JSON.parse(readFileSync(IDENTITY_FILE, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Write endpoint identity to disk.
 * @param {EndpointIdentity} identity
 */
export function writeEndpointIdentity(identity) {
    writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
}

/**
 * Record that agbrowse launched a managed Chrome instance.
 * @param {{ port: number, pid: number, profileDir: string }} opts
 * @returns {EndpointIdentity}
 */
export function recordManagedLaunch({ port, pid, profileDir }) {
    const identity = {
        mode: /** @type {EndpointMode} */ ('managed'),
        endpoint: "http://127.0.0.1:" + port,
        port,
        owned: true,
        pid,
        connectedAt: new Date().toISOString(),
        profileDir,
        ownedTabIds: [],
    };
    writeEndpointIdentity(identity);
    return identity;
}

/**
 * Record that agbrowse connected to an external Chrome instance.
 * @param {{ endpoint: string, port: number }} opts
 * @returns {EndpointIdentity}
 */
export function recordExternalConnect({ endpoint, port }) {
    const identity = {
        mode: /** @type {EndpointMode} */ ('external'),
        endpoint,
        port,
        owned: false,
        pid: null,
        connectedAt: new Date().toISOString(),
        profileDir: null,
        ownedTabIds: [],
    };
    writeEndpointIdentity(identity);
    return identity;
}

/**
 * Check whether the current endpoint is agbrowse-owned (safe to close).
 * @returns {boolean}
 */
export function isOwnedEndpoint() {
    const id = readEndpointIdentity();
    return id?.owned === true;
}

/**
 * Register a tab as opened by agbrowse.
 * @param {string} targetId
 */
export function registerOwnedTab(targetId) {
    const id = readEndpointIdentity();
    if (!id) return;
    if (!id.ownedTabIds.includes(targetId)) {
        id.ownedTabIds.push(targetId);
        writeEndpointIdentity(id);
    }
}

/**
 * Check whether a tab was opened by agbrowse.
 * @param {string} targetId
 * @returns {boolean}
 */
export function isOwnedTab(targetId) {
    const id = readEndpointIdentity();
    if (!id) return true; // fallback: assume owned when no identity exists
    if (id.owned) return true; // managed mode: all tabs are ours
    return id.ownedTabIds.includes(targetId);
}

/**
 * Remove a tab from the owned list.
 * @param {string} targetId
 */
export function unregisterOwnedTab(targetId) {
    const id = readEndpointIdentity();
    if (!id) return;
    id.ownedTabIds = id.ownedTabIds.filter(t => t !== targetId);
    writeEndpointIdentity(id);
}

/**
 * Clear the endpoint identity (on stop/disconnect).
 */
export function clearEndpointIdentity() {
    try {
        unlinkSync(IDENTITY_FILE);
    } catch { /* already gone */ }
}
