import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execBrowser } from '../helpers/exec-browser.mjs';

describe.sequential('research CLI', () => {
    it('plans Korean research without requiring Chrome or network access', async () => {
        const result = await execBrowser([
            'research',
            'plan',
            '--query',
            '2026년 한국 전기차 보조금 지자체별 차이 최신 기준 찾아봐',
            '--json',
        ]);
        expect(result.code).toBe(0);
        const body = JSON.parse(result.stdout);
        expect(body.schemaVersion).toBe('research-plan-v1');
        expect(body.sourceHints).toEqual(expect.arrayContaining(['official', 'date']));
        expect(body.constraints.length).toBeGreaterThan(0);
        expect(body.atomicQueries.length).toBeGreaterThan(0);
        expect(body.atomicQueries.length).toBeLessThanOrEqual(3);
        expect(body.atomicQueries[0].url).toContain('https://');
        expect(body.followUp.fetchOriginalPages).toBe(true);
    });

    it('normalizes provider search rows into URL candidates from a local JSON file', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'agbrowse-research-cli-'));
        const file = join(dir, 'results.json');
        try {
            writeFileSync(file, JSON.stringify({
                query: '네이버 블로그 원문',
                results: [
                    { link: 'https://blog.naver.com/example/1#comment', title: 'Naver Post', snippet: '후보' },
                    { url: 'https://blog.naver.com/example/1', title: 'Duplicate' },
                    { title: 'Missing URL' },
                ],
            }));
            const result = await execBrowser([
                'research',
                'normalize-results',
                '--backend',
                'tavily',
                '--file',
                file,
                '--json',
            ]);
            expect(result.code).toBe(0);
            const body = JSON.parse(result.stdout);
            expect(body.schemaVersion).toBe('search-results-v1');
            expect(body.backend).toBe('tavily');
            expect(body.query).toBe('네이버 블로그 원문');
            expect(body.results).toHaveLength(1);
            expect(body.results[0].url).toBe('https://blog.naver.com/example/1');
            expect(body.dropped.map(row => row.reason)).toEqual([
                'duplicate-url',
                'missing-or-invalid-url',
            ]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('awaits fetch enrichment CLI output without requiring Chrome or network when max-results is zero', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'agbrowse-research-enrich-cli-'));
        const planFile = join(dir, 'plan.json');
        const resultsFile = join(dir, 'results.json');
        try {
            const planResult = await execBrowser([
                'research',
                'plan',
                '--query',
                '고려대학교출판문화원 2024년 12월 27일 540쪽 MOOC 목차',
                '--json',
            ]);
            writeFileSync(planFile, planResult.stdout);
            writeFileSync(resultsFile, JSON.stringify({
                schemaVersion: 'search-results-v1',
                backend: 'fixture',
                query: JSON.parse(planResult.stdout).atomicQueries[0].query,
                results: [
                    { url: 'https://example.com/book', title: 'Book', snippet: 'candidate' },
                ],
                dropped: [],
                resultRole: 'url-candidates',
                evidencePolicy: 'snippets-are-not-final-evidence',
            }));
            const result = await execBrowser([
                'research',
                'enrich-fetch',
                '--plan',
                planFile,
                '--results',
                resultsFile,
                '--max-results',
                '0',
                '--json',
            ]);
            expect(result.code).toBe(0);
            const body = JSON.parse(result.stdout);
            expect(body.schemaVersion).toBe('research-fetch-enrichment-v1');
            expect(body.fetchPolicy.maxResults).toBe(0);
            expect(body.candidates).toEqual([]);
            expect(body.summary.status).toBe('insufficient-evidence');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('plans browse escalation commands from local enrichment JSON without Chrome or network', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'agbrowse-research-browse-plan-cli-'));
        const planFile = join(dir, 'plan.json');
        const enrichmentFile = join(dir, 'enrichment.json');
        try {
            const planResult = await execBrowser([
                'research',
                'plan',
                '--query',
                '네이버 블로그 후기 원문에서 표 항목을 확인해',
                '--json',
            ]);
            writeFileSync(planFile, planResult.stdout);
            writeFileSync(enrichmentFile, JSON.stringify({
                schemaVersion: 'research-fetch-enrichment-v1',
                planSchemaVersion: 'research-plan-v1',
                resultSchemaVersion: 'search-results-v1',
                query: '네이버 블로그 후기',
                candidates: [{
                    rank: 1,
                    url: 'https://blog.naver.com/example/1',
                    title: 'Naver Blog',
                    snippet: 'candidate only',
                    discoveryConstraintIds: ['c1'],
                    constraintIds: [],
                    fetch: {
                        ok: true,
                        verdict: 'weak_ok',
                        source: 'fetch',
                        finalUrl: 'https://blog.naver.com/example/1',
                        title: null,
                        textExcerpt: '',
                        warnings: [],
                        evidence: [],
                        chromeRequired: false,
                        chromeUsed: false,
                    },
                }],
                summary: {
                    ready: false,
                    supported: [],
                    pending: ['c1'],
                    status: 'insufficient-evidence',
                },
                nextStep: {
                    type: 'browse-candidates',
                    reason: 'fetch-insufficient-or-constraints-pending',
                },
            }));
            const result = await execBrowser([
                'research',
                'browse-plan',
                '--plan',
                planFile,
                '--enrichment',
                enrichmentFile,
                '--json',
            ]);
            expect(result.code).toBe(0);
            const body = JSON.parse(result.stdout);
            expect(body.schemaVersion).toBe('research-browse-escalation-v1');
            expect(body.needsBrowse).toBe(true);
            expect(body.summary.reasons).toContain('naver-shell-or-iframe-risk');
            expect(body.actions[0].commands[0]).toContain('agbrowse new-tab "https://blog.naver.com/example/1" --json');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails missing arguments before browser mutation', async () => {
        // Under --json these now emit the failure envelope on stdout rather
        // than plaintext usage on stderr. This test previously asserted the
        // plaintext form while passing --json, which is the contract violation
        // Q12 recorded; the usage text is still carried, as the envelope's
        // message.
        const cases = [
            [['research', 'plan', '--json'], 'research plan --query <problem>'],
            [['research', 'normalize-results', '--json'], 'research normalize-results --file <json>'],
            [['research', 'enrich-fetch', '--json'], 'research enrich-fetch --plan <json> --results <json>'],
            [['research', 'browse-plan', '--json'], 'research browse-plan --plan <json> --enrichment <json>'],
        ];
        for (const [argv, usage] of cases) {
            const result = await execBrowser(argv);
            expect(result.code).not.toBe(0);
            const envelope = JSON.parse(result.stdout);
            expect(envelope.ok).toBe(false);
            expect(envelope.error.errorCode).toBe('input.invalid-arguments');
            expect(envelope.error.message).toContain(usage);
        }
    });

    it('keeps plaintext usage when --json is absent', async () => {
        const result = await execBrowser(['research', 'plan']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('research plan --query <problem>');
    });
});
