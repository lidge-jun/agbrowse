import { describe, expect, it } from 'vitest';
import { execBrowser } from '../helpers/exec-browser.mjs';

describe.sequential('search CLI', () => {
    it('--help exits 0 and prints command reference', async () => {
        const result = await execBrowser(['search', '--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('agbrowse search');
        expect(result.stdout).toContain('--json');
        expect(result.stdout).toContain('--deep');
        expect(result.stdout).toContain('--verify');
        expect(result.stdout).toContain('--stdin-results');
    });

    it('search with --browser never produces structured JSON (no network)', async () => {
        const result = await execBrowser([
            'search',
            'Next.js 15 app router server components migration',
            '--json',
            '--browser', 'never',
            '--max-results', '1',
        ]);
        expect(result.code).toBe(0);
        const body = JSON.parse(result.stdout);
        expect(body.schemaVersion).toBe('agbrowse-search-v1');
        expect(body.query).toBe('Next.js 15 app router server components migration');
        expect(body.plan).toBeDefined();
        expect(body.plan.atomicQueries.length).toBeGreaterThan(0);
        expect(body.enrichment).toBeDefined();
        expect(body.enrichment.candidates).toBeDefined();
        expect(body.evidenceStatus).toBeDefined();
        expect(['sufficient', 'partial', 'browse-needed', 'insufficient']).toContain(body.evidenceStatus);
    });

    it('search Korean query produces plan with constraints and source hints', async () => {
        const result = await execBrowser([
            'search',
            '2026년 서울시 청년 지원금 공고 최신',
            '--json',
            '--browser', 'never',
            '--max-results', '1',
        ]);
        expect(result.code).toBe(0);
        const body = JSON.parse(result.stdout);
        expect(body.plan.sourceHints).toEqual(expect.arrayContaining(['official', 'date']));
        expect(body.plan.constraints.length).toBeGreaterThan(0);
        expect(body.plan.atomicQueries.length).toBeGreaterThanOrEqual(1);
        expect(body.plan.atomicQueries.length).toBeLessThanOrEqual(3);
    });

    it('--verify with --browser never returns structured verify envelope', async () => {
        const result = await execBrowser([
            'search',
            '--verify', 'https://example.com',
            '--json',
            '--browser', 'never',
        ]);
        expect(result.code).toBe(0);
        const body = JSON.parse(result.stdout);
        expect(body.schemaVersion).toBe('agbrowse-search-verify-v1');
        expect(body.url).toBe('https://example.com');
        expect(body).toHaveProperty('verdict');
        expect(body).toHaveProperty('ok');
        expect(body).toHaveProperty('source');
        expect(body).toHaveProperty('textExcerpt');
    });

    it('--stdin-results processes piped JSON candidates', async () => {
        const { execFileSync } = await import('node:child_process');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const projectRoot = join(__dirname, '..', '..');
        const script = join(projectRoot, 'skills', 'browser', 'browser.mjs');

        const stdinData = JSON.stringify([
            { url: 'https://httpbin.org/html', title: 'HTTPBin HTML', snippet: 'Test page' },
        ]);
        const stdout = execFileSync('node', [
            script, 'search', 'httpbin test page',
            '--stdin-results', '--json', '--browser', 'never', '--max-results', '1',
        ], {
            cwd: projectRoot,
            input: stdinData,
            timeout: 45000,
            env: { ...process.env, AGBROWSE_UPDATE_CHECK: '0' },
        }).toString().trim();

        const body = JSON.parse(stdout);
        expect(body.schemaVersion).toBe('agbrowse-search-v1');
        expect(body.enrichment.candidates.length).toBeGreaterThan(0);
        expect(body.enrichment.candidates[0].url).toBe('https://httpbin.org/html');
    });

    it('exits with error when no query and no --verify', async () => {
        const result = await execBrowser(['search', '--json', '--browser', 'never']);
        expect(result.code).not.toBe(0);
    });

    it('human-readable output contains evidence status heading', async () => {
        const result = await execBrowser([
            'search',
            'vitest testing framework',
            '--browser', 'never',
            '--max-results', '1',
        ]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Evidence:');
        expect(result.stdout).toContain('# Search:');
    });
});
