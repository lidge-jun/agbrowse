import { describe, expect, it, vi } from 'vitest';
import { runSearchCli } from '../../skills/browser/search.mjs';

const mockFetchResult = (overrides = {}) => ({
    ok: true,
    verdict: 'strong_ok',
    source: 'fetch',
    finalUrl: 'https://example.com/page',
    title: 'Example Page',
    content: 'This is the full page content for evidence testing. '.repeat(20),
    warnings: [],
    chromeUsed: false,
    chromeRequired: false,
    ...overrides,
});

const mockAdaptiveFetch = vi.fn(async () => mockFetchResult());

function captureOutput() {
    const lines = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => lines.push(args.join(' '));
    console.error = (...args) => lines.push(`[err] ${args.join(' ')}`);
    return {
        lines,
        restore() {
            console.log = origLog;
            console.error = origErr;
        },
        get text() { return lines.join('\n'); },
    };
}

describe('agbrowse search', () => {
    it('--help prints usage without error', async () => {
        const output = captureOutput();
        try {
            await runSearchCli(['--help'], { runAdaptiveFetch: mockAdaptiveFetch });
        } finally {
            output.restore();
        }
        expect(output.text).toContain('agbrowse search');
        expect(output.text).toContain('--json');
        expect(output.text).toContain('--deep');
    });

    it('--verify runs adaptive fetch on a single URL', async () => {
        const output = captureOutput();
        try {
            await runSearchCli(['--verify', 'https://example.com/test', '--json'], {
                runAdaptiveFetch: mockAdaptiveFetch,
            });
        } finally {
            output.restore();
        }
        expect(mockAdaptiveFetch).toHaveBeenCalledWith(
            expect.objectContaining({ url: 'https://example.com/test' }),
        );
        const result = JSON.parse(output.text);
        expect(result.schemaVersion).toBe('agbrowse-search-verify-v1');
        expect(result.verdict).toBe('strong_ok');
        expect(result.ok).toBe(true);
    });

    it('search query produces structured JSON output', async () => {
        const output = captureOutput();
        try {
            await runSearchCli(['Next.js app router guide', '--json', '--browser', 'never'], {
                runAdaptiveFetch: mockAdaptiveFetch,
            });
        } finally {
            output.restore();
        }
        const result = JSON.parse(output.text);
        expect(result.schemaVersion).toBe('agbrowse-search-v1');
        expect(result.query).toBe('Next.js app router guide');
        expect(result.plan).toBeDefined();
        expect(result.plan.atomicQueries).toBeDefined();
        expect(result.enrichment).toBeDefined();
        expect(result.evidenceStatus).toBeDefined();
    });

    it('--deep calls web-ai when evidence is insufficient', async () => {
        const weakFetch = vi.fn(async () => mockFetchResult({
            ok: false,
            verdict: 'blocked',
            content: '',
        }));
        const mockWebAi = vi.fn(async () => ({
            text: 'Deep research found the answer.',
            vendor: 'grok',
            source: 'web-ai',
        }));
        const output = captureOutput();
        try {
            await runSearchCli(
                ['test deep query', '--json', '--deep', '--browser', 'never'],
                { runAdaptiveFetch: weakFetch, runWebAiQuery: mockWebAi },
            );
        } finally {
            output.restore();
        }
        const result = JSON.parse(output.text);
        expect(mockWebAi).toHaveBeenCalled();
        expect(result.deep).not.toBeNull();
        expect(result.deep.text).toBe('Deep research found the answer.');
        expect(result.deep.vendor).toBe('grok');
    });

    it('--stdin-results processes piped JSON', async () => {
        const stdinData = JSON.stringify([
            { url: 'https://example.com/a', title: 'Result A', snippet: 'Snippet A' },
            { url: 'https://example.com/b', title: 'Result B', snippet: 'Snippet B' },
        ]);

        const origStdin = process.stdin;
        const mockStdin = {
            [Symbol.asyncIterator]() {
                let done = false;
                return {
                    next() {
                        if (done) return Promise.resolve({ value: undefined, done: true });
                        done = true;
                        return Promise.resolve({ value: Buffer.from(stdinData), done: false });
                    },
                };
            },
        };
        Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

        const output = captureOutput();
        try {
            await runSearchCli(
                ['test query', '--stdin-results', '--json', '--browser', 'never'],
                { runAdaptiveFetch: mockAdaptiveFetch },
            );
        } finally {
            output.restore();
            Object.defineProperty(process, 'stdin', { value: origStdin, writable: true });
        }
        const result = JSON.parse(output.text);
        expect(result.schemaVersion).toBe('agbrowse-search-v1');
        expect(result.enrichment.candidates.length).toBeGreaterThan(0);
    });

    it('human-readable output includes evidence status', async () => {
        const output = captureOutput();
        try {
            await runSearchCli(['readable test', '--browser', 'never'], {
                runAdaptiveFetch: mockAdaptiveFetch,
            });
        } finally {
            output.restore();
        }
        expect(output.text).toContain('Evidence:');
        expect(output.text).toContain('# Search: readable test');
    });
});
