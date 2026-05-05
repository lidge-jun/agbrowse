#!/usr/bin/env node
// smoke-bins: prove both bin shims execute and respond to --help.
// Used in P00, P01, and every later phase to lock the bin contract.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const BINS = [
  'bin/agbrowse.mjs',
  'bin/agbrowse-vision-click.mjs',
];

let failed = 0;

for (const rel of BINS) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    console.error(`✗ missing bin: ${rel}`);
    failed += 1;
    continue;
  }
  const st = statSync(abs);
  if (!(st.mode & 0o111)) {
    console.error(`✗ not executable: ${rel}`);
    failed += 1;
  }

  const res = spawnSync(process.execPath, [abs, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, AGBROWSE_WEB_AI_AUTO_START: '0' },
  });
  if (res.status !== 0) {
    console.error(`✗ ${rel} --help exited ${res.status}`);
    if (res.stderr) console.error(res.stderr);
    failed += 1;
    continue;
  }
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  if (!/agbrowse|vision-click/i.test(out)) {
    console.error(`✗ ${rel} --help output looks wrong`);
    console.error(out.slice(0, 200));
    failed += 1;
    continue;
  }
  console.log(`✓ ${rel} --help ok`);
}

if (failed > 0) {
  console.error(`\nsmoke-bins: ${failed} failure(s).`);
  process.exit(1);
}
console.log('\n✅ smoke-bins ok.');
