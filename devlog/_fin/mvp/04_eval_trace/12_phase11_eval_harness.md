# Phase 11 — DOM churn eval harness

Quantify provider DOM resilience before users discover breakage. This phase is
the first production blocker after Phase 10. GPT Pro approved the direction
only after PR 11.1 became self-contained, offline, and non-mutating.

Source reviews:

- GPT Pro competitor review: `https://chatgpt.com/c/69f823e1-43e4-83a7-b47c-18843ec9dae5`
- Grok competitor review: `https://grok.com/c/c36a69c7-377b-4fbe-979f-f6c210929cc3?rid=3a18225b-227f-465d-a040-8ae4b785e8c6`
- GPT Pro plan approval: `https://chatgpt.com/c/69f82ce4-835c-83aa-8370-5c9b3d345d1f`
- GPT Pro parallel-tab research: `https://chatgpt.com/c/69f8a43e-9190-83a8-a94b-cc23bd68e600`

## Decisions

- Phase 11 is fixture/eval only. It does not add a planner, LLM repair, cloud
  browser, dashboard, or general browser primitive expansion.
- PR 11.1 must be self-contained with ChatGPT fixtures, golden file, CLI,
  package script, and offline safety tests.
- Phase 11 must not import Phase 16 `web-ai/target-resolver.mjs`. It uses an
  eval-local target probe adapter.
- Eval runs must be offline, non-mutating, and profile-isolated.
- Parallel work in Phase 11 means bounded parallel fixture evaluation only. It
  does not mean live provider parallel sends, live multi-provider polling, or
  logged-in profile orchestration.

## PR 11.1 — Eval runner, schema, and ChatGPT fixture slice

### Diff

- NEW `web-ai/eval/types.mjs`
- NEW `web-ai/eval/fixtures.mjs`
- NEW `web-ai/eval/metrics.mjs`
- NEW `web-ai/eval/provider-targets.mjs`
- NEW `web-ai/eval-runner.mjs`
- MODIFY `web-ai/cli.mjs` to add `web-ai eval`
- MODIFY `package.json` to add `test:eval`
- NEW `scripts/run-web-ai-eval.mjs`
- NEW `test/fixtures/provider-dom/chatgpt-baseline.html`
- NEW `test/fixtures/provider-dom/chatgpt-cosmetic-churn.html`
- NEW `test/fixtures/provider-dom/chatgpt-structural-churn.html`
- NEW `test/fixtures/provider-dom/chatgpt-breaking.html`
- NEW `test/fixtures/provider-snapshots/chatgpt-*.json`
- NEW `test/golden/web-ai-eval-baseline.chatgpt.json`
- NEW `test/unit/web-ai-eval-types.test.mjs`
- NEW `test/unit/web-ai-eval-fixtures.test.mjs`
- NEW `test/unit/web-ai-eval-metrics.test.mjs`
- NEW `test/unit/web-ai-eval-runner.test.mjs`
- NEW `test/unit/web-ai-eval-cli.test.mjs`

### Public surface

```bash
agbrowse web-ai eval \
  --vendor chatgpt \
  --fixtures test/fixtures/provider-dom \
  --json
```

Use `--provider` only if it is explicitly implemented and tested as an alias.

### Eval result schema

```js
{
  schemaVersion: 1,
  runId: '01...',
  gitCommit: 'abc123' | null,
  startedAt: '2026-05-04T00:00:00.000Z',
  finishedAt: '2026-05-04T00:00:01.000Z',
  options: {
    vendor: 'chatgpt',
    fixtures: 'test/fixtures/provider-dom',
    variants: ['baseline', 'cosmetic-churn'],
    offline: true,
    javascriptEnabled: false
  },
  results: [{
    provider: 'chatgpt',
    variant: 'baseline',
    fixturePath: 'test/fixtures/provider-dom/chatgpt-baseline.html',
    fixtureSha256: '...',
    snapshotId: '...',
    metrics: {},
    thresholds: {},
    status: 'pass',
    errors: []
  }],
  regressions: []
}
```

Every ratio metric records:

```js
{ numerator: 95, denominator: 100, value: 0.95, threshold: 0.95 }
```

### Eval target probing

`web-ai/eval/provider-targets.mjs` owns the Phase 11 probe contract:

```js
export const EVAL_TARGET_INTENTS = [
  'composer.fill',
  'upload.open',
  'send.click',
  'copy.click',
];

export async function probeEvalTargetIntent(page, {
  provider,
  intent,
  variant,
} = {}) {
  return {
    status: 'resolved', // resolved | ambiguous | missing | unsupported
    refId: null,
    selector: null,
    confidence: null,
    evidence: {},
    error: null,
  };
}
```

It may delegate to existing self-heal/action-cache/observe-target code, but it
must not depend on Phase 16 `web-ai/target-resolver.mjs`.

### Safety invariants

- Use a fresh non-persistent Playwright context per run or fixture.
- Do not use the persisted agbrowse Chrome profile.
- Do not call `page.goto()` for provider URLs.
- Use `page.setContent()` for fixture execution.
- Disable JavaScript by default unless a fixture manifest opts in.
- Abort all network requests by default.
- Do not write sessions, browser state, cookies, localStorage, screenshots, or
  traces unless explicitly requested.
- Breaking fixtures return structured failure with `mutationAllowed: false`.

### Tests

- Unknown provider is rejected.
- Unknown variant is rejected.
- Fixture loader rejects path traversal.
- Eval output validates against `schemaVersion: 1`.
- Fixture with `fetch("https://example.com")` produces zero outbound requests.
- External `<img>`, `<script src>`, and `<link href>` produce zero outbound
  requests.
- Eval run does not modify `$BROWSER_AGENT_HOME/web-ai-sessions.json`.
- Eval run does not change active tab metadata or tab pool metadata.
- Baseline ChatGPT fixture reaches 100% composer resolution.
- Breaking ChatGPT fixture fails closed with `mutationAllowed: false`.

### Golden mechanics

- `scripts/run-web-ai-eval.mjs --update-golden --vendor chatgpt` updates only
  `test/golden/web-ai-eval-baseline.chatgpt.json`.
- Normal runs never update golden files.
- Regression compare exits 1 on threshold failure.
- Output includes machine-readable `regressions[]`.
- `snapshotTokenEstimate` may increase by at most 15% unless golden is updated.
- Thresholds cannot drop below this file's metric targets.

### PASS

- `npm run test:eval -- --vendor chatgpt --json` passes offline.
- `agbrowse web-ai eval --vendor chatgpt --fixtures test/fixtures/provider-dom --json`
  emits parseable JSON.
- No fixture eval reaches the network or mutates durable browser/session state.

## PR 11.1a — Eval-only parallel fixture isolation

GPT Pro verdict: `INTEGRATE_MINIMAL`.

True parallel multi-tab work is possible with Chrome CDP/Playwright, and
agbrowse already has the runtime ingredients from Phase 9: tab-per-session,
target IDs, session locks, leases, and finalizers. But Phase 11 must not expand
into live provider parallelism. The safe integration is an offline, bounded
fixture concurrency slice that proves isolation without touching provider
accounts or persistent browser state.

### Diff

- MODIFY `web-ai/eval/types.mjs`
- MODIFY `web-ai/eval-runner.mjs`
- MODIFY `scripts/run-web-ai-eval.mjs`
- MODIFY `package.json`
- MODIFY `.github/workflows/contract-drift.yml`
- NEW `test/fixtures/provider-dom/chatgpt-parallel-a.html`
- NEW `test/fixtures/provider-dom/chatgpt-parallel-b.html`
- NEW `test/fixtures/provider-dom/gemini-parallel-a.html`
- NEW `test/fixtures/provider-dom/parallel-eval.json`
- NEW `test/unit/web-ai-eval-parallel-fixtures.test.mjs`

### Concurrency contract

`web-ai/eval/types.mjs` owns the hard cap:

```js
export const DEFAULT_MAX_FIXTURE_CONCURRENCY = 1;
export const MAX_FIXTURE_CONCURRENCY = 4;

export function parseFixtureConcurrency(value, {
  defaultValue = DEFAULT_MAX_FIXTURE_CONCURRENCY,
  max = MAX_FIXTURE_CONCURRENCY,
} = {}) {}
```

Rules:

- Default fixture concurrency is `1`.
- Accepted values are integers `1..4`.
- Invalid values fail before fixture execution.
- Results are sorted back to deterministic input order.
- Runner internals may use a bounded local promise pool.
- Runner must not call live provider functions, session store, tab pool,
  clipboard, screenshots, downloads, persistent Chrome profile, or provider
  `*-live.mjs` modules.

### Fixture config

`test/fixtures/provider-dom/parallel-eval.json`:

```json
{
  "schemaVersion": 1,
  "taskId": "phase11-parallel-fixture-isolation",
  "maxFixtureConcurrency": 4,
  "fixtures": [
    {
      "id": "chatgpt-parallel-a",
      "vendor": "chatgpt",
      "htmlPath": "test/fixtures/provider-dom/chatgpt-parallel-a.html",
      "mustContain": ["CHATGPT_PARALLEL_A_OK"],
      "mustNotContain": ["CHATGPT_PARALLEL_B_OK", "GEMINI_PARALLEL_A_OK"],
      "scrub": ["SECRET_CHATGPT_A"]
    },
    {
      "id": "chatgpt-parallel-b",
      "vendor": "chatgpt",
      "htmlPath": "test/fixtures/provider-dom/chatgpt-parallel-b.html",
      "mustContain": ["CHATGPT_PARALLEL_B_OK"],
      "mustNotContain": ["CHATGPT_PARALLEL_A_OK", "GEMINI_PARALLEL_A_OK"],
      "scrub": ["SECRET_CHATGPT_B"]
    },
    {
      "id": "gemini-parallel-a",
      "vendor": "gemini",
      "htmlPath": "test/fixtures/provider-dom/gemini-parallel-a.html",
      "mustContain": ["GEMINI_PARALLEL_A_OK"],
      "mustNotContain": ["CHATGPT_PARALLEL_A_OK", "CHATGPT_PARALLEL_B_OK"],
      "scrub": ["SECRET_GEMINI_A"]
    }
  ]
}
```

### Scripts

Add repo/dev-only scripts:

```json
{
  "scripts": {
    "test:eval-fixtures": "vitest run test/unit/web-ai-eval-parallel-fixtures.test.mjs",
    "eval:web-ai:fixtures": "node scripts/run-web-ai-eval.mjs --config test/fixtures/provider-dom/parallel-eval.json --concurrency 4 --json"
  }
}
```

Do not expose this as a normal user-facing provider command in Phase 11. If a
CLI command is unavoidable, gate it behind `AGBROWSE_ENABLE_EVAL_CLI=1` and
name it `web-ai eval-fixtures`, not `web-ai query` or `web-ai send`.

### Tests

- `parseFixtureConcurrency(undefined)` returns `1`.
- `1`, `2`, and `4` are accepted.
- `0`, `5`, negative numbers, non-integers, and strings fail before fixture
  execution.
- Bounded runner never exceeds max concurrency.
- Parallel results are returned in deterministic input order.
- Fixture captures stay isolated: A cannot contain B's marker and vice versa.
- Scrubbed secret markers do not appear in serialized output.
- Fixtures containing `https:`, `wss:`, `ftp:`, or `file://` fail with
  `eval.network-blocked` and `mutationAllowed: false`.

### CI

Add to the fixture branch of `.github/workflows/contract-drift.yml` only:

```yaml
- run: npm run test:eval-fixtures
- run: npm run eval:web-ai:fixtures
```

Do not add this to scheduled live drift. This is a deterministic offline eval.

### PASS

- `npm run test:eval-fixtures` passes.
- `npm run eval:web-ai:fixtures` exits 0 with `{ ok: true }`.
- `--concurrency 1`, `2`, and `4` produce the same sorted fixture order.
- Invalid concurrency fails before any fixture runs.
- Network-bearing fixtures fail closed.
- No runtime provider, session-store, tab-pool, clipboard, download, screenshot,
  or persistent-profile code path is invoked.

### Explicit exclusions

Do not implement in Phase 11:

- live multi-provider parallel sends
- live ChatGPT/Gemini/Grok parallel polling
- shared logged-in browser profile parallel eval
- provider rate-limit scheduling
- clipboard capture
- downloads
- screenshots
- network access
- real user account checks
- tab-pool ownership changes
- session-store lock changes
- live-provider golden update automation

Those belong in Phase 14/15 after command ownership, throttling, and live
account safety are designed.

## PR 11.2 — Gemini/Grok matrix and scrubbed capture

### Diff

- NEW `test/fixtures/provider-dom/gemini-baseline.html`
- NEW `test/fixtures/provider-dom/gemini-cosmetic-churn.html`
- NEW `test/fixtures/provider-dom/gemini-structural-churn.html`
- NEW `test/fixtures/provider-dom/gemini-breaking.html`
- NEW `test/fixtures/provider-dom/grok-baseline.html`
- NEW `test/fixtures/provider-dom/grok-cosmetic-churn.html`
- NEW `test/fixtures/provider-dom/grok-structural-churn.html`
- NEW `test/fixtures/provider-dom/grok-breaking.html`
- NEW `test/fixtures/provider-snapshots/{gemini,grok}-*.json`
- NEW `web-ai/eval/scrub-dom.mjs`
- NEW `scripts/capture-provider-dom.mjs`
- NEW `docs/evals.md`
- NEW `.github/workflows/web-ai-eval.yml`

### Capture safety

- Manual-only; refuses CI unless `AGBROWSE_EVAL_LIVE_CAPTURE=1`.
- Writes raw capture only to memory or temp outside repo.
- Scrubs before writing any fixture path.
- Atomically renames only the scrubbed artifact.
- Refuses output containing emails, phone numbers, JWT/API-key-like strings,
  cookies, storage values, provider conversation IDs, avatar URLs, prompt text,
  or answer text.
- Never commits screenshots by default.

### Metrics

| Metric | Target |
| --- | ---: |
| Known fixture pass rate | >= 95% |
| `composer.fill` baseline/cosmetic/structural | 100% |
| `upload.open` where supported | >= 90% |
| `copy.lastResponse` exactness | >= 85% |
| Snapshot token estimate | <= 500 tokens per provider fixture |

### Tests

- Gemini and Grok fixture variants run offline.
- Scrubber refuses every forbidden data class listed above.
- CI runs `npm run test:eval` and fails on regression.

### PASS

- A contributor can run one command and see provider/variant metrics.
- CI blocks regressions.
- Captured fixtures cannot write unsanitized provider content into the repo.

## cli-jaw mirror

- Reuse agbrowse fixtures as canonical.
- Add a cli-jaw route/test runner only if HTTP exposure is needed.
- Do not maintain divergent provider fixture semantics.
