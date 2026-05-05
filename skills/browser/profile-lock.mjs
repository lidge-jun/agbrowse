// @ts-check
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * @typedef {Object} ProfileLock
 * @property {number} pid
 * @property {string} token
 * @property {string} acquiredAt
 * @property {string} [heartbeatAt]
 */

/**
 * @typedef {ProfileLock & { path: string }} AcquiredProfileLock
 */

const DEFAULT_HOME = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const LOCK_NAME = 'profile.lock';
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * @param {number|null|undefined} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
    if (!pid || typeof pid !== 'number') return false;
    try { process.kill(pid, 0); return true; } catch (e) { return /** @type {{ code?: string }} */ (e).code === 'EPERM'; }
}

/**
 * @param {string} [homeDir]
 * @returns {AcquiredProfileLock}
 */
export function acquireProfileLock(homeDir = DEFAULT_HOME) {
    const lockPath = join(homeDir, LOCK_NAME);
    mkdirSync(homeDir, { recursive: true });

    const existing = readProfileLock(homeDir);
    if (existing && !isStaleLock(existing)) {
        throw new Error(
            `profile.lock held by pid ${existing.pid} since ${existing.acquiredAt}. ` +
            `Another agbrowse/Chrome instance is using this BROWSER_AGENT_HOME. ` +
            `If the process is dead, delete ${lockPath} manually or wait ${Math.ceil(STALE_AFTER_MS / 1000)}s for stale reclaim.`
        );
    }

    const token = randomBytes(8).toString('hex');
    const lock = { pid: process.pid, token, acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };

    if (existing) {
        const reclaimDir = `${lockPath}.reclaiming`;
        try { mkdirSync(reclaimDir); } catch {
            throw new Error('profile.lock reclaim race: another process is reclaiming the lock');
        }
        try {
            const recheck = readProfileLock(homeDir);
            if (recheck && !isStaleLock(recheck)) {
                throw new Error(
                    `profile.lock held by pid ${recheck.pid} since ${recheck.acquiredAt}. ` +
                    `Lock was reclaimed by another process during our reclaim attempt.`
                );
            }
            try { unlinkSync(lockPath); } catch { /* already gone */ }
            const fd = openSync(lockPath, 'wx');
            writeFileSync(fd, JSON.stringify(lock, null, 2));
            closeSync(fd);
        } finally {
            try { rmdirSync(reclaimDir); } catch { /* cleanup */ }
        }
    } else {
        const fd = openSync(lockPath, 'wx');
        writeFileSync(fd, JSON.stringify(lock, null, 2));
        closeSync(fd);
    }

    return { ...lock, path: lockPath };
}

/**
 * @param {string} [homeDir]
 * @param {string|null} [token]
 */
export function releaseProfileLock(homeDir = DEFAULT_HOME, token = null) {
    const lockPath = join(homeDir, LOCK_NAME);
    const lock = readProfileLock(homeDir);
    if (!lock) return;
    if (token && lock.token !== token) return;
    if (!token && lock.pid !== process.pid) return;
    try { unlinkSync(lockPath); } catch { /* already gone */ }
}

/**
 * @param {string} [homeDir]
 * @returns {ProfileLock|null}
 */
export function readProfileLock(homeDir = DEFAULT_HOME) {
    const lockPath = join(homeDir, LOCK_NAME);
    if (!existsSync(lockPath)) return null;
    try { return /** @type {ProfileLock} */ (JSON.parse(readFileSync(lockPath, 'utf8'))); } catch { return null; }
}

/**
 * @param {ProfileLock|null|undefined} lock
 * @returns {boolean}
 */
export function isStaleLock(lock) {
    if (!lock) return true;
    if (Number.isInteger(lock.pid) && lock.pid > 0) {
        return !isPidAlive(lock.pid);
    }
    const ref = lock.heartbeatAt || lock.acquiredAt;
    if (!ref) return true;
    const elapsed = Date.now() - Date.parse(ref);
    if (Number.isNaN(elapsed)) return true;
    return elapsed > STALE_AFTER_MS;
}

/**
 * @param {string} homeDir
 * @param {string} token
 * @param {number} newPid
 */
export function updateLockPid(homeDir = DEFAULT_HOME, token, newPid) {
    const lockPath = join(homeDir, LOCK_NAME);
    const lock = readProfileLock(homeDir);
    if (!lock || lock.token !== token) return;
    lock.pid = newPid;
    lock.heartbeatAt = new Date().toISOString();
    try { writeFileSync(lockPath, JSON.stringify(lock, null, 2)); } catch { /* race safe */ }
}

/**
 * @param {string} [homeDir]
 * @param {string|null} [token]
 */
export function updateHeartbeat(homeDir = DEFAULT_HOME, token = null) {
    const lockPath = join(homeDir, LOCK_NAME);
    const lock = readProfileLock(homeDir);
    if (!lock) return;
    if (token && lock.token !== token) return;
    if (!token && lock.pid !== process.pid) return;
    lock.heartbeatAt = new Date().toISOString();
    try { writeFileSync(lockPath, JSON.stringify(lock, null, 2)); } catch { /* race safe */ }
}
