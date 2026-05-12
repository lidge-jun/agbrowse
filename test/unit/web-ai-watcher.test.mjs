import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const watcherSrc = readFileSync(join(process.cwd(), 'web-ai/watcher.mjs'), 'utf8');

describe('web-ai watcher transient-timeout promotion (source-string contract)', () => {
    it('imports withSessionCommandLock from session-store', () => {
        expect(watcherSrc).toContain("import { withSessionCommandLock } from './session-store.mjs'");
    });

    it('promotes a pre-deadline timeout back to polling inside the session command lock', () => {
        // The promotion block must check status === 'timeout' AND !isDeadlineExpired,
        // and the mutation must happen inside withSessionCommandLock.
        expect(watcherSrc).toMatch(
            /session\.status === 'timeout' && !isDeadlineExpired\(session\.deadlineAt\)[\s\S]*?await withSessionCommandLock\(session\.sessionId/,
        );
    });

    it('re-reads session inside the lock to avoid clobbering a concurrent live poll', () => {
        expect(watcherSrc).toMatch(/withSessionCommandLock\(session\.sessionId, async \(\) =>[\s\S]*?const refreshed = getSession\(session\.sessionId\)/);
    });

    it('uses short ttl and disables heartbeat for the status flip', () => {
        expect(watcherSrc).toMatch(/\{\s*ttlMs:\s*30_000,\s*heartbeatMs:\s*0\s*\}/);
    });

    it('still treats a deadline-expired timeout as terminal', () => {
        expect(watcherSrc).toMatch(/if\s*\(\s*TERMINAL_SESSION_STATUSES\.has\(session\.status\)\s*\)\s*\{[\s\S]*?terminal:\s*true/);
        expect(watcherSrc).toMatch(/if\s*\(\s*isDeadlineExpired\(session\.deadlineAt\)\s*\)\s*\{[\s\S]*?status:\s*'timeout'/);
    });

    it('appends a watcher-resumed-transient-timeout warning when promoting', () => {
        expect(watcherSrc).toContain('watcher-resumed-transient-timeout');
    });
});
