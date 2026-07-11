# Perplexity Web-AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Perplexity as a first-class Web-AI provider with fail-closed model and Thinking controls, lossless answer/citation persistence, provider-safe session recovery, CLI/MCP support, and deterministic browser fixtures.

**Architecture:** Follow the existing Gemini/Grok pair-module lifecycle: `perplexity-model.mjs` owns picker inspection and mutation, `perplexity-citations.mjs` owns pure citation normalization, and `perplexity-live.mjs` owns status/send/poll/query/stop. Shared identity, artifact, timeout, and recovery contracts are completed before any browser mutation so every later task can reach Green independently.

**Tech Stack:** Node.js ESM with `// @ts-check`, Playwright Core over CDP, Vitest, JSON session persistence, sanitized provider DOM fixtures.

## Global Constraints

- Provider ID is exactly `perplexity`; default URL is `https://www.perplexity.ai`.
- Implementation commands run from a complete Git checkout. The external-review ZIP is source evidence only and is not an executable checkout.
- Provider-specific argument validation completes before `ensureProviderTab()`, `deps.getPage()`, `openFreshPerplexityThread()`, `page.goto()`, or any `Page`/`Locator` operation.
- `--model` omission does not mutate the picker; `--effort` omission does not mutate Thinking.
- Perplexity `--effort` requires an explicit `--model`.
- Thinking OFF aliases are `off`, `low`, `light`, `standard`, `normal`, `default`.
- Thinking ON aliases are `on`, `extended`, `high`, `xhigh`, `heavy`.
- Ambiguous/missing rows, group headings, unknown lock state, noninteractive rows, ambiguous switches, and unknown selected state fail before click.
- Locked rows fail with `provider.model-entitlement` and retry hint `choose-unlocked-model`.
- Missing or ambiguous Thinking controls fail with `provider.mode-unavailable` and retry hint `omit-effort-or-change-model`.
- `Sonar 2` is an observed selectable `menuitemradio` and is included as alias `sonar-2`.
- Observed selectable V1 aliases are `best`, `sonar-2`, `gpt-5.6-terra`, `gemini-3.1-pro`, `claude-sonnet-5`, `glm-5.2`, `kimi-k2.6`, and `nemotron-3-ultra`.
- Observed locked aliases are `gpt-5.6-sol` and `claude-opus-4.8`; they are valid inputs that fail before click.
- Thinking is the selected model row's immediate next element sibling, which must be a `menuitemcheckbox` named exactly `Thinking` and contain exactly one direct-child `button[role=switch]`; selector traversal may not skip intervening siblings.
- After a model or switch click that can close/rerender the picker, every previously created menu, row, checkbox, and switch Locator is invalid and must be reacquired.
- Status separates fixture-backed `supportsThinking` from live `thinkingControlPresent`; it never infers an unselected model's live Thinking control.
- Standalone send opens a fresh Perplexity thread; session-bound send/query never does.
- A Perplexity send resolves a non-null target ID before provider mutation or fails with `cdp.target-mismatch`.
- The send baseline is captured after model/Thinking selection, composer insertion, and attachment-preview verification, immediately before submit.
- Every successful send records a baseline, `assistantCount`, active lease, target binding, model evidence, and `reasoningEffort`: canonical `on|off` when explicitly requested or unambiguously observed, otherwise `null`.
- Poll completion requires a unique newly committed response identity, settled citation state, and `streamingState === 'idle'`; truthiness checks are forbidden. An ambiguous response root is never a citation-degradation case and never completes.
- Citation state is `present|none-confirmed|unavailable|pending|unknown`. Only `present`, `none-confirmed`, and `unavailable` can settle; `unavailable` completes after the citation grace with `citations: []` and warning `citations-unavailable`.
- `PERPLEXITY_CITATION_GRACE_MS` is exactly `2000`.
- Poll uses `resolveTimeoutBudgetSec()`, calls `markSessionTimeout()` on timeout, and returns recoverable `tab-crashed` for `isPageDeathError()`.
- ChatGPT and Perplexity stored-conversation `page.goto()` and `createTab()` calls pass their provider-specific guard immediately before navigation. Existing ChatGPT query-bearing `/c/<id>` acceptance remains unchanged; Gemini/Grok are not narrowed without captured URL fixtures.
- Until another authenticated route format is captured, a Perplexity conversation path is exactly `/search/<UUID>` with an optional trailing slash.
- `perplexity.ai` and `www.perplexity.ai` are one lifecycle provider pool and share cleanup limits.
- Provider origin identity is shared by tab acquisition, driveability, navigation readiness, recovery compatibility, and cleanup. Successful navigation persists the browser's canonical live URL (`www.perplexity.ai` today).
- `web-ai watch`, `sessions resume`, and `sessions reattach --navigate` are required Perplexity integration surfaces.
- A completed Perplexity artifact always has `citations`, including `[]`.
- `answer` is byte-for-byte equal to `answerArtifact.text`.
- Default timeout is 1200 seconds; Thinking-enabled timeout is 3600 seconds, including resume fallback without a stored deadline.
- `SESSION_STORE_VERSION` remains `1`.
- `provider-adapter.mjs` stays contract-only, but its vendor typedef includes Perplexity.
- `parallel-eval.json` remains unchanged because it is the existing parallel-isolation contract.
- Fixture provenance distinguishes authenticated `live-captured` fixtures from deterministic `derived` adversarial fixtures; synthetic failure states are never labeled `live-frontend`.
- The live DOM source of truth is `docs/superpowers/specs/2026-07-11-perplexity-live-dom-observation.md`.
- The GPT-5.6 High review records are `docs/superpowers/specs/2026-07-11-chatgpt-5.6-high-plan-review.md` and `docs/superpowers/specs/2026-07-11-chatgpt-5.6-high-plan-rereview.md`.
- The follow-up external review disposition is `docs/superpowers/specs/2026-07-11-perplexity-plan-external-rereview.md`.
- Conflicting CLI aliases (`--effort` and `--reasoning-effort`) and MCP requested-provider/session-vendor mismatches fail before browser, target, session-page, or navigation access.
- Status may open and close the unique model menu for inspection, but must not click a model row, Thinking checkbox/switch, Search, Computer, Connectors, or Spaces; it verifies selected state is unchanged before returning.
- Spaces, Focus, Deep Research, login automation, and subscription changes are out of scope.
- Every task ends Red → Green → Refactor → existing-provider regression → commit.
- Refactor steps preserve public signatures, mutation call counts, fixture intent coverage, and serialized warning/error contracts.

## File Map

### New production files

- `web-ai/perplexity-model.mjs`: canonical aliases, request validation, unique row inspection, lock classification, selection and Thinking postconditions.
- `web-ai/perplexity-citations.mjs`: citation URL/index normalization and committed-response extraction.
- `web-ai/perplexity-live.mjs`: provider status/send/poll/query/stop lifecycle.
- `web-ai/provider-url-identity.mjs`: shared provider host identity, strict Perplexity conversation grammar, and conversation-ID compatibility.

### New tests and fixtures

- `test/unit/web-ai-perplexity-model.test.mjs`
- `test/unit/web-ai-perplexity-citations.test.mjs`
- `test/unit/web-ai-perplexity-live-policy.test.mjs`
- `test/integration/web-ai-perplexity-session.test.mjs`
- `test/fixtures/provider-dom/perplexity-model-picker-ko.html`
- `test/fixtures/provider-dom/perplexity-model-picker-en.html`
- `test/fixtures/provider-dom/perplexity-model-picker-close.html`
- `test/fixtures/provider-dom/perplexity-baseline.html`
- `test/fixtures/provider-dom/perplexity-cosmetic-churn.html`
- `test/fixtures/provider-dom/perplexity-structural-churn.html`
- `test/fixtures/provider-dom/perplexity-breaking.html`
- `test/fixtures/provider-dom/perplexity-streaming.html`
- `test/fixtures/provider-dom/perplexity-complete-citations.html`
- `test/fixtures/provider-dom/perplexity-copy-decoys.html`
- `test/fixtures/provider-dom/perplexity-blocking-overlay.html`
- `test/fixtures/provider-dom/perplexity-attachment-preview.html`
- `test/fixtures/provider-dom/perplexity-thinking-on.html`
- `test/fixtures/provider-dom/perplexity-thinking-off.html`
- `test/fixtures/provider-dom/perplexity-model-picker-locked.html`
- `test/fixtures/provider-dom/perplexity-model-picker-duplicate-switch.html`
- `test/fixtures/provider-dom/perplexity-thinking-adjacent-decoys.html`
- `test/fixtures/provider-dom/perplexity-thinking-detached-reopen.html`
- `test/fixtures/provider-dom/perplexity-late-citation.html`
- `test/fixtures/provider-dom/perplexity-sources-pane-open.html`
- `test/fixtures/provider-dom/perplexity-sources-pane-stale.html`
- `test/fixtures/provider-dom/perplexity-sources-pane-close.html`
- `test/fixtures/provider-dom/perplexity-eval.json`
- `test/fixtures/provider-dom/perplexity-fixture-provenance.json`
- `test/unit/web-ai-provider-url-identity.test.mjs`
- `test/fixtures/session-store/read-session-summary.mjs`

### Shared surfaces modified

- Identity/types: `web-ai/types.mjs`, `types/agbrowse-shared.d.ts`, `web-ai/question.mjs`, `web-ai/constants.mjs`, `web-ai/provider-adapter.mjs`, `web-ai/capability-types.mjs`, `web-ai/capability-registry.mjs`, `web-ai/capability-observation-presets.mjs`, `web-ai/eval/types.mjs`, `web-ai/errors.mjs`
- Persistence/timeouts: `web-ai/answer-artifact.mjs`, `web-ai/tab-finalizer.mjs`, `web-ai/session.mjs`, `web-ai/session-store.mjs`
- Recovery: `web-ai/tab-recovery.mjs`, `web-ai/navigation-ready.mjs`, `web-ai/watcher.mjs`
- Tab lifecycle: `skills/browser/tab-lifecycle.mjs`
- CLI/MCP: `web-ai/cli.mjs`, `web-ai/cli-sessions.mjs`, `web-ai/mcp-server.mjs`, `web-ai/tool-schema.mjs`
- Diagnostics/policy: `web-ai/copy-markdown.mjs`, `web-ai/doctor.mjs`, `web-ai/policy/default-policy.mjs`, `web-ai/vendor-editor-contract.mjs`
- Public help/docs: `skills/browser/browser.mjs`, `skills/browser/search.mjs`, `skills/browser/SKILL.md`, `skills/browser/extract.mjs`, `skills/search/references/cli-reference.md`, `skills/web-ai/SKILL.md`, `README.md`, `structure/`, `docs/index.html`, `docs/dev/`

## Preflight: Establish An Executable Baseline

- [ ] **Step 1: Confirm this is a complete checkout**

```bash
git rev-parse --is-inside-work-tree
test -f docs/production-readiness.md
test -f docs/comparison.md
test -f docs/benchmarks.md
test -f benchmarks/agbrowse/trajectory.mjs
test -f benchmarks/agbrowse/run-task.mjs
test -f bin/agbrowse.mjs
test -f docs/superpowers/specs/2026-07-11-chatgpt-5.6-high-plan-rereview.md
test -f docs/superpowers/specs/2026-07-11-perplexity-plan-external-rereview.md
command -v jq
command -v timeout
```

Expected: every command exits 0. Do not execute this plan from the review ZIP.

- [ ] **Step 2: Install the lockfile dependency tree**

```bash
npm ci
git diff --exit-code -- package-lock.json
node ./bin/agbrowse.mjs --help >/dev/null
```

Expected: exits 0 and does not modify the lockfile.

- [ ] **Step 3: Record baseline results**

```bash
set -euo pipefail
mkdir -p devlog/_baseline/260711_perplexity_web_ai
npm test 2>&1 | tee devlog/_baseline/260711_perplexity_web_ai/npm-test.log
npm run docs:drift 2>&1 | tee devlog/_baseline/260711_perplexity_web_ai/docs-drift.log
npm run gate:all 2>&1 | tee devlog/_baseline/260711_perplexity_web_ai/gate-all.log
npm run pack:dry 2>&1 | tee devlog/_baseline/260711_perplexity_web_ai/pack-dry.log
```

Expected: PASS. If a pre-existing failure is reproducible, record the exact test, error, and issue/owner in `devlog/_baseline/260711_perplexity_web_ai/README.md`; do not weaken new assertions to accommodate it.

## Per-Task Green Gate

After every task that changes production JavaScript, run:

```bash
npm run typecheck:checkjs
npm run check:module-graph
```

Tasks 5-10 also run:

```bash
npm run typecheck:checkjs-dom
```

The task is not Green and must not be committed if any gate fails.

---

### Task 0: Register Identity, Error Taxonomy, And Capability Scope

**Files:**
- Modify: `web-ai/types.mjs`
- Modify: `types/agbrowse-shared.d.ts`
- Modify: `web-ai/question.mjs`
- Modify: `web-ai/constants.mjs`
- Modify: `web-ai/provider-adapter.mjs`
- Modify: `web-ai/capability-types.mjs`
- Modify: `web-ai/capability-registry.mjs`
- Modify: `web-ai/capability-observation-presets.mjs`
- Modify: `web-ai/eval/types.mjs`
- Modify: `web-ai/errors.mjs`
- Modify: `test/unit/web-ai-errors.test.mjs`
- Modify: `test/unit/web-ai-capability-registry.test.mjs`
- Modify: `test/unit/web-ai-observation-presets.test.mjs`
- Modify: `test/unit/web-ai-capability-freshness.test.mjs`
- Modify: `test/unit/web-ai-question.test.mjs`
- Modify: `test/unit/web-ai-eval-types.test.mjs`
- Modify: `test/unit/web-ai-provider-adapter.test.mjs`

**Interfaces:**
- Produces: `WEB_AI_VENDOR.PERPLEXITY === 'perplexity'`
- Produces: `normalizeEnvelope({ vendor: 'perplexity' })`
- Produces: `normalizeEvalVendor('perplexity')`
- Produces: `modelMismatchError(vendor, model, evidence)`
- Produces: `modelEntitlementError(vendor, model, evidence)`
- Produces: `modeUnavailableError(vendor, model, effort, evidence)`

- [ ] **Step 1: Write Red identity tests**

```js
it('accepts a Perplexity question envelope', () => {
    expect(normalizeEnvelope({
        vendor: 'perplexity',
        prompt: 'hello',
    }).vendor).toBe('perplexity');
});

it('accepts Perplexity as an eval vendor', () => {
    expect(normalizeEvalVendor('perplexity')).toBe('perplexity');
});
```

Add exact error tests:

```js
expect(modelMismatchError('perplexity', 'unknown').toJSON())
    .toMatchObject({
        errorCode: 'provider.model-mismatch',
        retryHint: 'model-fallback',
        vendor: 'perplexity',
        mutationAllowed: false,
    });
expect(modelEntitlementError('perplexity', 'gpt-5.6-sol').toJSON())
    .toMatchObject({
        errorCode: 'provider.model-entitlement',
        retryHint: 'choose-unlocked-model',
        mutationAllowed: false,
    });
expect(modeUnavailableError(
    'perplexity',
    'gpt-5.6-terra',
    'on',
).toJSON()).toMatchObject({
    errorCode: 'provider.mode-unavailable',
    retryHint: 'omit-effort-or-change-model',
    mutationAllowed: false,
});
expect(optionConflictError('effort', 'on', 'off').toJSON())
    .toMatchObject({
        errorCode: 'provider.option-conflict',
        stage: 'provider-input-validation',
        mutationAllowed: false,
    });
expect(sessionVendorMismatchError(
    'perplexity',
    'chatgpt',
    'session-1',
).toJSON()).toMatchObject({
    errorCode: 'provider.session-vendor-mismatch',
    stage: 'session-resolve',
    vendor: 'perplexity',
    mutationAllowed: false,
});
```

Add six Perplexity capability rows and observation-preset assertions:
`active-tab-verification`, `composer-visible`, `model-alias-selectable`,
`upload-surface-visible`, `copy-button-present`, and `response-streaming`.

- [ ] **Step 2: Verify Red**

```bash
set -euo pipefail
npx vitest run \
  test/unit/web-ai-question.test.mjs \
  test/unit/web-ai-eval-types.test.mjs \
  test/unit/web-ai-provider-adapter.test.mjs \
  test/unit/web-ai-errors.test.mjs \
  test/unit/web-ai-capability-registry.test.mjs \
  test/unit/web-ai-observation-presets.test.mjs \
  test/unit/web-ai-capability-freshness.test.mjs
```

Expected: Perplexity identity assertions fail before any browser code exists.

- [ ] **Step 3: Add pure identity, error, and capability contracts**

Add `PERPLEXITY: 'perplexity'` to the shared vendor constant and all additive unions. Extend:

```js
const SUPPORTED_VENDORS = new Set([
    WEB_AI_VENDOR.CHATGPT,
    WEB_AI_VENDOR.GEMINI,
    WEB_AI_VENDOR.GROK,
    WEB_AI_VENDOR.PERPLEXITY,
]);

export const EVAL_VENDORS = [
    'chatgpt',
    'gemini',
    'grok',
    'perplexity',
];
```

Do not add live dispatch or browser mutation in this task.

Add these exact factories to `web-ai/errors.mjs`:

```js
export function modelMismatchError(vendor, model, evidence = {}) {
    return providerError(vendor, {
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        retryHint: 'model-fallback',
        message: model
            ? `unsupported ${vendor} model: ${model}`
            : `invalid ${vendor} model selection request`,
        mutationAllowed: false,
        evidence: { model, ...evidence },
    });
}

export function modelEntitlementError(vendor, model, evidence = {}) {
    return providerError(vendor, {
        errorCode: 'provider.model-entitlement',
        stage: 'provider-select-mode',
        retryHint: 'choose-unlocked-model',
        message: `${vendor} model is locked: ${model}`,
        mutationAllowed: false,
        evidence: { model, ...evidence },
    });
}

export function modeUnavailableError(
    vendor,
    model,
    effort,
    evidence = {},
) {
    return providerError(vendor, {
        errorCode: 'provider.mode-unavailable',
        stage: 'provider-select-mode',
        retryHint: 'omit-effort-or-change-model',
        message:
            `${vendor} Thinking control is unavailable`
            + (model ? ` for ${model}` : ''),
        mutationAllowed: false,
        evidence: { model, effort, ...evidence },
    });
}
```

Also add `optionConflictError(primaryName, primaryValue, aliasValue)` and
`sessionVendorMismatchError(sessionVendor, requestedProvider, sessionId)`
factories with the exact codes/stages asserted in Step 1. Task 9 and Task 10
consume these factories rather than constructing ad hoc errors.

Extend `WebAiVendorScope` with `perplexity`. Add these observation exports:

```js
export const PERPLEXITY_MODEL_PICKER_OBSERVATION = {
    status: 'not-observed',
    source: 'planning',
    selectorCandidates: [],
    textCandidates: [],
    activationPath: [],
    activeStateSignals: [],
    mutationRisk: 'medium',
    notes: ['Task 5 replaces this with fixture-backed evidence.'],
};

export const PERPLEXITY_UPLOAD_OBSERVATION = {
    status: 'not-observed',
    source: 'planning',
    selectorCandidates: [],
    textCandidates: [],
    activationPath: [],
    activeStateSignals: [],
    mutationRisk: 'medium',
    notes: ['Task 5 replaces this with fixture-backed evidence.'],
};

export const PERPLEXITY_RESPONSE_OBSERVATION = {
    status: 'not-observed',
    source: 'planning',
    selectorCandidates: [],
    textCandidates: [],
    activationPath: [],
    activeStateSignals: [],
    mutationRisk: 'read-only',
    notes: ['Task 5 replaces this with fixture-backed evidence.'],
};
```

Add the six registry entries with vendor `perplexity`, status `planned`,
owner PRD `perplexity-web-ai-v1`, the matching observation above, and these
families: active-tab/session `sessionReattach`, composer/model `modelSelection`,
upload `attachments`, copy `copyOrExport`, streaming `responseCapture`.

Each row uses `requiredOfficialDocs: []`, `browserGate: 'partial'`,
`cliJawPortGate: 'absent'`, and the following mutation/failure contract:

```js
[
    [
        'perplexity-active-tab-verification',
        false,
        'status',
        'verify perplexity.ai before browser mutation',
    ],
    [
        'perplexity-composer-visible',
        false,
        'composer-prereq',
        'resolve #ask-input as the unique visible composer',
    ],
    [
        'perplexity-model-alias-selectable',
        true,
        'provider-select-mode',
        'select one observed menuitemradio and verify aria-checked',
    ],
    [
        'perplexity-upload-surface-visible',
        true,
        'attachment-preflight',
        'open Add files or tools and verify attachment preview',
    ],
    [
        'perplexity-copy-button-present',
        false,
        'poll',
        'resolve Copy in the committed answer footer',
    ],
    [
        'perplexity-response-streaming',
        false,
        'poll',
        'classify Stop response (Esc) as streaming',
    ],
]
```

The fourth tuple value is the required `commandBehavior` field.

- [ ] **Step 4: Verify Green**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Refactor and regress existing vendors**

Use the shared vendor constant where it removes duplicate literal unions, but keep `provider-adapter.mjs` disabled. Run:

```bash
npx vitest run \
  test/unit/web-ai-question.test.mjs \
  test/unit/web-ai-eval-types.test.mjs \
  test/unit/web-ai-provider-adapter.test.mjs \
  test/unit/web-ai-provider-session.test.mjs \
  test/unit/web-ai-errors.test.mjs \
  test/unit/web-ai-capability-registry.test.mjs \
  test/unit/web-ai-observation-presets.test.mjs \
  test/unit/web-ai-capability-freshness.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add web-ai/types.mjs types/agbrowse-shared.d.ts web-ai/question.mjs \
  web-ai/constants.mjs web-ai/provider-adapter.mjs \
  web-ai/capability-types.mjs web-ai/capability-registry.mjs \
  web-ai/capability-observation-presets.mjs web-ai/eval/types.mjs \
  web-ai/errors.mjs \
  test/unit/web-ai-question.test.mjs test/unit/web-ai-eval-types.test.mjs \
  test/unit/web-ai-provider-adapter.test.mjs test/unit/web-ai-errors.test.mjs \
  test/unit/web-ai-capability-registry.test.mjs \
  test/unit/web-ai-observation-presets.test.mjs \
  test/unit/web-ai-capability-freshness.test.mjs
git commit -m "feat: register Perplexity web-ai contracts"
```

---

### Task 1: Make Answer And Citation Persistence Lossless

**Files:**
- Modify: `web-ai/types.mjs`
- Modify: `types/agbrowse-shared.d.ts`
- Modify: `web-ai/answer-artifact.mjs`
- Modify: `web-ai/tab-finalizer.mjs`
- Modify: `test/unit/web-ai-answer-artifact.test.mjs`
- Modify: `test/unit/web-ai-tab-finalizer.test.mjs`
- Modify: `test/unit/web-ai-session-store.test.mjs`
- Modify: `test/unit/web-ai-sessions-command.test.mjs`
- Modify: `test/integration/web-ai-mcp-server.test.mjs`
- Create: `test/fixtures/session-store/read-session-summary.mjs`

**Interfaces:**
- Produces: `AnswerCitation`
- Produces: `createAnswerArtifact({ citations })`
- Produces: `finalizeProviderTab(..., { answerArtifact })`
- Invariant: `session.answer === session.answerArtifact.text`

- [ ] **Step 1: Write Red artifact and disk round-trip tests**

Use a deterministic 2 MiB multilingual answer:

```js
const chunk = '한글 English emoji🙂 line\\n';
const largeAnswer = chunk.repeat(Math.ceil((2 * 1024 * 1024) / chunk.length));
const citations = Array.from({ length: 500 }, (_, index) => ({
    index: index + 1,
    title: `Source ${index + 1}`,
    url: `https://example.com/source/${index + 1}?q=테스트`,
}));
expect(Buffer.byteLength(largeAnswer, 'utf8'))
    .toBeGreaterThanOrEqual(2 * 1024 * 1024);
```

Assert:

```js
expect(stored.answer).toBe(largeAnswer);
expect(stored.answerArtifact.text).toBe(largeAnswer);
expect(stored.answerArtifact.citations).toEqual(citations);
expect(Object.hasOwn(stored.answerArtifact, 'citations')).toBe(true);
```

Create `test/fixtures/session-store/read-session-summary.mjs`:

```js
import { createHash } from 'node:crypto';
import { getSession } from '../../../web-ai/session.mjs';

const session = getSession(process.argv[2]);
if (!session) process.exit(2);
const answer = String(session.answer || '');
const artifactText = String(session.answerArtifact?.text || '');
const citations = session.answerArtifact?.citations ?? null;
process.stdout.write(JSON.stringify({
    answerSha256: createHash('sha256').update(answer).digest('hex'),
    answerBytes: Buffer.byteLength(answer, 'utf8'),
    artifactTextSha256:
        createHash('sha256').update(artifactText).digest('hex'),
    citationCount: Array.isArray(citations) ? citations.length : null,
    hasCitations:
        Object.hasOwn(session.answerArtifact || {}, 'citations'),
}));
```

Spawn it with `process.execPath`, a temporary `BROWSER_AGENT_HOME`, the
session ID, and `encoding: 'utf8'`. Assert exit status 0 and compare hashes,
byte length, citation count, and property presence. Add cases for
`citations: []`, a legacy version-1 session without `answerArtifact`, and
malformed JSON preserving the repository's current empty-store fallback.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-answer-artifact.test.mjs \
  test/unit/web-ai-tab-finalizer.test.mjs \
  test/unit/web-ai-session-store.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs
```

- [ ] **Step 3: Implement canonical persistence**

Extend artifact types with:

```js
/**
 * @typedef {Object} AnswerCitation
 * @property {number|null} index
 * @property {string} title
 * @property {string} url
 */
```

Preserve `citations` in `createAnswerArtifact()`, `artifactFromPollResult()`, and `withAnswerArtifact()`. In `finalizeProviderTab()` compute one canonical answer:

```js
if (
    answerText != null
    && answerArtifact?.text != null
    && answerText !== answerArtifact.text
) {
    throw new WebAiError({
        errorCode: 'internal.answer-artifact-mismatch',
        stage: 'finalize',
        retryHint: 'report',
        mutationAllowed: false,
    });
}

const canonicalAnswer =
    answerText
    ?? answerArtifact?.text
    ?? '';

const normalizedArtifact = answerArtifact
    ? createAnswerArtifact({
        ...answerArtifact,
        provider:
            answerArtifact.provider
            ?? vendor
            ?? session.vendor,
        sessionId:
            answerArtifact.sessionId
            ?? session.sessionId,
        conversationUrl:
            answerArtifact.conversationUrl
            ?? conversationUrl,
        text: canonicalAnswer,
        markdown:
            answerArtifact.markdown
            ?? artifactText
            ?? canonicalAnswer,
        citations:
            (vendor ?? session.vendor) === 'perplexity'
                ? (answerArtifact.citations ?? [])
                : answerArtifact.citations,
        warnings: [
            ...baseWarnings,
            ...(answerArtifact.warnings ?? []),
        ],
    })
    : null;
```

Store `answer: canonicalAnswer` and the normalized artifact in the same
`updateSession()` call. Save the transcript from
`normalizedArtifact?.markdown ?? artifactText ?? canonicalAnswer`; use
`canonicalAnswer` rather than the original `answerText` as the condition for
whether a transcript exists.

- [ ] **Step 4: Verify Green**

Run the Step 2 command and:

```bash
npx vitest run test/integration/web-ai-mcp-server.test.mjs
```

- [ ] **Step 5: Refactor and regress existing artifacts**

Keep one citation type name, `AnswerCitation`, across JS and declarations. Run:

```bash
npx vitest run \
  test/unit/web-ai-answer-artifact.test.mjs \
  test/unit/web-ai-tab-finalizer.test.mjs \
  test/unit/web-ai-session-artifacts.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add web-ai/types.mjs types/agbrowse-shared.d.ts \
  web-ai/answer-artifact.mjs web-ai/tab-finalizer.mjs \
  test/unit/web-ai-answer-artifact.test.mjs \
  test/unit/web-ai-tab-finalizer.test.mjs \
  test/unit/web-ai-session-store.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/integration/web-ai-mcp-server.test.mjs \
  test/fixtures/session-store/read-session-summary.mjs
git commit -m "feat: persist web-ai answer citations losslessly"
```

---

### Task 2: Make Timeout And Resume Metadata Effort-Aware

**Files:**
- Modify: `web-ai/session.mjs`
- Modify: `test/unit/web-ai-timeout-default.test.mjs`
- Modify: `test/unit/web-ai-provider-session.test.mjs`

**Interfaces:**
- Produces: `deriveTimeoutTier(vendor, model, research, effort)`
- Produces: 1200-second Perplexity default and 3600-second Thinking tier
- Persists: `envelopeSummary.reasoningEffort`

- [ ] **Step 1: Write Red timeout tests**

```js
expect(resolveTimeoutDefaultSec({}, 'perplexity')).toBe(1200);
expect(resolveTimeoutDefaultSec({
    model: 'gpt-5.6-terra',
    reasoningEffort: 'on',
}, 'perplexity')).toBe(3600);

expect(resolveTimeoutBudgetSec({}, {
    vendor: 'perplexity',
    deadlineAt: null,
    envelopeSummary: {
        model: 'gpt-5.6-terra',
        reasoningEffort: 'on',
    },
}, 'perplexity', Date.now())).toBe(3600);
```

Add regression assertions for ChatGPT Pro, Gemini, Grok Heavy, and Deep Research.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-timeout-default.test.mjs \
  test/unit/web-ai-provider-session.test.mjs
```

- [ ] **Step 3: Implement effort-aware fallback**

Add `perplexity: 1200` and `perplexity-thinking: 3600`. Pass `reasoningEffort` through `deriveTimeoutTier()`, `resolveTimeoutDefaultSec()`, and `summarizeEnvelope()`. Update budget fallback:

```js
return resolveTimeoutDefaultSec({
    model: input.model ?? summary.model,
    research:
        input.research
        ?? session?.researchMode
        ?? summary.research,
    reasoningEffort:
        input.reasoningEffort
        ?? input.effort
        ?? summary.reasoningEffort,
}, session?.vendor || vendor);
```

- [ ] **Step 4: Verify Green, refactor, and regress**

Run Step 2, then:

```bash
npx vitest run test/unit/web-ai-timeout*.test.mjs
```

Keep the alias table for ON/OFF in `perplexity-model.mjs`; until Task 5 exists, `session.mjs` only recognizes the canonical stored values `on` and `off`.

- [ ] **Step 5: Commit**

```bash
git add web-ai/session.mjs \
  test/unit/web-ai-timeout-default.test.mjs \
  test/unit/web-ai-provider-session.test.mjs
git commit -m "feat: restore Perplexity thinking timeout on resume"
```

---

### Task 3: Add Strict Provider Conversation Recovery

**Files:**
- Create: `web-ai/provider-url-identity.mjs`
- Modify: `web-ai/tab-recovery.mjs`
- Modify: `web-ai/navigation-ready.mjs`
- Modify: `web-ai/cli-sessions.mjs`
- Modify: `web-ai/watcher.mjs`
- Modify: `test/unit/web-ai-safe-conversation-url.test.mjs`
- Modify: `test/unit/web-ai-tab-recovery.test.mjs`
- Modify: `test/unit/web-ai-open-conversation-newtab.test.mjs`
- Modify: `test/unit/web-ai-navigation-ready.test.mjs`
- Modify: `test/unit/web-ai-sessions-command.test.mjs`
- Modify: `test/unit/web-ai-watcher.test.mjs`
- Create: `test/unit/web-ai-provider-url-identity.test.mjs`

**Interfaces:**
- Produces: `isSafeProviderConversationUrl(vendor, value)`
- Produces: `isSafePerplexityConversationUrl(value)`
- Produces: `perplexityConversationId(value)`
- Produces: `isProviderOriginUrl(vendor, value)`
- Produces: provider-aware `urlsCompatible(storedUrl, liveUrl, vendor)`
- Produces: `openConversationInNewTab(deps, { vendor, conversationUrl })`
- Produces: provider-specific conversation identity and readiness

- [ ] **Step 1: Write Red URL matrix tests**

For Perplexity, reject `http:`, foreign hosts, provider root, credentials,
every explicit port including `:443`, fragments, queries, path prefixes, `..`,
encoded traversal, encoded slash/dash at any supported encoding depth,
backslashes, NUL, and malformed conversation IDs. Permit only the captured
raw `/search/<UUID>` form with an optional trailing slash. Add both allowed
hosts, uppercase hex, malformed/short/long/suffixed UUIDs, `%2D`, `%2F`, and
`%252D`. Test conversation mismatch in `urlsCompatible()`, not in the one-URL
guard.

```js
expect(isSafePerplexityConversationUrl(
    'https://www.perplexity.ai/search/../search/abc',
)).toBe(false);
expect(isSafePerplexityConversationUrl(
    'https://www.perplexity.ai/search/%2e%2e/search/abc',
)).toBe(false);
```

Preserve the existing ChatGPT test that accepts
`https://chatgpt.com/c/abc123?model=gpt-5`. Assert existing-tab `page.goto()`,
watcher `page.goto()`, and new-tab `createTab()` are never called for unsafe
ChatGPT/Perplexity URLs. Assert `sessions reattach --navigate` passes
`vendor: 'perplexity'`. Perplexity watcher poll dispatch waits until Task 9,
after `perplexity-live.mjs` exists.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-safe-conversation-url.test.mjs \
  test/unit/web-ai-tab-recovery.test.mjs \
  test/unit/web-ai-open-conversation-newtab.test.mjs \
  test/unit/web-ai-navigation-ready.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-watcher.test.mjs \
  test/unit/web-ai-provider-url-identity.test.mjs
```

- [ ] **Step 3: Preserve ChatGPT and add a strict Perplexity guard**

```js
const PERPLEXITY_UUID_SOURCE =
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}'
    + '-[0-9a-f]{4}-[0-9a-f]{12}';

const PERPLEXITY_RAW_CONVERSATION_RE = new RegExp(
    '^https://(?:www\\.)?perplexity\\.ai'
    + `/search/${PERPLEXITY_UUID_SOURCE}/?$`,
    'i',
);

export function isSafeProviderConversationUrl(vendor, value) {
    if (vendor === 'chatgpt') {
        return isSafeChatGptConversationUrl(value);
    }
    if (vendor === 'perplexity') {
        return isSafePerplexityConversationUrl(value);
    }
    return false;
}

export function isSafePerplexityConversationUrl(value) {
    if (
        typeof value !== 'string'
        || !PERPLEXITY_RAW_CONVERSATION_RE.test(value)
    ) return false;

    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    if (
        url.protocol !== 'https:'
        || url.username
        || url.password
        || url.port
        || url.search
        || url.hash
    ) return false;
    return true;
}

export function perplexityConversationId(value) {
    if (!isSafePerplexityConversationUrl(value)) return null;
    return new URL(value).pathname
        .replace(/\/+$/, '')
        .split('/')
        .at(-1)
        ?.toLowerCase() || null;
}

const PERPLEXITY_RAW_PROVIDER_RE =
    /^https:\/\/(?:www\.)?perplexity\.ai(?:[/?#]|$)/i;

export function isProviderOriginUrl(vendor, value) {
    if (typeof value !== 'string') return false;
    if (vendor === 'perplexity') {
        if (!PERPLEXITY_RAW_PROVIDER_RE.test(value)) return false;
        let url;
        try {
            url = new URL(value);
        } catch {
            return false;
        }
        return !url.username && !url.password && !url.port;
    }
    return existingProviderOriginMatch(vendor, value);
}
```

The raw regex is the canonical-syntax gate and therefore runs before WHATWG
URL normalization can erase an explicit default port or decode an encoded UUID
separator. `urlsCompatible()` compares non-null Perplexity IDs and permits the
same UUID across bare/`www` hosts; a different UUID is incompatible. Existing
ChatGPT/Gemini/Grok compatibility remains unchanged.

`isProviderOriginUrl()` treats bare/`www` Perplexity hosts as one HTTPS
provider, rejects credentials and explicit ports from raw input, and preserves
the existing exact-origin behavior for the other providers. Use it in
`shouldNavigateToRequestedProviderUrl(..., vendor)` and recovery preference
logic so a same-UUID cross-host redirect causes zero `goto()` calls and updates
the session to the live canonical URL.

Do not rewrite `isSafeChatGptConversationUrl()`. Call the provider guard
immediately before ChatGPT/Perplexity stored-session navigation in
all five paths:

1. `recoverSessionTab()` existing-tab `page.goto()`
2. `recoverSessionTab()` fallback `createTab()`
3. `resolveSessionPage()` existing-tab `page.goto()`
4. `openConversationInNewTab()` `createTab()`
5. watcher `ensureWatcherAttached()` `page.goto()`

`recoverSessionTab()` validates before entering its stale-page recovery block
and immediately before each navigation. A typed `cdp.target-mismatch` is
re-thrown and is never swallowed by the existing broad catch/fallback.
Make new-tab recovery accept `{ vendor, conversationUrl }`. Split
compatibility and readiness by provider so Perplexity does not depend on
ChatGPT selectors.

The new-tab precondition is:

```js
export async function openConversationInNewTab(
    deps,
    { vendor, conversationUrl } = {},
) {
    if (!isSafeProviderConversationUrl(vendor, conversationUrl)) {
        return {
            opened: false,
            reason: 'unsafe-conversation-url',
        };
    }
    const safeUrl = conversationUrl;
    const port = deps.getPort();
    let targetId = null;
    try {
        const newTab = await createTab(port, safeUrl);
        targetId = newTab.targetId;
        const newPage =
            await waitForPageByTargetId(
                port,
                targetId,
            ).catch(() => null);
        if (!newPage) {
            await closeTab(
                port,
                targetId,
            ).catch(() => undefined);
            return {
                opened: false,
                reason: 'page-unavailable',
                targetId,
            };
        }
        await waitForConversationReady(
            newPage,
            newPage.url(),
            vendor,
        );
        if (!urlsCompatible(
            safeUrl,
            newPage.url(),
            vendor,
        )) {
            await closeTab(port, targetId).catch(() => undefined);
            return {
                opened: false,
                reason: 'conversation-mismatch',
            };
        }
        return {
            opened: true,
            page: newPage,
            targetId,
            conversationUrl: newPage.url(),
        };
    } catch (error) {
        if (targetId) {
            await closeTab(port, targetId).catch(() => undefined);
        }
        return {
            opened: false,
            reason:
                `new-tab-failed:${error?.message || 'unknown'}`,
        };
    }
}
```

Watcher navigation checks the guard immediately before `page.goto()`:

```js
if (
    options.navigate
    && ['chatgpt', 'perplexity'].includes(session.vendor)
    && !isSafeProviderConversationUrl(
        session.vendor,
        targetUrl,
    )
) {
    throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'target-resolution',
        vendor: session.vendor,
        retryHint: 'pass-session',
        message: 'refusing unsafe stored conversation URL',
        mutationAllowed: false,
        evidence: { targetUrl },
    });
}
```

After successful new-tab recovery, `cli-sessions.mjs` stores both canonical
values:

```js
updateSession(id, {
    targetId: reopened.targetId,
    conversationUrl: reopened.conversationUrl,
});
```

- [ ] **Step 4: Verify Green, refactor, and regress ChatGPT**

Run Step 2. Public ChatGPT, Gemini, and Grok resume/watch behavior must remain
unchanged.

- [ ] **Step 5: Commit**

```bash
git add web-ai/provider-url-identity.mjs \
  web-ai/tab-recovery.mjs web-ai/navigation-ready.mjs \
  web-ai/cli-sessions.mjs web-ai/watcher.mjs \
  test/unit/web-ai-safe-conversation-url.test.mjs \
  test/unit/web-ai-tab-recovery.test.mjs \
  test/unit/web-ai-open-conversation-newtab.test.mjs \
  test/unit/web-ai-navigation-ready.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-watcher.test.mjs \
  test/unit/web-ai-provider-url-identity.test.mjs
git commit -m "feat: guard provider conversation recovery URLs"
```

---

### Task 4: Register Perplexity Tab Lifecycle Ownership

**Files:**
- Modify: `web-ai/cli.mjs`
- Modify: `skills/browser/tab-lifecycle.mjs`
- Modify: `test/integration/web-ai-cli-contract.test.mjs`
- Modify: `test/unit/tab-lifecycle.test.mjs`

**Interfaces:**
- Adds: one Perplexity lifecycle provider with hosts `perplexity.ai` and `www.perplexity.ai`
- Consumes: `isProviderOriginUrl(vendor, value)` from Task 3
- Preserves: active lease, active session, active command, and pinned-tab protection

- [ ] **Step 1: Write Red lifecycle tests**

Add Perplexity host detection, idle cleanup, max-tab cleanup, active lease,
active command, pinned-tab, and bound-session protection cases using the same
table-driven fixtures as existing providers. Test both allowed hosts, reject
other subdomains and `http:`, and prove both hosts count toward one provider
overflow limit.
Add reusable-tab and driveability tests proving a bare-host pooled/unmanaged tab
is reused for a `www` request and vice versa, without navigation. Reject
credentials, explicit default/non-default ports, `http:`, and unrelated
subdomains. Keep ChatGPT/Gemini/Grok origin behavior byte-for-byte compatible.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run test/unit/tab-lifecycle.test.mjs
npx vitest run test/integration/web-ai-cli-contract.test.mjs
```

- [ ] **Step 3: Add the origin**

```js
tabs.filter(tab =>
    isProviderOriginUrl(vendor, tab.url)
);
```

Replace lifecycle and `findReusableProviderTab()` exact-origin comparisons with
the Task 3 shared helper. Do not create a second Perplexity-only host map. Use
one vendor key for bare and `www` tabs so cleanup, pooled lease ownership,
unmanaged reusable-tab acquisition, and max-per-provider accounting agree.

- [ ] **Step 4: Verify Green and regress existing providers**

Run Step 2. Expected: cleanup ordering and protection behavior remain
unchanged for ChatGPT/Gemini/Grok.

- [ ] **Step 5: Commit**

```bash
git add web-ai/cli.mjs skills/browser/tab-lifecycle.mjs \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/tab-lifecycle.test.mjs
git commit -m "feat: track Perplexity tab lifecycle"
```

---

### Task 5: Capture DOM Evidence And Add Pure Perplexity Rules

**Files:**
- Create: `web-ai/perplexity-model.mjs`
- Create: `web-ai/perplexity-citations.mjs`
- Create: `scripts/capture-perplexity-fixtures.mjs`
- Create: `scripts/derive-perplexity-adversarial-fixtures.mjs`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-ko.html`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-en.html`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-close.html`
- Create: `test/fixtures/provider-dom/perplexity-baseline.html`
- Create: `test/fixtures/provider-dom/perplexity-cosmetic-churn.html`
- Create: `test/fixtures/provider-dom/perplexity-structural-churn.html`
- Create: `test/fixtures/provider-dom/perplexity-breaking.html`
- Create: `test/fixtures/provider-dom/perplexity-streaming.html`
- Create: `test/fixtures/provider-dom/perplexity-complete-citations.html`
- Create: `test/fixtures/provider-dom/perplexity-copy-decoys.html`
- Create: `test/fixtures/provider-dom/perplexity-blocking-overlay.html`
- Create: `test/fixtures/provider-dom/perplexity-attachment-preview.html`
- Create: `test/fixtures/provider-dom/perplexity-thinking-on.html`
- Create: `test/fixtures/provider-dom/perplexity-thinking-off.html`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-locked.html`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-duplicate-switch.html`
- Create: `test/fixtures/provider-dom/perplexity-thinking-adjacent-decoys.html`
- Create: `test/fixtures/provider-dom/perplexity-thinking-detached-reopen.html`
- Create: `test/fixtures/provider-dom/perplexity-late-citation.html`
- Create: `test/fixtures/provider-dom/perplexity-sources-pane-open.html`
- Create: `test/fixtures/provider-dom/perplexity-sources-pane-stale.html`
- Create: `test/fixtures/provider-dom/perplexity-sources-pane-two-visible.html`
- Create: `test/fixtures/provider-dom/perplexity-sources-pane-fingerprint-replacement.html`
- Create: `test/fixtures/provider-dom/perplexity-sources-pane-close.html`
- Create: `test/fixtures/provider-dom/perplexity-fixture-provenance.json`
- Create: `test/unit/web-ai-perplexity-model.test.mjs`
- Create: `test/unit/web-ai-perplexity-citations.test.mjs`
- Modify: `web-ai/capability-observation-presets.mjs`
- Modify: `test/unit/web-ai-observation-presets.test.mjs`
- Modify: `test/unit/web-ai-capability-freshness.test.mjs`

**Interfaces:**
- Produces: `validatePerplexitySelectionRequest(model, effort)`
- Produces: `normalizePerplexityModelChoice(value)`
- Produces: `normalizePerplexityEffort(value)`
- Produces: `normalizePerplexityCitations(raw, baseUrl)`

- [ ] **Step 1: Capture authenticated headed DOM evidence**

Create `scripts/capture-perplexity-fixtures.mjs` as a read-only CDP capture
command accepting:

```text
--surface picker-ko|picker-en|picker-locked|picker-close|thinking-on|thinking-off|attachment|baseline|streaming|complete-citations|sources-pane-open|sources-pane-close|overlay
--output <fixture-path>
--screenshot-output <png-path>
```

The script connects through the existing browser runtime and resolves exactly
one surface root using the surface-specific semantic markers captured in the
preceding snapshot. It fails on zero or multiple candidates, removes
scripts/styles/account text, replaces user text with stable tokens, and
refuses to overwrite without `--force`. It writes the PNG and records its
SHA-256 in provenance. Run it after:

```bash
node ./bin/agbrowse.mjs navigate https://www.perplexity.ai
node ./bin/agbrowse.mjs snapshot --interactive --max-nodes 300
node scripts/capture-perplexity-fixtures.mjs \
  --surface picker-ko \
  --output test/fixtures/provider-dom/perplexity-model-picker-ko.html \
  --screenshot-output devlog/_evidence/perplexity-picker-ko.png
```

Repeat for every naturally observable surface in the command contract. Capture
`overlay` only when it is actually present; absence is recorded as
`not-observed`, not synthesized. Record the semantic markers
and resolved root selector in provenance; do not assume
`dialog/menu/listbox`. For Sources, capture the before-click pane candidates,
the post-click pane identity or changed fingerprint, and an authenticated close
mechanism. Do not implement pane closing from an invented selector or unverified
Escape behavior.
For status, `picker-close` records the authenticated close action and proves the
selected alias and selected-row Thinking state are unchanged afterward.

After sanitizing live captures, run
`scripts/derive-perplexity-adversarial-fixtures.mjs`. It deterministically
creates `duplicate-switch`, `thinking-adjacent-decoys`,
`thinking-detached-reopen`, `copy-decoys`, `sources-pane-stale`,
`sources-pane-two-visible`, `sources-pane-fingerprint-replacement`,
`late-citation`, and the eval variants. These synthetic states are never passed
to the live capture command.

Derive eval variants from the sanitized baseline:

- `cosmetic-churn`: change class names and non-semantic wrapper text only;
- `structural-churn`: insert/reorder wrapper elements while preserving role,
  accessible name, state, and `data-eval-intent`;
- `breaking`: remove the composer/send semantic targets and retain a decoy
  response so the expected failure is `eval.target-resolution-failed`.

Record capture date, locale, surface, sanitization, screenshot SHA-256, and
source URL class for live captures. Every derived entry records `kind:
'derived'`, `derivedFrom`, `parentSha256`, a stable transform name/parameters,
and `generatedBy: 'scripts/derive-perplexity-adversarial-fixtures.mjs'`.
Live entries use `kind: 'live-captured'`; only those may use
`source: 'live-frontend'`.

The same provenance contains model capability evidence. Set
`supportsThinking: true|false` only for an alias whose authenticated selected
model fixture proves presence/absence; otherwise use `null`. With current
evidence, `gpt-5.6-terra` is the only required `true` entry. Runtime send still
revalidates the adjacent control after selection and never treats this catalog
as mutation evidence.
For eval fixtures, remove or rewrite every external `href`, `src`, `action`,
and `formaction`; `runOneFixture()` must not return `eval.network-blocked`.
Citation URL normalization fixtures store source URLs in inert
`data-source-url` attributes or test records, not network-capable markup.
Replace Task 0's `not-observed` Perplexity observation presets with
fixture-backed selectors, activation paths, and active-state signals. Use
`source: 'live-frontend'` only when every selector in that preset is backed by
a live-captured parent; derived-only failure variants remain test provenance
and do not upgrade runtime observation status. Set the resulting supported
presets to `schema-ready`.

- [ ] **Step 2: Write Red pure tests against the fixture files**

Tests must load both KO/EN fixture HTML and assert:

```js
expect(() =>
    validatePerplexitySelectionRequest(undefined, 'on')
).toThrow(expect.objectContaining({
    errorCode: 'provider.model-mismatch',
    mutationAllowed: false,
}));
expect(normalizePerplexityModelChoice('Sonar 2')).toBe('sonar-2');
expect(normalizePerplexityEffort('heavy')).toBe('on');
expect(normalizePerplexityEffort('normal')).toBe('off');
```

Pure citation tests cover relative URL resolution, HTTP(S)-only filtering,
fragment removal, query preservation, first-visual-occurrence ordering,
deduplication, explicit index preservation, `index: null` without evidence,
and rejection of internal `/search/<UUID>` links. DOM clicking, committed-turn
scope, pane association, late citations, and pane closing belong to Task 8.
Model fixture tests assert selectable rows are `menuitemradio`, locked rows
are non-radio `menuitem` elements containing `pplx-icon-lock`, and the
selected row is identified by `aria-checked=true`.

- [ ] **Step 3: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-perplexity-model.test.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/unit/web-ai-observation-presets.test.mjs \
  test/unit/web-ai-capability-freshness.test.mjs
```

- [ ] **Step 4: Implement pure validation and normalization**

```js
export function validatePerplexitySelectionRequest(model, effort) {
    const hasModel = typeof model === 'string' && model.trim() !== '';
    const hasEffort = typeof effort === 'string' && effort.trim() !== '';
    if (hasEffort && !hasModel) {
        throw modelMismatchError('perplexity', null, {
            reason: 'effort-requires-explicit-model',
            effort,
        });
    }
    const requestedModel = hasModel
        ? normalizePerplexityModelChoice(model)
        : null;
    const requestedThinking = hasEffort
        ? normalizePerplexityEffort(effort)
        : null;
    if (hasModel && !requestedModel) {
        throw modelMismatchError('perplexity', String(model), {
            reason: 'unsupported-model',
        });
    }
    if (hasEffort && !requestedThinking) {
        throw modeUnavailableError(
            'perplexity',
            requestedModel,
            String(effort),
        );
    }
    return { requestedModel, requestedThinking };
}
```

Normalize citation URLs by resolving against the conversation URL, accepting only HTTP(S), removing fragments, preserving queries, and deduplicating by first visual occurrence.

- [ ] **Step 5: Verify Green, refactor, and regress**

Run Step 3. Export one canonical model catalog consumed later by CLI and MCP validation; do not duplicate aliases.
The catalog stores nullable fixture-backed `supportsThinking` separately from
all live selected-row state.

- [ ] **Step 6: Commit**

```bash
git add web-ai/perplexity-model.mjs web-ai/perplexity-citations.mjs \
  scripts/capture-perplexity-fixtures.mjs \
  scripts/derive-perplexity-adversarial-fixtures.mjs \
  web-ai/capability-observation-presets.mjs \
  test/unit/web-ai-perplexity-model.test.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/unit/web-ai-observation-presets.test.mjs \
  test/unit/web-ai-capability-freshness.test.mjs \
  test/fixtures/provider-dom/perplexity-*.html \
  test/fixtures/provider-dom/perplexity-fixture-provenance.json
git commit -m "feat: define Perplexity model and citation contracts"
```

---

### Task 6: Implement Fail-Closed Model And Thinking Mutation

**Files:**
- Modify: `web-ai/perplexity-model.mjs`
- Create: `test/helpers/perplexity-page-fixture.mjs`
- Modify: `test/unit/web-ai-perplexity-model.test.mjs`

**Interfaces:**
- Consumes: `validatePerplexitySelectionRequest(model, effort)`
- Produces: `selectPerplexityModel(page, selectionRequest)`
- Returns: `{ requestedModel, resolvedModel, resolvedLabel, locked, thinking, verified }`

- [ ] **Step 1: Write Red action-log tests**

Create `test/helpers/perplexity-page-fixture.mjs` following the existing
ChatGPT model tests' fake Page/Locator pattern; do not add JSDOM or a browser
dependency. The helper loads sanitized fixture annotations and records
`locator`, `count`, `evaluate`, and `click`. It models element/parent/immediate
next-sibling identity, role, accessible name/text, visibility, disabled and
inert ancestry, lock evidence, `aria-checked`, `data-state`, and locator
detachment generation. Unsupported locator operations fail the test instead of
returning an empty match. Use KO, EN, Thinking ON/OFF,
locked-row, and duplicate-switch fixtures. Assert zero mutation for duplicate rows,
noninteractive rows, disabled/inert ancestors, unknown lock state, locked
rows, missing selected row, zero/two switches, and invalid `aria-checked`.

Add adversarial fixtures where an unrelated sibling is inserted before a later
Thinking item, only the next model owns Thinking, the adjacent checkbox has a
different name, two nested descendant switches exist, and picker reopening
detaches the original row. Every case records zero clicks and forbids reusing a
detached locator.

After a valid click, assert the implementation reopens/reads the picker and verifies both selected model and Thinking state.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run test/unit/web-ai-perplexity-model.test.mjs
```

- [ ] **Step 3: Implement exact unique-row mutation**

Validation is performed by callers before Page acquisition. This function
accepts only the validated object:

```js
export async function selectPerplexityModel(
    page,
    { requestedModel, requestedThinking },
) {
    if (!requestedModel) return null;
    // Resolve exactly one observed interactive row.
}
```

Require exactly one `menuitemradio` for selectable models. Treat
non-radio `menuitem` plus `pplx-icon-lock` as locked. Treat `aria-disabled`, `disabled`,
inert/disabled ancestors, lock evidence, and unknown state explicitly. Throw
`modelEntitlementError('perplexity', requestedModel, evidence)` for a locked
row.

```js
const initial = await openAndResolveRequestedModelRow(
    page,
    requestedModel,
);

let selectedRowAfterModel = initial.row;
if (!initial.selected) {
    await initial.row.click({ timeout: 5_000 });
    selectedRowAfterModel = (
        await reopenAndResolveSelectedModelRow(
            page,
            requestedModel,
        )
    ).row;
}

let thinking = null;
if (requestedThinking !== null) {
    const thinkingControl =
        await resolveAdjacentThinkingControl(
            selectedRowAfterModel,
        );
    thinking = await setPerplexityThinking(
        thinkingControl.switch,
        requestedThinking,
    );

    const afterThinking =
        await reopenAndResolveSelectedModelRow(
            page,
            requestedModel,
        );
    await verifyAdjacentThinkingState(
        afterThinking.row,
        requestedThinking,
    );
} else {
    thinking =
        await readPerplexityThinkingStateWithoutMutation(
            selectedRowAfterModel,
        );
}
return {
    requestedModel,
    resolvedModel: requestedModel,
    thinking,
    verified: true,
};
```

`resolveAdjacentThinkingControl()` enforces the immediate-next-sibling role,
exact visible name, direct-child switch count, actionability, and state rules
defined above. After any model/switch click, no Locator created before that
click may be queried again. Tests assert the action sequence: open/resolve
model, click when needed, reopen/resolve fresh selected row, resolve adjacent
Thinking, click switch when needed, reopen/resolve fresh row, and verify model
plus switch. A stale-locator query fails the fake harness immediately.

When effort is omitted, a missing Thinking item is valid, no switch click is
allowed, and the stored state is `null` unless exactly one switch can be read
without mutation.

- [ ] **Step 4: Verify Green**

Run Step 2. Expected: every failure case has zero mutation; valid cases verify postconditions.

- [ ] **Step 5: Refactor and regress**

Separate picker traversal, row inspection, and mutation into pure/imperative helpers. Re-run Task 5 pure tests.

- [ ] **Step 6: Commit**

```bash
git add web-ai/perplexity-model.mjs \
  test/helpers/perplexity-page-fixture.mjs \
  test/unit/web-ai-perplexity-model.test.mjs
git commit -m "feat: select Perplexity models fail closed"
```

---

### Task 7: Implement The Complete Send Lifecycle

**Files:**
- Create: `web-ai/perplexity-live.mjs`
- Create: `test/unit/web-ai-perplexity-live-policy.test.mjs`
- Create: `test/integration/web-ai-perplexity-session.test.mjs`

**Interfaces:**
- Produces: `perplexityStatusWebAi(deps, input)`
- Produces: `perplexitySendWebAi(deps, input)`
- Produces: `validatePerplexityUnsupportedFeatures(input)`
- Stores: baseline, assistant count, target binding, active lease, model selection

`perplexityStatusWebAi()` returns only sanitized model evidence:

```js
{
    ok,
    vendor: 'perplexity',
    status,
    url,
    modelOptions: [{
        alias,
        label,
        selected,
        locked,
        supportsThinking,
        thinkingControlPresent,
    }],
    capabilities,
    warnings,
}
```

It never returns account text, subscription details, or full DOM content.
Status may open the unique model trigger, inspect the resulting unique
`role=menu`, and close it without selecting a row or changing a switch. It
must verify that the selected model and every observed switch state are
unchanged after closing the menu.

`supportsThinking` is nullable static capability evidence from Task 5's
authenticated fixture/catalog. `thinkingControlPresent` is live and boolean
only for the currently selected model when exactly one adjacent control can be
read; every unselected model returns `null`. Status never selects models to
discover this field. Send never skips post-selection DOM validation because of
`supportsThinking`.

- [ ] **Step 1: Write Red lifecycle tests**

Assert:

- status resolves exactly one visible model trigger whose accessible name is
  `Model` or the currently selected model label;
- status opens and closes exactly one model menu, returns only the documented
  sanitized keys, and never returns account/subscription text or raw DOM;
- status performs zero model-row clicks and zero switch clicks, and verifies
  the selected model and switch states did not change;
- with Best selected and no Thinking row, an unselected Terra row reports
  `supportsThinking: true` and `thinkingControlPresent: null` from the fixture
  catalog; when Terra is selected, only Terra may report live
  `thinkingControlPresent: true`;
- unsupported/uncaptured aliases report `supportsThinking: null`, and status
  output alone never authorizes or bypasses actual switch resolution in send;
- zero or multiple model triggers/menus fail closed with typed evidence;
- `perplexityStatusWebAi()` has a direct Red test and a real implementation
  before send is implemented;
- standalone send calls `openFreshPerplexityThread()` once;
- session-bound send never calls it;
- invalid model/effort/scope yields zero calls to `deps.getPage()`,
  `openFreshPerplexityThread()`, `goto`, `locator`, `evaluate`, and `click`;
- missing target ID fails with `cdp.target-mismatch` before provider mutation;
- overlay dismissal uses only an observed close control or Escape and never
  clicks login, subscribe, or consent;
- context-package attachment plus explicit `filePath` fails before Page access;
- composer resolution prefers the unique visible `#ask-input` textbox;
- the upload path clicks `Add files or tools`, then the unique
  `role=menuitem` named `Upload files or images`, and verifies the selected
  file through the hidden multiple file input and visible preview;
- the send button is resolved only after composer text is non-empty and has
  accessible name `Submit`;
- Search and Computer controls retain their original `aria-pressed` values and
  are never clicked in V1;
- attachment preview is required before submit and sent-turn attachment
  evidence is required after submit;
- baseline capture occurs after model/Thinking/composer/upload and immediately
  before submit;
- no session is created before prompt commit evidence;
- successful send calls `saveBaseline()`, `recordActiveLease()`, and `bindSessionToTab()`;
- `envelopeSummary.assistantCount`, canonical model, and canonical `reasoningEffort` are stored.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-perplexity-live-policy.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
```

- [ ] **Step 3: Implement send in the existing lifecycle order**

```js
export async function perplexitySendWebAi(deps, input = {}) {
    const effort =
        input.reasoningEffort
        ?? input.effort;
    const selectionRequest =
        validatePerplexitySelectionRequest(
            input.model,
            effort,
        );
    const envelope = normalizeEnvelope({
        ...input,
        vendor: 'perplexity',
    });
    validatePerplexityUnsupportedFeatures(input);

    const contextPack = await prepareContextForBrowser({
        ...input,
        vendor: 'perplexity',
    });
    if (contextPack?.attachments?.[0] && input.filePath) {
        throw providerError('perplexity', {
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            retryHint: 'inline-only-or-file',
            message:
                'context package upload and --file cannot be combined',
            mutationAllowed: false,
        });
    }
    const rendered = contextPack
        ? contextPack.transport === 'inline'
            ? renderQuestionEnvelopeWithContext(
                envelope,
                contextPack.composerText,
            )
            : renderQuestionEnvelope(envelope)
        : renderQuestionEnvelope(envelope);
    const warnings = [
        ...rendered.warnings,
        ...(contextPack?.warnings || []),
    ];
    const usedFallbacks = [];

    const targetId =
        await deps.getTargetId?.().catch(() => null)
        || null;
    if (!targetId) {
        throw new WebAiError({
            errorCode: 'cdp.target-mismatch',
            stage: 'target-resolution',
            vendor: 'perplexity',
            retryHint: 'tab-switch',
            message:
                'Perplexity send requires a managed target ID',
            mutationAllowed: false,
        });
    }

    const page = await deps.getPage();
    await verifyPerplexityHost(page);
    await dismissPerplexityBlockingOverlay(page);
    if (!input.session) {
        await openFreshPerplexityThread(page);
    }

    const composer =
        await resolvePerplexityComposer(page);
    const modelSelection =
        await selectPerplexityModel(
            page,
            selectionRequest,
        );
    await insertPerplexityPrompt(
        composer,
        rendered.composerText,
    );
    const upload =
        await attachAndVerifyPerplexityFile(
            page,
            input,
            contextPack,
        );

    const captured =
        await capturePerplexityBaseline(page);
    await submitPerplexityPrompt(page, {
        accessibleName: 'Submit',
    });
    await verifyPerplexityCommit(page, {
        baseline: captured,
        attachment: upload,
    });

    const baseline = saveBaseline({
        vendor: 'perplexity',
        url: captured.url,
        envelope,
        assistantCount: captured.responseCount,
        textHash: captured.textHash,
    });
    const session = createSession(envelope, {
        vendor: 'perplexity',
        targetId,
        originalUrl: captured.url,
        conversationUrl: page.url(),
        deadlineAt: resolveDeadlineAt(input, 'perplexity'),
        envelopeSummary: {
            ...summarizeEnvelope(input, contextPack),
            assistantCount: captured.responseCount,
            model:
                modelSelection?.resolvedModel
                ?? input.model
                ?? null,
            reasoningEffort:
                modelSelection?.thinking
                ?? effort
                ?? null,
        },
    });
    updateSession(session.sessionId, { modelSelection });
    await recordActiveLease({
        owner: 'web-ai',
        vendor: 'perplexity',
        sessionType: 'send-poll',
        sessionId: session.sessionId,
        targetId,
        url: page.url(),
        port: deps.getPort?.() || 9222,
    });
    bindSessionToTab(session.sessionId, targetId);
    return {
        ok: true,
        vendor: 'perplexity',
        status: 'sent',
        sessionId: session.sessionId,
        baseline,
        modelSelection,
        warnings,
        usedFallbacks,
    };
}
```

`resolvePerplexityComposer()` requires one visible `#ask-input` element with
`role=textbox` and `contenteditable=true`. Attachment handling uses the
observed `Add files or tools` button and `Upload files or images` menu item;
it does not infer upload from a broad paperclip selector. The implementation
must not click the observed Search or Computer `aria-pressed` controls.

`validatePerplexityUnsupportedFeatures()` rejects `tools`, `plugins`,
`webSearch`, `autoTools`, `outputImage`, `followUps`, and
`research: 'deep'` with `capability.unsupported` before browser access. The
existing Work command surface remains ChatGPT-owned and must not be
reclassified by this provider task. Existing code-mode validation keeps
returning `code-mode.vendor-unsupported` for Perplexity. V1 accepts zero or
one upload path and rejects multiple `filePaths`.

Assert this exact call order:

```js
expect(callOrder).toEqual([
    'validate-request',
    'validate-scope',
    'prepare-context',
    'get-target-id',
    'get-page',
    'verify-host',
    'dismiss-overlay',
    'open-fresh-thread',
    'resolve-composer',
    'select-model',
    'insert-prompt',
    'verify-attachment-preview',
    'capture-baseline',
    'submit',
    'verify-commit',
    'create-session',
    'record-lease',
    'bind-target',
]);
```

Use `perplexity-blocking-overlay.html`,
`perplexity-attachment-preview.html`, `perplexity-thinking-on.html`, and
`perplexity-thinking-off.html` in the behavioral tests.

Implement `perplexityStatusWebAi()` first and make its focused Red test Green
before adding send. A source-text assertion or an uncalled exported stub does
not satisfy this step.
The status implementation joins live row facts with the canonical catalog but
does not project a selected-row Thinking control onto other models. Its menu
close mechanism must come from a live-captured fixture and preserve the same
selected alias before/after close.

- [ ] **Step 4: Verify Green**

Run Step 2.

- [ ] **Step 5: Refactor and regress Gemini/Grok**

Merge send warnings and model evidence without extracting a shared lifecycle helper unless identical code is demonstrated. Run:

```bash
npx vitest run \
  test/unit/web-ai-gemini-contract.test.mjs \
  test/unit/web-ai-grok-live-policy.test.mjs \
  test/unit/web-ai-provider-session.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add web-ai/perplexity-live.mjs \
  test/unit/web-ai-perplexity-live-policy.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
git commit -m "feat: add Perplexity send lifecycle"
```

---

### Task 8: Implement Progress-Gated Polling And Scoped Citations

**Files:**
- Modify: `web-ai/perplexity-live.mjs`
- Modify: `web-ai/perplexity-citations.mjs`
- Modify: `test/unit/web-ai-perplexity-citations.test.mjs`
- Modify: `test/unit/web-ai-perplexity-live-policy.test.mjs`
- Modify: `test/integration/web-ai-perplexity-session.test.mjs`

**Interfaces:**
- Produces: `perplexityPollWebAi`, `perplexityQueryWebAi`, `perplexityStopWebAi`
- Produces: `resolveCommittedPerplexityResponse(page, baseline)`
- Produces: `probePerplexityStreamingState(page): 'streaming'|'idle'|'unknown'`
- Produces: citation state `present|none-confirmed|unavailable|pending|unknown`

- [ ] **Step 1: Write Red poll tests with a fake clock**

Assert:

- stable previous answer without URL/turn progress never completes;
- concrete URL progress plus a new committed response can complete;
- same-URL follow-up requires response-count/turn-identity progress;
- URL change without a new response does not complete;
- citation fingerprint must stabilize after answer text;
- citation state `unknown` or `pending` never completes;
- a unique committed response root with a missing Sources control, a missing
  pane selector, or citations all removed by normalization becomes
  `unavailable` and degraded-completes only after the 2-second grace;
- zero or multiple committed response roots are response-resolution failures,
  never `unavailable`, and never complete;
- citations added at least 800ms after text stability are retained;
- `PERPLEXITY_CITATION_GRACE_MS` is exactly `2000`;
- streaming state `unknown` never completes;
- `Stop response (Esc)` is the observed streaming control and maps to
  `streaming`;
- completed response action `Copy` maps to idle/completion evidence only
  inside the committed response root;
- citation extraction clicks the committed response footer's unique
  `${count} sources` button, identifies only the causally associated pane,
  reads its direct external HTTP(S) anchors, and closes it only through the
  authenticated mechanism captured in Task 5;
- before/after pane identity tests cover an already-open previous pane, hidden
  stale plus new visible pane, two visible panes, same-node content replacement,
  no pane change, close failure, and answer/response-count drift during close;
- ordinary body links, internal `/search/<UUID>` memory links, related
  questions, Share/Download/Rewrite/action links, and links from other turns
  are excluded;
- the observed Sources pane supplies no numeric index, so each citation uses
  `index: null` unless explicit index metadata or ARIA evidence is present;
- conversation URL is stored as soon as a concrete `/search/<UUID>` appears;
- timeout calls `markSessionTimeout()`;
- page death returns `tab-crashed` with `recoverable: true`;
- stop click or Escape is followed by a verified non-streaming postcondition.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/unit/web-ai-perplexity-live-policy.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
```

- [ ] **Step 3: Implement progress and artifact stability**

```js
const currentUrl = page.url();
const committed =
    await resolveCommittedPerplexityResponse(
        page,
        baseline,
    );
const urlProgress =
    currentUrl !== baseline.url
    && isSafePerplexityConversationUrl(currentUrl);
const turnProgress =
    committed.isNewTurn === true
    && committed.responseCount > baseline.assistantCount;
const progressObserved = urlProgress || turnProgress;

const responseStableMs =
    stableSince > 0
        ? Date.now() - stableSince
        : 0;

const citationSettled =
    citationState === 'present'
        ? citationFingerprint === stableCitationFingerprint
            && citationStableMs >= 500
        : (
            citationState === 'none-confirmed'
            || citationState === 'unavailable'
        )
            ? responseStableMs
                >= PERPLEXITY_CITATION_GRACE_MS
            : false;

const isStable = Boolean(
    progressObserved
    && committed.isNewTurn === true
    && committed.promptCommitObserved === true
    && committed.text.trim()
    && committed.text === stableText
    && responseStableMs >= 1500
    && citationSettled
    && streamingState === 'idle'
);
```

`resolveCommittedPerplexityResponse()` returns:

```js
{
    locator,
    turnId,
    responseCount,
    promptCommitObserved,
    isNewTurn,
    text,
}
```

URL progress alone never satisfies completion. Extract citations only from
this locator. `resolveCommittedPerplexityResponse()` must return exactly one
root; zero or multiple roots are a response-resolution failure and cannot be
degraded into citation completion.

Before clicking the unique `${count} sources` control inside that root, record
the visible pane candidates and their identity/fingerprint. After clicking,
accept exactly one of: a newly visible pane, one existing pane whose source
fingerprint uniquely changed, or one fixture-proven `aria-controls`/ownership
relationship. If association is ambiguous, discard citations and use
`unavailable` only because the committed answer root is already unique. Close
the pane only using the Task 5 authenticated close mechanism, then verify the
pane is hidden/detached while committed answer text and response count remain
unchanged. Never scan every `a[href]` below the answer root.

Use explicit data/ARIA index evidence; otherwise `index: null`. State mapping:

- unique root plus observed zero source count/no-citation evidence -> `none-confirmed`;
- unique root plus missing Sources control/pane selector, ambiguous pane
  association, or normalization dropping every candidate -> `unavailable`;
- a pane or citations that may still appear -> `pending`;
- contradictory evidence -> `unknown`;
- ambiguous committed response root -> response-resolution failure, not a
  citation state.

`unavailable` completion stores `citations: []` and warning
`citations-unavailable`. The V1 artifact is immutable after terminal completion;
citations arriving after the 2-second grace do not rewrite a completed session.

- [ ] **Step 4: Finalize with one artifact**

Build one artifact using the exact `responseStableMs`, always include citations,
and pass it to `finalizeProviderTab()`. Add `citations-unavailable` for the
`unavailable` state; do not emit it for an explicitly confirmed zero-source
answer unless another extraction failure occurred.
Declare `const PERPLEXITY_CITATION_GRACE_MS = 2000` once and use that exact
constant in tests and runtime.

Merge query results:

```js
return {
    ...polled,
    sessionId: polled.sessionId || sent.sessionId,
    usedFallbacks: [
        ...(sent.usedFallbacks || []),
        ...(polled.usedFallbacks || []),
    ],
    warnings: [
        ...(sent.warnings || []),
        ...(polled.warnings || []),
    ],
};
```

- [ ] **Step 5: Verify Green, refactor, and regress**

Run Step 2 and existing Gemini/Grok poll tests. Keep response selection, streaming detection, and citation extraction as separate helpers.

- [ ] **Step 6: Commit**

```bash
git add web-ai/perplexity-live.mjs web-ai/perplexity-citations.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/unit/web-ai-perplexity-live-policy.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
git commit -m "feat: poll Perplexity answers with stable citations"
```

---

### Task 9: Wire CLI, Bound Sessions, Resume, Reattach, And Watch

**Files:**
- Modify: `web-ai/cli.mjs`
- Modify: `web-ai/cli-sessions.mjs`
- Modify: `web-ai/watcher.mjs`
- Modify: `skills/browser/browser.mjs`
- Modify: `skills/browser/search.mjs`
- Modify: `test/integration/web-ai-cli-contract.test.mjs`
- Modify: `test/unit/web-ai-sessions-command.test.mjs`
- Modify: `test/unit/web-ai-watcher.test.mjs`
- Modify: `test/integration/web-ai-perplexity-session.test.mjs`

**Interfaces:**
- Routes status/send/poll/query/stop to Perplexity
- Routes session-bound send/query without a fresh thread
- Routes resume/reattach through Perplexity poller and strict URL recovery
- Routes watch through Perplexity host, streaming selectors, and poller

- [ ] **Step 1: Write Red CLI/session tests**

Assert Perplexity help, default URL, canonical aliases, effort-with-model rule,
bound send/query dispatch, resume poller, reattach navigation guard, watcher
dispatch, and `skills/browser/search.mjs` deep-search vendor help.

Assert `--tool`, `--plugin`, `--web-search`, `--auto-tools`,
`--output-image`, `--follow-up`, and `--research deep` fail with
`capability.unsupported` before `ensureHeadedBrowserForWebAi()`. Assert the
existing Work command remains ChatGPT-only without passing through Perplexity
provider validation, and Perplexity code mode preserves the existing
`code-mode.vendor-unsupported` error. Assert both `--effort on` and
`--reasoning-effort on` produce the 3600-second default.
Assert equal duplicate aliases are accepted once, while conflicting
`--effort on --reasoning-effort off` fails with
`provider.option-conflict` before `ensureHeadedBrowserForWebAi()`, `getPage()`,
or `getTargetId()`.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-watcher.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
```

- [ ] **Step 3: Add every explicit CLI dispatch branch**

Import the Perplexity lifecycle functions, add the URL map, and branch in
every render/status/send/poll/query/stop/watch and session-bound path. Parse
CLI values into the normalized `input` first, then run the pure selection and
unsupported-scope validators against that normalized object before browser
preparation. Do not validate raw `values` with normalized-input helpers.
Resolve aliases before creating normalized input:

```js
const reasoningEffort = resolveEqualAlias(
    values,
    'effort',
    'reasoning-effort',
);
```

`resolveEqualAlias()` compares normalized values when both are supplied and
throws a typed `provider.option-conflict` with `mutationAllowed: false` on
disagreement. Use the resolved value for validation and timeout calculation;
do not retain an `a || b` fallback elsewhere in CLI scope checks.

Add:

```js
const VENDOR_DEFAULT_URLS = {
    chatgpt: 'https://chatgpt.com/',
    gemini: 'https://gemini.google.com/app',
    grok: 'https://grok.com/',
    perplexity: 'https://www.perplexity.ai',
};
```

In the existing `runBoundSendOrQuery()`, route Perplexity send/query to
`perplexitySendWebAi`/`perplexityQueryWebAi`. In the main vendor switch, add
all six branches:

```js
case 'render':
    return renderWebAi(input);
case 'status':
    return perplexityStatusWebAi(deps, input);
case 'send':
    return withWebAiActiveCommand(
        command,
        deps,
        input,
        () => perplexitySendWebAi(deps, input),
    );
case 'poll':
    return runBoundCommand(
        command,
        deps,
        input,
        perplexityPollWebAi,
        perplexityStopWebAi,
    );
case 'query':
    return withWebAiActiveCommand(
        command,
        deps,
        input,
        () => perplexityQueryWebAi(deps, input),
    );
case 'stop':
    return runBoundCommand(
        command,
        deps,
        input,
        perplexityPollWebAi,
        perplexityStopWebAi,
    );
```

Keep Work routing before generic provider dispatch. Keep code mode's existing
vendor guard before any provider browser preparation.

In `web-ai/watcher.mjs`, add Perplexity hosts/streaming selectors and:

```js
const pollFn =
    isWorkSession(session)
        ? pollWorkSession
        : vendor === 'gemini'
            ? geminiPollWebAi
            : vendor === 'grok'
                ? grokPollWebAi
                : vendor === 'perplexity'
                    ? perplexityPollWebAi
                    : pollWebAi;
```

- [ ] **Step 4: Verify Green, refactor, and regress**

Run Step 2 plus:

```bash
npx vitest run \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-tab-recovery.test.mjs \
  test/unit/web-ai-watcher.test.mjs
```

Use the exported model catalog for help generation instead of duplicating aliases.

- [ ] **Step 5: Commit**

```bash
git add web-ai/cli.mjs web-ai/cli-sessions.mjs web-ai/watcher.mjs \
  skills/browser/browser.mjs skills/browser/search.mjs \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-watcher.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
git commit -m "feat: expose Perplexity CLI sessions"
```

---

### Task 10: Wire MCP, Policy, Copy, Doctor, And Semantic Targets

**Files:**
- Modify: `web-ai/mcp-server.mjs`
- Modify: `web-ai/tool-schema.mjs`
- Modify: `web-ai/copy-markdown.mjs`
- Modify: `web-ai/policy/default-policy.mjs`
- Modify: `web-ai/doctor.mjs`
- Modify: `web-ai/vendor-editor-contract.mjs`
- Modify: `test/integration/web-ai-mcp-server.test.mjs`
- Modify: `test/unit/web-ai-tool-schema.test.mjs`
- Modify: `test/unit/web-ai-tool-validation.test.mjs`
- Modify: `test/unit/web-ai-policy.test.mjs`
- Modify: `test/unit/web-ai-copy-markdown.test.mjs`
- Modify: `test/unit/web-ai-doctor.test.mjs`

**Interfaces:**
- Produces: `validateProviderWebAiInput(toolName, input)`
- Produces: `PERPLEXITY_COPY_SELECTORS`, feature definitions, and editor contract

- [ ] **Step 1: Write Red semantic validation tests**

Assert validation happens before `getPage()`/`getTargetId()`:

- Perplexity `effort` requires `model`;
- Perplexity rejects ChatGPT-only `family`;
- ChatGPT/Gemini/Grok keep their existing effort semantics;
- conflicting `provider` and `vendor` values fail before Page/target access;
- conflicting MCP `effort`/`reasoningEffort` canonical values fail with
  `provider.option-conflict` before `getTargetId()`, `getPage()`,
  `withSessionPage()`, navigation, or tab-mutex entry; canonical-equal pairs
  such as `heavy`+`on` and `normal`+`off` are accepted for Perplexity;
- an explicit MCP provider/vendor that differs from the persisted session
  vendor fails with `provider.session-vendor-mismatch` before
  `withSessionPage()`, `getPage()`, target access, or navigation;
- MCP wait/resume returns exact citation artifacts.
- MCP errors preserve `errorCode`, `stage`, `retryHint`, `vendor`,
  `mutationAllowed`, and `evidence` in `structuredContent.error`.

Add policy cases `omitted → true`, `false → false`, `true → true`. Add doctor assertions for a non-empty Perplexity feature list and Perplexity semantic targets. Add a copy fixture with two answers, a source panel, and a decoy copy button.
For copy fallback, assert overlapping turn selectors resolve the actual last
DOM turn, the committed response root wins over selector order, and the copy
handler fires exactly once. The Perplexity copy target is
`committedRoot.getByRole('button', { name: /^Copy$/i, exact: true })`; do not
require an `aria-label` attribute unless a fixture captures it. The Sources
pane, earlier turns, root-external Copy decoys, and duplicate Copy controls must
not win.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/integration/web-ai-mcp-server.test.mjs \
  test/unit/web-ai-tool-schema.test.mjs \
  test/unit/web-ai-tool-validation.test.mjs \
  test/unit/web-ai-policy.test.mjs \
  test/unit/web-ai-copy-markdown.test.mjs \
  test/unit/web-ai-doctor.test.mjs
```

- [ ] **Step 3: Implement provider-specific validation**

Add `on/off` to the schema enum, then immediately apply
`validateProviderWebAiInput()` so schema acceptance does not change other
providers. `providerFromArgs()` rejects non-equal simultaneous
`provider`/`vendor` values.

At the beginning of MCP submit/session dispatch, before policy target lookup or
tab mutex acquisition, resolve aliases once:

```js
const provider = providerFromArgs(args);
const reasoningEffort = resolveProviderEffortAliases(
    provider,
    args.effort,
    args.reasoningEffort,
);
validateProviderWebAiInput(name, {
    ...args,
    provider,
    reasoningEffort,
});
```

For Perplexity, compare canonical `on|off` values; for existing providers,
preserve their current normalization rules. Remove every downstream
`args.effort || args.reasoningEffort` expression and pass only the resolved
value. Conflicts use Task 0's `optionConflictError()`.

For session tools, resolve the explicit requested provider separately from the
stored session. If present and unequal to `stored.vendor`, throw
`provider.session-vendor-mismatch` before `withSessionPage()`. Preserve this
typed error in `structuredContent.error`.

In the MCP catch path, wrap the error and return:

```js
const wrapped = wrapError(error);
const serialized = wrapped.toJSON();
return jsonResponse(message.id, {
    content: [{
        type: 'text',
        text: wrapped.message,
    }],
    structuredContent: {
        error: serialized,
    },
    isError: true,
});
```

- [ ] **Step 4: Add scoped selectors and diagnostics**

Define narrow committed-answer selectors from captured fixtures; do not use `main .prose`.

```js
export const PERPLEXITY_EDITOR_CONTRACT = Object.freeze({
    vendor: 'perplexity',
    semanticTargets: {
        composer: {
            roles: ['textbox'],
            names: [/ask/i, /question/i, /질문/i, /search/i],
            excludeNames: [/filter/i],
            cssFallbacks: ['#ask-input'],
            required: true,
        },
        sendButton: {
            roles: ['button'],
            names: [/submit/i, /send/i, /검색/i],
            cssFallbacks: PERPLEXITY_SEND_SELECTORS,
        },
        modelPicker: {
            roles: ['button', 'combobox'],
            names: [/model/i, /모델/i],
            cssFallbacks: PERPLEXITY_MODEL_PICKER_SELECTORS,
        },
        uploadSurface: {
            roles: ['button'],
            names: [/^add files or tools$/i],
            cssFallbacks: PERPLEXITY_UPLOAD_SELECTORS,
        },
        responseFeed: {
            roles: [],
            names: [],
            cssFallbacks: PERPLEXITY_RESPONSE_SELECTORS,
        },
        copyButton: {
            roles: ['button'],
            names: [/copy/i, /복사/i],
            cssFallbacks: PERPLEXITY_COPY_SELECTORS.copyButtonSelectors,
        },
        streamingIndicator: {
            roles: ['button'],
            names: [/^stop response \(esc\)$/i, /중지/i],
            cssFallbacks: PERPLEXITY_STREAMING_SELECTORS,
        },
    },
});
```

`PERPLEXITY_RESPONSE_SELECTORS` must be derived from the Task 5 fixture by
finding the smallest unique current-turn ancestor that contains committed
answer text and the observed completed-footer controls (`Copy`,
`<number> sources`, and at least one of `Share`/`Rewrite Session`) while
excluding previous-turn footers. Do not invent `article|region|main` roles or
accessible names. Test a page-level `main` decoy, footer-only skeleton,
streaming text without a completion footer, two Copy controls, and previous-turn
footer decoys.

Add `PERPLEXITY_FEATURES` and a doctor switch branch; host mapping alone is insufficient.

Change `captureCopiedResponseText()` to accept an optional committed response
root. Without one, deduplicate matches and sort nodes with
`compareDocumentPosition()` before choosing the last DOM turn. Trigger the
copy control through one mechanism only; remove the synthetic-plus-native
double click. Regress all existing provider copy tests.

- [ ] **Step 5: Verify Green, refactor, and regress**

Run Step 2 plus existing three-provider tool-validation and policy tests.

- [ ] **Step 6: Commit**

```bash
git add web-ai/mcp-server.mjs web-ai/tool-schema.mjs \
  web-ai/copy-markdown.mjs web-ai/policy/default-policy.mjs \
  web-ai/doctor.mjs web-ai/vendor-editor-contract.mjs \
  test/integration/web-ai-mcp-server.test.mjs \
  test/unit/web-ai-tool-schema.test.mjs \
  test/unit/web-ai-tool-validation.test.mjs \
  test/unit/web-ai-policy.test.mjs \
  test/unit/web-ai-copy-markdown.test.mjs \
  test/unit/web-ai-doctor.test.mjs \
  test/fixtures/provider-dom/perplexity-copy-decoys.html
git commit -m "feat: expose Perplexity through MCP diagnostics"
```

---

### Task 11: Add Perplexity Eval Without Changing Parallel Isolation

**Files:**
- Modify: `package.json`
- Modify: `scripts/release-gates.mjs`
- Create: `test/fixtures/provider-dom/perplexity-eval.json`
- Modify: `test/unit/web-ai-eval-fixtures.test.mjs`
- Modify: `test/unit/web-ai-eval-parallel-fixtures.test.mjs`

**Interfaces:**
- Perplexity baseline/cosmetic/structural fixtures pass
- Perplexity breaking fixture fails in an explicit test
- `parallel-eval.json` remains byte-for-byte unchanged

- [ ] **Step 1: Write Red eval tests**

Read `parallel-eval.json` before and after this task and assert its SHA-256 is
unchanged. Keep the existing three fixture paths and order assertion. Add:

```js
it('detects the intentional Perplexity breaking fixture', async () => {
    const result = await runOneFixture({
        vendor: 'perplexity',
        variant: 'breaking',
        fixturePath: resolve(
            'test/fixtures/provider-dom/perplexity-breaking.html',
        ),
        requiredIntents: [
            'composer.fill',
            'send.click',
        ],
    }, {
        fixtureDir: resolve('test/fixtures/provider-dom'),
        index: 0,
    });

    expect(result.status).toBe('fail');
    expect(result.errors).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                errorCode: 'eval.target-resolution-failed',
            }),
        ]),
    );
});
```

For baseline/cosmetic/structural variants, assert `result.status === 'pass'`
and that no error has `errorCode === 'eval.network-blocked'`. Sanitized
fixtures must not contain active external `href`, `src`, `action`, or
`formaction` values.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-eval-fixtures.test.mjs \
  test/unit/web-ai-eval-parallel-fixtures.test.mjs
```

- [ ] **Step 3: Create the dedicated eval config**

Create `perplexity-eval.json`:

```json
{
  "schemaVersion": 1,
  "fixtures": [
    {
      "vendor": "perplexity",
      "variant": "baseline",
      "htmlPath": "perplexity-baseline.html",
      "requiredIntents": ["composer.fill", "upload.open", "send.click", "copy.click"]
    },
    {
      "vendor": "perplexity",
      "variant": "cosmetic-churn",
      "htmlPath": "perplexity-cosmetic-churn.html",
      "requiredIntents": ["composer.fill", "send.click", "copy.click"]
    },
    {
      "vendor": "perplexity",
      "variant": "structural-churn",
      "htmlPath": "perplexity-structural-churn.html",
      "requiredIntents": ["composer.fill", "send.click"]
    }
  ]
}
```

Do not add the breaking variant to the default config.

- [ ] **Step 4: Verify Green**

```bash
npm run test:eval-perplexity
node scripts/run-web-ai-eval.mjs \
  --config test/fixtures/provider-dom/perplexity-eval.json \
  --json
npx vitest run \
  test/unit/web-ai-eval-fixtures.test.mjs \
  test/unit/web-ai-eval-parallel-fixtures.test.mjs
```

Add to `package.json`:

```json
"test:eval-perplexity": "node scripts/run-web-ai-eval.mjs --config test/fixtures/provider-dom/perplexity-eval.json --json"
```

Add `test:eval-perplexity` to the `tests` suite in
`scripts/release-gates.mjs` so `npm run gate:all` cannot pass while the
dedicated fixture contract fails.

- [ ] **Step 5: Refactor and regress**

Document that marker eval verifies fixture intent coverage while Task 6–8 behavioral tests verify actual locator/mutation behavior.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/release-gates.mjs \
  test/fixtures/provider-dom/perplexity-eval.json \
  test/unit/web-ai-eval-fixtures.test.mjs \
  test/unit/web-ai-eval-parallel-fixtures.test.mjs
git commit -m "test: add isolated Perplexity provider eval"
```

---

### Task 12: Synchronize Public Documentation

**Files:**
- Modify: `README.md`
- Modify: `skills/browser/browser.mjs`
- Modify: `skills/browser/search.mjs`
- Modify: `skills/browser/SKILL.md`
- Modify: `skills/browser/skill-install.mjs`
- Modify: `skills/browser/extract.mjs`
- Modify: `skills/search/references/cli-reference.md`
- Modify: `skills/web-ai/SKILL.md`
- Modify: `structure/INDEX.md`
- Modify: `structure/CAPABILITY_TRUTH_TABLE.md`
- Modify: `structure/commands.md`
- Modify: `structure/runtime_contracts.md`
- Modify: `structure/release_gates.md`
- Modify: `structure/phase_status.md`
- Modify: `structure/str_func.md`
- Modify: `docs/production-readiness.md`
- Modify: `docs/comparison.md`
- Modify: `docs/index.html`
- Modify: `docs/dev/index.html`
- Modify: `docs/dev/concepts/architecture.html`
- Modify: `docs/dev/concepts/web-ai-sessions.html`
- Modify: `docs/dev/guides/web-ai.html`
- Modify: `docs/dev/reference/cli.html`
- Modify: `docs/dev/ko/index.html`
- Modify: `docs/dev/ko/concepts/architecture.html`
- Modify: `docs/dev/ko/concepts/web-ai-sessions.html`
- Modify: `docs/dev/ko/guides/web-ai.html`
- Modify: `docs/dev/ko/reference/cli.html`

- [ ] **Step 1: Write Red help/source-contract assertions**

Assert public help advertises `chatgpt | gemini | grok | perplexity`,
Perplexity aliases, binary effort, timeout tiers, citation persistence,
locked-model error, and session recovery. `provider-adapter.mjs` is included
because Task 0 expands its typedef while leaving runtime disabled.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run test/integration/web-ai-cli-contract.test.mjs
```

- [ ] **Step 3: Update exact documentation files**

Add status/send/watch/resume/reattach and locked-model examples. State that
citations can be `[]`, with `citations-unavailable` specifically when citation
extraction degraded. Keep unsupported Spaces/Focus/Deep Research claims out of
ready surfaces.

- [ ] **Step 4: Verify Green and documentation gates**

```bash
npm run fix:counts
npm run docs:drift
git diff --check
```

- [ ] **Step 5: Refactor and regress**

Search public sources for stale three-provider claims and inspect each match:

```bash
rg -n \
  "ChatGPT.?Gemini.?Grok|ChatGPT, Gemini(,| and) Grok|chatgpt \\| gemini \\| grok|chatgpt, gemini, grok" \
  README.md skills web-ai structure docs
```

- [ ] **Step 6: Commit exact files**

Inspect `git diff --name-only` for unrelated changes, then stage only these
explicit public surfaces:

```bash
git diff --name-only
git add README.md skills/browser/browser.mjs skills/browser/search.mjs \
  skills/browser/SKILL.md skills/browser/skill-install.mjs \
  skills/browser/extract.mjs \
  skills/search/references/cli-reference.md skills/web-ai/SKILL.md \
  structure/INDEX.md structure/CAPABILITY_TRUTH_TABLE.md \
  structure/commands.md structure/runtime_contracts.md \
  structure/release_gates.md structure/phase_status.md \
  structure/str_func.md docs/production-readiness.md docs/comparison.md \
  docs/index.html docs/dev/index.html \
  docs/dev/concepts/architecture.html \
  docs/dev/concepts/web-ai-sessions.html \
  docs/dev/guides/web-ai.html docs/dev/reference/cli.html \
  docs/dev/ko/index.html docs/dev/ko/concepts/architecture.html \
  docs/dev/ko/concepts/web-ai-sessions.html \
  docs/dev/ko/guides/web-ai.html docs/dev/ko/reference/cli.html
git commit -m "docs: document Perplexity web-ai support"
```

---

### Task 13: Full Regression, Package Gates, And Authenticated Smoke

**Files:**
- Create: `devlog/_smoke/260711_perplexity_web_ai/README.md`

- [ ] **Step 1: Run focused and shared regression tests**

```bash
set -euo pipefail
npx vitest run \
  test/unit/web-ai-perplexity-model.test.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/unit/web-ai-perplexity-live-policy.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
npm run test:unit
npm run test:integration
npm test
npm run test:e2e
npm run test:eval-perplexity
```

- [ ] **Step 2: Run all package gates**

```bash
set -euo pipefail
npm run typecheck:checkjs
npm run typecheck:checkjs-dom
npm run typecheck
npm run check:module-graph
npm run smoke:bins
npm run test:eval-perplexity
npm run gate:all
npm pack --dry-run --json | tee /tmp/perplexity-pack.json
jq -e '
  .[0].files
  | map(.path) as $files
  | ($files | index("web-ai/perplexity-model.mjs")) != null
    and ($files | index("web-ai/perplexity-citations.mjs")) != null
    and ($files | index("web-ai/perplexity-live.mjs")) != null
' /tmp/perplexity-pack.json
git diff --check
```

- [ ] **Step 3: Run authenticated status → send → watch → resume**

```bash
set -euo pipefail

node ./bin/agbrowse.mjs navigate https://www.perplexity.ai

node ./bin/agbrowse.mjs web-ai status \
  --vendor perplexity \
  --url https://www.perplexity.ai \
  --json | tee /tmp/perplexity-status.json

jq -e '
  .ok == true
  and .vendor == "perplexity"
  and (.modelOptions | type == "array")
' /tmp/perplexity-status.json

SMOKE_MODEL_ALIAS="$(
  jq -r '
    .modelOptions[]
    | select(
        .alias == "gpt-5.6-terra"
        and .locked == false
        and .supportsThinking == true
      )
    | .alias
  ' /tmp/perplexity-status.json | head -n 1
)"
test -n "$SMOKE_MODEL_ALIAS"
test "$SMOKE_MODEL_ALIAS" = "gpt-5.6-terra"

node ./bin/agbrowse.mjs web-ai send \
  --vendor perplexity \
  --url https://www.perplexity.ai \
  --model "$SMOKE_MODEL_ALIAS" \
  --effort on \
  --inline-only \
  --prompt "Reply with a short sourced explanation of CDP." \
  --json | tee /tmp/perplexity-send.json

SID="$(jq -r '.sessionId' /tmp/perplexity-send.json)"
test -n "$SID"
test "$SID" != "null"

# 3600-second Thinking deadline plus a 120-second shutdown/evidence margin.
timeout 3720 node ./bin/agbrowse.mjs web-ai watch \
  --session "$SID" \
  --interval 5s \
  --poll-timeout 30 \
  --navigate \
  --json | tee /tmp/perplexity-watch.jsonl

grep -q '"type":"watch.complete"' /tmp/perplexity-watch.jsonl

node ./bin/agbrowse.mjs web-ai sessions resume "$SID" \
  --json | tee /tmp/perplexity-resume.json

jq -e '
  .status == "complete"
  and (.answerArtifact.citations | type == "array")
  and .answerText == .answerArtifact.text
' /tmp/perplexity-resume.json
```

- [ ] **Step 4: Verify reattach and disk persistence**

```bash
set -euo pipefail
SID="$(jq -er '.sessionId' /tmp/perplexity-send.json)"

node ./bin/agbrowse.mjs web-ai sessions reattach "$SID" \
  --navigate \
  --json | tee /tmp/perplexity-reattach.json

node ./bin/agbrowse.mjs web-ai sessions show "$SID" \
  --json | tee /tmp/perplexity-session.json

jq -e --slurpfile resumed /tmp/perplexity-resume.json '
  .session.answer == $resumed[0].answerText
  and .session.answerArtifact == $resumed[0].answerArtifact
' /tmp/perplexity-session.json
```

- [ ] **Step 5: Verify locked model fail-closed**

Choose only a model currently reported as locked by the non-mutating status
probe:

```bash
set -euo pipefail
test -s /tmp/perplexity-status.json

OBSERVED_LOCKED_MODEL_ALIAS="$(
  jq -r '
    .modelOptions[]
    | select(.locked == true)
    | .alias
  ' /tmp/perplexity-status.json | head -n 1
)"

if [ -z "$OBSERVED_LOCKED_MODEL_ALIAS" ]; then
  printf '%s\n' \
    'locked-model check: not-observable' \
    >> devlog/_smoke/260711_perplexity_web_ai/README.md
else
  set +e
  node ./bin/agbrowse.mjs web-ai send \
    --vendor perplexity \
    --model "$OBSERVED_LOCKED_MODEL_ALIAS" \
    --inline-only \
    --prompt "This prompt must not be submitted." \
    --json \
    >/tmp/perplexity-locked.out \
    2>/tmp/perplexity-locked.err
  RC=$?
  set -e

  test "$RC" -ne 0
  jq -e '
    .error.errorCode == "provider.model-entitlement"
  ' /tmp/perplexity-locked.err
fi
```

- [ ] **Step 6: Record only executed evidence**

`devlog/_smoke/260711_perplexity_web_ai/README.md` must include command,
timestamp, exit code, session ID, observed conversation URL, citation count,
provider deadline, external watchdog timeout, watchdog exit reason, and exact
booleans for watch, resume, reattach, and locked-model checks. Do not
write `yes` for an unexecuted check. Every fenced smoke block is self-contained
with `set -euo pipefail` and reloads values it needs from `/tmp` JSON evidence.

- [ ] **Step 7: Commit evidence**

```bash
git add devlog/_smoke/260711_perplexity_web_ai/README.md
git commit -m "test: record Perplexity web-ai smoke"
git status --short
```

Expected: the final `git status --short` prints no output.

## Final Acceptance Checklist

- [ ] Full checkout baseline and all pre-existing failures are documented.
- [ ] Identity registration precedes live dispatch and eval execution.
- [ ] Validation completes before any Page/Locator call.
- [ ] Model row and its immediate-next-sibling Thinking switch are unique, scoped, interactive, and post-verified without sibling skipping.
- [ ] `Sonar 2` is recognized as the observed selectable
  `menuitemradio`, while headings and locked non-radio rows are never clicked.
- [ ] Standalone send opens a fresh thread; session-bound send does not.
- [ ] Baseline, assistant count, active lease, target binding, model, and effort persist.
- [ ] Completion requires a unique committed response, progress, settled citation state, and no streaming; `unavailable` degrades only after grace with a warning.
- [ ] Timeout, page-death, and stop postconditions match existing provider behavior.
- [ ] Citation extraction proves Sources-pane causality, uses an authenticated close mechanism, is scoped to the committed response, and never invents indices.
- [ ] `answer === answerArtifact.text`; 2 MiB answers and 500 citations survive a fresh process.
- [ ] Thinking timeout restores to 3600 seconds during resume without a deadline.
- [ ] Existing-tab and new-tab recovery share the strict provider URL guard.
- [ ] CLI, MCP, policy, doctor, copy fallback, sessions, watcher, and search help include Perplexity.
- [ ] Capability registry/presets expose the six Perplexity rows without browser mutation in Task 0.
- [ ] Tab lifecycle treats bare and `www` Perplexity hosts as one provider and preserves active lease/session ownership.
- [ ] MCP errors preserve the structured WebAiError contract.
- [ ] Unsupported/conflicting Perplexity options and MCP session-vendor mismatches fail before browser preparation or session-page recovery.
- [ ] `parallel-eval.json` remains unchanged; dedicated Perplexity eval is part of `gate:all` and passes.
- [ ] ChatGPT/Gemini/Grok regression tests, `npm test`, `test:e2e`, and `npm run gate:all` pass.
- [ ] Smoke evidence includes the watcher path and records only commands that actually ran.
