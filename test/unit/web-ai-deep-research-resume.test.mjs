import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-dr-resume-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
    vi.resetModules();
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
});

const REAL_REPORT = [
    '# Findings: Renewable Energy 2026',
    '',
    'Solar capacity additions outpaced every prior year. The detailed breakdown',
    'below cites primary grid-operator filings and manufacturer disclosures with',
    'enough length to read as a completed long-form research report.',
].join('\n');

const drResumePage = ({ assistant, stopUnreadable = false }) => ({
    waitForTimeout: async () => undefined,
    // Selector-aware: returning assistant turns for the stop-button selector too
    // handed the probe nodes with no `isVisible`, which now reads as unreadable
    // rather than as "not streaming".
    locator: (selector = '') => (/stop|Stop/.test(selector)
        ? (stopUnreadable
            ? { all: async () => { throw new Error('detached'); } }
            : { first: () => ({ isVisible: async () => false }), all: async () => [] })
        : {
            first: () => ({ isVisible: async () => false }),
            all: async () => (assistant ? [{ innerText: async () => assistant }] : []),
        }),
    evaluate: async () => [],
    frames: () => [],
    url: () => 'https://chatgpt.com/c/resumed',
});

describe('resumeDeepResearch (35.2)', () => {
    it('collects a completed report without sending a new prompt', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { resumeDeepResearch } = await import('../../web-ai/chatgpt-deep-research.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        const r = await resumeDeepResearch(drResumePage({ assistant: REAL_REPORT }), {}, { session, stableMs: 0, timeoutMs: 5_000 });
        expect(r.status).toBe('complete');
        expect(r.ok).toBe(true);
        expect(r.reportText).toContain('Renewable Energy');
        expect(r.warnings).toContain('deep-research-resumed');
    });

    it('times out without persisting an incomplete (planning/progress) report', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { resumeDeepResearch } = await import('../../web-ai/chatgpt-deep-research.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        const r = await resumeDeepResearch(drResumePage({ assistant: 'Researching the web...' }), {}, { session, stableMs: 0, timeoutMs: 40 });
        expect(r.status).toBe('timeout');
        expect(r.reportText).toBeNull();
        expect(r.warnings).toContain('deep-research-resume-timeout');
    });
});

describe('sessions resume DR routing (source contract)', () => {
    const src = readFileSync(join(process.cwd(), 'web-ai/cli-sessions.mjs'), 'utf8');
    it('routes researchMode:deep sessions to resumeDeepResearch', () => {
        expect(src).toContain("session.researchMode === 'deep'");
        expect(src).toContain('resumeDeepResearch(page, sessionDeps');
    });
});

/**
 * Consumer policy for an unreadable stop probe (issue #88, boundary B04).
 *
 * The producer tests prove the verdict; this proves the caller acts on it. A
 * shared probe returning `unknown` is worthless if the consumer still reads it
 * as "not generating" — which is what this path did before.
 */
describe('deep research resume acts on an unreadable stop probe (B04)', () => {
    it('Y10c: an unreadable probe does not settle as a finished report', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { resumeDeepResearch } = await import('../../web-ai/chatgpt-deep-research.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
        const page = drResumePage({ assistant: REAL_REPORT, stopUnreadable: true });

        const result = await resumeDeepResearch(page, {}, { session, timeoutMs: 400, stableMs: 10 });

        // Same page, same report text — only the probe verdict differs from the
        // completing case above.
        expect(result.status).not.toBe('complete');
    });
});
