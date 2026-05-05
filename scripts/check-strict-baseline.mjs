#!/usr/bin/env node
// strict-baseline gate for agbrowse.
// - Counts `\bany\b` and `@strict-debt` markers per tracked directory.
// - Compares against the frozen floor recorded in docs/migration/strict-baseline.md.
// - Runs `tsc --noEmit` with the root tsconfig.
//
// Mirrors cli-jaw/scripts/check-strict-baseline.mjs in spirit; tuned to the
// agbrowse layout (bin/, web-ai/, skills/, scripts/, test/).

import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const TRACKED_DIRS = [
  'bin',
  'web-ai',
  'skills',
  'scripts',
  'benchmarks',
  'types',
];

const SOURCE_GLOBS = ['**/*.{ts,mts,cts}', '!**/*.d.ts'];
const ANY_RE = /\bany\b/g;
const DEBT_RE = /@strict-debt\b/g;

function readBaseline() {
  const p = join(ROOT, 'docs', 'migration', 'strict-baseline.md');
  let text;
  try {
    text = readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  const rows = {};
  const tableRe = /\|\s*([\w./-]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g;
  for (const m of text.matchAll(tableRe)) {
    const dir = m[1];
    if (dir === 'dir') continue;
    rows[dir] = {
      any: Number(m[2]),
      debt: Number(m[3]),
      allow: Number(m[4]),
    };
  }
  return rows;
}

async function countDir(dir) {
  const abs = join(ROOT, dir);
  try {
    if (!statSync(abs).isDirectory()) return { any: 0, debt: 0 };
  } catch {
    return { any: 0, debt: 0 };
  }
  const files = await fg(SOURCE_GLOBS, { cwd: abs, absolute: true, dot: false });
  let any = 0;
  let debt = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    any += (text.match(ANY_RE) ?? []).length;
    debt += (text.match(DEBT_RE) ?? []).length;
  }
  return { any, debt };
}

async function main() {
  const baseline = readBaseline();
  const counts = {};
  for (const dir of TRACKED_DIRS) {
    counts[dir] = await countDir(dir);
  }

  let regressions = 0;
  console.log('## strict-baseline counts');
  console.log('| dir | any | debt | allow |');
  console.log('|-----|----:|-----:|------:|');
  for (const dir of TRACKED_DIRS) {
    const c = counts[dir];
    const allow = baseline?.[dir]?.allow ?? 0;
    console.log(`| ${dir} | ${c.any} | ${c.debt} | ${allow} |`);
    if (baseline) {
      const floor = baseline[dir];
      if (floor && c.any > floor.any) {
        console.error(`✗ ${dir}: any count ${c.any} > frozen floor ${floor.any}`);
        regressions += 1;
      }
      if (floor && c.debt > floor.debt) {
        console.error(`✗ ${dir}: debt count ${c.debt} > frozen floor ${floor.debt}`);
        regressions += 1;
      }
    }
  }

  console.log('\n## strict-baseline typecheck gate');
  const tsc = spawnSync('npx', ['tsc', '--noEmit'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (tsc.status !== 0) {
    console.error('✗ tsc --noEmit failed');
    process.exit(1);
  }
  console.log('root: ok');

  if (regressions > 0) {
    console.error(`\n✗ strict-baseline regressions: ${regressions}`);
    process.exit(1);
  }
  console.log('\n✅ strict-baseline OK (no regressions in tracked directories).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
