#!/usr/bin/env node
/**
 * Phase 22 named release gates for agbrowse.
 *
 * Each gate has a NAME, a CHECK function, and prints PASS / FAIL.
 * Usage:
 *   node scripts/release-gates.mjs              # run all gates
 *   node scripts/release-gates.mjs <gate-name>  # run one gate
 *
 * Wired through package.json scripts as `gate:<name>`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditClaims, formatClaimAuditReport } from '../web-ai/claim-audit.mjs';
import { DEFERRED_BROWSER_TOOLS, BROWSER_TOOLS } from '../web-ai/browser-tool-schema.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
    return spawnSync(cmd, args, {
        cwd: repoRoot,
        stdio: opts.stdio || 'pipe',
        encoding: 'utf8',
        ...opts,
    });
}

function readFile(rel) {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

const GATES = {
    'typecheck': {
        description: 'syntactic + structural integrity (node --check + doc drift)',
        check() {
            // agbrowse is .mjs (no TypeScript). Treat node --check on the
            // public surface plus doc-drift as the equivalent of a typecheck.
            const targets = [
                'bin/agbrowse.mjs',
                'bin/agbrowse-vision-click.mjs',
                'web-ai/cli.mjs',
                'web-ai/mcp-server.mjs',
                'web-ai/browser-tool-schema.mjs',
                'web-ai/tool-schema.mjs',
                'scripts/release-gates.mjs',
            ];
            for (const rel of targets) {
                const abs = path.join(repoRoot, rel);
                if (!fs.existsSync(abs)) continue;
                const r = run('node', ['--check', abs]);
                if (r.status !== 0) {
                    return { ok: false, detail: `node --check failed for ${rel}:\n${(r.stderr || r.stdout || '').slice(-1000)}` };
                }
            }
            const drift = run('bash', ['structure/check-doc-drift.sh']);
            if (drift.status !== 0) {
                return { ok: false, detail: `doc drift failed:\n${(drift.stdout || drift.stderr || '').slice(-2000)}` };
            }
            return { ok: true, detail: `node --check clean for ${targets.length} entries; doc drift clean` };
        },
    },
    'tests': {
        description: 'unit + MCP + source-audit + trace-policy tests pass',
        check() {
            const suites = ['test:unit', 'test:mcp', 'test:source-audit', 'test:trace-policy'];
            for (const suite of suites) {
                const r = run('npm', ['run', suite, '--silent']);
                if (r.status !== 0) {
                    return { ok: false, detail: `${suite} failed:\n${(r.stdout || r.stderr || '').slice(-2000)}` };
                }
            }
            return { ok: true, detail: `passed: ${suites.join(', ')}` };
        },
    },
    'truth-table-fresh': {
        description: 'CAPABILITY_TRUTH_TABLE.md edited within 7 days OR matches code refs',
        check() {
            const rel = 'structure/CAPABILITY_TRUTH_TABLE.md';
            const abs = path.join(repoRoot, rel);
            if (!fs.existsSync(abs)) return { ok: false, detail: `${rel} missing` };
            const stat = fs.statSync(abs);
            const ageMs = Date.now() - stat.mtimeMs;
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays <= 7) {
                return { ok: true, detail: `truth table ${ageDays.toFixed(2)}d old` };
            }
            // fallback: ensure every frozen MCP tool name appears in the table
            const text = readFile(rel);
            const required = ['browser_snapshot', 'browser_click_ref', 'answerArtifact', 'sourceAudit'];
            for (const term of required) {
                if (!text.includes(term)) {
                    return { ok: false, detail: `truth table stale (${ageDays.toFixed(1)}d) and missing ${term}` };
                }
            }
            return { ok: true, detail: `truth table ${ageDays.toFixed(1)}d old but matches required terms` };
        },
    },
    'mcp-scope-frozen': {
        description: 'only the 2 frozen browser MCP tools are registered',
        check() {
            const text = readFile('web-ai/browser-tool-schema.mjs');
            const matches = [...text.matchAll(/^\s{4}(browser_[a-z_]+):\s*{/gm)].map((m) => m[1]);
            const expected = ['browser_snapshot', 'browser_click_ref'];
            if (matches.length !== 2 || matches[0] !== expected[0] || matches[1] !== expected[1]) {
                return { ok: false, detail: `expected ${expected.join(',')}, found ${matches.join(',') || '(none)'}` };
            }
            return { ok: true, detail: 'browser MCP scope frozen at browser_snapshot, browser_click_ref' };
        },
    },
    'no-experimental-in-readme-ready-section': {
        description: 'README "ready" claims do not include external CDP or unimplemented MCP tools',
        check() {
            const readme = readFile('README.md');
            // capture content from a "ready" / "Production" / "Supported" header up to next ##
            const sections = readme.split(/\n##\s+/);
            const offending = [];
            const forbiddenInReady = [
                /external[-\s]?cdp/i,
                /remote[-\s]?cdp/i,
                /hosted browser/i,
                /browser_type_ref/,
                /browser_navigate/,
                /browser_screenshot/,
                /browser_back/,
                /browser_forward/,
                /browser_reload/,
                /browser_wait_for/,
                /browser_extract_text/,
            ];
            for (const sec of sections) {
                const head = sec.split('\n', 1)[0].toLowerCase();
                const isReady = head.includes('ready') || head.includes('production') || head.includes('supported');
                const isExperimentalSection = head.includes('experimental') || head.includes('deferred') || head.includes('out of scope');
                if (isReady && !isExperimentalSection) {
                    for (const pat of forbiddenInReady) {
                        if (pat.test(sec)) offending.push(`${head} :: ${pat}`);
                    }
                }
            }
            if (offending.length > 0) {
                return { ok: false, detail: `forbidden terms in ready section:\n${offending.join('\n')}` };
            }
            return { ok: true, detail: 'README ready sections do not advertise experimental/unimplemented surfaces' };
        },
    },
    'no-cloud-claims': {
        description: 'no hosted/cloud/stealth/external-CDP/leaderboard claims outside experimental sections (G10)',
        check() {
            const report = auditClaims({ repoRoot });
            const detail = formatClaimAuditReport(report);
            return { ok: report.ok, detail };
        },
    },
    'mcp-deferred-metadata': {
        description: 'every deferred browser MCP tool has reason+cliEquivalent+competitorRef+since (G04)',
        check() {
            const required = ['reason', 'cliEquivalent', 'competitorRef', 'since'];
            const offending = [];
            const names = Object.keys(DEFERRED_BROWSER_TOOLS);
            if (names.length === 0) {
                return { ok: false, detail: 'DEFERRED_BROWSER_TOOLS is empty — at least one entry required while MCP scope is frozen' };
            }
            for (const name of names) {
                const meta = DEFERRED_BROWSER_TOOLS[name];
                if (!meta || typeof meta !== 'object') {
                    offending.push(`${name}: not an object`);
                    continue;
                }
                for (const key of required) {
                    const val = /** @type {any} */ (meta)[key];
                    if (typeof val !== 'string' || val.trim().length === 0) {
                        offending.push(`${name}.${key} missing or empty`);
                    }
                }
                if (Object.prototype.hasOwnProperty.call(BROWSER_TOOLS, name)) {
                    offending.push(`${name}: appears in both BROWSER_TOOLS and DEFERRED_BROWSER_TOOLS`);
                }
            }
            const scopeRecord = path.join(repoRoot, 'structure/mcp_scope.md');
            if (!fs.existsSync(scopeRecord)) {
                offending.push('structure/mcp_scope.md is missing — required decision record for G04');
            }
            if (offending.length > 0) {
                return { ok: false, detail: `mcp-deferred-metadata violations:\n  - ${offending.join('\n  - ')}` };
            }
            return { ok: true, detail: `${names.length} deferred browser tool(s) carry full metadata; structure/mcp_scope.md present` };
        },
    },
    'observe-actions-fixtures': {
        description: 'observe-actions module loads and produces ranked candidates from a fixture snapshot (G02)',
        async check() {
            try {
                const mod = await import('../web-ai/observe-actions.mjs');
                if (typeof mod.buildObserveActions !== 'function' || typeof mod.formatObserveActions !== 'function') {
                    return { ok: false, detail: 'web-ai/observe-actions.mjs missing required exports' };
                }
                const fixture = {
                    snapshotId: 'gate-fixture',
                    url: 'https://example.com/login',
                    refs: {
                        '@e1': { role: 'button', name: 'Sign in' },
                        '@e2': { role: 'textbox', name: 'Email' },
                        '@e3': { role: 'link', name: 'Forgot password?' },
                    },
                };
                const r = mod.buildObserveActions(fixture, 'click sign in');
                if (!r || !Array.isArray(r.candidates) || r.candidates.length < 3) {
                    return { ok: false, detail: 'observe-actions did not return ≥3 candidates from the 3-element fixture' };
                }
                if (r.candidates[0].ref !== '@e1' || r.candidates[0].action !== 'click') {
                    return { ok: false, detail: 'observe-actions did not rank the matching button first' };
                }
                if (!r.candidates.every((c) => c.args && c.args.snapshotId === 'gate-fixture')) {
                    return { ok: false, detail: 'observe-actions candidates missing snapshotId in args' };
                }
                const text = mod.formatObserveActions(r);
                if (typeof text !== 'string' || text.length === 0) {
                    return { ok: false, detail: 'formatObserveActions returned empty output' };
                }
                return { ok: true, detail: `observe-actions produced ${r.candidates.length} ranked candidates from fixture` };
            } catch (err) {
                return { ok: false, detail: `observe-actions fixture check threw: ${(err && err.message) || err}` };
            }
        },
    },
    'observation-bundle-fixtures': {
        description: 'observation-bundle module emits ObservationBundleV1 from a fixture (G06)',
        async check() {
            try {
                const mod = await import('../web-ai/observation-bundle.mjs');
                if (typeof mod.buildObservationBundle !== 'function' || typeof mod.formatObservationBundle !== 'function') {
                    return { ok: false, detail: 'web-ai/observation-bundle.mjs missing required exports' };
                }
                if (mod.OBSERVATION_BUNDLE_SCHEMA_VERSION !== 'observation-bundle-v1') {
                    return { ok: false, detail: `unexpected schema version: ${mod.OBSERVATION_BUNDLE_SCHEMA_VERSION}` };
                }
                const bundle = mod.buildObservationBundle({
                    url: 'https://example.com/',
                    title: 'Fixture',
                    viewport: { width: 1280, height: 800 },
                    dpr: 2,
                    snapshotNodes: [
                        { ref: '@e1', role: 'button', name: 'Go', depth: 1 },
                        { ref: '...', role: 'note', name: 'truncated' },
                    ],
                    boxes: { '@e1': { x: 0, y: 0, width: 100, height: 30 } },
                    screenshotPath: '/tmp/x.png',
                    textSummary: 'hello',
                });
                if (bundle.schemaVersion !== 'observation-bundle-v1') {
                    return { ok: false, detail: 'fixture bundle has wrong schemaVersion' };
                }
                if (bundle.stats.refCount !== 1 || bundle.stats.boxCount !== 1 || !bundle.stats.hasScreenshot) {
                    return { ok: false, detail: `fixture bundle stats wrong: ${JSON.stringify(bundle.stats)}` };
                }
                if (!bundle.refs[0].box || bundle.refs[0].box.width !== 100) {
                    return { ok: false, detail: 'fixture bundle ref missing box' };
                }
                const text = mod.formatObservationBundle(bundle);
                if (!text.includes('observation-bundle-v1')) {
                    return { ok: false, detail: 'formatObservationBundle output missing schema label' };
                }
                return { ok: true, detail: `observation-bundle fixture: refs=${bundle.stats.refCount} boxes=${bundle.stats.boxCount} text=${bundle.stats.textChars}ch` };
            } catch (err) {
                return { ok: false, detail: `observation-bundle fixture check threw: ${(err && err.message) || err}` };
            }
        },
    },
};

function printResult(name, result) {
    const status = result.ok ? 'PASS' : 'FAIL';
    process.stdout.write(`[${status}] gate:${name} — ${GATES[name].description}\n`);
    if (result.detail) process.stdout.write(`        ${result.detail.replace(/\n/g, '\n        ')}\n`);
}

async function main() {
    const target = process.argv[2];
    const names = target ? [target] : Object.keys(GATES);
    let failed = 0;
    for (const name of names) {
        if (!GATES[name]) {
            process.stdout.write(`[FAIL] gate:${name} — unknown gate\n`);
            failed += 1;
            continue;
        }
        let result;
        try {
            result = await GATES[name].check();
        } catch (err) {
            result = { ok: false, detail: `threw: ${err.message}` };
        }
        printResult(name, result);
        if (!result.ok) failed += 1;
    }
    process.stdout.write(failed === 0 ? `\nAll ${names.length} gate(s) passed.\n` : `\n${failed}/${names.length} gate(s) FAILED.\n`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    process.stderr.write(`release-gates threw: ${err.stack || err}\n`);
    process.exit(1);
});
