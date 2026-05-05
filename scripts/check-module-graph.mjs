#!/usr/bin/env node
// @ts-check
/**
 * P03 — module-graph builder for the agbrowse strict migration.
 *
 * Walks the repo (excluding node_modules / .git / dist / .next / _legacy
 * / docs / structure / devlog) and parses every relative `from '…'`
 * specifier in *.mjs sources. Resolves each specifier with the candidate
 * extension set ['', '.mjs', '/index.mjs'].
 *
 * Output: docs/migration/module-graph.json with
 *   { generated_at, total_mjs, fan_in, fan_out, edges, leaves, tiers }
 *
 * The script is idempotent and side-effect-free except for writing the
 * cached graph artifact. It is invoked as part of `check:module-graph`.
 *
 * Tier assignment uses longest-path-from-leaf with cycle short-circuit at
 * depth 0; the generated artifact records the unsorted depth per node.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, relative, resolve, posix } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SKIP = new Set([
    'node_modules',
    '.git',
    '.next',
    'dist',
    '_legacy',
]);

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listMjs(dir) {
    /** @type {string[]} */
    const out = [];
    const stack = [dir];
    while (stack.length > 0) {
        const cur = /** @type {string} */ (stack.pop());
        let entries;
        try {
            entries = await readdir(cur, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            if (SKIP.has(ent.name)) continue;
            const p = join(cur, ent.name);
            if (ent.isDirectory()) {
                stack.push(p);
            } else if (ent.isFile() && ent.name.endsWith('.mjs')) {
                out.push(p);
            }
        }
    }
    return out;
}

/**
 * @param {string} p
 * @returns {string}
 */
function toRel(p) {
    return relative(root, p).split(/[\\/]/).join('/');
}

/**
 * Static and dynamic module specifier forms recognized by Node ESM:
 *   • `from '…'`            — `import x from '…'`, `export { x } from '…'`
 *   • `import '…'`           — bare side-effect import
 *   • `export * from '…'`    — re-export all
 *   • `import('…')`          — dynamic import (literal arg only)
 *
 * Specifiers built from template literals or runtime expressions are out
 * of scope; the strict-migration plan does not currently emit any.
 */
const SPEC_RES = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * @param {string} src
 * @returns {string[]}
 */
function extractRelImports(src) {
    /** @type {Set<string>} */
    const out = new Set();
    for (const re of SPEC_RES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
            if (m[1].startsWith('.')) out.add(m[1]);
        }
    }
    return [...out];
}

/**
 * @param {string} fromAbs
 * @param {string} spec
 * @param {Set<string>} fileSet
 * @returns {string|null}
 */
function resolveRelative(fromAbs, spec, fileSet) {
    const base = normalize(resolve(dirname(fromAbs), spec));
    for (const ext of ['', '.mjs', '/index.mjs']) {
        const cand = base + ext;
        if (fileSet.has(cand)) return cand;
    }
    return null;
}

async function main() {
    const absFiles = await listMjs(root);
    const fileSet = new Set(absFiles);

    /** @type {Record<string,string[]>} */
    const edges = Object.create(null);
    /** @type {Record<string,number>} */
    const fanIn = Object.create(null);
    /** @type {Record<string,number>} */
    const fanOut = Object.create(null);

    for (const abs of absFiles) {
        const src = readFileSync(abs, 'utf8');
        const specs = extractRelImports(src);
        const rel = toRel(abs);
        const deps = new Set();
        for (const s of specs) {
            const target = resolveRelative(abs, s, fileSet);
            if (!target) continue;
            const trel = toRel(target);
            deps.add(trel);
            fanIn[trel] = (fanIn[trel] ?? 0) + 1;
        }
        const list = [...deps].sort();
        edges[rel] = list;
        fanOut[rel] = list.length;
    }

    // Tier assignment: longest path from leaf
    const memo = Object.create(null);
    /**
     * @param {string} f
     * @param {Set<string>} stack
     */
    const depth = (f, stack) => {
        if (memo[f] !== undefined) return memo[f];
        if (stack.has(f)) return 0;
        const deps = edges[f] ?? [];
        if (deps.length === 0) {
            memo[f] = 0;
            return 0;
        }
        stack.add(f);
        let best = 0;
        for (const d of deps) {
            const v = depth(d, stack);
            if (v + 1 > best) best = v + 1;
        }
        stack.delete(f);
        memo[f] = best;
        return best;
    };

    /** @type {Record<string,number>} */
    const tiers = {};
    for (const f of Object.keys(edges).sort()) tiers[f] = depth(f, new Set());

    const leaves = Object.keys(edges).filter((f) => edges[f].length === 0).sort();

    const out = {
        generated_at: new Date().toISOString(),
        total_mjs: absFiles.length,
        fan_in: Object.fromEntries(
            Object.entries(fanIn).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
        ),
        fan_out: fanOut,
        leaves,
        tiers,
        edges,
    };

    const outDir = resolve(root, 'docs', 'migration');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
        resolve(outDir, 'module-graph.json'),
        `${JSON.stringify(out, null, 2)}\n`,
        'utf8',
    );
    process.stdout.write(
        `module-graph: ${absFiles.length} .mjs files, ${leaves.length} leaves, max tier ${Math.max(...Object.values(tiers))}\n`,
    );
}

main().catch((err) => {
    process.stderr.write(`check-module-graph failed: ${err?.stack ?? err}\n`);
    process.exit(1);
});
