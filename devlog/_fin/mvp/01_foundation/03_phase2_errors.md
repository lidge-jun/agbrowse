# Phase 2 — Typed error taxonomy + retry hints

GPT Pro recommended Phase 2 PR1 land **before** Phase 1 so session failures
get structured shape from day one. PR2 (call-site rewrites) parallelizes with
Phase 3 PR1 because they touch different files.

## Decisions resolved (post-critique)

- **Evidence payload:** selector counts and short text snippets only, capped
  at 4 KB; no raw HTML or screenshots by default.
- **Severity field:** skip; `retryHint` + `mutationAllowed` is enough for
  agents.
- **Cross-provider vs vendor-prefixed codes:** use `provider.*` plus a
  `vendor` field; reserve vendor-prefixed codes for policy-only cases like
  `grok.context-pack-not-allowed`.

## Error code catalog (initial)

| `errorCode` | `stage` | `retryHint` | `mutationAllowed` | `vendor`? |
| --- | --- | --- | ---: | --- |
| `cdp.unreachable` | `connect` | `start-or-check-port` | false | optional |
| `cdp.target-mismatch` | `connect` | `tab-switch` | false | required |
| `provider.composer-not-visible` | `composer-prereq` | `re-snapshot` | false | required |
| `provider.model-mismatch` | `provider-select-mode` | `model-fallback` | false | required |
| `provider.attachment-preflight` | `attachment-preflight` | `inline-only-or-file` | false | required |
| `provider.attachment-evidence-missing` | `attachment-verify` | `re-upload` | true | required |
| `provider.commit-not-verified` | `commit-verify` | `re-snapshot` | true | required |
| `provider.poll-timeout` | `poll` | `poll-or-resume` | true | required |
| `context.over-budget` | `context-preflight` | `reduce-files` | false | optional |
| `context.symlink-rejected` | `context-preflight` | `path-list` | false | optional |
| `grok.context-pack-not-allowed` | `grok-context-pack-not-allowed` | `inline-only-or-allow-flag` | false | required (`grok`) |
| `internal.unhandled` | `internal` | `report` | false | optional |
| `cdp.target-mismatch` | `session-target-verify` | `tab-switch` | false | required (cli-jaw `WrongTargetError`) |
| `capability.unsupported` | `capability-preflight` | `feature-fallback` | false | required (cli-jaw `BrowserCapabilityError`) |
| `provider.runtime-disabled` | `provider-runtime-gate` | `enable-or-skip` | false | required (cli-jaw `ProviderRuntimeDisabledError`) |

## PR plan

| PR | Scope |
| --- | --- |
| **PR1** | NEW `web-ai/errors.mjs`, `cli.mjs` outer wrap, env flag, docs, unit tests for class shape + JSON. **Lands before Phase 1.** |
| **PR2** | Convert every `throw new Error(...)` in `web-ai/**` (including `context-pack/`) to `WebAiError` and update tests. Can run alongside Phase 3 PR1. |

## Diffs (PR1)

### NEW `web-ai/errors.mjs`

API surface:

```js
export class WebAiError extends Error {}
export function wrapError(err, fallback) {}
export function providerError(vendor, init) {}
export function contextError(init) {}
export function toErrorJson(err) {}
```

Skeleton:

```js
export class WebAiError extends Error {
    constructor({ errorCode, stage, message, retryHint, vendor, mutationAllowed = false, selectorsTried = [], evidence = null, cause }) {
        super(message);
        this.name = 'WebAiError';
        Object.assign(this, { errorCode, stage, retryHint, vendor, mutationAllowed, selectorsTried, evidence });
        if (cause) this.cause = cause;
    }
    toJSON() { return toErrorJson(this); }
}

export function wrapError(err, fallback = {}) {
    return err instanceof WebAiError
        ? err
        : new WebAiError({
            errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report',
            message: err?.message || String(err), ...fallback, cause: err,
        });
}

export function providerError(vendor, init) { return new WebAiError({ vendor, ...init }); }
export function contextError(init) { return new WebAiError({ ...init }); }

export function toErrorJson(err) {
    return {
        name: err.name, errorCode: err.errorCode, stage: err.stage, message: err.message,
        retryHint: err.retryHint, vendor: err.vendor,
        mutationAllowed: err.mutationAllowed, selectorsTried: err.selectorsTried || [],
        evidence: err.evidence || null,
    };
}
```

### MODIFY `web-ai/cli.mjs` — outer try wrap

Before:

```js
export async function runWebAiCli(argv = [], deps) {
    const command = argv[0];
    if (!command || command === '--help' || command === 'help' || argv.includes('--help')) {
        console.log(WEB_AI_USAGE.trim());
        return { ok: true, status: 'help' };
    }
```

After:

```js
export async function runWebAiCli(argv = [], deps) {
    try {
        return await runWebAiCliInner(argv, deps);
    } catch (err) {
        const wrapped = wrapError(err);
        emitCliError(wrapped, argv);
        wrapped.alreadyReported = true;
        throw wrapped;
    }
}

async function runWebAiCliInner(argv = [], deps) {
    const command = argv[0];
    if (!command || command === '--help' || command === 'help' || argv.includes('--help')) {
        console.log(WEB_AI_USAGE.trim());
        return { ok: true, status: 'help' };
    }
```

Helper:

```js
function emitCliError(err, argv) {
    const forceJson = process.env.AGBROWSE_JSON_ERRORS === '1' || argv.includes('--json');
    const payload = { ok: false, status: 'error', error: err.toJSON() };
    if (forceJson) console.error(JSON.stringify(payload, null, 2));
    else console.error(`[web-ai error] ${err.errorCode}: ${err.message}\n[hint] retryHint: ${err.retryHint}`);
}
```

### MODIFY `bin/agbrowse.mjs`

Source not in the attached bundle. Add a top-level catch that respects
`err.alreadyReported` so we do not double-print:

```js
try { await runWebAiCli(...); }
catch (err) { if (!err?.alreadyReported) console.error(err.message); process.exit(1); }
```

### MODIFY `skills/web-ai/SKILL.md` — new section

Before:

```md
## Safety
```

After:

```md
## Error taxonomy

Set `AGBROWSE_JSON_ERRORS=1` for agent integrations. Failures include
`errorCode`, `stage`, `retryHint`, `mutationAllowed`, `selectorsTried`, and
optional `evidence`. The full catalog lives in `devlog/03_phase2_errors.md`.

## Safety
```

## Diffs (PR2 — call-site conversions)

### MODIFY `web-ai/chatgpt.mjs`

Before:

```js
if (!CHATGPT_HOSTS.has(host)) {
    throw new Error(`active tab is not ChatGPT: ${url}. Use tabs then tab-switch before web-ai.`);
}
```

After:

```js
if (!CHATGPT_HOSTS.has(host)) {
    throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'connect',
        vendor: 'chatgpt',
        retryHint: 'tab-switch',
        message: `active tab is not ChatGPT: ${url}. Use tabs then tab-switch before web-ai.`,
        evidence: { url },
    });
}
```

### MODIFY `web-ai/gemini-live.mjs`

Before:

```js
if (!isGeminiUrl(page.url())) throw new Error(`active tab is not gemini.google.com (${page.url()})`);
```

After:

```js
if (!isGeminiUrl(page.url())) {
    throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'connect',
        vendor: 'gemini',
        retryHint: 'tab-switch',
        message: `active tab is not gemini.google.com (${page.url()})`,
        evidence: { url: page.url() },
    });
}
```

### MODIFY `web-ai/grok-live.mjs`

Before:

```js
const composerSel = await findFirstSelector(page, COMPOSER_SELECTORS, 10_000);
if (!composerSel) throw new Error('grok composer not visible');
```

After:

```js
const composerSel = await findFirstSelector(page, COMPOSER_SELECTORS, 10_000);
if (!composerSel) throw new WebAiError({
    errorCode: 'provider.composer-not-visible',
    stage: 'composer-prereq',
    vendor: 'grok',
    retryHint: 're-snapshot',
    message: 'grok composer not visible',
    selectorsTried: COMPOSER_SELECTORS,
});
```

### MODIFY `web-ai/grok-live.mjs` — Phase 0 throw upgraded

Phase 0 added `err.stage = 'grok-context-pack-not-allowed'` on a plain
`Error`. PR2 converts it:

```js
if (hasContextPackaging(input) && input.allowGrokContextPack !== true) {
    throw new WebAiError({
        errorCode: 'grok.context-pack-not-allowed',
        stage: 'grok-context-pack-not-allowed',
        vendor: 'grok',
        retryHint: 'inline-only-or-allow-flag',
        message: 'grok context-pack disabled by default; pass --allow-grok-context-pack to override',
    });
}
```

### MODIFY `web-ai/context-pack/builder.mjs`

Before:

```js
if (result.budget.estimatedTokens > result.budget.maxInputTokens) {
    throw new Error(`context package exceeds max input tokens: ${result.budget.estimatedTokens}/${result.budget.maxInputTokens}`);
}
```

After:

```js
if (result.budget.estimatedTokens > result.budget.maxInputTokens) {
    throw new WebAiError({
        errorCode: 'context.over-budget',
        stage: 'context-preflight',
        retryHint: 'reduce-files',
        message: `context package exceeds max input tokens: ${result.budget.estimatedTokens}/${result.budget.maxInputTokens}`,
        evidence: result.budget,
    });
}
```

### MODIFY `web-ai/context-pack/file-selector.mjs`

Before:

```js
if (stat.isSymbolicLink()) throw new Error(`context path is a symlink and is not allowed: ${pattern}`);
```

After:

```js
if (stat.isSymbolicLink()) throw new WebAiError({
    errorCode: 'context.symlink-rejected',
    stage: 'context-preflight',
    retryHint: 'path-list',
    message: `context path is a symlink and is not allowed: ${pattern}`,
    evidence: { pattern },
});
```

### Other call sites

Apply the same pattern to every remaining `throw new Error(` in
`web-ai/**`. Public provider runtime paths must use `WebAiError`. Internal
helpers and tests can keep plain `Error` if the message is purely diagnostic.

## Public-surface changes

- New env: `AGBROWSE_JSON_ERRORS=1` to force JSON error output regardless of
  the `--json` flag.
- Error JSON shape stable per the catalog above.
- Exit code stays 1 on any error; the parseable failure shape is on
  stderr (and on stdout when `--json` is set).

## Test plan

- Unit: `WebAiError.toJSON` snapshot test for two known shapes.
- Unit: `wrapError` passes through `WebAiError`, wraps plain `Error`.
- Source: every public provider file throws via `WebAiError` only — grep for
  `throw new Error(` in `web-ai/{chatgpt,gemini-live,grok-live,context-pack/**}.mjs`
  must be empty after PR2.
- Contract: ChatGPT/Gemini/Grok send/poll/query produce expected
  `errorCode`/`stage` for documented failure paths via the fake-page tests.
- CLI: with `AGBROWSE_JSON_ERRORS=1`, force a wrong vendor; assert exactly one
  parseable JSON object on stderr/stdout and non-zero exit.

## Smoke plan

- Force a wrong-tab scenario; expect `cdp.target-mismatch` JSON.
- Force an upload preflight failure (Gemini upload without file); expect
  `provider.attachment-preflight` JSON.
- Force a Grok context-pack without flag (Phase 0 hard-gate); expect
  `grok.context-pack-not-allowed` JSON.

## Exit criteria

- All `throw new Error(` call sites in `web-ai/**` public paths replaced.
- `AGBROWSE_JSON_ERRORS=1` produces parseable JSON for every documented
  failure.
- SKILL doc lists the catalog and is the only place that defines the codes.

## Risks

- **Most likely regression:** CLI errors print twice if the outer
  `bin/agbrowse.mjs` entrypoint also catches and prints. Mitigated by the
  `err.alreadyReported` flag.
- **Test:** force a wrong vendor with `AGBROWSE_JSON_ERRORS=1`; assert
  exactly one parseable JSON object on stderr/stdout and non-zero exit.

## cli-jaw mirror

cli-jaw already has a rudimentary error helper that this phase replaces:

- `src/browser/web-ai/chatgpt.ts` (and others) wrap throws with
  `stageError(err, 'poll-timeout')` style — ad-hoc, untyped.
- `src/routes/browser.ts` has `toWebAiHttpError(e)` that converts thrown
  errors into HTTP error JSON. Phase 2 should replace the hand-rolled
  serializer with `WebAiError.toJSON()`.

| Item | cli-jaw status |
| --- | --- |
| `WebAiError` class | **Ports as-is** to `src/browser/web-ai/errors.ts`. Same code catalog (`provider.composer-not-visible`, etc.). |
| `wrapError` helper | **Ports as-is**. |
| `stageError` helper | **Replace** — every call site that does `stageError(err, '<stage>')` becomes `throw new WebAiError({ stage, ... })`. |
| `WrongTargetError` (in `session.ts`) | **Map to `cdp.target-mismatch`** — preserve `expectedTargetId` and `actualTargetId` in `evidence`. |
| `BrowserCapabilityError` (in `primitives.ts` / `capability-registry.ts`) | **Map to `capability.unsupported`** — preserve `capabilityId`, `stage`, `mutationAllowed`, `ownerPrd`. |
| `ProviderRuntimeDisabledError` (in `provider-adapter.ts`) | **Map to `provider.runtime-disabled`** — preserve `vendor`, `stage`. |
| `toWebAiHttpError` (in `routes/browser.ts`) | **Modify** — delegates to `WebAiError.toJSON()` when the error is an instance, falls back to legacy shape otherwise (during transition). |
| `toWebAiErrorEnvelope` (in `web-ai/diagnostics.ts`) | **Delegate or delete** — convert to `WebAiError.toJSON()` shim or remove after every HTTP route uses the new shape. |
| `WebAiFailureStage` enum | **Reconcile** — align Phase 2 `stage` strings (table above) with cli-jaw's existing stage names so HTTP parity is painless. List the cli-jaw stage names first, agbrowse-only stages last. |
| `AGBROWSE_JSON_ERRORS` env | **Skip** for cli-jaw — HTTP responses are already JSON. CLI side prints human messages from the JSON response by default; add `--json` to dump the full payload (already supported). |
| Call-site conversions | All `throw new Error(` in `src/browser/web-ai/**.ts` and `src/browser/web-ai/context-pack/**.ts` get the same conversion as agbrowse. |
| Tests | Add `tests/unit/browser-web-ai-errors.test.ts` mirroring the agbrowse `WebAiError` coverage. |

PR slicing for cli-jaw matches agbrowse:

- **PR1**: `errors.ts`, `toWebAiHttpError` delegation, docs, tests. Lands
  before Phase 1 PR2 in cli-jaw too so session failures get typed shape.
- **PR2**: convert call sites in providers + context-pack; remove
  `stageError`.

Skill docs: `cli-jaw/skills_ref/web-ai/SKILL.md` adds the same Error
taxonomy section pointing at the catalog (replicated from agbrowse devlog).
