import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const recoverySrc = readFileSync(join(process.cwd(), 'web-ai/tab-recovery.mjs'), 'utf8');

describe('web-ai tab-recovery resolveSessionPage surface (source-string contract)', () => {
    it('exports resolveSessionPage with an allowNavigate option', () => {
        expect(recoverySrc).toContain('export async function resolveSessionPage');
        expect(recoverySrc).toMatch(/const allowNavigate = options\.allowNavigate !== false/);
    });

    it('returns a typed mismatch result when allowNavigate=false and stored target is invalid', () => {
        // Mismatch branch returns mismatch: true with page: null and warnings.
        expect(recoverySrc).toMatch(/mismatch:\s*true,\s*page:\s*null/);
        expect(recoverySrc).toContain('pass --navigate to recover');
    });

    it('prefers live provider conversation URL over stale provider root', () => {
        expect(recoverySrc).toContain('shouldPreferCurrentProviderUrl');
        expect(recoverySrc).toContain("savedPath === '/' && currentPath !== '/'");
    });

    it('reattach drift case emits a warning naming the live and stored URL', () => {
        expect(recoverySrc).toContain('does not match session conversationUrl');
        expect(recoverySrc).toContain('pass --navigate to switch tabs');
    });

    it('withSessionPage layers on top of resolveSessionPage with retry-on-page-death', () => {
        expect(recoverySrc).toMatch(/await resolveSessionPage\(deps, sessionId, \{ allowNavigate: true \}\)/);
        expect(recoverySrc).toMatch(/forceRecover:\s*true/);
        expect(recoverySrc).toContain('isPageDeathError');
    });
});
