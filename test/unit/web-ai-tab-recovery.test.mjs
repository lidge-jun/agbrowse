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
        expect(recoverySrc).toMatch(/await resolveSessionPage\(deps, sessionId, \{ allowNavigate: true, stillActive \}\)/);
        expect(recoverySrc).toMatch(/forceRecover:\s*true/);
        expect(recoverySrc).toContain('isPageDeathError');
    });
});

// --- Work-session recovery guard tests (round-2 fix) ---

import {
    isBareOriginUrl,
    isWorkTabUrlConsistent,
    isWorkSessionWithBareOrigin,
    isSafeChatGptConversationUrl,
    urlsCompatible,
    isCdpDisconnectError,
} from '../../web-ai/tab-recovery.mjs';

describe('isCdpDisconnectError', () => {
    it.each([
        new Error('Browser disconnected while reading response'),
        new Error('Connection closed while reading from transport'),
        new Error('CDP session detached'),
        new Error('Protocol error: session closed'),
        new Error('WebSocket is not open: readyState 3'),
        Object.assign(new Error('watch failed'), { cause: new Error('connection to the browser was lost') }),
    ])('matches recoverable CDP transport fixture %#', (error) => {
        expect(isCdpDisconnectError(error)).toBe(true);
    });

    it.each([
        new Error('Target closed'),
        new Error('Page closed'),
        new Error('Browser has been closed'),
        new Error('Page crashed'),
        new Error('Protocol error: Target closed'),
    ])('excludes page, target, and browser death fixture %#', (error) => {
        expect(isCdpDisconnectError(error)).toBe(false);
    });
});

describe('reattachSessionPage target-preserving contract', () => {
    it('resolves only the persisted target and contains no replacement or navigation path', () => {
        const body = recoverySrc.match(/export async function reattachSessionPage[\s\S]*?\n\}/)?.[0] || '';
        expect(body).toContain('getPageByTargetId(deps.getPort(), session.targetId)');
        expect(body).not.toContain('createTab');
        expect(body).not.toContain('.goto(');
        expect(body).not.toContain('updateSession');
    });
});

describe('isBareOriginUrl', () => {
    it('returns true for "https://chatgpt.com/"', () => {
        expect(isBareOriginUrl('https://chatgpt.com/')).toBe(true);
    });

    it('returns true for "https://chatgpt.com" (no trailing slash)', () => {
        expect(isBareOriginUrl('https://chatgpt.com')).toBe(true);
    });

    it('returns false for /c/<uuid> URL', () => {
        expect(isBareOriginUrl('https://chatgpt.com/c/abc-123')).toBe(false);
    });

    it('returns false for null', () => {
        expect(isBareOriginUrl(null)).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isBareOriginUrl('')).toBe(false);
    });
});

describe('isWorkTabUrlConsistent', () => {
    it('returns true when tab URL matches session taskUrl', () => {
        const session = {
            responseContract: 'work',
            conversationUrl: 'https://chatgpt.com/c/a0b1c2d3-e4f5-6789-abcd-ef0123456789',
            envelopeSummary: { taskUrl: 'https://chatgpt.com/c/a0b1c2d3-e4f5-6789-abcd-ef0123456789' },
        };
        expect(isWorkTabUrlConsistent(session, 'https://chatgpt.com/c/a0b1c2d3-e4f5-6789-abcd-ef0123456789')).toBe(true);
    });

    it('returns false when tab shows bare origin (home page)', () => {
        const session = {
            responseContract: 'work',
            conversationUrl: 'https://chatgpt.com/c/a0b1c2d3-e4f5-6789-abcd-ef0123456789',
            envelopeSummary: { taskUrl: 'https://chatgpt.com/c/a0b1c2d3-e4f5-6789-abcd-ef0123456789' },
        };
        expect(isWorkTabUrlConsistent(session, 'https://chatgpt.com/')).toBe(false);
    });

    it('returns false when tab shows a different /c/<uuid>', () => {
        const session = {
            responseContract: 'work',
            conversationUrl: 'https://chatgpt.com/c/a0b1c2d3-e4f5-6789-abcd-ef0123456789',
            envelopeSummary: { taskUrl: 'https://chatgpt.com/c/a0b1c2d3-e4f5-6789-abcd-ef0123456789' },
        };
        expect(isWorkTabUrlConsistent(session, 'https://chatgpt.com/c/ff000000-0000-0000-0000-000000000456')).toBe(false);
    });

    it('returns false for null tab URL', () => {
        const session = { responseContract: 'work', conversationUrl: 'https://chatgpt.com/c/aabbccdd-eeff-0011-2233-445566778899' };
        expect(isWorkTabUrlConsistent(session, null)).toBe(false);
    });

    it('accepts any /c/<uuid> when session has no specific taskUrl', () => {
        const session = {
            responseContract: 'work',
            conversationUrl: null,
            envelopeSummary: {},
        };
        expect(isWorkTabUrlConsistent(session, 'https://chatgpt.com/c/deadbeef-cafe-babe-face-d00d00000000')).toBe(true);
    });

    it('rejects bare origin when session has no taskUrl', () => {
        const session = {
            responseContract: 'work',
            conversationUrl: null,
            envelopeSummary: {},
        };
        expect(isWorkTabUrlConsistent(session, 'https://chatgpt.com/')).toBe(false);
    });
});

describe('isWorkSessionWithBareOrigin', () => {
    it('returns true for work session with bare-origin conversationUrl', () => {
        expect(isWorkSessionWithBareOrigin({
            responseContract: 'work',
            conversationUrl: 'https://chatgpt.com/',
        })).toBe(true);
    });

    it('returns false for work session with /c/<uuid> conversationUrl', () => {
        expect(isWorkSessionWithBareOrigin({
            responseContract: 'work',
            conversationUrl: 'https://chatgpt.com/c/abc-123',
        })).toBe(false);
    });

    it('returns false for chat sessions even with bare origin', () => {
        expect(isWorkSessionWithBareOrigin({
            responseContract: 'chat',
            conversationUrl: 'https://chatgpt.com/',
        })).toBe(false);
    });

    it('returns false for null session', () => {
        expect(isWorkSessionWithBareOrigin(null)).toBe(false);
    });

    it('rejects the Work post-gate recovery shape using originalUrl as the effective target', () => {
        expect(isWorkSessionWithBareOrigin({
            responseContract: 'work',
            conversationUrl: null,
            originalUrl: 'https://chatgpt.com/',
        })).toBe(true);
    });
});

// Source-string contract tests for recovery guards

describe('tab-recovery work-session guards (source-string contract)', () => {
    it('recoverSessionTab checks isRunningWork before accepting existing tab', () => {
        expect(recoverySrc).toContain('isRunningWork && !isWorkTabUrlConsistent');
    });

    it('recoverSessionTab rejects bare-origin work session before recovery', () => {
        expect(recoverySrc).toContain('isRunningWork && isWorkSessionWithBareOrigin');
    });

    it('resolveSessionPage rejects bare-origin work session before navigation', () => {
        expect(recoverySrc).toContain('_isWorkSession(current) && current.status !== \'complete\' && isWorkSessionWithBareOrigin');
    });

    it('resolveSessionPage returns mismatch with work-reattach-unverified for bare-origin work sessions', () => {
        expect(recoverySrc).toContain('provider.work-reattach-unverified');
    });

    it('completed work sessions are not blocked by bare-origin guard in resolveSessionPage', () => {
        // The guard checks current.status !== 'complete', so completed tasks pass through
        expect(recoverySrc).toContain("current.status !== 'complete'");
    });
});
