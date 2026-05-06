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
    'browser-primitives-complete': {
        description: 'all action-breadth primitives have a wired CLI subcommand (G03)',
        async check() {
            try {
                const fs = await import('node:fs');
                const path = await import('node:path');
                const { fileURLToPath } = await import('node:url');
                const here = path.dirname(fileURLToPath(import.meta.url));
                const cliPath = path.resolve(here, '..', 'skills/browser/browser.mjs');
                const source = fs.readFileSync(cliPath, 'utf8');
                const mod = await import('../web-ai/action-breadth.mjs');
                if (!Array.isArray(mod.BROWSER_PRIMITIVES) || mod.BROWSER_PRIMITIVES.length === 0) {
                    return { ok: false, detail: 'web-ai/action-breadth.mjs has no BROWSER_PRIMITIVES' };
                }
                if (mod.BROWSER_PRIMITIVE_SCHEMA_VERSION !== 'browser-primitives-v1') {
                    return { ok: false, detail: `unexpected schema version: ${mod.BROWSER_PRIMITIVE_SCHEMA_VERSION}` };
                }
                const r = mod.auditPrimitiveCoverage(source);
                if (!r.ok) {
                    return { ok: false, detail: `missing CLI cases for: ${r.missing.join(', ')}` };
                }
                return { ok: true, detail: `${r.found.length}/${r.total} browser primitives wired` };
            } catch (err) {
                return { ok: false, detail: `browser-primitives gate threw: ${(err && err.message) || err}` };
            }
        },
    },
    'trace-browser-actions': {
        description: 'action-timeline module aggregates events into ActionTimelineV1 (G11)',
        async check() {
            try {
                const mod = await import('../web-ai/trace/action-timeline.mjs');
                if (typeof mod.buildActionTimeline !== 'function') {
                    return { ok: false, detail: 'web-ai/trace/action-timeline.mjs missing buildActionTimeline' };
                }
                if (mod.ACTION_TIMELINE_SCHEMA_VERSION !== 'action-timeline-v1') {
                    return { ok: false, detail: `unexpected schema: ${mod.ACTION_TIMELINE_SCHEMA_VERSION}` };
                }
                const tl = mod.buildActionTimeline([
                    { traceId: 'gate-t', eventId: 'a', t: 100, kind: 'observe', command: 'snapshot', outcome: 'ok' },
                    { traceId: 'gate-t', eventId: 'b', t: 200, kind: 'mutate', command: 'click', target: '@e1', outcome: 'fail', errorCode: 'click.refMissing' },
                ]);
                if (tl.schemaVersion !== 'action-timeline-v1' || tl.stats.eventCount !== 2 || tl.stats.failCount !== 1 || tl.durationMs !== 100) {
                    return { ok: false, detail: `fixture timeline wrong: ${JSON.stringify(tl.stats)} duration=${tl.durationMs}` };
                }
                let threw = false;
                try { mod.buildActionTimeline([]); } catch { threw = true; }
                if (!threw) return { ok: false, detail: 'empty input did not throw' };
                return { ok: true, detail: `action-timeline fixture: events=${tl.stats.eventCount} ok=${tl.stats.okCount} fail=${tl.stats.failCount}` };
            } catch (err) {
                return { ok: false, detail: `trace-browser-actions gate threw: ${(err && err.message) || err}` };
            }
        },
    },
    'action-memory-safe-replay': {
        description: 'action-memory cache returns hit only when DOM signature matches (G07)',
        async check() {
            try {
                const mod = await import('../web-ai/action-memory.mjs');
                if (typeof mod.createActionMemory !== 'function') {
                    return { ok: false, detail: 'web-ai/action-memory.mjs missing createActionMemory' };
                }
                if (mod.ACTION_MEMORY_SCHEMA_VERSION !== 'action-memory-v1') {
                    return { ok: false, detail: `unexpected schema: ${mod.ACTION_MEMORY_SCHEMA_VERSION}` };
                }
                const m = mod.createActionMemory();
                m.put({
                    origin: 'https://x.test', intentId: 'send.click', signature: 'sig-A',
                    ref: '@e3', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '',
                });
                const hit = m.get('https://x.test', 'send.click', 'sig-A');
                if (!hit || hit.ref !== '@e3') return { ok: false, detail: 'exact-signature lookup missed' };
                const drift = m.get('https://x.test', 'send.click', 'sig-B');
                if (drift !== null) return { ok: false, detail: 'signature drift returned a hit (unsafe replay)' };
                const validated = mod.validateMemoryHit(hit, 'sig-B');
                if (validated !== null) return { ok: false, detail: 'validateMemoryHit allowed signature drift' };
                m.recordReplay('https://x.test', 'send.click', 'sig-A', 'ok');
                m.clear();
                if (m.size() !== 0) return { ok: false, detail: 'clear() did not empty the cache' };
                return { ok: true, detail: 'action-memory: hit-on-match, miss-on-drift, clear OK' };
            } catch (err) {
                return { ok: false, detail: `action-memory-safe-replay gate threw: ${(err && err.message) || err}` };
            }
        },
    },
    'model-adapter-frozen': {
        description: 'G09 freeze: no API mode / provider SDK / api-* commands / API env vars (anti-drift scan)',
        async check() {
            try {
                const mod = await import('../web-ai/constants.mjs');
                if (mod.MAX_MODEL_ADAPTER_ATTEMPTS !== 2) {
                    return { ok: false, detail: `MAX_MODEL_ADAPTER_ATTEMPTS expected 2, got ${mod.MAX_MODEL_ADAPTER_ATTEMPTS}` };
                }
                if (typeof mod.isModelAdapterTransient !== 'function') {
                    return { ok: false, detail: 'isModelAdapterTransient classifier missing' };
                }
                // Idempotent must not retry; transient 429 must retry; 401 must not.
                if (mod.isModelAdapterTransient({ statusCode: 401 })) return { ok: false, detail: '401 incorrectly classified transient' };
                if (!mod.isModelAdapterTransient({ statusCode: 429 })) return { ok: false, detail: '429 not classified transient' };
                if (!mod.isModelAdapterTransient({ statusCode: 529 })) return { ok: false, detail: '529 not classified transient' };
                if (mod.isModelAdapterTransient({ statusCode: 500, midStream: true })) return { ok: false, detail: 'mid-stream error classified transient' };
                if (mod.isModelAdapterTransient({ statusCode: 500, idempotent: false })) return { ok: false, detail: 'non-idempotent classified transient' };

                // Truth-table deferred row.
                const truth = readFile('structure/CAPABILITY_TRUTH_TABLE.md');
                if (!/G09[^\n]*model[- ]adapter/i.test(truth) || !/(deferred|frozen)/i.test(truth.match(/G09[^\n]+/i)?.[0] || '')) {
                    return { ok: false, detail: 'CAPABILITY_TRUTH_TABLE.md missing G09 model-adapter deferred/frozen row' };
                }

                // package.json must NOT depend on provider SDKs.
                const pkg = JSON.parse(readFile('package.json'));
                const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) };
                const sdkDenylist = ['openai', '@anthropic-ai/sdk', '@google/generative-ai', '@google/genai', 'ai'];
                for (const name of Object.keys(allDeps)) {
                    if (sdkDenylist.includes(name) || name.startsWith('@ai-sdk/')) {
                        return { ok: false, detail: `forbidden provider SDK dep: ${name}` };
                    }
                }

                // Source scan for command/env/path/import drift.
                const scanRoots = ['bin', 'web-ai', 'scripts', 'skills', 'src'];
                /** @type {Array<{file:string, hit:string}>} */
                const violations = [];
                const cmdAliasRe = /\b(api-query|model-query|model-adapter|--api\b|--transport\s+api|--mode\s+api)\b/;
                const envRe = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|MODEL_ADAPTER_[A-Z_]+|AI_SDK_[A-Z_]+)\b/;
                const importRe = /from\s+['"](openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|@ai-sdk\/[^'"]+|ai)['"]/;
                const helpDriftRe = /API\s+(model\s+)?(mode|adapter|client)s?\s+(coming\s+soon|planned|future|will\s+be\s+added)/i;
                const dirDenylist = [
                    'web-ai/model-adapter',
                    'model-adapter',
                    'api-client',
                ];
                for (const dirRel of dirDenylist) {
                    if (fs.existsSync(path.join(repoRoot, dirRel))) {
                        return { ok: false, detail: `forbidden path exists: ${dirRel}/` };
                    }
                }
                /** @param {string} dirAbs */
                function walk(dirAbs) {
                    if (!fs.existsSync(dirAbs)) return;
                    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
                        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                        const abs = path.join(dirAbs, entry.name);
                        if (entry.isDirectory()) { walk(abs); continue; }
                        if (!/\.(mjs|cjs|js|ts|json|md|sh)$/.test(entry.name)) continue;
                        const rel = path.relative(repoRoot, abs);
                        // Skip the freeze gate itself, the freeze plan, and freeze-context devlog files.
                        if (rel.startsWith('devlog/_plan/')) continue;
                        if (rel.endsWith('release-gates.mjs')) continue;
                        if (rel.endsWith('CAPABILITY_TRUTH_TABLE.md')) continue;
                        if (rel.endsWith('release_gates.md')) continue;
                        if (rel === 'web-ai/constants.mjs') continue;
                        if (/g09[-_].*\.test\.(mjs|cjs|js|ts)$/i.test(rel)) continue;
                        const text = fs.readFileSync(abs, 'utf8');
                        if (cmdAliasRe.test(text)) violations.push({ file: rel, hit: 'forbidden api-query/--api/--transport api alias' });
                        if (envRe.test(text)) violations.push({ file: rel, hit: 'forbidden API key/MODEL_ADAPTER_/AI_SDK_ env var' });
                        if (importRe.test(text)) violations.push({ file: rel, hit: 'forbidden provider SDK import' });
                        if (helpDriftRe.test(text)) violations.push({ file: rel, hit: 'forbidden coming-soon/planned API marketing text' });
                    }
                }
                for (const root of scanRoots) walk(path.join(repoRoot, root));
                if (violations.length) {
                    const sample = violations.slice(0, 5).map(v => `${v.file}: ${v.hit}`).join('; ');
                    return { ok: false, detail: `${violations.length} freeze violation(s): ${sample}` };
                }

                // Help text must include the exact frozen-capability boundary.
                const cli = readFile('web-ai/cli.mjs');
                if (!/Capability boundary:[^\n]*web-ai query[^\n]*local browser automation/i.test(cli)) {
                    return { ok: false, detail: 'web-ai/cli.mjs help missing Capability boundary statement' };
                }
                if (!/explicitly deferred and unavailable in this release/i.test(cli)) {
                    return { ok: false, detail: 'web-ai/cli.mjs help missing "explicitly deferred and unavailable in this release" wording' };
                }

                return { ok: true, detail: `freeze clean: cap=${mod.MAX_MODEL_ADAPTER_ATTEMPTS}, no SDK deps, no api-* drift, help boundary present` };
            } catch (err) {
                return { ok: false, detail: `model-adapter-frozen gate threw: ${(err && err.message) || err}` };
            }
        },
    },
    'planner-loop-local': {
        description: 'G01 experimental: planner-loop runs observe→propose→act→verify with G09 retry cap, no cloud',
        async check() {
            try {
                const contract = await import('../web-ai/planner-contract.mjs');
                if (contract.PLANNER_RESULT_SCHEMA_VERSION !== 'planner-result-v1') {
                    return { ok: false, detail: `unexpected planner result schema: ${contract.PLANNER_RESULT_SCHEMA_VERSION}` };
                }
                const loop = await import('../web-ai/planner-loop.mjs');
                if (typeof loop.runPlannerLoop !== 'function') {
                    return { ok: false, detail: 'web-ai/planner-loop.mjs missing runPlannerLoop' };
                }
                // Fixture: 2-step plan with one transient retry must complete and stay within retry cap.
                let actCalls = 0;
                const result = await loop.runPlannerLoop(
                    { id: 'gate-fix-1', description: 'gate fixture', stopConditions: [], maxSteps: 4 },
                    {
                        async observe() { return { observationId: `o${actCalls}`, bundle: { refs: [] } }; },
                        async act() {
                            actCalls += 1;
                            if (actCalls === 1) return { ok: false, statusCode: 503, transient: true };
                            return { ok: true };
                        },
                        async verify() { return { ok: true }; },
                        async propose({ history }) {
                            if (history.length === 0) return { kind: 'click', ref: '@e1' };
                            return { kind: 'finalize', text: 'OK' };
                        },
                    },
                );
                if (result.outcome !== 'completed') return { ok: false, detail: `outcome=${result.outcome}` };
                if (result.finalAnswer !== 'OK') return { ok: false, detail: `finalAnswer=${result.finalAnswer}` };
                if (result.stats.retryCount !== 1) return { ok: false, detail: `retryCount=${result.stats.retryCount} (expected 1)` };
                if (result.steps[0].attempts !== 2) return { ok: false, detail: `step1.attempts=${result.steps[0].attempts}` };
                return { ok: true, detail: `planner-loop fixture: completed, retries=${result.stats.retryCount}, steps=${result.steps.length}` };
            } catch (err) {
                return { ok: false, detail: `planner-loop-local gate threw: ${(err && err.message) || err}` };
            }
        },
    },
    'extract-schema-fixtures': {
        description: 'G05 experimental: extract-schema validator subset is fail-closed and version-frozen',
        async check() {
            try {
                const mod = await import('../web-ai/extract-schema.mjs');
                if (mod.EXTRACT_SCHEMA_VERSION !== 'extract-schema-v1') {
                    return { ok: false, detail: `unexpected EXTRACT_SCHEMA_VERSION: ${mod.EXTRACT_SCHEMA_VERSION}` };
                }
                const schema = {
                    type: 'object',
                    properties: { title: { type: 'string' }, count: { type: 'integer' } },
                    required: ['title'],
                };
                const ok = mod.validateExtraction(schema, { title: 'hi', count: 1 });
                if (!ok.ok) return { ok: false, detail: `valid fixture rejected: ${JSON.stringify(ok.errors)}` };
                const bad = mod.validateExtraction(schema, { count: 'x' });
                if (bad.ok) return { ok: false, detail: 'invalid fixture incorrectly accepted' };
                if (bad.errors.length < 2) return { ok: false, detail: `expected ≥2 errors, got ${bad.errors.length}` };
                let threw = false;
                try { mod.assertSupportedSchema({ type: 'unknown-type' }); } catch { threw = true; }
                if (!threw) return { ok: false, detail: 'unsupported type did not throw capability.unsupported' };
                return { ok: true, detail: `extract-schema: version=${mod.EXTRACT_SCHEMA_VERSION}, fail-closed validated` };
            } catch (err) {
                return { ok: false, detail: `extract-schema-fixtures gate threw: ${(err && err.message) || err}` };
            }
        },
    },
    'eval-adapters-no-score-claims': {
        description: 'G08 experimental: eval adapters carry no leaderboard/score claims; dry-run outputs scoreClaim=null',
        async check() {
            const fs = await import('node:fs');
            const path = await import('node:path');
            const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
            const adapterDir = path.join(repoRoot, 'web-ai', 'eval-adapters');
            if (!fs.existsSync(adapterDir)) {
                return { ok: false, detail: `eval-adapters dir missing: ${adapterDir}` };
            }
            const forbidden = [
                /leaderboard/i,
                /%\s*on\s*webvoyager/i,
                /%\s*on\s*webarena/i,
                /%\s*on\s*mind2web/i,
                /score\s*:\s*\d/i,
                /rank\s*:\s*\d/i,
                /success-rate\s*:\s*\d/i,
            ];
            const files = fs.readdirSync(adapterDir).filter((f) => f.endsWith('.mjs'));
            for (const f of files) {
                const body = fs.readFileSync(path.join(adapterDir, f), 'utf8');
                for (const re of forbidden) {
                    if (re.test(body)) {
                        return { ok: false, detail: `forbidden score pattern in ${f}: ${re}` };
                    }
                }
            }
            try {
                const wv = await import('../web-ai/eval-adapters/webvoyager.mjs');
                const fixture = JSON.stringify({ id: 't1', url: 'https://example.com', instruction: 'x' });
                const r = wv.dryRunWebVoyager(fixture, { limit: 1 });
                if (r.scoreClaim !== null) return { ok: false, detail: 'dryRunWebVoyager.scoreClaim must be null' };
                if (r.descriptors.some((d) => d.scoreClaim !== null)) {
                    return { ok: false, detail: 'descriptor.scoreClaim must be null' };
                }
                return { ok: true, detail: `${files.length} adapter file(s) clean; dry-run scoreClaim=null` };
            } catch (err) {
                return { ok: false, detail: `eval-adapters gate threw: ${(err && err.message) || err}` };
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
