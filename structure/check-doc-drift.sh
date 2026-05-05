#!/usr/bin/env bash
# check-doc-drift.sh — minimum structure-doc drift gate for agbrowse.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node <<'NODE'
const fs = require('fs');

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

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

const requiredFiles = [
  'structure/AGENTS.md',
  'structure/INDEX.md',
  'structure/str_func.md',
  'structure/commands.md',
  'structure/runtime_contracts.md',
  'structure/release_gates.md',
  'structure/phase_status.md',
  'structure/verify-counts.sh',
  'structure/_legacy/.gitkeep',
  'docs/production-readiness.md',
  'docs/comparison.md',
  'docs/benchmarks.md',
  'benchmarks/agbrowse/trajectory.mjs',
  'benchmarks/agbrowse/run-task.mjs',
];

for (const file of requiredFiles) {
  if (fs.existsSync(file)) pass(`${file} exists`);
  else fail(`${file} is missing`);
}

const commandsDoc = read('structure/commands.md');
const runtimeDoc = read('structure/runtime_contracts.md');
const releaseDoc = read('structure/release_gates.md');
const phaseStatusDoc = read('structure/phase_status.md');
const indexDoc = read('structure/INDEX.md');
const readme = read('README.md');
const productionDoc = read('docs/production-readiness.md');
const comparisonDoc = read('docs/comparison.md');
const benchmarksDoc = read('docs/benchmarks.md');
const pkg = JSON.parse(read('package.json'));

const rootCommands = [
  'start', 'stop', 'status', 'reset',
  'snapshot', 'screenshot', 'text', 'get-dom',
  'click', 'type', 'press', 'hover', 'select', 'check', 'uncheck', 'drag',
  'mouse-click', 'move-mouse', 'mouse-down', 'mouse-up',
  'navigate', 'reload', 'resize', 'tabs', 'tab-switch', 'select-tab',
  'tab-cleanup', 'scroll',
  'wait', 'wait-for-selector', 'wait-for-text', 'wait-for',
  'console', 'network', 'evaluate',
  'web-ai', 'skills', 'install-skills',
];

const webAiCommands = [
  'render', 'status', 'send', 'poll', 'query', 'stop', 'watch',
  'snapshot', 'sessions list', 'sessions show', 'sessions resume',
  'sessions reattach', 'sessions prune', 'context-dry-run',
  'context-render', 'mcp-server', 'eval', 'doctor',
];

const mcpTools = [
  'browser_snapshot', 'browser_click_ref',
  'web_ai_snapshot', 'web_ai_click_ref', 'web_ai_submit_prompt',
  'web_ai_wait_response', 'web_ai_copy_markdown', 'web_ai_doctor',
  'web_ai_session_resume',
];

for (const command of rootCommands) {
  if (commandsDoc.includes(`\`${command}\``)) pass(`commands.md lists root command ${command}`);
  else fail(`commands.md missing root command ${command}`);
}

for (const command of webAiCommands) {
  if (commandsDoc.includes(`\`${command}\``)) pass(`commands.md lists web-ai command ${command}`);
  else fail(`commands.md missing web-ai command ${command}`);
}

for (const tool of mcpTools) {
  if (commandsDoc.includes(`\`${tool}\``)) pass(`commands.md lists MCP tool ${tool}`);
  else fail(`commands.md missing MCP tool ${tool}`);
}

const expectedScripts = [
  'test', 'test:unit', 'test:integration', 'test:eval',
  'test:contract-drift', 'test:trace-policy', 'test:mcp',
  'test:source-audit', 'test:release-gates', 'benchmark:trajectory',
  'release', 'release:preview',
];

for (const scriptName of expectedScripts) {
  if (pkg.scripts && pkg.scripts[scriptName]) pass(`package.json has ${scriptName}`);
  else fail(`package.json missing ${scriptName}`);
  if (releaseDoc.includes(`npm run ${scriptName}`) || releaseDoc.includes(`npm ${scriptName}`) || releaseDoc.includes(`\`${scriptName}\``)) {
    pass(`release_gates.md mentions ${scriptName}`);
  } else {
    fail(`release_gates.md missing ${scriptName}`);
  }
}

if (Array.isArray(pkg.files) && pkg.files.includes('structure/')) pass('package files include structure/');
else fail('package files missing structure/');
if (Array.isArray(pkg.files) && pkg.files.includes('docs/')) pass('package files include docs/');
else fail('package files missing docs/');
if (Array.isArray(pkg.files) && pkg.files.includes('benchmarks/')) pass('package files include benchmarks/');
else fail('package files missing benchmarks/');

if (readme.includes('structure/INDEX.md')) pass('README links structure/INDEX.md');
else fail('README missing structure/INDEX.md link');

for (const label of ['Ready surfaces', 'Beta surfaces', 'Experimental or deferred surfaces']) {
  if (readme.includes(label)) pass(`README includes ${label}`);
  else fail(`README missing ${label}`);
}

for (const docCheck of [
  [productionDoc, 'Ready', 'production-readiness.md labels ready surfaces'],
  [productionDoc, 'Beta', 'production-readiness.md labels beta surfaces'],
  [comparisonDoc, 'Comparison Rules', 'comparison.md has comparison rules'],
  [benchmarksDoc, 'Claim Boundary', 'benchmarks.md has claim boundary'],
]) {
  if (docCheck[0].includes(docCheck[1])) pass(docCheck[2]);
  else fail(docCheck[2]);
}

for (const linked of ['str_func.md', 'commands.md', 'runtime_contracts.md', 'release_gates.md', 'phase_status.md', 'check-doc-drift.sh', 'verify-counts.sh']) {
  if (indexDoc.includes(linked)) pass(`INDEX links ${linked}`);
  else fail(`INDEX missing ${linked}`);
}

for (const statusNeedle of ['18 MCP/AI SDK', '19 remote CDP adapters', '20 benchmark trajectory', '21 release gates']) {
  if (phaseStatusDoc.includes(statusNeedle)) pass(`phase_status.md tracks ${statusNeedle}`);
  else fail(`phase_status.md missing ${statusNeedle}`);
}

for (const forbiddenClaim of ['No stealth', 'No leaderboard score', 'No production MCP claim beyond']) {
  if (phaseStatusDoc.includes(forbiddenClaim)) pass(`phase_status.md blocks ${forbiddenClaim}`);
  else fail(`phase_status.md missing forbidden claim guard: ${forbiddenClaim}`);
}

for (const phase of [
  '13_phase12_trace_replay.md',
  '14_phase13_safety_policy.md',
  '15_phase14_active_command_ownership.md',
  '18_phase17_provider_contracts_source_audit.md',
  '19_phase18_mcp_ai_sdk_hardening.md',
  '22_phase21_release_gates.md',
]) {
  if (runtimeDoc.includes(phase)) pass(`runtime_contracts.md links ${phase}`);
  else fail(`runtime_contracts.md missing ${phase}`);
}

if (failures > 0) {
  console.error(`\n${failures} drift check(s) failed; ${passes} passed.`);
  process.exit(1);
}

console.log(`\nAll structure drift checks passed (${passes}).`);
NODE
