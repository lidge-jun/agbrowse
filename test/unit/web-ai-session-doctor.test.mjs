import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-session-doctor-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

async function freshDoctor() {
    const url = new URL('../../web-ai/session-doctor.mjs', import.meta.url).href + `?cache=${Date.now()}${Math.random()}`;
    return import(url);
}

async function freshSession() {
    const url = new URL('../../web-ai/session.mjs', import.meta.url).href + `?cache=${Date.now()}${Math.random()}`;
    return import(url);
}

function makeStubDeps({ valid = false, port = 9222 } = {}) {
    return {
        getPort: () => port,
        // verifySessionTab consults isTabAlive via deps.getPort; here we
        // intercept the network call by making the report tolerate failures.
        // The actual deps surface used by verifySessionTab is the port number,
        // so we let it fail and assert on the doctor's caught-error envelope.
        __forceInvalid: valid === false,
    };
}

describe('web-ai session-doctor', () => {
    it('returns a missing-session-record envelope when sessionId is unknown', async () => {
        const { buildSessionDoctorReport } = await freshDoctor();
        const report = await buildSessionDoctorReport(makeStubDeps(), 'NOPE-NEVER-EXISTED');
        expect(report.ok).toBe(false);
        expect(report.status).toBe('session-doctor');
        expect(report.summary).toContain('missing session record');
        expect(report.recommendations).toEqual(['Run: agbrowse web-ai sessions list']);
    });

    it('sanitizes the session record and excludes prompt/answer text', async () => {
        const { buildSessionDoctorReport } = await freshDoctor();
        const { createSession, updateSession } = await freshSession();
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'SECRET-PROMPT-DO-NOT-LEAK', attachmentPolicy: 'inline-only' },
            { conversationUrl: 'https://chatgpt.com/c/abcd?token=SHHH#frag', originalUrl: 'https://chatgpt.com/' },
        );
        updateSession(session.sessionId, { answer: 'SECRET-ANSWER-DO-NOT-LEAK', status: 'complete' });

        const report = await buildSessionDoctorReport(makeStubDeps(), session.sessionId);
        expect(report.status).toBe('session-doctor');
        expect(report.sessionId).toBe(session.sessionId);
        expect(report.vendor).toBe('chatgpt');

        // Prompt and answer text must not appear in the report.
        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain('SECRET-PROMPT-DO-NOT-LEAK');
        expect(serialized).not.toContain('SECRET-ANSWER-DO-NOT-LEAK');

        // URLs are redacted to protocol+host+pathname (no query, no fragment).
        expect(report.session.conversationUrl).toBe('https://chatgpt.com/c/abcd');
        expect(report.session.conversationUrl).not.toContain('?');
        expect(report.session.conversationUrl).not.toContain('#');
        expect(report.session.originalUrl).toBe('https://chatgpt.com/');
    });

    it('recommends reattach --navigate when target is missing and navigate=true', async () => {
        const { buildSessionDoctorReport } = await freshDoctor();
        const { createSession } = await freshSession();
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            { conversationUrl: 'https://chatgpt.com/c/x', originalUrl: 'https://chatgpt.com/' },
        );
        // No real Chrome — verifySessionTab will report invalid/needsRecovery.
        const report = await buildSessionDoctorReport(makeStubDeps(), session.sessionId, { navigate: true });
        expect(report.ok).toBe(true);
        expect(report.target?.valid).toBe(false);
        const joined = report.recommendations.join('\n');
        expect(joined).toMatch(/sessions reattach .* --navigate/);
    });

    it('falls back to the poll --session recommendation when target is missing and navigate=false', async () => {
        const { buildSessionDoctorReport } = await freshDoctor();
        const { createSession } = await freshSession();
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            { conversationUrl: 'https://chatgpt.com/c/y', originalUrl: 'https://chatgpt.com/' },
        );
        const report = await buildSessionDoctorReport(makeStubDeps(), session.sessionId);
        expect(report.ok).toBe(true);
        const joined = report.recommendations.join('\n');
        expect(joined).toMatch(/sessions doctor .* --navigate|poll --session .* --navigate/);
    });

    it('sanitizeSession redacts query+fragment uniformly', async () => {
        const { sanitizeSession } = await freshDoctor();
        const out = sanitizeSession({
            sessionId: 'X',
            vendor: 'gemini',
            status: 'sent',
            originalUrl: 'https://gemini.google.com/app?foo=1#hash',
            conversationUrl: 'https://gemini.google.com/app/c/zzz?secret=1',
            updatedAt: '2026-01-01T00:00:00Z',
        });
        expect(out.originalUrl).toBe('https://gemini.google.com/app');
        expect(out.conversationUrl).toBe('https://gemini.google.com/app/c/zzz');
    });
});
