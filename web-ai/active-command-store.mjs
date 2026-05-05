// @ts-check
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { generateSessionId } from './session-store.mjs';

/**
 * @typedef {Error & { code?: string, cause?: unknown, command?: ActiveCommandRow }} ActiveCommandError
 *
 * @typedef {{
 *   commandId: string,
 *   command: string,
 *   provider: string,
 *   sessionId: string|null,
 *   targetId: string|null,
 *   owner: string,
 *   browserProfileKey: string,
 *   startedAt: string,
 *   heartbeatAt: string,
 *   expiresAt: string,
 *   status: string,
 *   completedAt?: string,
 * }} ActiveCommandRow
 *
 * @typedef {Partial<ActiveCommandRow> & { ttlMs?: number, heartbeatIntervalMs?: number, port?: string|number }} ActiveCommandInput
 *
 * @typedef {{
 *   version: number,
 *   commands: ActiveCommandRow[],
 * }} ActiveCommandStoreFile
 */

const STORE_VERSION = 1;
const LOCK_RETRY_MS = 25;
const LOCK_RETRY_LIMIT = 200;
const STALE_LOCK_MS = 30_000;
const DEFAULT_TTL_MS = 2 * 60_000;
/** @type {ActiveCommandRow|null} */
let currentCommandContext = null;

function home() {
    return process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
}

function storePath() {
    return join(home(), 'web-ai-active-commands.json');
}

function lockPath() {
    return `${storePath()}.lock`;
}

/** @returns {ActiveCommandStoreFile} */
function readStore() {
    const path = storePath();
    if (!existsSync(path)) return { version: STORE_VERSION, commands: [] };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return {
            version: Number(parsed?.version) || STORE_VERSION,
            commands: Array.isArray(parsed?.commands) ? parsed.commands.filter((/** @type {{commandId?: unknown}} */ row) => row?.commandId) : [],
        };
    } catch (cause) {
        const error = /** @type {ActiveCommandError} */ (new Error(`active command store unavailable: ${/** @type {{message?: string}} */ (cause)?.message || path}`));
        error.code = 'active-command.store-unavailable';
        error.cause = cause;
        throw error;
    }
}

/** @param {ActiveCommandStoreFile} store */
function writeStore(store) {
    const path = storePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify({ version: STORE_VERSION, commands: store.commands || [] }, null, 2)}\n`);
    renameSync(tmp, path);
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withActiveCommandLock(fn) {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    /** @type {number|null} */
    let fd = null;
    let attempts = 0;
    while (attempts < LOCK_RETRY_LIMIT) {
        try {
            fd = openSync(path, 'wx');
            writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
            break;
        } catch (error) {
            if (/** @type {{code?: string}} */ (error)?.code !== 'EEXIST') throw error;
            attempts += 1;
            if (isStaleLock(path)) {
                try { unlinkSync(path); } catch { /* raced */ }
                continue;
            }
            await sleep(LOCK_RETRY_MS);
        }
    }
    if (fd === null) throw new Error(`web-ai active command: failed to acquire lock at ${path}`);
    try {
        return await fn();
    } finally {
        try { closeSync(fd); } catch { /* already closed */ }
        try { unlinkSync(path); } catch { /* already gone */ }
    }
}

/** @param {string} path */
function isStaleLock(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        const acquired = Date.parse(parsed?.acquiredAt || '');
        return !Number.isFinite(acquired) || Date.now() - acquired > STALE_LOCK_MS;
    } catch {
        return true;
    }
}

/** @param {number} ms */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** @param {ActiveCommandInput} [input] */
export async function registerActiveCommand(input = {}) {
    const now = new Date();
    const command = normalizeActiveCommand({
        ...input,
        commandId: input.commandId || generateSessionId(now.getTime()),
        startedAt: input.startedAt || now.toISOString(),
        heartbeatAt: input.heartbeatAt || now.toISOString(),
        expiresAt: input.expiresAt || new Date(now.getTime() + (input.ttlMs || DEFAULT_TTL_MS)).toISOString(),
        status: 'running',
    });
    return withActiveCommandLock(async () => {
        const store = readStore();
        const nowMs = Date.now();
        const targetConflict = command.targetId
            ? store.commands.find(row =>
                row.status === 'running' &&
                Date.parse(row.expiresAt || '') > nowMs &&
                row.targetId === command.targetId &&
                row.commandId !== command.commandId)
            : null;
        if (targetConflict) {
            const error = /** @type {ActiveCommandError} */ (new Error(`target already owned by active command: ${targetConflict.commandId}`));
            error.code = 'active-command.target-owned';
            error.command = targetConflict;
            throw error;
        }
        store.commands = store.commands.filter(row => row.commandId !== command.commandId);
        store.commands.push(command);
        writeStore(store);
        return command;
    });
}

/**
 * @param {string} commandId
 * @param {{ ttlMs?: number }} [options]
 */
export async function heartbeatActiveCommand(commandId, { ttlMs = DEFAULT_TTL_MS } = {}) {
    const now = new Date();
    return withActiveCommandLock(async () => {
        const store = readStore();
        const idx = store.commands.findIndex(row => row.commandId === commandId);
        if (idx < 0) return null;
        store.commands[idx] = {
            ...store.commands[idx],
            heartbeatAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        };
        writeStore(store);
        return store.commands[idx];
    });
}

/**
 * @param {string} commandId
 * @param {string} [status]
 */
export async function releaseActiveCommand(commandId, status = 'completed') {
    return withActiveCommandLock(async () => {
        const store = readStore();
        const idx = store.commands.findIndex(row => row.commandId === commandId);
        if (idx < 0) return null;
        const updated = { ...store.commands[idx], status, completedAt: new Date().toISOString() };
        store.commands[idx] = updated;
        writeStore(store);
        return updated;
    });
}

/**
 * @param {{ active?: boolean, targetId?: string, browserProfileKey?: string|number, owner?: string }} [filter]
 */
export async function listActiveCommands(filter = {}) {
    return withActiveCommandLock(async () => {
        const now = Date.now();
        const store = readStore();
        let changed = false;
        let commands = store.commands.map(row => {
            if (row.status === 'running' && Date.parse(row.expiresAt || '') <= now) {
                changed = true;
                return { ...row, status: 'stale' };
            }
            return row;
        });
        if (changed) writeStore({ ...store, commands });
        if (filter.active === true) commands = commands.filter(row => row.status === 'running');
        if (filter.targetId) commands = commands.filter(row => row.targetId === filter.targetId);
        if (filter.browserProfileKey) commands = commands.filter(row => row.browserProfileKey === String(filter.browserProfileKey));
        if (filter.owner) commands = commands.filter(row => row.owner === filter.owner);
        return commands;
    });
}

/**
 * @param {{ targetId?: string, browserProfileKey?: string|number, owner?: string }} [filter]
 */
export async function activeCommandTargetIds(filter = {}) {
    const commands = await listActiveCommands({ ...filter, active: true });
    return new Set(commands.map(row => row.targetId).filter(Boolean));
}

/**
 * @template T
 * @param {ActiveCommandInput} input
 * @param {(command: ActiveCommandRow) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withActiveCommand(input, fn) {
    if (isSameCommandTarget(currentCommandContext, input)) {
        return fn(/** @type {ActiveCommandRow} */ (currentCommandContext));
    }
    const command = await registerActiveCommand(input);
    const previousContext = currentCommandContext;
    currentCommandContext = command;
    /** @type {NodeJS.Timeout|null} */
    let heartbeatTimer = null;
    if (input.heartbeatIntervalMs !== 0) {
        const interval = Math.max(1000, input.heartbeatIntervalMs || 15_000);
        heartbeatTimer = setInterval(() => {
            void heartbeatActiveCommand(command.commandId, { ttlMs: input.ttlMs || DEFAULT_TTL_MS }).catch(() => undefined);
        }, interval);
        heartbeatTimer.unref?.();
    }
    try {
        return await fn(command);
    } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        currentCommandContext = previousContext;
        await releaseActiveCommand(command.commandId).catch(() => undefined);
    }
}

/**
 * @param {ActiveCommandRow|null} command
 * @param {ActiveCommandInput} [input]
 */
function isSameCommandTarget(command, input = {}) {
    if (!command?.targetId || !input?.targetId) return false;
    const inputProfile = String(input.browserProfileKey || input.port || process.env.CDP_PORT || '9222');
    return command.status === 'running' &&
        command.targetId === input.targetId &&
        command.browserProfileKey === inputProfile;
}

/**
 * @param {ActiveCommandInput} [input]
 * @returns {ActiveCommandRow}
 */
function normalizeActiveCommand(input = {}) {
    return {
        commandId: /** @type {string} */ (input.commandId),
        command: input.command || 'web-ai',
        provider: input.provider || 'chatgpt',
        sessionId: input.sessionId || null,
        targetId: input.targetId || null,
        owner: input.owner || 'cli',
        browserProfileKey: String(input.browserProfileKey || input.port || process.env.CDP_PORT || '9222'),
        startedAt: /** @type {string} */ (input.startedAt),
        heartbeatAt: /** @type {string} */ (input.heartbeatAt),
        expiresAt: /** @type {string} */ (input.expiresAt),
        status: input.status || 'running',
    };
}
