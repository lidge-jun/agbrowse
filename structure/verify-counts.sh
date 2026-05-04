#!/usr/bin/env bash
# verify-counts.sh — verify str_func.md source snapshot counts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const doc = fs.readFileSync('structure/str_func.md', 'utf8');
let failures = 0;
let passes = 0;

function pass(message) {
  console.log(`PASS ${message}`);
  passes += 1;
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

function countPath(relPath) {
  const full = path.join(process.cwd(), relPath);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    return {
      files: 1,
      lines: fs.readFileSync(full, 'utf8').split(/\r?\n/).length,
    };
  }
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  walk(full);
  let lines = 0;
  for (const file of files) {
    try {
      lines += fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
    } catch {
      fail(`could not read ${path.relative(process.cwd(), file)}`);
    }
  }
  return { files: files.length, lines };
}

const aggregateRows = [];
for (const line of doc.split(/\r?\n/)) {
  const match = line.match(/^\|\s+`([^`]+)`\s+\|\s+(\d+)\s+\|\s+(\d+)\s+\|/);
  if (!match) continue;
  aggregateRows.push({
    relPath: match[1],
    files: Number(match[2]),
    lines: Number(match[3]),
  });
}

for (const row of aggregateRows) {
  const actual = countPath(row.relPath);
  if (!actual) {
    fail(`${row.relPath} does not exist`);
    continue;
  }
  if (actual.files === row.files && actual.lines === row.lines) {
    pass(`${row.relPath} count matches (${actual.files} files, ${actual.lines} lines)`);
  } else {
    fail(`${row.relPath} count drift: doc ${row.files} files/${row.lines} lines vs actual ${actual.files} files/${actual.lines} lines`);
  }
}

const fileRows = [];
for (const line of doc.split(/\r?\n/)) {
  const match = line.match(/^\|\s+`([^`]+)`\s+\|\s+(\d+)\s+\|/);
  if (!match) continue;
  const relPath = match[1];
  if (relPath.endsWith('/')) continue;
  fileRows.push({ relPath, lines: Number(match[2]) });
}

for (const row of fileRows) {
  const full = path.join(process.cwd(), row.relPath);
  if (!fs.existsSync(full)) {
    fail(`${row.relPath} does not exist`);
    continue;
  }
  if (!fs.statSync(full).isFile()) continue;
  const actualLines = fs.readFileSync(full, 'utf8').split(/\r?\n/).length;
  if (actualLines === row.lines) {
    pass(`${row.relPath} line count matches (${actualLines})`);
  } else {
    fail(`${row.relPath} line drift: doc ${row.lines} vs actual ${actualLines}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} count check(s) failed; ${passes} passed.`);
  process.exit(1);
}

console.log(`\nAll structure count checks passed (${passes}).`);
NODE

