import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

async function freshSession() {
    delete require.cache?.[require.resolve?.('../../web-ai/session.mjs')];
    const url = new URL('../../web-ai/session.mjs', import.meta.url).href + `?cache=${Date.now()}${Math.random()}`;
    return import(url);
}

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-session-baseline-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

describe('web-ai session baseline three-tier fallback', () => {
    it('saves and reads back a baseline by exact url', async () => {
        const { saveBaseline, getBaseline } = await freshSession();
        const envelope = { vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' };
        saveBaseline({ vendor: 'chatgpt', url: 'https://chatgpt.com/', envelope, assistantCount: 0, textHash: '0' });
        const fetched = getBaseline('chatgpt', 'https://chatgpt.com/');
        expect(fetched).toBeTruthy();
        expect(fetched.url).toBe('https://chatgpt.com/');
    });

    it('returns the latest same-host baseline before falling back to vendor-latest', async () => {
        const { saveBaseline, getLatestBaseline } = await freshSession();
        const envelope = { vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' };
        saveBaseline({ vendor: 'chatgpt', url: 'https://chatgpt.com/c/old', envelope, assistantCount: 0, textHash: '0' });
        await new Promise(r => setTimeout(r, 5));
        saveBaseline({ vendor: 'chatgpt', url: 'https://chatgpt.com/c/new', envelope, assistantCount: 0, textHash: '0' });
        await new Promise(r => setTimeout(r, 5));
        saveBaseline({ vendor: 'chatgpt', url: 'https://other-host.invalid/', envelope, assistantCount: 0, textHash: '0' });

        const sameHost = getLatestBaseline('chatgpt', { sameHostUrl: 'https://chatgpt.com/c/new' });
        expect(sameHost?.url).toBe('https://chatgpt.com/c/new');

        const sameHostOld = getLatestBaseline('chatgpt', { sameHostUrl: 'https://chatgpt.com/c/old' });
        expect(sameHostOld?.url).toBe('https://chatgpt.com/c/new');

        const anyHost = getLatestBaseline('chatgpt');
        expect(anyHost?.url).toBe('https://other-host.invalid/');
    });

    it('returns null when no baseline matches the requested vendor', async () => {
        const { getLatestBaseline } = await freshSession();
        expect(getLatestBaseline('chatgpt')).toBeNull();
        expect(getLatestBaseline('chatgpt', { sameHostUrl: 'https://chatgpt.com/' })).toBeNull();
    });

    it('falls through to vendor-latest when no baseline shares the host', async () => {
        const { saveBaseline, getLatestBaseline } = await freshSession();
        const envelope = { vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' };
        saveBaseline({ vendor: 'chatgpt', url: 'https://chatgpt.com/c/x', envelope, assistantCount: 0, textHash: '0' });
        const sameHost = getLatestBaseline('chatgpt', { sameHostUrl: 'https://other.invalid/' });
        expect(sameHost).toBeNull();
        const anyHost = getLatestBaseline('chatgpt');
        expect(anyHost?.url).toBe('https://chatgpt.com/c/x');
    });

    /**
     * Every other test here imports a cache-busted module per test, so each one
     * starts with an empty map. That hides the bug this covers: the map and its
     * loaded flag are module-global, so ONE module instance seeing two homes
     * answered reads from the wrong one and merged both homes' rows on save.
     */
    it('does not serve one home\'s baselines to another on the same module instance', async () => {
        const session = await freshSession();
        const envelope = { vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' };
        const homeB = mkdtempSync(join(tmpdir(), 'agbrowse-baseline-b-'));
        const homeC = mkdtempSync(join(tmpdir(), 'agbrowse-baseline-c-'));
        try {
            process.env.BROWSER_AGENT_HOME = homeB;
            session.saveBaseline({ vendor: 'chatgpt', url: 'https://chatgpt.com/c/home-b', envelope, assistantCount: 0, textHash: '0' });

            process.env.BROWSER_AGENT_HOME = homeC;
            // Home C has no baselines. A shared map would hand back home B's.
            expect(session.getLatestBaseline('chatgpt')).toBeNull();

            session.saveBaseline({ vendor: 'chatgpt', url: 'https://chatgpt.com/c/home-c', envelope, assistantCount: 0, textHash: '0' });
            const rowsInC = JSON.parse(readFileSync(join(homeC, 'web-ai-baselines.json'), 'utf8')).baselines;
            expect(rowsInC.map((/** @type {any} */ row) => row.url)).toEqual(['https://chatgpt.com/c/home-c']);

            // Going back must reload B rather than keep C's rows.
            process.env.BROWSER_AGENT_HOME = homeB;
            expect(session.getLatestBaseline('chatgpt')?.url).toBe('https://chatgpt.com/c/home-b');
        } finally {
            rmSync(homeB, { recursive: true, force: true });
            rmSync(homeC, { recursive: true, force: true });
        }
    });
});
