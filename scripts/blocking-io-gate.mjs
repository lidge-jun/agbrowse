#!/usr/bin/env node
/**
 * Ratchet gate: no NEW blocking IO or CDP commands in the web-ai runtime.
 *
 * Issue #88 twice tried to enumerate the boundaries where a poll can stall, and
 * both attempts were disproved — `deps.*` are injection points, so any count is
 * a snapshot rather than a contract. This gate inverts the problem: it does not
 * try to know every boundary, only to notice when one is added.
 *
 * Counting rule is a SUFFIX rule, not a hand-written list. Two hand-written
 * attempts each missed primitives (`cpSync`, `lstatSync`, `readlinkSync`,
 * `realpathSync`, `rmdirSync`, `symlinkSync`), which is the same failure mode
 * as enumerating boundaries.
 *
 * What this does NOT catch, stated plainly:
 *   - new code calling an EXISTING blocking wrapper (primitive totals unchanged)
 *   - identifiers hidden from a text scan: `readFile\u0053ync(p)` and
 *     `disk['readFile' + 'Sync'](p)` both run and both read as ordinary text.
 *     Closing those needs a parser, not another pattern.
 *   - syntax forms nobody has thought of yet; review found three rounds of them
 *
 * So this closes ENUMERATED ingress forms. It raises the cost of adding
 * blocking IO accidentally, which is the realistic threat here — it is not a
 * defence against someone deliberately hiding one.
 */

// Counts are of REFERENCES, not calls. A comment mentioning `readFileSync` or a
// new function named `normalizeSync` will therefore trip the ratchet. That is a
// deliberate false positive: the alternative missed real ingress, and the fix
// (rename, or update the manifest in a reviewed commit) is cheap.

/**
 * Any REFERENCE to a `Sync`-suffixed identifier, not just a call.
 *
 * Matching `name(` misses `readFileSync?.(p)`, `(readFileSync)(p)` and
 * `const read = fs.readFileSync`, all of which are ordinary JavaScript rather
 * than obfuscation. Counting references costs nothing here — a `Sync` binding
 * that is mentioned but never invoked does not exist in this tree — and it
 * cannot be dodged by changing call syntax.
 */
const SYNC_CALL = /\b[A-Za-z_$][A-Za-z0-9_$]*Sync\b/g;
/**
 * Event-loop blockers that do not end in `Sync`. Matched as a REFERENCE for the
 * same reason as above: `Atomics.wait?.(…)` and `Atomics['wait'](…)` both dodge
 * a call-shaped pattern.
 */
const OTHER_BLOCKING = /\bAtomics\s*(?:\.\s*wait\b|\[\s*['"`]wait['"`]\s*\])/g;
/**
 * The synchronous session-store lock, counted separately.
 *
 * It contains no `Sync` primitive of its own at the call site, so the patterns
 * above see nothing when a new caller takes it — the case this file's own notes
 * list as uncovered ("new code calling an EXISTING blocking wrapper"). It waits
 * with `Atomics.wait`, and a contended acquire measured 6,476ms during which a
 * 50ms timer never fired, so every new caller is another place a deadline stops
 * being counted. `withStoreLockAsync` is the replacement and is not matched.
 */
const BLOCKING_STORE_LOCK = /\bwithStoreLock\s*\(/g;
/**
 * Any other REFERENCE to the blocking lock: `withStoreLock?.(…)`,
 * `(withStoreLock)(…)`, `const lock = withStoreLock`, and
 * `import { withStoreLock as lock }` all run and all dodge the call-shaped
 * pattern above. Counting the reference and subtracting direct calls leaves
 * exactly the indirect uses, which are rejected outright rather than counted —
 * an alias cannot be ratcheted, because the manifest cannot say which name it
 * will wear next.
 *
 * `withStoreLockAsync` shares the prefix, so the boundary is explicit.
 */
const ANY_STORE_LOCK_REF = /\bwithStoreLock\b(?!Async)/g;
/** `store['withStoreLock'](…)` — a literal computed member dodges both forms. */
const COMPUTED_STORE_LOCK = /\[\s*['"`]withStoreLock['"`]\s*\]/g;
/** The one legitimate non-call reference: `export function withStoreLock(`. */
const STORE_LOCK_DECLARATION = /\bfunction\s+withStoreLock\b(?!Async)/;
/** A CDP command: `.send('Domain.method'` with a literal. */
const CDP_LITERAL_SEND = /\.send\(\s*['"`][A-Z][A-Za-z]*\.[A-Za-z]/g;
/**
 * Any `send` MEMBER reference, so non-literal uses can be told apart. Counting
 * `.send(` alone missed `.send.call(…)` and `Reflect.apply(cdp.send, …)`.
 */
const ANY_SEND = /\.\s*send\b/g;

/** `import { readFileSync as read }` / `export { … as … } from 'node:…'`. */
const NODE_BINDING = /\b(?:import|export)\s*\{([^}]*)\}\s*from\s*['"]node:[^'"]+['"]/g;
/**
 * `fs[name](…)` where the receiver is a filesystem-ish binding. Scoped to those
 * names on purpose: banning every `obj[i](…)` would reject `arr[i](value)`,
 * which is unrelated and legitimate.
 */
const COMPUTED_FS_CALL = /\b(?:fs|fsp|nodeFs|promises)\s*\[\s*[^\]]+\s*\]\s*\(/g;
/** `(fs)['readFileSync'](…)` — a parenthesised receiver dodges the `\bfs[` form. */
const COMPUTED_STRING_MEMBER = /\[\s*['"`][A-Za-z_$][A-Za-z0-9_$]*Sync['"`]\s*\]/g;
/** `cdp['send'](…)` — a literal computed member dodges the `.send(` rule. */
const COMPUTED_SEND = /\[\s*['"`]send['"`]\s*\]\s*\(/g;
/** `cdp.send.bind(…)` — the call site then has no `.send(`. */
const BOUND_SEND = /\.send\s*\.\s*bind\s*\(/g;

/**
 * `const read = readFileSync;` / `const read = fs.readFileSync;`
 *
 * The reference rule above already counts these, but naming them separately
 * produces an error that says WHY rather than just reporting a count.
 */
const SYNC_VALUE_ALIAS = /(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*[A-Za-z_$][A-Za-z0-9_$.]*Sync\s*[;,\n]/g;

/**
 * @param {string} source
 * @param {RegExp} re
 * @returns {number}
 */
function countMatches(source, re) {
    return (source.match(new RegExp(re.source, re.flags)) || []).length;
}

/**
 * Aliases whose ORIGINAL name ends in `Sync`. Aliasing itself is fine and
 * already common here (`promises as fs`, `execFile as execFileCallback`);
 * banning all of it would fail the current tree.
 *
 * @param {string} source
 * @returns {string[]}
 */
function findSyncBindingAliases(source) {
    /** @type {string[]} */
    const found = [];
    for (const match of source.matchAll(NODE_BINDING)) {
        for (const clause of String(match[1]).split(',')) {
            const [original] = clause.split(/\s+as\s+/);
            if (!clause.includes(' as ')) continue;
            if (/Sync\s*$/.test(String(original).trim())) found.push(clause.trim());
        }
    }
    return found;
}

/**
 * @param {string} source
 * @returns {{ sync: number, cdp: number, nonLiteralSend: number, evasions: string[] }}
 */
export function scanSource(source) {
    const literalSend = countMatches(source, CDP_LITERAL_SEND);
    /** @type {string[]} */
    const evasions = [];
    if (countMatches(source, COMPUTED_FS_CALL) > 0) evasions.push('computed-member-call');
    if (countMatches(source, COMPUTED_STRING_MEMBER) > 0) evasions.push('computed-sync-member');
    if (countMatches(source, COMPUTED_SEND) > 0) evasions.push('computed-send');
    if (countMatches(source, BOUND_SEND) > 0) evasions.push('bound-send');
    if (countMatches(source, SYNC_VALUE_ALIAS) > 0) evasions.push('sync-value-alias');
    const storeLockCalls = countMatches(source, BLOCKING_STORE_LOCK);
    if (countMatches(source, COMPUTED_STORE_LOCK) > 0) evasions.push('computed-store-lock');
    // Every reference that is not a direct call is an alias or an indirect call
    // shape, both of which are rejected outright: a manifest cannot ratchet a
    // name it cannot predict. The file that DECLARES the lock carries one such
    // reference by definition, so it is allowed exactly that one.
    const declaresLock = STORE_LOCK_DECLARATION.test(source);
    STORE_LOCK_DECLARATION.lastIndex = 0;
    const indirectRefs = countMatches(source, ANY_STORE_LOCK_REF) - storeLockCalls - (declaresLock ? 1 : 0);
    if (indirectRefs > 0) evasions.push('store-lock-alias');
    for (const alias of findSyncBindingAliases(source)) evasions.push(`sync-binding-alias:${alias}`);
    return {
        sync: countMatches(source, SYNC_CALL) + countMatches(source, OTHER_BLOCKING),
        cdp: literalSend,
        nonLiteralSend: countMatches(source, ANY_SEND) - literalSend,
        blockingStoreLock: storeLockCalls,
        evasions,
    };
}

/**
 * Pure evaluator. Takes sources as data so tests never touch the real tree —
 * mutating checked-in files to exercise a gate would corrupt concurrent work.
 *
 * @param {{
 *   sources: Map<string, string>,
 *   baseline: { files: Record<string, { sync?: number, cdp?: number, nonLiteralSend?: number }>, totals: { sync: number, cdp: number } },
 * }} input
 * @returns {{ ok: boolean, detail: string }}
 */
export function evaluateBlockingIoGate({ sources, baseline }) {
    const limits = baseline?.files || {};
    /** @type {string[]} */
    const failures = [];
    /** @type {string[]} */
    const reductions = [];
    let totalSync = 0;
    let totalCdp = 0;

    for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
        const found = scanSource(source);
        totalSync += found.sync;
        totalCdp += found.cdp;
        // A file absent from the manifest has a limit of zero, so a brand-new
        // file cannot smuggle blocking IO in.
        const limit = limits[file] || { sync: 0, cdp: 0, nonLiteralSend: 0, blockingStoreLock: 0 };

        for (const evasion of found.evasions) {
            failures.push(`${file}: ${evasion} cannot be counted; use a direct call or keep it out of the runtime`);
        }
        if (found.sync > (limit.sync || 0)) {
            failures.push(`${file}: blocking IO ${found.sync} > allowed ${limit.sync || 0}`);
        } else if (found.sync < (limit.sync || 0)) {
            reductions.push(`${file} sync ${limit.sync}→${found.sync}`);
        }
        if (found.cdp > (limit.cdp || 0)) {
            failures.push(`${file}: CDP commands ${found.cdp} > allowed ${limit.cdp || 0}`);
        } else if (found.cdp < (limit.cdp || 0)) {
            reductions.push(`${file} cdp ${limit.cdp}→${found.cdp}`);
        }
        // Non-CDP `.send(` (ws, child process) is pinned per file rather than by
        // receiver name: allowing the name `ws` would let a CDP session be
        // renamed to `ws` and slip through.
        if (found.nonLiteralSend > (limit.nonLiteralSend || 0)) {
            failures.push(`${file}: non-literal .send() ${found.nonLiteralSend} > allowed ${limit.nonLiteralSend || 0}`);
        }
        // Ratcheted per file so a new caller of the blocking lock has to be a
        // deliberate, reviewed manifest change rather than an accident.
        if (found.blockingStoreLock > (limit.blockingStoreLock || 0)) {
            failures.push(`${file}: blocking withStoreLock ${found.blockingStoreLock} > allowed ${limit.blockingStoreLock || 0}; use withStoreLockAsync`);
        } else if (found.blockingStoreLock < (limit.blockingStoreLock || 0)) {
            reductions.push(`${file} withStoreLock ${limit.blockingStoreLock}→${found.blockingStoreLock}`);
        }
    }

    if (totalSync > baseline.totals.sync) {
        failures.push(`total blocking IO ${totalSync} > allowed ${baseline.totals.sync}`);
    }
    if (totalCdp > baseline.totals.cdp) {
        failures.push(`total CDP commands ${totalCdp} > allowed ${baseline.totals.cdp}`);
    }

    if (failures.length) return { ok: false, detail: failures.join('; ') };
    const detail = `blocking IO ${totalSync}/${baseline.totals.sync}, CDP ${totalCdp}/${baseline.totals.cdp}`;
    // Reductions pass but are reported rather than silently absorbed: tightening
    // the manifest stays a human commit so the history shows it.
    return {
        ok: true,
        detail: reductions.length
            ? `${detail} — reduced: ${reductions.join(', ')} (run --write-baseline to tighten)`
            : detail,
    };
}

/** Runtime directories this gate governs. Tests and build scripts are exempt. */
const SCANNED_DIRS = ['web-ai', 'skills/browser'];
/** `"type": "module"` means a `.js` file here is runtime code too. */
const SCANNED_EXTENSIONS = ['.mjs', '.js', '.cjs'];
/**
 * Browser-injected bundles: shipped as-is, never executed in the Node runtime.
 *
 * Listed as exact files, not a directory prefix. Excluding `vendor/` wholesale
 * would make it the easiest place to hide a runtime module.
 */
const EXCLUDED_FILES = new Set(['skills/browser/adaptive-fetch/vendor/defuddle.iife.min.js']);

/**
 * Read every runtime source as `relativePath → text`.
 *
 * Walks the real tree rather than the manifest: iterating the manifest would
 * skip new files entirely, which is the easiest way to add blocking IO.
 *
 * @param {string} repoRoot
 * @returns {Promise<Map<string, string>>}
 */
export async function readRuntimeSources(repoRoot) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    /** @type {Map<string, string>} */
    const sources = new Map();
    /** @param {string} dir */
    const walk = (dir) => {
        const abs = path.join(repoRoot, dir);
        if (!fs.existsSync(abs)) return;
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            // A symlink is neither followed nor ignored: following one needs
            // realpath containment and cycle handling, and ignoring it would
            // hide a whole subtree. There are none today, so refuse outright
            // rather than relying on a synthetic source to trip another rule.
            if (entry.isSymbolicLink()) {
                throw new Error(`blocking-io gate: symlink in runtime tree is not scannable: ${rel}`);
            }
            if (entry.isDirectory()) walk(rel);
            else if (SCANNED_EXTENSIONS.some(ext => entry.name.endsWith(ext))
                && !EXCLUDED_FILES.has(rel)) {
                sources.set(rel, fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
            }
        }
    };
    for (const dir of SCANNED_DIRS) walk(dir);
    return sources;
}

/**
 * @param {Map<string, string>} sources
 * @returns {{ files: Record<string, any>, totals: { sync: number, cdp: number } }}
 */
export function buildBaseline(sources) {
    /** @type {Record<string, any>} */
    const files = {};
    let sync = 0;
    let cdp = 0;
    for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
        const found = scanSource(source);
        if (!found.sync && !found.cdp && !found.nonLiteralSend && !found.blockingStoreLock) continue;
        files[file] = {
            sync: found.sync,
            cdp: found.cdp,
            nonLiteralSend: found.nonLiteralSend,
            ...(found.blockingStoreLock ? { blockingStoreLock: found.blockingStoreLock } : {}),
        };
        sync += found.sync;
        cdp += found.cdp;
    }
    return { files, totals: { sync, cdp } };
}

/**
 * Production adapter. Reads the COMMITTED manifest — never regenerates it here,
 * because a gate that derives its own limits from current source always passes.
 *
 * @param {string} repoRoot
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function runBlockingIoGate(repoRoot) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const manifestPath = path.join(repoRoot, 'scripts', 'blocking-io-baseline.json');
    if (!fs.existsSync(manifestPath)) {
        return { ok: false, detail: `baseline manifest missing: ${manifestPath}` };
    }
    const baseline = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return evaluateBlockingIoGate({ sources: await readRuntimeSources(repoRoot), baseline });
}

// `--write-baseline` is deliberately a separate, explicit invocation: the diff
// it produces is the review point for any loosening.
if (process.argv[1] && process.argv[1].endsWith('blocking-io-gate.mjs')) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    if (process.argv.includes('--write-baseline')) {
        const baseline = buildBaseline(await readRuntimeSources(repoRoot));
        const out = path.join(repoRoot, 'scripts', 'blocking-io-baseline.json');
        fs.writeFileSync(out, `${JSON.stringify(baseline, null, 4)}\n`);
        process.stdout.write(`wrote ${out}: sync=${baseline.totals.sync} cdp=${baseline.totals.cdp}\n`);
    } else {
        const result = await runBlockingIoGate(repoRoot);
        process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'} ${result.detail}\n`);
        process.exit(result.ok ? 0 : 1);
    }
}
