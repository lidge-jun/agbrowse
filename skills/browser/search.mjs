// @ts-check

/**
 * agbrowse search — Standalone search orchestrator.
 *
 * Pipeline: query rewrite → (stdin results OR endpoint discovery) → adaptive-fetch
 * enrichment → evidence scoring → optional web-ai deep escalation → output.
 *
 * Usage:
 *   agbrowse search "<query>" [options]
 *   agbrowse search --verify <url> [options]
 *   echo '<json>' | agbrowse search "<query>" --stdin-results [options]
 *
 * Options:
 *   --json              Machine-readable JSON output
 *   --deep              Escalate to web-ai if evidence is insufficient
 *   --verify <url>      Skip query; fetch + score a single URL
 *   --stdin-results     Read normalized search results from stdin (pipe from any provider)
 *   --browser <mode>    auto | never | required (default: auto)
 *   --max-results <n>   Max URLs to fetch-enrich (default: 5)
 *   --vendor <name>     Web-ai vendor for --deep (chatgpt | gemini | grok, default: grok)
 */

import { parseArgs } from 'node:util';
import { planKoreanResearch } from './search-research/search-strategy.mjs';
import { normalizeSearchResults } from './search-research/normalizer.mjs';
import { enrichSearchResultsWithFetch } from './search-research/fetch-enrichment.mjs';
import { planBrowseEscalation } from './search-research/browse-escalation.mjs';
import { runAdaptiveFetch } from './adaptive-fetch/index.mjs';

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_BROWSER_MODE = 'auto';
const DEFAULT_VENDOR = 'grok';

/**
 * @param {string[]} argv
 * @param {{ runAdaptiveFetch?: typeof runAdaptiveFetch, runWebAiQuery?: Function }} [deps]
 */
export async function runSearchCli(argv = [], deps = {}) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            json: { type: 'boolean', default: false },
            deep: { type: 'boolean', default: false },
            verify: { type: 'string' },
            'stdin-results': { type: 'boolean', default: false },
            browser: { type: 'string', default: DEFAULT_BROWSER_MODE },
            'max-results': { type: 'string', default: String(DEFAULT_MAX_RESULTS) },
            vendor: { type: 'string', default: DEFAULT_VENDOR },
            help: { type: 'boolean', default: false },
        },
        allowPositionals: true,
        strict: false,
    });

    if (values.help) {
        return printHelp();
    }

    if (values.verify) {
        return runVerifyMode(values.verify, {
            json: values.json,
            browser: normalizeBrowserMode(values.browser),
            fetchRunner: deps.runAdaptiveFetch || runAdaptiveFetch,
        });
    }

    const query = positionals.join(' ').trim();
    if (!query) {
        console.error('Error: query is required. Usage: agbrowse search "<query>"');
        process.exit(1);
    }

    const plan = planKoreanResearch(query);
    const maxResults = Math.max(1, parseInt(values['max-results'], 10) || DEFAULT_MAX_RESULTS);
    const browserMode = normalizeBrowserMode(values.browser);

    let normalizedResults;
    if (values['stdin-results']) {
        normalizedResults = await readStdinResults(query);
    } else {
        normalizedResults = buildInternalCandidates(plan);
    }

    const enrichment = await enrichSearchResultsWithFetch(plan, normalizedResults, {
        maxResults,
        browser: browserMode,
        trace: false,
    }, { runAdaptiveFetch: deps.runAdaptiveFetch || runAdaptiveFetch });

    const escalation = planBrowseEscalation(plan, enrichment);

    let deepResult = null;
    if (values.deep && !enrichment.summary?.ready) {
        deepResult = await runDeepEscalation(plan, enrichment, {
            vendor: values.vendor || DEFAULT_VENDOR,
            runWebAiQuery: deps.runWebAiQuery,
        });
    }

    const output = buildOutput(plan, enrichment, escalation, deepResult, query);

    if (values.json) {
        console.log(JSON.stringify(output, null, 2));
    } else {
        console.log(formatHumanOutput(output));
    }
}

/**
 * @param {string} url
 * @param {{ json: boolean, browser: string, fetchRunner: Function }} options
 */
async function runVerifyMode(url, options) {
    const result = await options.fetchRunner({
        url,
        json: true,
        trace: false,
        browser: options.browser,
    });

    const output = {
        schemaVersion: 'agbrowse-search-verify-v1',
        url,
        finalUrl: result.finalUrl || url,
        verdict: result.verdict || 'unknown',
        ok: Boolean(result.ok),
        source: result.source || 'unknown',
        title: result.title || null,
        textExcerpt: excerpt(result.content || '', 1200),
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
        chromeUsed: Boolean(result.chromeUsed),
    };

    if (options.json) {
        console.log(JSON.stringify(output, null, 2));
    } else {
        console.log(formatVerifyOutput(output));
    }
}

/**
 * @param {string} query
 */
async function readStdinResults(query) {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
        return normalizeSearchResults([], { query });
    }
    try {
        const parsed = JSON.parse(raw);
        return normalizeSearchResults(parsed, { query });
    } catch {
        console.error('Warning: could not parse stdin JSON, treating as empty results');
        return normalizeSearchResults([], { query });
    }
}

/**
 * @param {ReturnType<typeof planKoreanResearch>} plan
 */
function buildInternalCandidates(plan) {
    const results = (plan.atomicQueries || []).map((aq, index) => ({
        url: buildSearchUrl(aq.query || ''),
        title: aq.query || '',
        snippet: `Atomic query ${index + 1}: ${aq.query}`,
        rank: index + 1,
    }));
    return normalizeSearchResults(results, { query: plan.problem, backend: 'agbrowse-internal' });
}

/**
 * @param {string} query
 */
function buildSearchUrl(query) {
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * @param {ReturnType<typeof planKoreanResearch>} plan
 * @param {any} enrichment
 * @param {{ vendor: string, runWebAiQuery?: Function }} options
 */
async function runDeepEscalation(plan, enrichment, options) {
    const pendingConstraints = (enrichment.summary?.pending || [])
        .map(id => plan.constraints?.find(c => c.id === id))
        .filter(Boolean)
        .map(c => c.text);

    const prompt = buildDeepPrompt(plan.problem, pendingConstraints, enrichment);

    if (options.runWebAiQuery) {
        return options.runWebAiQuery({ prompt, vendor: options.vendor });
    }

    try {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        const agbrowseBin = process.argv[1] || 'agbrowse';
        const result = await execFileAsync('node', [
            agbrowseBin, 'web-ai', 'query',
            '--vendor', options.vendor,
            '--inline-only',
            '--prompt', prompt,
        ], { timeout: 300_000 });
        return { text: result.stdout.trim(), vendor: options.vendor, source: 'web-ai' };
    } catch (err) {
        return { text: null, error: err.message, vendor: options.vendor, source: 'web-ai' };
    }
}

/**
 * @param {string} problem
 * @param {string[]} pendingConstraints
 * @param {any} enrichment
 */
function buildDeepPrompt(problem, pendingConstraints, enrichment) {
    const context = (enrichment.candidates || [])
        .filter(c => c.fetch?.ok)
        .map(c => `- [${c.title || c.url}](${c.url}): ${c.fetch?.textExcerpt?.slice(0, 200) || '(no text)'}`)
        .join('\n');

    return [
        `## Research Question`,
        problem,
        '',
        `## Already Confirmed`,
        context || '(no confirmed evidence yet)',
        '',
        `## Still Unresolved`,
        ...pendingConstraints.map((c, i) => `${i + 1}. ${c}`),
        '',
        `## Instructions`,
        `Find authoritative evidence for the unresolved points above.`,
        `Cite primary sources with URLs. Distinguish confirmed facts from inference.`,
    ].join('\n');
}

/**
 * @param {ReturnType<typeof planKoreanResearch>} plan
 * @param {any} enrichment
 * @param {any} escalation
 * @param {any} deepResult
 * @param {string} query
 */
function buildOutput(plan, enrichment, escalation, deepResult, query) {
    const evidenceStatus = enrichment.summary?.ready
        ? 'sufficient'
        : deepResult?.text
            ? 'partial'
            : escalation.needsBrowse
                ? 'browse-needed'
                : 'insufficient';

    return {
        schemaVersion: 'agbrowse-search-v1',
        query,
        plan: {
            problem: plan.problem,
            atomicQueries: plan.atomicQueries,
            sourceHints: plan.sourceHints,
            constraints: plan.constraints,
        },
        enrichment: {
            candidates: (enrichment.candidates || []).map(c => ({
                rank: c.rank,
                url: c.url,
                title: c.title,
                verdict: c.fetch?.verdict || 'unknown',
                ok: Boolean(c.fetch?.ok),
                source: c.fetch?.source || 'unknown',
                textExcerpt: c.fetch?.textExcerpt || null,
            })),
            ledger: enrichment.summary || null,
        },
        escalation: escalation.needsBrowse ? {
            needed: true,
            actions: escalation.actions?.slice(0, 3) || [],
        } : { needed: false },
        deep: deepResult ? {
            vendor: deepResult.vendor,
            text: deepResult.text,
            error: deepResult.error || null,
        } : null,
        evidenceStatus,
    };
}

/**
 * @param {any} output
 */
function formatHumanOutput(output) {
    const lines = [];
    lines.push(`# Search: ${output.query}`);
    lines.push(`Evidence: ${output.evidenceStatus}`);
    lines.push('');

    if (output.plan?.atomicQueries?.length) {
        lines.push('## Queries');
        for (const aq of output.plan.atomicQueries) {
            lines.push(`  - ${aq.query}`);
        }
        lines.push('');
    }

    if (output.enrichment?.candidates?.length) {
        lines.push('## Results');
        for (const c of output.enrichment.candidates) {
            const icon = c.ok ? '✓' : '✗';
            lines.push(`  ${icon} [${c.verdict}] ${c.title || c.url}`);
            if (c.textExcerpt) {
                lines.push(`    ${c.textExcerpt.slice(0, 120)}...`);
            }
        }
        lines.push('');
    }

    if (output.escalation?.needed) {
        lines.push('## Browse Escalation Needed');
        for (const action of output.escalation.actions || []) {
            lines.push(`  → ${action.url} (${action.reasons?.join(', ')})`);
        }
        lines.push('');
    }

    if (output.deep?.text) {
        lines.push('## Deep Research');
        lines.push(output.deep.text);
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * @param {any} output
 */
function formatVerifyOutput(output) {
    const lines = [];
    const icon = output.ok ? '✓' : '✗';
    lines.push(`${icon} ${output.verdict} — ${output.url}`);
    if (output.finalUrl !== output.url) {
        lines.push(`  → redirected to: ${output.finalUrl}`);
    }
    if (output.title) lines.push(`  Title: ${output.title}`);
    if (output.source) lines.push(`  Source: ${output.source}`);
    if (output.chromeUsed) lines.push(`  Chrome: used`);
    if (output.warnings?.length) {
        lines.push(`  Warnings: ${output.warnings.join(', ')}`);
    }
    if (output.textExcerpt) {
        lines.push(`  Content: ${output.textExcerpt.slice(0, 200)}...`);
    }
    return lines.join('\n');
}

function printHelp() {
    console.log(`agbrowse search — Standalone deep search for any CLI agent

Usage:
  agbrowse search "<query>" [options]
  agbrowse search --verify <url> [options]
  echo '<json>' | agbrowse search "<query>" --stdin-results [options]

Options:
  --json              Machine-readable JSON output
  --deep              Escalate to web-ai if evidence is insufficient
  --verify <url>      Skip query; fetch + score a single URL
  --stdin-results     Read search results from stdin (JSON array or object)
  --browser <mode>    auto | never | required (default: auto)
  --max-results <n>   Max URLs to fetch-enrich (default: 5)
  --vendor <name>     Web-ai vendor for --deep (chatgpt | gemini | grok)
  --help              Show this help

Examples:
  agbrowse search "Next.js 15 app router migration guide"
  agbrowse search "서울시 2026 청년 지원금 공고" --deep --json
  agbrowse search --verify "https://nextjs.org/docs/app/building-your-application"
  curl -s api/search | agbrowse search "topic" --stdin-results --json

Integration:
  Any CLI agent can pipe its built-in web search results into agbrowse:
    1. Agent runs its native web search → gets URL candidates
    2. Pipe as JSON into: agbrowse search "<query>" --stdin-results
    3. agbrowse fetches original pages, scores evidence, returns verdict
`);
}

/**
 * @param {string} value
 */
function normalizeBrowserMode(value) {
    if (['auto', 'never', 'required'].includes(value)) return value;
    return DEFAULT_BROWSER_MODE;
}

/**
 * @param {string} text
 * @param {number} [max]
 */
function excerpt(text, max = 800) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max)}...` : value;
}
