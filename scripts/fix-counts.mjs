#!/usr/bin/env node
// fix-counts.mjs — rewrite structure/str_func.md count tables to match the live tree.
// Mirrors the walker in structure/verify-counts.sh so updates round-trip cleanly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
process.chdir(ROOT);

const DOC = 'structure/str_func.md';
const original = fs.readFileSync(DOC, 'utf8');

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
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  })(full);
  let lines = 0;
  for (const file of files) {
    lines += fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
  }
  return { files: files.length, lines };
}

const aggregateRegex = /^(\|\s+`([^`]+)`\s+\|\s+)(\d+)(\s+\|\s+)(\d+)(\s+\|)/;
const fileRegex = /^(\|\s+`([^`]+)`\s+\|\s+)(\d+)(\s+\|)/;

let drift = 0;
const updated = original.split(/\r?\n/).map((line) => {
  const agg = line.match(aggregateRegex);
  if (agg) {
    const [, prefix, relPath, files, mid, lines, suffix] = agg;
    const actual = countPath(relPath);
    if (!actual) return line;
    if (String(actual.files) === files && String(actual.lines) === lines) return line;
    drift += 1;
    const rest = line.slice(agg[0].length);
    return `${prefix}${actual.files}${mid}${actual.lines}${suffix}${rest}`;
  }
  const file = line.match(fileRegex);
  if (file) {
    const [, prefix, relPath, lines, suffix] = file;
    if (relPath.endsWith('/')) return line;
    const full = path.join(process.cwd(), relPath);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return line;
    const actualLines = fs.readFileSync(full, 'utf8').split(/\r?\n/).length;
    if (String(actualLines) === lines) return line;
    drift += 1;
    const rest = line.slice(file[0].length);
    return `${prefix}${actualLines}${suffix}${rest}`;
  }
  return line;
});

let next = updated.join('\n');

if (drift > 0) {
  const today = new Date().toISOString().slice(0, 10);
  next = next.replace(/^마지막 측정: \d{4}-\d{2}-\d{2}\.$/m, `마지막 측정: ${today}.`);
}

if (next !== original) {
  fs.writeFileSync(DOC, next);
  console.log(`fix-counts: updated ${drift} row(s) in ${DOC}`);
} else {
  console.log(`fix-counts: no drift in ${DOC}`);
}
