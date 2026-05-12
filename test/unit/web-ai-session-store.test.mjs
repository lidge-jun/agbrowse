import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

async function freshStore() {
    const url = new URL('../../web-ai/session-store.mjs', import.meta.url).href + `?cache=${Date.now()}${Math.random()}`;
    return import(url);
}

async function freshSession() {
    const url = new URL('../../web-ai/session.mjs', import.meta.url).href + `?cache=${Date.now()}${Math.random()}`;
    return import(url);
}

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-session-store-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

describe('web-ai session-store ULID', () => {
    it('generates a 26-char Crockford base32 ULID with sortable timestamp prefix', async () => {
        const { generateSessionId } = await freshStore();
        const a = generateSessionId(1700000000000);
        const b = generateSessionId(1700000000001);
        expect(a).toHaveLength(26);
        expect(b).toHaveLength(26);
        expect(a.localeCompare(b)).toBe(-1);
        expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(a)).toBe(true);
    });

    it('two ULIDs from the same millisecond differ in the random suffix', async () => {
        const { generateSessionId } = await freshStore();
        const ms = 1700000000000;
        const ids = new Set();
        for (let i = 0; i < 50; i++) ids.add(generateSessionId(ms));
        expect(ids.size).toBe(50);
    });
});

describe('web-ai session-store insert/list/patch/prune', () => {
    it('round-trips a session through insertSession + listStoredSessions', async () => {
        const { insertSession, listStoredSessions, generateSessionId } = await freshStore();
        const session = {
            sessionId: generateSessionId(),
            vendor: 'chatgpt',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'sent',
        };
        insertSession(session);
        const rows = listStoredSessions({ vendor: 'chatgpt' });
        expect(rows.length).toBe(1);
        expect(rows[0].sessionId).toBe(session.sessionId);
    });

    it('patchSession mutates an existing record without losing fields', async () => {
        const { insertSession, patchSession, listStoredSessions, generateSessionId } = await freshStore();
        const id = generateSessionId();
        insertSession({ sessionId: id, vendor: 'grok', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'sent', warnings: ['x'] });
        patchSession(id, { status: 'complete' });
        const row = listStoredSessions({ sessionId: id })[0];
        expect(row.status).toBe('complete');
        expect(row.warnings).toEqual(['x']);
    });

    it('listStoredSessions filters by active status (sent + polling) when active=true', async () => {
        const { insertSession, listStoredSessions, generateSessionId } = await freshStore();
        const now = new Date().toISOString();
        insertSession({ sessionId: generateSessionId(), vendor: 'gemini', createdAt: now, updatedAt: now, status: 'sent' });
        insertSession({ sessionId: generateSessionId(), vendor: 'gemini', createdAt: now, updatedAt: now, status: 'polling' });
        insertSession({ sessionId: generateSessionId(), vendor: 'gemini', createdAt: now, updatedAt: now, status: 'complete' });
        const active = listStoredSessions({ vendor: 'gemini', active: true });
        expect(active.length).toBe(2);
        expect(active.every(s => s.status === 'sent' || s.status === 'polling')).toBe(true);
    });

    it('listStoredSessions excludes expired sent/polling sessions from active results', async () => {
        const { insertSession, listStoredSessions, generateSessionId } = await freshStore();
        const now = new Date().toISOString();
        const expired = new Date(Date.now() - 1000).toISOString();
        const future = new Date(Date.now() + 60_000).toISOString();
        insertSession({ sessionId: generateSessionId(), vendor: 'chatgpt', createdAt: now, updatedAt: now, status: 'sent', deadlineAt: expired });
        insertSession({ sessionId: generateSessionId(), vendor: 'chatgpt', createdAt: now, updatedAt: now, status: 'polling', deadlineAt: expired });
        const current = insertSession({ sessionId: generateSessionId(), vendor: 'chatgpt', createdAt: now, updatedAt: now, status: 'sent', deadlineAt: future });
        const active = listStoredSessions({ vendor: 'chatgpt', active: true });
        expect(active.map(s => s.sessionId)).toEqual([current.sessionId]);
    });

    it('pruneSessions removes records older than the cutoff', async () => {
        const { insertSession, listStoredSessions, pruneSessions, generateSessionId } = await freshStore();
        const old = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
        const recent = new Date().toISOString();
        insertSession({ sessionId: generateSessionId(), vendor: 'chatgpt', createdAt: old, updatedAt: old, status: 'complete' });
        insertSession({ sessionId: generateSessionId(), vendor: 'chatgpt', createdAt: recent, updatedAt: recent, status: 'complete' });
        const result = pruneSessions({ olderThanMs: 30 * 24 * 3600 * 1000 });
        expect(result.removed).toBe(1);
        expect(listStoredSessions({}).length).toBe(1);
    });
});

describe('web-ai session API on top of the store', () => {
    it('createSession persists vendor, promptHash sha256: prefix, deadline, and status=sent', async () => {
        const { createSession } = await freshSession();
        const session = createSession({ vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' }, {
            originalUrl: 'https://chatgpt.com/',
            conversationUrl: 'https://chatgpt.com/c/abc',
            deadlineAt: new Date(Date.now() + 1200_000).toISOString(),
            envelopeSummary: { model: 'pro' },
        });
        expect(session.vendor).toBe('chatgpt');
        expect(session.status).toBe('sent');
        expect(session.promptHash.startsWith('sha256:')).toBe(true);
        expect(session.envelopeSummary).toEqual({ model: 'pro' });
        expect(session.conversationUrl).toBe('https://chatgpt.com/c/abc');
    });

    it('findActiveSession honors targetId > conversationUrl > vendor-latest priority', async () => {
        const { createSession, findActiveSession } = await freshSession();
        const a = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, { targetId: 'tA', conversationUrl: 'https://chatgpt.com/c/a' });
        const b = createSession({ vendor: 'chatgpt', prompt: 'b', attachmentPolicy: 'inline-only' }, { targetId: 'tB', conversationUrl: 'https://chatgpt.com/c/b' });
        expect(findActiveSession({ vendor: 'chatgpt', targetId: 'tA' }).sessionId).toBe(a.sessionId);
        expect(findActiveSession({ vendor: 'chatgpt', conversationUrl: 'https://chatgpt.com/c/b' }).sessionId).toBe(b.sessionId);
        expect(findActiveSession({ vendor: 'chatgpt' }).sessionId).toBe(b.sessionId);
        expect(findActiveSession({ vendor: 'gemini' })).toBeNull();
    });

    it('findActiveSession ignores stale sent sessions whose deadline already passed', async () => {
        const { createSession, findActiveSession } = await freshSession();
        createSession({ vendor: 'chatgpt', prompt: 'old', attachmentPolicy: 'inline-only' }, {
            targetId: 'old-target',
            conversationUrl: 'https://chatgpt.com/c/old',
            deadlineAt: new Date(Date.now() - 1000).toISOString(),
        });
        const current = createSession({ vendor: 'chatgpt', prompt: 'new', attachmentPolicy: 'inline-only' }, {
            targetId: 'new-target',
            conversationUrl: 'https://chatgpt.com/c/new',
            deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        });
        expect(findActiveSession({ vendor: 'chatgpt' }).sessionId).toBe(current.sessionId);
        expect(findActiveSession({ vendor: 'chatgpt', targetId: 'old-target' }).sessionId).toBe(current.sessionId);
    });

    it('updateSession changes status without dropping createdAt', async () => {
        const { createSession, updateSession, getSession } = await freshSession();
        const created = createSession({ vendor: 'grok', prompt: 'x', attachmentPolicy: 'inline-only' });
        const patched = updateSession(created.sessionId, { status: 'complete', answer: 'AGBR' });
        expect(patched.status).toBe('complete');
        expect(patched.answer).toBe('AGBR');
        expect(patched.createdAt).toBe(created.createdAt);
        expect(getSession(created.sessionId)?.status).toBe('complete');
    });

    it('sessionToBaseline strips the sha256 prefix and pulls assistantCount from envelopeSummary', async () => {
        const { createSession, sessionToBaseline } = await freshSession();
        const session = createSession({ vendor: 'chatgpt', prompt: 'ok', attachmentPolicy: 'inline-only' }, {
            conversationUrl: 'https://chatgpt.com/c/x',
            envelopeSummary: { assistantCount: 7 },
        });
        const baseline = sessionToBaseline(session);
        expect(baseline.vendor).toBe('chatgpt');
        expect(baseline.url).toBe('https://chatgpt.com/c/x');
        expect(baseline.assistantCount).toBe(7);
        expect(baseline.promptHash.startsWith('sha256:')).toBe(false);
    });
});

describe('web-ai session command lock heartbeat + PID staleness', () => {
    it('records pid, sessionId, acquiredAt, heartbeatAt, expiresAt metadata when acquired', async () => {
        const { withSessionCommandLock, readSessionCommandLock } = await freshStore();
        const sessionId = 'TESTSESSION001';
        const before = Date.now();
        let snapshot;
        await withSessionCommandLock(sessionId, async () => {
            snapshot = readSessionCommandLock(sessionId);
        }, { heartbeatMs: 0 });
        expect(snapshot).toBeTruthy();
        expect(snapshot.pid).toBe(process.pid);
        expect(snapshot.sessionId).toBe(sessionId);
        expect(Date.parse(snapshot.acquiredAt)).toBeGreaterThanOrEqual(before - 1);
        expect(Date.parse(snapshot.heartbeatAt)).toBeGreaterThanOrEqual(Date.parse(snapshot.acquiredAt) - 1);
        expect(Date.parse(snapshot.expiresAt)).toBeGreaterThan(Date.parse(snapshot.heartbeatAt));
        expect(typeof snapshot.stale).toBe('boolean');
        expect(readSessionCommandLock(sessionId)).toBeNull();
    });

    it('treats a command lock from a dead pid as stale and allows reacquire', async () => {
        const { withSessionCommandLock, readSessionCommandLock } = await freshStore();
        const sessionId = 'TESTSESSION002';
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const { dirname } = await import('node:path');
        const lockPath = join(tmpHome, `web-ai-sessions.json.cmd.${sessionId}.lock`);
        mkdirSync(dirname(lockPath), { recursive: true });
        // Pick a PID guaranteed not to be alive: max valid pid value.
        const deadPid = 2_147_483_646;
        const now = Date.now();
        writeFileSync(lockPath, JSON.stringify({
            pid: deadPid,
            sessionId,
            acquiredAt: new Date(now).toISOString(),
            heartbeatAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 60_000).toISOString(),
        }));
        const before = readSessionCommandLock(sessionId);
        expect(before?.stale).toBe(true);

        let executed = false;
        await withSessionCommandLock(sessionId, async () => { executed = true; }, { heartbeatMs: 0 });
        expect(executed).toBe(true);
    });

    it('does not treat a live command lock heartbeat as stale within ttl', async () => {
        const { withSessionCommandLock, readSessionCommandLock } = await freshStore();
        const sessionId = 'TESTSESSION003';
        // A short ttl so we observe expiresAt > now while heartbeat is fresh.
        const lockPromise = withSessionCommandLock(sessionId, async () => {
            const snapshot = readSessionCommandLock(sessionId);
            expect(snapshot).toBeTruthy();
            expect(snapshot.stale).toBe(false);
            expect(Date.parse(snapshot.expiresAt) - Date.now()).toBeGreaterThan(0);
        }, { ttlMs: 60_000, heartbeatMs: 0 });
        await lockPromise;
    });
});

describe('web-ai session-store concurrency', () => {
    it('serializes parallel insertSession calls without losing records', async () => {
        const { insertSession, listStoredSessions, generateSessionId } = await freshStore();
        const ids = Array.from({ length: 25 }, () => generateSessionId());
        const now = new Date().toISOString();
        await Promise.all(ids.map(id =>
            Promise.resolve().then(() => insertSession({ sessionId: id, vendor: 'chatgpt', createdAt: now, updatedAt: now, status: 'sent' }))
        ));
        const stored = listStoredSessions({ vendor: 'chatgpt' });
        expect(stored.length).toBe(25);
        expect(new Set(stored.map(s => s.sessionId)).size).toBe(25);
    });
});
