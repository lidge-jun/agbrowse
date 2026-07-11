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
- Thinking is the selected model row's adjacent `menuitemcheckbox`, containing one `role=switch`; it is not nested inside the model row.
- Standalone send opens a fresh Perplexity thread; session-bound send/query never does.
- A Perplexity send resolves a non-null target ID before provider mutation or fails with `cdp.target-mismatch`.
- The send baseline is captured after model/Thinking selection, composer insertion, and attachment-preview verification, immediately before submit.
- Every successful send records a baseline, `assistantCount`, active lease, target binding, model evidence, and `reasoningEffort`: canonical `on|off` when explicitly requested or unambiguously observed, otherwise `null`.
- Poll completion requires a newly committed response identity, settled citation state, and `streamingState === 'idle'`; truthiness checks are forbidden.
- `PERPLEXITY_CITATION_GRACE_MS` is exactly `2000`.
- Poll uses `resolveTimeoutBudgetSec()`, calls `markSessionTimeout()` on timeout, and returns recoverable `tab-crashed` for `isPageDeathError()`.
- ChatGPT and Perplexity stored-conversation `page.goto()` and `createTab()` calls pass their provider-specific guard immediately before navigation. Existing ChatGPT query-bearing `/c/<id>` acceptance remains unchanged; Gemini/Grok are not narrowed without captured URL fixtures.
- `web-ai watch`, `sessions resume`, and `sessions reattach --navigate` are required Perplexity integration surfaces.
- A completed Perplexity artifact always has `citations`, including `[]`.
- `answer` is byte-for-byte equal to `answerArtifact.text`.
- Default timeout is 1200 seconds; Thinking-enabled timeout is 3600 seconds, including resume fallback without a stored deadline.
- `SESSION_STORE_VERSION` remains `1`.
- `provider-adapter.mjs` stays contract-only, but its vendor typedef includes Perplexity.
- `parallel-eval.json` remains unchanged because it is the existing parallel-isolation contract.
- The live DOM source of truth is `docs/superpowers/specs/2026-07-11-perplexity-live-dom-observation.md`.
- The GPT-5.6 High review record is `docs/superpowers/specs/2026-07-11-chatgpt-5.6-high-plan-review.md`.
- Status may open and close the unique model menu for inspection, but must not click a model row, Thinking checkbox/switch, Search, Computer, Connectors, or Spaces; it verifies selected state is unchanged before returning.
- Spaces, Focus, Deep Research, login automation, and subscription changes are out of scope.
- Every task ends Red → Green → Refactor → existing-provider regression → commit.
- Refactor steps preserve public signatures, mutation call counts, fixture intent coverage, and serialized warning/error contracts.

## File Map

### New production files

- `web-ai/perplexity-model.mjs`: canonical aliases, request validation, unique row inspection, lock classification, selection and Thinking postconditions.
- `web-ai/perplexity-citations.mjs`: citation URL/index normalization and committed-response extraction.
- `web-ai/perplexity-live.mjs`: provider status/send/poll/query/stop lifecycle.

### New tests and fixtures

- `test/unit/web-ai-perplexity-model.test.mjs`
- `test/unit/web-ai-perplexity-citations.test.mjs`
- `test/unit/web-ai-perplexity-live-policy.test.mjs`
- `test/integration/web-ai-perplexity-session.test.mjs`
- `test/fixtures/provider-dom/perplexity-model-picker-ko.html`
- `test/fixtures/provider-dom/perplexity-model-picker-en.html`
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
- `test/fixtures/provider-dom/perplexity-late-citation.html`
- `test/fixtures/provider-dom/perplexity-eval.json`
- `test/fixtures/provider-dom/perplexity-fixture-provenance.json`
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
command -v jq
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
set -o pipefail
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
```

Add six Perplexity capability rows and observation-preset assertions:
`active-tab-verification`, `composer-visible`, `model-alias-selectable`,
`upload-surface-visible`, `copy-button-present`, and `response-streaming`.

- [ ] **Step 2: Verify Red**

```bash
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

**Interfaces:**
- Produces: `isSafeProviderConversationUrl(vendor, value)`
- Produces: `isSafePerplexityConversationUrl(value)`
- Produces: `openConversationInNewTab(deps, { vendor, conversationUrl })`
- Produces: provider-specific conversation identity and readiness

- [ ] **Step 1: Write Red URL matrix tests**

For Perplexity, reject `http:`, foreign hosts, provider root, credentials, ports, fragments, queries, path prefixes, `..`, encoded traversal, backslashes, NUL, and mismatched conversation IDs. Permit only captured `/search/<id>` forms.

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
  test/unit/web-ai-watcher.test.mjs
```

- [ ] **Step 3: Preserve ChatGPT and add a strict Perplexity guard**

```js
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
        || value === ''
        || value.includes('\\')
        || value.includes('\0')
    ) return false;

    const authorityEnd =
        value.indexOf('/', 'https://'.length);
    const rawPath = authorityEnd === -1
        ? '/'
        : value.slice(authorityEnd).split(/[?#]/, 1)[0];
    let decodedRawPath = rawPath;
    try {
        for (let index = 0; index < 3; index += 1) {
            const next = decodeURIComponent(decodedRawPath);
            if (next === decodedRawPath) break;
            decodedRawPath = next;
        }
    } catch {
        return false;
    }
    if (
        /(?:^|\/)\.\.(?:\/|$)/.test(decodedRawPath)
        || decodedRawPath.includes('\\')
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
        || ![
            'perplexity.ai',
            'www.perplexity.ai',
        ].includes(url.hostname)
    ) return false;

    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return false;
    }
    if (pathname.includes('..') || pathname.includes('\\')) return false;
    return /^\/search\/[A-Za-z0-9_-]+\/?$/.test(pathname);
}
```

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
git add web-ai/tab-recovery.mjs web-ai/navigation-ready.mjs \
  web-ai/cli-sessions.mjs web-ai/watcher.mjs \
  test/unit/web-ai-safe-conversation-url.test.mjs \
  test/unit/web-ai-tab-recovery.test.mjs \
  test/unit/web-ai-open-conversation-newtab.test.mjs \
  test/unit/web-ai-navigation-ready.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-watcher.test.mjs
git commit -m "feat: guard provider conversation recovery URLs"
```

---

### Task 4: Register Perplexity Tab Lifecycle Ownership

**Files:**
- Modify: `skills/browser/tab-lifecycle.mjs`
- Modify: `test/unit/tab-lifecycle.test.mjs`

**Interfaces:**
- Adds: `perplexity: 'https://www.perplexity.ai'` provider origin
- Preserves: active lease, active session, active command, and pinned-tab protection

- [ ] **Step 1: Write Red lifecycle tests**

Add Perplexity origin detection, idle cleanup, max-tab cleanup, active lease
protection, and bound-session protection cases using the same table-driven
fixtures as existing providers.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run test/unit/tab-lifecycle.test.mjs
```

- [ ] **Step 3: Add the origin**

```js
const PROVIDER_ORIGINS = {
    chatgpt: 'https://chatgpt.com',
    gemini: 'https://gemini.google.com',
    grok: 'https://grok.com',
    perplexity: 'https://www.perplexity.ai',
};
```

- [ ] **Step 4: Verify Green and regress existing providers**

Run Step 2. Expected: cleanup ordering and protection behavior remain
unchanged for ChatGPT/Gemini/Grok.

- [ ] **Step 5: Commit**

```bash
git add skills/browser/tab-lifecycle.mjs test/unit/tab-lifecycle.test.mjs
git commit -m "feat: track Perplexity tab lifecycle"
```

---

### Task 5: Capture DOM Evidence And Add Pure Perplexity Rules

**Files:**
- Create: `web-ai/perplexity-model.mjs`
- Create: `web-ai/perplexity-citations.mjs`
- Create: `scripts/capture-perplexity-fixtures.mjs`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-ko.html`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-en.html`
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
- Create: `test/fixtures/provider-dom/perplexity-late-citation.html`
- Create: `test/fixtures/provider-dom/perplexity-fixture-provenance.json`
- Create: `test/unit/web-ai-perplexity-model.test.mjs`
- Create: `test/unit/web-ai-perplexity-citations.test.mjs`
- Create: `test/helpers/perplexity-page-fixture.mjs`
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
--surface picker-ko|picker-en|picker-locked|duplicate-switch|thinking-on|thinking-off|overlay|attachment|baseline|streaming|complete-citations|late-citation|copy-decoys
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

Repeat for every surface in the command contract. Record the semantic markers
and resolved root selector in provenance; do not assume
`dialog/menu/listbox`.

Derive eval variants from the sanitized baseline:

- `cosmetic-churn`: change class names and non-semantic wrapper text only;
- `structural-churn`: insert/reorder wrapper elements while preserving role,
  accessible name, state, and `data-eval-intent`;
- `breaking`: remove the composer/send semantic targets and retain a decoy
  response so the expected failure is `eval.target-resolution-failed`.

Record capture date, locale, surface, sanitization, screenshot SHA-256, and source URL class in `perplexity-fixture-provenance.json`.
For eval fixtures, remove or rewrite every external `href`, `src`, `action`,
and `formaction`; `runOneFixture()` must not return `eval.network-blocked`.
Citation URL normalization fixtures store source URLs in inert
`data-source-url` attributes or test records, not network-capable markup.
Replace Task 0's `not-observed` Perplexity observation presets with the
fixture-backed selectors, activation paths, active-state signals, and
`source: 'live-frontend'`; set status to `schema-ready`.

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

Citation tests assert that only links from the Sources pane opened by the
committed answer footer's unique `${count} sources` button are retained;
inline links, related questions, internal navigation, actions, and other
turns are excluded. Missing explicit index remains `null`; no visual offset
is invented.
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

- [ ] **Step 6: Commit**

```bash
git add web-ai/perplexity-model.mjs web-ai/perplexity-citations.mjs \
  scripts/capture-perplexity-fixtures.mjs \
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
- Modify: `test/unit/web-ai-perplexity-model.test.mjs`

**Interfaces:**
- Consumes: `validatePerplexitySelectionRequest(model, effort)`
- Produces: `selectPerplexityModel(page, selectionRequest)`
- Returns: `{ requestedModel, resolvedModel, resolvedLabel, locked, thinking, verified }`

- [ ] **Step 1: Write Red action-log tests**

Create `test/helpers/perplexity-page-fixture.mjs` following the existing
ChatGPT model tests' fake Page/Locator pattern; do not add JSDOM or a browser
dependency. The helper loads sanitized fixture annotations and records
`locator`, `count`, `evaluate`, and `click`. Use KO, EN, Thinking ON/OFF,
locked-row, and duplicate-switch fixtures. Assert zero mutation for duplicate rows,
noninteractive rows, disabled/inert ancestors, unknown lock state, locked
rows, missing selected row, zero/two switches, and invalid `aria-checked`.

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
let thinking = null;
if (requestedThinking !== null) {
    const thinkingItem =
        selectedRow.locator(
            'xpath=following-sibling::*[@role="menuitemcheckbox"][1]',
        );
    const thinkingCount = await thinkingItem.count();
    const switches =
        thinkingItem.locator('[role="switch"]');
    const switchCount = await switches.count();
    if (thinkingCount !== 1 || switchCount !== 1) {
        throw modeUnavailableError(
            'perplexity',
            requestedModel,
            requestedThinking,
            { thinkingCount, switchCount },
        );
    }
    thinking = await setAndVerifyPerplexityThinking(
        switches.first(),
        requestedThinking,
    );
} else {
    thinking =
        await readPerplexityThinkingStateWithoutMutation(
            selectedRow,
        );
}
return verifyPerplexitySelection(
    page,
    requestedModel,
    requestedThinking,
    {
        thinking,
        thinkingMutationExpected:
            requestedThinking !== null,
    },
);
```

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
        thinkingAvailable,
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

- [ ] **Step 1: Write Red lifecycle tests**

Assert:

- status resolves exactly one visible model trigger whose accessible name is
  `Model` or the currently selected model label;
- status opens and closes exactly one model menu, returns only the documented
  sanitized keys, and never returns account/subscription text or raw DOM;
- status performs zero model-row clicks and zero switch clicks, and verifies
  the selected model and switch states did not change;
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
- Produces: citation state `present|none-confirmed|pending|unknown`

- [ ] **Step 1: Write Red poll tests with a fake clock**

Assert:

- stable previous answer without URL/turn progress never completes;
- concrete URL progress plus a new committed response can complete;
- same-URL follow-up requires response-count/turn-identity progress;
- URL change without a new response does not complete;
- citation fingerprint must stabilize after answer text;
- citation state `unknown` or `pending` never completes;
- citations added at least 800ms after text stability are retained;
- `PERPLEXITY_CITATION_GRACE_MS` is exactly `2000`;
- streaming state `unknown` never completes;
- `Stop response (Esc)` is the observed streaming control and maps to
  `streaming`;
- completed response action `Copy` maps to idle/completion evidence only
  inside the committed response root;
- citation extraction clicks the committed response footer's unique
  `${count} sources` button, reads only the opened Sources pane's direct
  external HTTP(S) anchors, and closes the pane without changing the answer;
- ordinary body links, internal `/search/<id>` memory links, related
  questions, Share/Download/Rewrite/action links, and links from other turns
  are excluded;
- the observed Sources pane supplies no numeric index, so each citation uses
  `index: null` unless explicit index metadata or ARIA evidence is present;
- conversation URL is stored as soon as a concrete `/search/<id>` appears;
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
        : citationState === 'none-confirmed'
            && responseStableMs
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
this locator. Resolve the unique `${count} sources` footer control within the
committed root, open the associated Sources pane, and collect only that
pane's source-list anchors. Never scan every `a[href]` below the answer root.
Use explicit data/ARIA index evidence; otherwise `index: null`. Preserve public warning
`citations-unavailable`, but store internal evidence as one of
`none-observed`, `selector-unavailable`, `ambiguous-response-root`, or
`normalization-dropped-all`.

- [ ] **Step 4: Finalize with one artifact**

Build one artifact using the exact `responseStableMs`, always include citations, add string warning `citations-unavailable` for `[]`, and pass it to `finalizeProviderTab()`.
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
Resolve timeout defaults with:

```js
reasoningEffort:
    values.effort
    || values['reasoning-effort']
```

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
- MCP wait/resume returns exact citation artifacts.
- MCP errors preserve `errorCode`, `stage`, `retryHint`, `vendor`,
  `mutationAllowed`, and `evidence` in `structuredContent.error`.

Add policy cases `omitted → true`, `false → false`, `true → true`. Add doctor assertions for a non-empty Perplexity feature list and Perplexity semantic targets. Add a copy fixture with two answers, a source panel, and a decoy copy button.
For copy fallback, assert overlapping turn selectors resolve the actual last
DOM turn, the committed response root wins over selector order, and the copy
handler fires exactly once. The Perplexity copy target is the unique
`button[aria-label="Copy"]` inside the committed answer footer; the Sources
pane and earlier turns must not win.

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
            roles: ['article', 'region', 'main'],
            names: [/answer/i, /response/i, /답변/i],
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
node scripts/run-web-ai-eval.mjs \
  --config test/fixtures/provider-dom/perplexity-eval.json \
  --json
npx vitest run \
  test/unit/web-ai-eval-fixtures.test.mjs \
  test/unit/web-ai-eval-parallel-fixtures.test.mjs
```

- [ ] **Step 5: Refactor and regress**

Document that marker eval verifies fixture intent coverage while Task 6–8 behavioral tests verify actual locator/mutation behavior.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/provider-dom/perplexity-eval.json \
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

Add status/send/resume/reattach and locked-model examples. State that citations can be `[]` with `citations-unavailable`. Keep unsupported Spaces/Focus/Deep Research claims out of ready surfaces.

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
npx vitest run \
  test/unit/web-ai-perplexity-model.test.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/unit/web-ai-perplexity-live-policy.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
npm run test:unit
npm run test:integration
npm test
npm run test:e2e
```

- [ ] **Step 2: Run all package gates**

```bash
set -o pipefail
npm run typecheck:checkjs
npm run typecheck:checkjs-dom
npm run typecheck
npm run check:module-graph
npm run smoke:bins
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

- [ ] **Step 3: Run authenticated status → send → resume**

```bash
set -o pipefail

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
    | select(.locked == false and .thinkingAvailable == true)
    | .alias
  ' /tmp/perplexity-status.json | head -n 1
)"
test -n "$SMOKE_MODEL_ALIAS"

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
set -o pipefail

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

`devlog/_smoke/260711_perplexity_web_ai/README.md` must include command, timestamp, exit code, session ID, observed conversation URL, citation count, and exact booleans for resume, reattach, and locked-model checks. Do not write `yes` for an unexecuted check.

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
- [ ] Model row and Thinking switch are unique, scoped, interactive, and post-verified.
- [ ] `Sonar 2` is recognized as the observed selectable
  `menuitemradio`, while headings and locked non-radio rows are never clicked.
- [ ] Standalone send opens a fresh thread; session-bound send does not.
- [ ] Baseline, assistant count, active lease, target binding, model, and effort persist.
- [ ] Completion requires progress plus stable answer/citations and no streaming.
- [ ] Timeout, page-death, and stop postconditions match existing provider behavior.
- [ ] Citation extraction is scoped to the committed response and never invents indices.
- [ ] `answer === answerArtifact.text`; 2 MiB answers and 500 citations survive a fresh process.
- [ ] Thinking timeout restores to 3600 seconds during resume without a deadline.
- [ ] Existing-tab and new-tab recovery share the strict provider URL guard.
- [ ] CLI, MCP, policy, doctor, copy fallback, sessions, watcher, and search help include Perplexity.
- [ ] Capability registry/presets expose the six Perplexity rows without browser mutation in Task 0.
- [ ] Tab lifecycle recognizes Perplexity origin and preserves active lease/session ownership.
- [ ] MCP errors preserve the structured WebAiError contract.
- [ ] Unsupported Perplexity options fail before browser preparation.
- [ ] `parallel-eval.json` remains unchanged; dedicated Perplexity eval passes.
- [ ] ChatGPT/Gemini/Grok regression tests, `npm test`, `test:e2e`, and `npm run gate:all` pass.
- [ ] Smoke evidence records only commands that actually ran.
