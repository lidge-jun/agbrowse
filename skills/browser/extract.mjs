// @ts-check

/**
 * agbrowse extract — Schema-bound structured extraction (gapclose Phase 10).
 *
 * Tier 1 (LLM-free, default): raw HTML (fetchTextCandidate or --from-file)
 *   -> extractStructuredContent -> mapStructuredToSchema -> validateExtraction.
 *   Fail-closed: when no candidate structure satisfies the schema, returns an
 *   explicit envelope with verdict `no_mappable_structure` and a summary of the
 *   structures that were considered. Never silently returns partial data.
 *
 * Tier 2 (--escalate-web-ai, opt-in): on Tier 1 failure only, sends page text +
 *   schema to a logged-in web-ai vendor session and validates the response JSON
 *   with the SAME validator. Injectable via deps for tests.
 *
 * JS-rendered pages are a non-goal for Tier 1: the direct fetch keeps the raw
 * body, so client-rendered content that never appears in HTML is reported as
 * fail-closed rather than guessed.
 *
 * Usage:
 *   agbrowse extract <url> --schema <file.json> [options]
 *   agbrowse extract --from-file <page.html> --schema <file.json> [options]
 *
 * Options:
 *   --schema <file>        JSON schema file (extract-schema-v1 subset). Required.
 *   --from-file <file>     Read local HTML instead of fetching.
 *   --source <mode>        auto | table | jsonld (default: auto)
 *   --json                 Machine-readable JSON envelope
 *   --escalate-web-ai      Tier 2 web-ai fallback on Tier 1 failure
 *   --vendor <name>        Tier 2 vendor (chatgpt | gemini | grok | perplexity, default: grok)
 *   --timeout <ms>         Fetch timeout
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fetchTextCandidate } from './adaptive-fetch/fetcher.mjs';
import { extractStructuredContent } from './adaptive-fetch/structured-extractor.mjs';
import { assertSupportedSchema, validateExtraction, EXTRACT_SCHEMA_VERSION } from '../../web-ai/extract-schema.mjs';

export const EXTRACT_ENVELOPE_VERSION = 'agbrowse-extract-v1';

const SOURCE_MODES = new Set(['auto', 'table', 'jsonld']);

/**
 * @param {string[]} argv
 * @param {{ fetchTextCandidate?: typeof fetchTextCandidate, runWebAiQuery?: Function, exit?: (code: number) => void, log?: (line: string) => void, error?: (line: string) => void }} [deps]
 */
export async function runExtractCli(argv = [], deps = {}) {
    const log = deps.log || ((line) => console.log(line));
    const errorLog = deps.error || ((line) => console.error(line));
    const exit = deps.exit || ((code) => process.exit(code));

    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            schema: { type: 'string' },
            'from-file': { type: 'string' },
            source: { type: 'string', default: 'auto' },
            json: { type: 'boolean', default: false },
            'escalate-web-ai': { type: 'boolean', default: false },
            vendor: { type: 'string', default: 'grok' },
            timeout: { type: 'string' },
            help: { type: 'boolean', default: false },
        },
        allowPositionals: true,
        strict: false,
    });

    if (values.help) {
        log(usage());
        return;
    }

    const url = positionals[0] || null;
    const fromFile = typeof values['from-file'] === 'string' ? values['from-file'] : null;
    if (!values.schema) {
        errorLog('Error: --schema <file.json> is required.');
        errorLog(usage());
        return exit(1);
    }
    if (!url && !fromFile) {
        errorLog('Error: provide a <url> or --from-file <page.html>.');
        errorLog(usage());
        return exit(1);
    }
    const sourceMode = values.source === undefined ? 'auto' : String(values.source);
    if (!SOURCE_MODES.has(sourceMode)) {
        errorLog(`Error: invalid --source "${sourceMode}". Use auto | table | jsonld.`);
        errorLog(usage());
        return exit(1);
    }

    // Load and gate the schema first: unsupported constructs must fail before I/O.
    let schema;
    try {
        schema = JSON.parse(readFileSync(String(values.schema), 'utf8'));
        assertSupportedSchema(schema);
    } catch (error) {
        const err = /** @type {any} */ (error);
        return emit({
            ok: false,
            tier: 1,
            verdict: err.code === 'capability.unsupported' ? 'schema_unsupported' : 'schema_invalid',
            data: null,
            errors: [{ path: '$', code: err.code || 'schema.load-failed', detail: err.message }],
            candidatesConsidered: 0,
            source: 'schema',
            finalUrl: url || fromFile,
            evidence: [],
        }, values.json, { log, errorLog, exit });
    }

    // Acquire raw HTML.
    let html = '';
    let finalUrl = url || fromFile || '';
    let fetchEvidence = [];
    if (fromFile) {
        try {
            html = readFileSync(fromFile, 'utf8');
            fetchEvidence.push('local-file');
        } catch (error) {
            return emit({
                ok: false, tier: 1, verdict: 'input_unreadable', data: null,
                errors: [{ path: '$', code: 'input.unreadable', detail: /** @type {any} */ (error).message }],
                candidatesConsidered: 0, source: 'file', finalUrl: fromFile, evidence: [],
            }, values.json, { log, errorLog, exit });
        }
    } else {
        const fetcher = deps.fetchTextCandidate || fetchTextCandidate;
        let fetched;
        try {
            fetched = await fetcher(String(url), {
                timeoutMs: values.timeout ? Number(values.timeout) : undefined,
            });
        } catch (error) {
            return emit({
                ok: false, tier: 1, verdict: 'fetch_failed', data: null,
                errors: [{ path: '$', code: 'fetch.error', detail: /** @type {any} */ (error).message }],
                candidatesConsidered: 0, source: 'fetch', finalUrl: url, evidence: [],
            }, values.json, { log, errorLog, exit });
        }
        if (!fetched.ok || !fetched.text) {
            return emit({
                ok: false, tier: 1, verdict: 'fetch_blocked', data: null,
                errors: [{ path: '$', code: 'fetch.blocked', detail: `status ${fetched.status}${fetched.warnings?.length ? ` (${fetched.warnings.join(',')})` : ''}` }],
                candidatesConsidered: 0, source: 'fetch', finalUrl: fetched.finalUrl || url,
                evidence: fetched.evidence || [],
            }, values.json, { log, errorLog, exit });
        }
        html = fetched.text;
        finalUrl = fetched.finalUrl || String(url);
        fetchEvidence = fetched.evidence || [];
    }

    // Tier 1: structure extraction + schema mapping.
    const structured = extractStructuredContent(html);
    const mapping = mapStructuredToSchema(schema, structured, { sourceMode });

    if (mapping.ok) {
        return emit({
            ok: true, tier: 1, verdict: 'extracted', data: mapping.data,
            errors: [],
            candidatesConsidered: mapping.candidatesConsidered,
            source: mapping.source, finalUrl,
            evidence: [...fetchEvidence, `mapped:${mapping.source}`, EXTRACT_SCHEMA_VERSION],
        }, values.json, { log, errorLog, exit });
    }

    // Tier 2 (opt-in): web-ai escalation with the same validator.
    if (values['escalate-web-ai']) {
        const tier2 = await runTier2Escalation({
            schema, html, structured, vendor: String(values.vendor || 'grok'),
            runWebAiQuery: deps.runWebAiQuery,
        });
        return emit({
            ...tier2,
            candidatesConsidered: mapping.candidatesConsidered,
            finalUrl,
            evidence: [...fetchEvidence, ...(tier2.evidence || [])],
        }, values.json, { log, errorLog, exit });
    }

    // Fail-closed: explicit verdict plus a summary of what WAS on the page.
    return emit({
        ok: false, tier: 1, verdict: 'no_mappable_structure', data: null,
        errors: mapping.errors,
        candidatesConsidered: mapping.candidatesConsidered,
        source: mapping.source || 'none', finalUrl,
        structuresAvailable: summarizeStructures(structured),
        evidence: fetchEvidence,
    }, values.json, { log, errorLog, exit });
}

/**
 * Pure mapping: structured content -> schema-shaped data. Fail-closed.
 * Exported for unit tests.
 *
 * @param {any} schema  extract-schema-v1 subset (already asserted supported)
 * @param {ReturnType<typeof extractStructuredContent>} structured
 * @param {{ sourceMode?: string }} [options]
 * @returns {{ ok: true, data: unknown, source: string, candidatesConsidered: number } | { ok: false, errors: Array<{ path: string, code: string, detail: string }>, source: string|null, candidatesConsidered: number }}
 */
export function mapStructuredToSchema(schema, structured, options = {}) {
    const sourceMode = options.sourceMode || 'auto';
    /** @type {Array<{ path: string, code: string, detail: string }>} */
    const failures = [];
    let candidatesConsidered = 0;

    const tryJsonLd = sourceMode === 'auto' || sourceMode === 'jsonld';
    const tryTables = sourceMode === 'auto' || sourceMode === 'table';

    if (tryJsonLd) {
        for (const raw of structured.jsonLd || []) {
            for (const node of flattenJsonLd(raw)) {
                candidatesConsidered += 1;
                const validated = validateExtraction(schema, node);
                if (validated.ok) {
                    return { ok: true, data: validated.data, source: 'jsonld', candidatesConsidered };
                }
                failures.push({ path: '$', code: 'jsonld.rejected', detail: firstDetail(validated) });
            }
        }
    }

    if (tryTables) {
        if (schema.type === 'array' && schema.items && /** @type {any} */ (schema.items).type === 'object') {
            const itemSchema = /** @type {any} */ (schema.items);
            for (const table of structured.tables || []) {
                candidatesConsidered += 1;
                const rows = tableToObjects(table, itemSchema);
                if (!rows) {
                    failures.push({ path: '$', code: 'table.headers-unmatched', detail: `headers [${effectiveHeaders(table).join(', ')}] do not cover schema properties` });
                    continue;
                }
                const validated = validateExtraction(schema, rows);
                if (validated.ok) {
                    return { ok: true, data: validated.data, source: 'table', candidatesConsidered };
                }
                failures.push({ path: '$', code: 'table.rows-invalid', detail: firstDetail(validated) });
            }
        } else if (schema.type === 'object') {
            for (const table of structured.tables || []) {
                candidatesConsidered += 1;
                const single = tableToSingleObject(table, schema);
                if (!single) {
                    failures.push({ path: '$', code: 'table.not-single-object', detail: 'table shape does not map to a single object' });
                    continue;
                }
                const validated = validateExtraction(schema, single);
                if (validated.ok) {
                    return { ok: true, data: validated.data, source: 'table', candidatesConsidered };
                }
                failures.push({ path: '$', code: 'table.object-invalid', detail: firstDetail(validated) });
            }
        }
    }

    if (candidatesConsidered === 0) {
        failures.push({ path: '$', code: 'structure.none', detail: `no ${sourceMode === 'auto' ? 'jsonld or table' : sourceMode} structures found on page` });
    }
    return { ok: false, errors: failures, source: null, candidatesConsidered };
}

/**
 * Effective headers: prefer <th>-derived headers; when absent, treat the first
 * row as a header row (structured-extractor collects headers only from <th>).
 * @param {{ headers: string[], rows: string[][] }} table
 */
function effectiveHeaders(table) {
    if (table.headers?.length) return table.headers;
    if (table.rows?.length) return table.rows[0];
    return [];
}

/**
 * @param {{ headers: string[], rows: string[][] }} table
 */
function effectiveRows(table) {
    if (table.headers?.length) return table.rows || [];
    // First row consumed as header fallback.
    return (table.rows || []).slice(1);
}

/**
 * Map a table to an array of objects per itemSchema. Returns null when the
 * headers cannot cover all required properties (candidate rejected).
 * @param {{ headers: string[], rows: string[][] }} table
 * @param {any} itemSchema
 */
function tableToObjects(table, itemSchema) {
    const headers = effectiveHeaders(table).map(h => normalizeKey(h));
    const rows = effectiveRows(table);
    if (headers.length === 0 || rows.length === 0) return null;

    const props = Object.keys(itemSchema.properties || {});
    const required = Array.isArray(itemSchema.required) ? itemSchema.required : [];
    /** @type {Record<string, number>} */
    const columnIndex = {};
    for (const prop of props) {
        const idx = headers.indexOf(normalizeKey(prop));
        if (idx !== -1) columnIndex[prop] = idx;
    }
    for (const req of required) {
        if (!(req in columnIndex)) return null;
    }
    if (Object.keys(columnIndex).length === 0) return null;

    return rows.map(cells => {
        /** @type {Record<string, unknown>} */
        const obj = {};
        for (const [prop, idx] of Object.entries(columnIndex)) {
            const targetType = /** @type {any} */ (itemSchema.properties[prop])?.type || 'string';
            const coerced = coerceCell(cells[idx], targetType);
            if (coerced !== undefined) obj[prop] = coerced;
        }
        return obj;
    });
}

/**
 * Map a 2-column key/value table (or single-row table) to one object.
 * @param {{ headers: string[], rows: string[][] }} table
 * @param {any} schema
 */
function tableToSingleObject(table, schema) {
    const props = Object.keys(schema.properties || {});
    if (props.length === 0) return null;

    // Key/value layout: every row is [key, value].
    const rows = table.rows || [];
    if (rows.length > 0 && rows.every(r => r.length === 2)) {
        /** @type {Record<string, unknown>} */
        const obj = {};
        for (const [key, value] of rows) {
            const prop = props.find(p => normalizeKey(p) === normalizeKey(key));
            if (!prop) continue;
            const targetType = /** @type {any} */ (schema.properties[prop])?.type || 'string';
            const coerced = coerceCell(value, targetType);
            if (coerced !== undefined) obj[prop] = coerced;
        }
        return Object.keys(obj).length > 0 ? obj : null;
    }

    // Single data row under headers.
    const objects = tableToObjects(table, schema);
    if (objects && objects.length === 1) return objects[0];
    return null;
}

/**
 * Conservative cell coercion. Returns undefined when the cell cannot be
 * represented as the target type (leaving the key absent -> validator decides).
 * @param {string|undefined} cell
 * @param {string} targetType
 */
export function coerceCell(cell, targetType) {
    if (cell === undefined || cell === null) return undefined;
    const text = String(cell).trim();
    if (text === '') return undefined;
    switch (targetType) {
        case 'string':
            return text;
        case 'number':
        case 'integer': {
            // Allow digits, sign, decimal point, thousands separators, currency symbols and %.
            const cleaned = text.replace(/[,\s]/g, '').replace(/^[^0-9+-]*/, '').replace(/[^0-9.]*$/, '');
            if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return undefined;
            const num = Number(cleaned);
            if (!Number.isFinite(num)) return undefined;
            if (targetType === 'integer' && !Number.isInteger(num)) return undefined;
            return num;
        }
        case 'boolean': {
            const lower = text.toLowerCase();
            if (['true', 'yes', 'y', '1', 'o'].includes(lower)) return true;
            if (['false', 'no', 'n', '0', 'x'].includes(lower)) return false;
            return undefined;
        }
        case 'null':
            return null;
        default:
            return undefined;
    }
}

/** @param {string} key */
function normalizeKey(key) {
    return String(key || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * JSON-LD can be a node, a graph, or an array. Flatten to candidate nodes.
 * @param {unknown} raw
 * @returns {unknown[]}
 */
function flattenJsonLd(raw) {
    if (Array.isArray(raw)) return raw.flatMap(flattenJsonLd);
    if (raw && typeof raw === 'object') {
        const graph = /** @type {any} */ (raw)['@graph'];
        if (Array.isArray(graph)) return [raw, ...graph.flatMap(flattenJsonLd)];
        return [raw];
    }
    return [];
}

/**
 * @param {{ ok: boolean } & Record<string, any>} validated
 */
function firstDetail(validated) {
    if (validated.ok) return 'ok';
    const first = validated.errors?.[0];
    return first ? `${first.path}: ${first.code} (${first.detail})` : 'validation-failed';
}

/**
 * @param {ReturnType<typeof extractStructuredContent>} structured
 */
function summarizeStructures(structured) {
    return {
        tables: (structured.tables || []).map(t => ({
            caption: t.caption || null,
            headers: effectiveHeaders(t).slice(0, 12),
            rowCount: (t.rows || []).length,
        })),
        jsonLdCount: (structured.jsonLd || []).length,
        headingCount: (structured.headings || []).length,
        listCount: (structured.lists || []).length,
    };
}

/**
 * Tier 2: web-ai escalation. Sends page structures + schema to a logged-in
 * vendor session, expects raw JSON back, validates with the same validator.
 * @param {{ schema: any, html: string, structured: any, vendor: string, runWebAiQuery?: Function }} input
 */
async function runTier2Escalation(input) {
    const prompt = buildTier2Prompt(input.schema, input.structured, input.html);
    let responseText = null;
    /** @type {Array<{ path: string, code: string, detail: string }>} */
    const errors = [];

    try {
        if (input.runWebAiQuery) {
            const result = await input.runWebAiQuery({ prompt, vendor: input.vendor });
            responseText = result?.text ?? null;
        } else {
            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const execFileAsync = promisify(execFile);
            const agbrowseBin = process.argv[1] || 'agbrowse';
            const result = await execFileAsync('node', [
                agbrowseBin, 'web-ai', 'query',
                '--vendor', input.vendor,
                '--inline-only',
                '--prompt', prompt,
            ], { timeout: 300_000 });
            responseText = result.stdout.trim();
        }
    } catch (error) {
        return {
            ok: false, tier: 2, verdict: 'web_ai_failed', data: null,
            errors: [{ path: '$', code: 'web-ai.error', detail: /** @type {any} */ (error).message }],
            source: 'web-ai', evidence: [`web-ai:${input.vendor}`],
        };
    }

    const parsed = parseJsonFromText(responseText || '');
    if (parsed === undefined) {
        return {
            ok: false, tier: 2, verdict: 'web_ai_unparseable', data: null,
            errors: [{ path: '$', code: 'web-ai.no-json', detail: 'no JSON object/array found in web-ai response' }],
            source: 'web-ai', evidence: [`web-ai:${input.vendor}`],
        };
    }
    const validated = validateExtraction(input.schema, parsed);
    if (validated.ok) {
        return {
            ok: true, tier: 2, verdict: 'extracted', data: validated.data, errors: [],
            source: 'web-ai', evidence: [`web-ai:${input.vendor}`, EXTRACT_SCHEMA_VERSION],
        };
    }
    return {
        ok: false, tier: 2, verdict: 'web_ai_schema_mismatch', data: null,
        errors: validated.errors,
        source: 'web-ai', evidence: [`web-ai:${input.vendor}`],
    };
}

/**
 * @param {any} schema
 * @param {any} structured
 * @param {string} html
 */
function buildTier2Prompt(schema, structured, html) {
    const tables = JSON.stringify((structured.tables || []).slice(0, 5));
    const excerpt = html.replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 12_000);
    return [
        'Extract data from the following page content so it EXACTLY matches this JSON schema.',
        'Respond with ONLY the JSON value (no markdown fences, no commentary).',
        `SCHEMA: ${JSON.stringify(schema)}`,
        `TABLES: ${tables}`,
        `PAGE EXCERPT: ${excerpt}`,
    ].join('\n\n');
}

/**
 * Extract the first JSON value from free text (tolerates markdown fences).
 * @param {string} text
 * @returns {unknown|undefined}
 */
export function parseJsonFromText(text) {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
        return JSON.parse(trimmed);
    } catch { /* fall through to scan */ }
    const start = trimmed.search(/[[{]/);
    if (start === -1) return undefined;
    for (let end = trimmed.length; end > start; end -= 1) {
        const candidate = trimmed.slice(start, end);
        if (!/[\]}]$/.test(candidate.trim())) continue;
        try {
            return JSON.parse(candidate);
        } catch { /* keep shrinking */ }
    }
    return undefined;
}

/**
 * @param {Record<string, unknown>} envelope
 * @param {unknown} jsonFlag
 * @param {{ log: Function, errorLog: Function, exit: Function }} io
 */
function emit(envelope, jsonFlag, io) {
    const body = { schemaVersion: EXTRACT_ENVELOPE_VERSION, ...envelope };
    if (jsonFlag) {
        io.log(JSON.stringify(body, null, 2));
    } else {
        io.log(formatHuman(body));
    }
    if (!body.ok) return io.exit(1);
}

/** @param {any} body */
function formatHuman(body) {
    const lines = [
        `extract: ${body.ok ? 'OK' : 'FAILED'} (${body.verdict}, tier ${body.tier})`,
        `source: ${body.source}  url: ${body.finalUrl}`,
        `candidates considered: ${body.candidatesConsidered ?? 0}`,
    ];
    if (body.ok) {
        lines.push('', JSON.stringify(body.data, null, 2));
    } else {
        for (const err of body.errors || []) {
            lines.push(`  - ${err.path} ${err.code}: ${err.detail}`);
        }
        if (body.structuresAvailable) {
            lines.push('', 'structures on page:');
            for (const t of body.structuresAvailable.tables || []) {
                lines.push(`  table${t.caption ? ` "${t.caption}"` : ''}: [${t.headers.join(', ')}] x${t.rowCount} rows`);
            }
            lines.push(`  jsonLd: ${body.structuresAvailable.jsonLdCount}, headings: ${body.structuresAvailable.headingCount}, lists: ${body.structuresAvailable.listCount}`);
        }
    }
    return lines.join('\n');
}

function usage() {
    return `agbrowse extract — schema-bound structured extraction (Tier 1 LLM-free)

Usage:
  agbrowse extract <url> --schema <file.json> [options]
  agbrowse extract --from-file <page.html> --schema <file.json> [options]

Options:
  --schema <file>      JSON schema (extract-schema-v1 subset: object/array/
                       string/number/integer/boolean/null, required, enum,
                       minItems/maxItems). Required.
  --from-file <file>   Read local HTML instead of fetching the URL.
  --source <mode>      auto | table | jsonld (default: auto)
  --json               JSON envelope output (agbrowse-extract-v1)
  --escalate-web-ai    On Tier 1 failure, escalate to a logged-in web-ai
                       session (uses your existing provider subscription).
  --vendor <name>      Tier 2 vendor: chatgpt | gemini | grok | perplexity (default: grok)
  --timeout <ms>       Fetch timeout

Fail-closed: when nothing on the page satisfies the schema, exits 1 with an
explicit verdict and a summary of the structures that were found.`;
}
