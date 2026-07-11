# Perplexity Web-AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Perplexity as a first-class Web-AI provider with fail-closed model and Thinking controls, lossless answer/citation persistence, provider-safe session recovery, CLI/MCP support, and deterministic browser fixtures.

**Architecture:** Follow the existing Gemini/Grok pair-module lifecycle: `perplexity-model.mjs` owns picker inspection and mutation, `perplexity-citations.mjs` owns pure citation normalization, and `perplexity-live.mjs` owns status/send/poll/query/stop. Shared identity, artifact, timeout, and recovery contracts are completed before any browser mutation so every later task can reach Green independently.

**Tech Stack:** Node.js ESM with `// @ts-check`, Playwright Core over CDP, Vitest, JSON session persistence, sanitized provider DOM fixtures.

## Global Constraints

- Provider ID is exactly `perplexity`; default URL is `https://www.perplexity.ai`.
- Implementation commands run from a complete Git checkout. The external-review ZIP is source evidence only and is not an executable checkout.
- Validate model, effort, and cross-field rules before any `Page` or `Locator` call.
- `--model` omission does not mutate the picker; `--effort` omission does not mutate Thinking.
- Perplexity `--effort` requires an explicit `--model`.
- Thinking OFF aliases are `off`, `low`, `light`, `standard`, `normal`, `default`.
- Thinking ON aliases are `on`, `extended`, `high`, `xhigh`, `heavy`.
- Ambiguous/missing rows, group headings, unknown lock state, noninteractive rows, ambiguous switches, and unknown selected state fail before click.
- Locked rows fail with `provider.model-entitlement` and retry hint `choose-unlocked-model`.
- Missing or ambiguous Thinking controls fail with `provider.mode-unavailable` and retry hint `omit-effort-or-change-model`.
- `Sonar 2` is a group heading and is never a model alias unless a later captured DOM fixture proves it is an interactive row.
- V1 aliases are limited to screenshot-observed rows: `best`, `gpt-5.6-terra`, `gpt-5.6-sol`, `gemini-3.1-pro`, `claude-sonnet-5`, `claude-opus-4.8`, `glm-5.2`, `kimi-k2.6`, and `nemotron-3-ultra`. Locked aliases remain valid inputs that fail before click.
- Standalone send opens a fresh Perplexity thread; session-bound send/query never does.
- Every successful send records a baseline, `assistantCount`, active lease, target binding, model evidence, and canonical Thinking state.
- Poll completion requires `progressObserved && stableResponse && stableCitations && !streaming`.
- Poll uses `resolveTimeoutBudgetSec()`, calls `markSessionTimeout()` on timeout, and returns recoverable `tab-crashed` for `isPageDeathError()`.
- Every stored-session `page.goto()` and `createTab()` passes a provider-specific concrete-conversation URL guard immediately before navigation.
- A completed Perplexity artifact always has `citations`, including `[]`.
- `answer` is byte-for-byte equal to `answerArtifact.text`.
- Default timeout is 1200 seconds; Thinking-enabled timeout is 3600 seconds, including resume fallback without a stored deadline.
- `SESSION_STORE_VERSION` remains `1`.
- `provider-adapter.mjs` stays contract-only; update its typedef or explicitly allowlist it in public provider-literal audits.
- `parallel-eval.json` remains unchanged because it is the existing parallel-isolation contract.
- Spaces, Focus, Deep Research, login automation, and subscription changes are out of scope.
- Every task ends Red → Green → Refactor → existing-provider regression → commit.

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
- `test/fixtures/provider-dom/perplexity-eval.json`
- `test/fixtures/provider-dom/perplexity-fixture-provenance.json`

### Shared surfaces modified

- Identity/types: `web-ai/types.mjs`, `types/agbrowse-shared.d.ts`, `web-ai/question.mjs`, `web-ai/constants.mjs`, `web-ai/provider-adapter.mjs`, `web-ai/capability-types.mjs`, `web-ai/eval/types.mjs`, `web-ai/errors.mjs`
- Persistence/timeouts: `web-ai/answer-artifact.mjs`, `web-ai/tab-finalizer.mjs`, `web-ai/session.mjs`, `web-ai/session-store.mjs`
- Recovery: `web-ai/tab-recovery.mjs`, `web-ai/navigation-ready.mjs`
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
```

Expected: every command exits 0. Do not execute this plan from the review ZIP.

- [ ] **Step 2: Install the lockfile dependency tree**

```bash
npm ci
git diff --exit-code -- package-lock.json
```

Expected: exits 0 and does not modify the lockfile.

- [ ] **Step 3: Record baseline results**

```bash
mkdir -p devlog/_baseline/260711_perplexity_web_ai
npm test 2>&1 | tee devlog/_baseline/260711_perplexity_web_ai/npm-test.log
npm run docs:drift 2>&1 | tee devlog/_baseline/260711_perplexity_web_ai/docs-drift.log
npm run gate:all 2>&1 | tee devlog/_baseline/260711_perplexity_web_ai/gate-all.log
```

Expected: PASS. If a pre-existing failure is reproducible, record the exact test, error, and issue/owner in `devlog/_baseline/260711_perplexity_web_ai/README.md`; do not weaken new assertions to accommodate it.

---

### Task 0: Register Perplexity Identity Before Browser Mutation

**Files:**
- Modify: `web-ai/types.mjs`
- Modify: `types/agbrowse-shared.d.ts`
- Modify: `web-ai/question.mjs`
- Modify: `web-ai/constants.mjs`
- Modify: `web-ai/provider-adapter.mjs`
- Modify: `web-ai/capability-types.mjs`
- Modify: `web-ai/eval/types.mjs`
- Modify: `web-ai/errors.mjs`
- Modify: `test/unit/web-ai-question.test.mjs`
- Modify: `test/unit/web-ai-eval-types.test.mjs`
- Modify: `test/unit/web-ai-provider-adapter.test.mjs`

**Interfaces:**
- Produces: `WEB_AI_VENDOR.PERPLEXITY === 'perplexity'`
- Produces: `normalizeEnvelope({ vendor: 'perplexity' })`
- Produces: `normalizeEvalVendor('perplexity')`

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

Also assert that `provider.model-entitlement` and `provider.mode-unavailable` serialize with the fixed retry hints from Global Constraints.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-question.test.mjs \
  test/unit/web-ai-eval-types.test.mjs \
  test/unit/web-ai-provider-adapter.test.mjs
```

Expected: Perplexity identity assertions fail before any browser code exists.

- [ ] **Step 3: Add identity only**

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

- [ ] **Step 4: Verify Green**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Refactor and regress existing vendors**

Use the shared vendor constant where it removes duplicate literal unions, but keep `provider-adapter.mjs` disabled. Run:

```bash
npx vitest run \
  test/unit/web-ai-question.test.mjs \
  test/unit/web-ai-eval-types.test.mjs \
  test/unit/web-ai-provider-adapter.test.mjs \
  test/unit/web-ai-provider-session.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add web-ai/types.mjs types/agbrowse-shared.d.ts web-ai/question.mjs \
  web-ai/constants.mjs web-ai/provider-adapter.mjs \
  web-ai/capability-types.mjs web-ai/eval/types.mjs web-ai/errors.mjs \
  test/unit/web-ai-question.test.mjs test/unit/web-ai-eval-types.test.mjs \
  test/unit/web-ai-provider-adapter.test.mjs
git commit -m "feat: register Perplexity web-ai identity"
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
```

Assert:

```js
expect(stored.answer).toBe(largeAnswer);
expect(stored.answerArtifact.text).toBe(largeAnswer);
expect(stored.answerArtifact.citations).toEqual(citations);
expect(Object.hasOwn(stored.answerArtifact, 'citations')).toBe(true);
```

Spawn a fresh Node process that imports the session store and prints the stored session as JSON. Assert exact equality after process restart. Add a second case for `citations: []` and a legacy version-1 session without `answerArtifact`.

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

Store `answer: canonicalAnswer` and the normalized artifact in the same `updateSession()` call.

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
  test/integration/web-ai-mcp-server.test.mjs
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

Keep the alias table for ON/OFF in `perplexity-model.mjs`; until Task 4 exists, `session.mjs` only recognizes the canonical stored values `on` and `off`.

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
- Modify: `test/unit/web-ai-tab-recovery.test.mjs`
- Modify: `test/unit/web-ai-open-conversation-newtab.test.mjs`
- Modify: `test/unit/web-ai-navigation-ready.test.mjs`

**Interfaces:**
- Produces: `isSafeProviderConversationUrl(vendor, value)`
- Produces: provider-specific conversation identity and readiness

- [ ] **Step 1: Write Red URL matrix tests**

For Perplexity, reject `http:`, foreign hosts, provider root, credentials, ports, fragments, queries, path prefixes, `..`, encoded traversal, backslashes, NUL, and mismatched conversation IDs. Permit only captured `/search/<id>` forms.

Assert both existing-tab `page.goto()` and new-tab `createTab()` are never called for unsafe URLs.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-tab-recovery.test.mjs \
  test/unit/web-ai-open-conversation-newtab.test.mjs \
  test/unit/web-ai-navigation-ready.test.mjs
```

- [ ] **Step 3: Implement one guard at every navigation point**

```js
export function isSafeProviderConversationUrl(vendor, value) {
    if (
        typeof value !== 'string'
        || value === ''
        || value.includes('\\')
        || value.includes('\0')
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
        || url.hash
    ) return false;

    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return false;
    }
    if (pathname.includes('..')) return false;

    if (vendor === 'chatgpt') {
        return ['chatgpt.com', 'chat.openai.com'].includes(url.hostname)
            && !url.search
            && /^(?:\/g\/[^/]+)?\/c\/[A-Za-z0-9_-]+\/?$/.test(pathname);
    }
    if (vendor === 'perplexity') {
        return ['perplexity.ai', 'www.perplexity.ai'].includes(url.hostname)
            && !url.search
            && /^\/search\/[A-Za-z0-9_-]+\/?$/.test(pathname);
    }
    return false;
}
```

Call this immediately before every stored-session `page.goto()` and `createTab()`. Split `urlsCompatible()` and `waitForConversationReady()` by provider so Perplexity does not depend on ChatGPT selectors.

- [ ] **Step 4: Verify Green, refactor, and regress ChatGPT**

Run Step 2. Add explicit ChatGPT parity cases for existing accepted `/c/<id>` and GPT-prefixed URLs.

- [ ] **Step 5: Commit**

```bash
git add web-ai/tab-recovery.mjs web-ai/navigation-ready.mjs \
  test/unit/web-ai-tab-recovery.test.mjs \
  test/unit/web-ai-open-conversation-newtab.test.mjs \
  test/unit/web-ai-navigation-ready.test.mjs
git commit -m "feat: guard provider conversation recovery URLs"
```

---

### Task 4: Capture DOM Evidence And Add Pure Perplexity Rules

**Files:**
- Create: `web-ai/perplexity-model.mjs`
- Create: `web-ai/perplexity-citations.mjs`
- Create: picker/citation/streaming fixtures listed in File Map
- Create: `test/fixtures/provider-dom/perplexity-fixture-provenance.json`
- Create: `test/unit/web-ai-perplexity-model.test.mjs`
- Create: `test/unit/web-ai-perplexity-citations.test.mjs`

**Interfaces:**
- Produces: `validatePerplexitySelectionRequest(model, effort)`
- Produces: `normalizePerplexityModelChoice(value)`
- Produces: `normalizePerplexityEffort(value)`
- Produces: `normalizePerplexityCitations(raw, baseUrl)`

- [ ] **Step 1: Capture authenticated headed DOM evidence**

```bash
agbrowse navigate https://www.perplexity.ai
agbrowse snapshot --interactive --max-nodes 300
```

Open the picker by the observed interactive ref, then capture the exact observed container by ref-derived selector. Do not assume `dialog/menu/listbox`. Capture one completed answer with source chips, one active streaming turn, and one two-turn page containing related questions and decoy links.

Record capture date, locale, surface, sanitization, screenshot SHA-256, and source URL class in `perplexity-fixture-provenance.json`.

- [ ] **Step 2: Write Red pure tests against the fixture files**

Tests must load both KO/EN fixture HTML and assert:

```js
expect(validatePerplexitySelectionRequest(undefined, 'on'))
    .toThrow(/effort-requires-explicit-model/);
expect(normalizePerplexityModelChoice('Sonar 2')).toBeNull();
expect(normalizePerplexityEffort('heavy')).toBe('on');
expect(normalizePerplexityEffort('normal')).toBe('off');
```

Citation tests assert that only source-chip/source-list links from the committed answer are retained; inline links, related questions, internal navigation, actions, and other turns are excluded. Missing explicit index remains `null`; no visual offset is invented.

- [ ] **Step 3: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-perplexity-model.test.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs
```

- [ ] **Step 4: Implement pure validation and normalization**

```js
export function validatePerplexitySelectionRequest(model, effort) {
    const hasModel = typeof model === 'string' && model.trim() !== '';
    const hasEffort = typeof effort === 'string' && effort.trim() !== '';
    if (hasEffort && !hasModel) {
        throw modelMismatchError(null, {
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
        throw modelMismatchError(null, {
            reason: 'unsupported-model',
            model,
        });
    }
    if (hasEffort && !requestedThinking) {
        throw modeUnavailableError(requestedModel, effort);
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
  test/unit/web-ai-perplexity-model.test.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/fixtures/provider-dom/perplexity-*.html \
  test/fixtures/provider-dom/perplexity-fixture-provenance.json
git commit -m "feat: define Perplexity model and citation contracts"
```

---

### Task 5: Implement Fail-Closed Model And Thinking Mutation

**Files:**
- Modify: `web-ai/perplexity-model.mjs`
- Modify: `test/unit/web-ai-perplexity-model.test.mjs`

**Interfaces:**
- Produces: `selectPerplexityModel(page, model, effort)`
- Returns: `{ requestedModel, resolvedModel, resolvedLabel, locked, thinking, verified }`

- [ ] **Step 1: Write Red action-log tests**

Use a fixture-backed fake Page/Locator that records `locator`, `count`, and `click`. Assert zero clicks for invalid effort, effort without model, omitted model/effort, Sonar heading, duplicate rows, noninteractive rows, disabled/inert ancestors, unknown lock state, locked rows, missing selected row, zero/two switches, and invalid `aria-checked`.

After a valid click, assert the implementation reopens/reads the picker and verifies both selected model and Thinking state.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run test/unit/web-ai-perplexity-model.test.mjs
```

- [ ] **Step 3: Implement exact unique-row mutation**

Call `validatePerplexitySelectionRequest()` before the first Page call. Require exactly one interactive row. Treat `aria-disabled`, `disabled`, inert/disabled ancestors, lock evidence, and unknown state explicitly. Require exactly one row-scoped `[role="switch"]`.

```js
const switches = selectedRow.locator('[role="switch"]');
const switchCount = await switches.count();
if (switchCount !== 1) {
    throw modeUnavailableError(requestedModel, effort, {
        switchCount,
    });
}
await setAndVerifyPerplexityThinking(
    switches.first(),
    requestedThinking,
);
return verifyPerplexitySelection(
    page,
    requestedModel,
    requestedThinking,
);
```

- [ ] **Step 4: Verify Green**

Run Step 2. Expected: every failure case has zero mutation; valid cases verify postconditions.

- [ ] **Step 5: Refactor and regress**

Separate picker traversal, row inspection, and mutation into pure/imperative helpers. Re-run Task 4 pure tests.

- [ ] **Step 6: Commit**

```bash
git add web-ai/perplexity-model.mjs \
  test/unit/web-ai-perplexity-model.test.mjs
git commit -m "feat: select Perplexity models fail closed"
```

---

### Task 6: Implement The Complete Send Lifecycle

**Files:**
- Create: `web-ai/perplexity-live.mjs`
- Create: `test/unit/web-ai-perplexity-live-policy.test.mjs`
- Create: `test/integration/web-ai-perplexity-session.test.mjs`

**Interfaces:**
- Produces: `perplexityStatusWebAi(deps, input)`
- Produces: `perplexitySendWebAi(deps, input)`
- Stores: baseline, assistant count, target binding, active lease, model selection

- [ ] **Step 1: Write Red lifecycle tests**

Assert:

- standalone send calls `openFreshPerplexityThread()` once;
- session-bound send never calls it;
- model validation occurs before picker/composer mutation;
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
if (!input.session) {
    await openFreshPerplexityThread(page, warnings);
}

const captured = await capturePerplexityBaseline(page);
const modelSelection = await selectPerplexityModel(
    page,
    input.model,
    input.reasoningEffort ?? input.effort,
);
await insertPerplexityPrompt(page, composerSelector, rendered.composerText);
if (uploadPath) await attachPerplexityFile(page, uploadPath, input);
await submitPerplexityPrompt(page);
await verifyPerplexityCommit(page, captured);

const baseline = saveBaseline({
    vendor: 'perplexity',
    url: captured.url,
    envelope,
    assistantCount: captured.responseCount,
    textHash: captured.textHash,
});
```

Create the session only after commit evidence. Record the target lease and bind the session exactly as Gemini/Grok do.

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

### Task 7: Implement Progress-Gated Polling And Scoped Citations

**Files:**
- Modify: `web-ai/perplexity-live.mjs`
- Modify: `web-ai/perplexity-citations.mjs`
- Modify: `test/unit/web-ai-perplexity-citations.test.mjs`
- Modify: `test/unit/web-ai-perplexity-live-policy.test.mjs`
- Modify: `test/integration/web-ai-perplexity-session.test.mjs`

**Interfaces:**
- Produces: `perplexityPollWebAi`, `perplexityQueryWebAi`, `perplexityStopWebAi`
- Consumes: committed response locator/turn identity, not a broad selector string

- [ ] **Step 1: Write Red poll tests with a fake clock**

Assert:

- stable previous answer without URL/turn progress never completes;
- concrete URL progress plus a new committed response can complete;
- same-URL follow-up requires response-count/turn-identity progress;
- URL change without a new response does not complete;
- citation fingerprint must stabilize after answer text;
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
const urlProgress =
    currentUrl !== baseline.url
    && isSafeProviderConversationUrl('perplexity', currentUrl);
const turnProgress =
    responseCount > baseline.assistantCount;
const progressObserved = urlProgress || turnProgress;

const responseStableMs =
    stableSince > 0
        ? Date.now() - stableSince
        : 0;

const isStable = Boolean(
    progressObserved
    && latest.trim()
    && latest === stableText
    && responseStableMs >= 1500
    && citationFingerprint === stableCitationFingerprint
    && citationStableMs >= 500
    && !streaming
);
```

Extract citations only from the committed final response locator and observed source-chip/source-list containers. Use explicit index evidence; otherwise `index: null`.

- [ ] **Step 4: Finalize with one artifact**

Build one artifact using the exact `responseStableMs`, always include citations, add string warning `citations-unavailable` for `[]`, and pass it to `finalizeProviderTab()`.

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

### Task 8: Wire CLI, Bound Sessions, Resume, And Reattach

**Files:**
- Modify: `web-ai/cli.mjs`
- Modify: `web-ai/cli-sessions.mjs`
- Modify: `skills/browser/browser.mjs`
- Modify: `skills/browser/search.mjs`
- Modify: `test/integration/web-ai-cli-contract.test.mjs`
- Modify: `test/unit/web-ai-sessions-command.test.mjs`
- Modify: `test/integration/web-ai-perplexity-session.test.mjs`

**Interfaces:**
- Routes status/send/poll/query/stop to Perplexity
- Routes session-bound send/query without a fresh thread
- Routes resume/reattach through Perplexity poller and strict URL recovery

- [ ] **Step 1: Write Red CLI/session tests**

Assert Perplexity help, default URL, canonical aliases, effort-with-model rule, bound send/query dispatch, resume poller, reattach navigation guard, and `skills/browser/search.mjs` deep-search vendor help.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
```

- [ ] **Step 3: Add dispatch and session routing**

Import the Perplexity lifecycle functions, add the URL map, and branch in every status/send/poll/query/stop and session-bound path. Resolve timeout defaults with `reasoningEffort: values.effort`.

- [ ] **Step 4: Verify Green, refactor, and regress**

Run Step 2 plus:

```bash
npx vitest run \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-tab-recovery.test.mjs
```

Use the exported model catalog for help generation instead of duplicating aliases.

- [ ] **Step 5: Commit**

```bash
git add web-ai/cli.mjs web-ai/cli-sessions.mjs \
  skills/browser/browser.mjs skills/browser/search.mjs \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
git commit -m "feat: expose Perplexity CLI sessions"
```

---

### Task 9: Wire MCP, Policy, Copy, Doctor, And Semantic Targets

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
- MCP wait/resume returns exact citation artifacts.

Add policy cases `omitted → true`, `false → false`, `true → true`. Add doctor assertions for a non-empty Perplexity feature list and Perplexity semantic targets. Add a copy fixture with two answers, a source panel, and a decoy copy button.

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

Add `on/off` to the schema enum, then immediately apply `validateProviderWebAiInput()` so schema acceptance does not change other providers.

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
            cssFallbacks: PERPLEXITY_COMPOSER_SELECTORS,
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
            names: [/attach/i, /upload/i, /file/i, /첨부/i],
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
            roles: ['button', 'status'],
            names: [/stop/i, /중지/i],
            cssFallbacks: PERPLEXITY_STREAMING_SELECTORS,
        },
    },
});
```

Add `PERPLEXITY_FEATURES` and a doctor switch branch; host mapping alone is insufficient.

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

### Task 10: Add Perplexity Eval Without Changing Parallel Isolation

**Files:**
- Create: `test/fixtures/provider-dom/perplexity-eval.json`
- Modify: `test/unit/web-ai-eval-fixtures.test.mjs`
- Modify: `test/unit/web-ai-eval-parallel-fixtures.test.mjs`

**Interfaces:**
- Perplexity baseline/cosmetic/structural fixtures pass
- Perplexity breaking fixture fails in an explicit test
- `parallel-eval.json` remains byte-for-byte unchanged

- [ ] **Step 1: Write Red eval tests**

Hash `parallel-eval.json` before the task and assert its existing three fixture paths and order remain unchanged. Add a direct breaking-fixture assertion for `eval.target-resolution-failed`.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run \
  test/unit/web-ai-eval-fixtures.test.mjs \
  test/unit/web-ai-eval-parallel-fixtures.test.mjs
```

- [ ] **Step 3: Add dedicated config**

Create `perplexity-eval.json` with baseline, cosmetic, and structural variants. Do not add the breaking variant to the default config.

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

Document that marker eval verifies fixture intent coverage while Task 5–7 behavioral tests verify actual locator/mutation behavior.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/provider-dom/perplexity-eval.json \
  test/unit/web-ai-eval-fixtures.test.mjs \
  test/unit/web-ai-eval-parallel-fixtures.test.mjs
git commit -m "test: add isolated Perplexity provider eval"
```

---

### Task 11: Synchronize Public Documentation

**Files:**
- Modify: `README.md`
- Modify: `skills/browser/browser.mjs`
- Modify: `skills/browser/search.mjs`
- Modify: `skills/browser/SKILL.md`
- Modify: `skills/browser/extract.mjs`
- Modify: `skills/search/references/cli-reference.md`
- Modify: `skills/web-ai/SKILL.md`
- Modify: `structure/INDEX.md`
- Modify: `structure/CAPABILITY_TRUTH_TABLE.md`
- Modify: `structure/commands.md`
- Modify: `structure/runtime_contracts.md`
- Modify: `structure/release_gates.md`
- Modify: `structure/phase_status.md`
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

Assert public help advertises `chatgpt | gemini | grok | perplexity`, Perplexity aliases, binary effort, timeout tiers, citation persistence, locked-model error, and session recovery. Explicitly allow `provider-adapter.mjs` if its contract-only typedef remains intentionally narrower.

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
rg -n "ChatGPT.?Gemini.?Grok|chatgpt \\| gemini \\| grok" \
  README.md skills web-ai structure docs/dev docs/index.html
```

- [ ] **Step 6: Commit exact files**

Inspect `git diff --name-only` for unrelated changes, then stage only these
explicit public surfaces:

```bash
git diff --name-only
git add README.md skills/browser/browser.mjs skills/browser/search.mjs \
  skills/browser/SKILL.md skills/browser/extract.mjs \
  skills/search/references/cli-reference.md skills/web-ai/SKILL.md \
  structure/INDEX.md structure/CAPABILITY_TRUTH_TABLE.md \
  structure/commands.md structure/runtime_contracts.md \
  structure/release_gates.md structure/phase_status.md \
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

### Task 12: Full Regression, Package Gates, And Authenticated Smoke

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
```

- [ ] **Step 2: Run all package gates**

```bash
npm run typecheck:checkjs
npm run typecheck:checkjs-dom
npm run typecheck
npm run check:module-graph
npm run smoke:bins
npm run gate:all
npm run pack:dry
```

- [ ] **Step 3: Run authenticated send → resume**

```bash
agbrowse web-ai send \
  --vendor perplexity \
  --url https://www.perplexity.ai \
  --model gpt-5.6-terra \
  --effort on \
  --inline-only \
  --prompt "Reply with a short sourced explanation of CDP." \
  --json | tee /tmp/perplexity-send.json

SID="$(jq -r '.sessionId' /tmp/perplexity-send.json)"
test -n "$SID"
test "$SID" != "null"

agbrowse web-ai sessions resume "$SID" \
  --json | tee /tmp/perplexity-resume.json

jq -e '
  .status == "complete"
  and (.answerArtifact.citations | type == "array")
  and .answer == .answerArtifact.text
' /tmp/perplexity-resume.json
```

- [ ] **Step 4: Verify reattach and disk persistence**

```bash
agbrowse web-ai sessions reattach "$SID" \
  --navigate \
  --json | tee /tmp/perplexity-reattach.json

agbrowse web-ai sessions show "$SID" \
  --json | tee /tmp/perplexity-session.json

jq -e --slurpfile resumed /tmp/perplexity-resume.json '
  .session.answer == $resumed[0].answer
  and .session.answerArtifact == $resumed[0].answerArtifact
' /tmp/perplexity-session.json
```

- [ ] **Step 5: Verify locked model fail-closed**

Set `OBSERVED_LOCKED_MODEL_ALIAS` to a locked alias confirmed by the current fixture, such as `gpt-5.6-sol`:

```bash
OBSERVED_LOCKED_MODEL_ALIAS=gpt-5.6-sol
set +e
agbrowse web-ai send \
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
jq -e '.error.errorCode == "provider.model-entitlement"' \
  /tmp/perplexity-locked.err
```

- [ ] **Step 6: Record only executed evidence**

`devlog/_smoke/260711_perplexity_web_ai/README.md` must include command, timestamp, exit code, session ID, observed conversation URL, citation count, and exact booleans for resume, reattach, and locked-model checks. Do not write `yes` for an unexecuted check.

- [ ] **Step 7: Commit evidence**

```bash
git add devlog/_smoke/260711_perplexity_web_ai/README.md
git commit -m "test: record Perplexity web-ai smoke"
```

## Final Acceptance Checklist

- [ ] Full checkout baseline and all pre-existing failures are documented.
- [ ] Identity registration precedes live dispatch and eval execution.
- [ ] Validation completes before any Page/Locator call.
- [ ] Model row and Thinking switch are unique, scoped, interactive, and post-verified.
- [ ] `Sonar 2` is never clicked as a model.
- [ ] Standalone send opens a fresh thread; session-bound send does not.
- [ ] Baseline, assistant count, active lease, target binding, model, and effort persist.
- [ ] Completion requires progress plus stable answer/citations and no streaming.
- [ ] Timeout, page-death, and stop postconditions match existing provider behavior.
- [ ] Citation extraction is scoped to the committed response and never invents indices.
- [ ] `answer === answerArtifact.text`; 2 MiB answers and 500 citations survive a fresh process.
- [ ] Thinking timeout restores to 3600 seconds during resume without a deadline.
- [ ] Existing-tab and new-tab recovery share the strict provider URL guard.
- [ ] CLI, MCP, policy, doctor, copy fallback, sessions, and search help include Perplexity.
- [ ] `parallel-eval.json` remains unchanged; dedicated Perplexity eval passes.
- [ ] ChatGPT/Gemini/Grok regression tests and `npm run gate:all` pass.
- [ ] Smoke evidence records only commands that actually ran.
