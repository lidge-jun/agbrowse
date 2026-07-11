# Perplexity Web-AI Provider Design

## Goal

Add `perplexity` as a first-class agbrowse web-ai provider with the same
session-oriented lifecycle available to ChatGPT, Gemini, and Grok:

- `status`
- `send`
- `poll`
- `query`
- `stop`
- session-bound resume and reattach
- CLI and MCP JSON output
- inline prompts and file attachments
- model selection
- independent Perplexity "thinking" toggle control
- structured citation capture that survives session persistence

Perplexity Spaces, Focus modes, and provider-specific Deep Research automation
are outside the first release.

The observed mobile model-picker screen used for this design is preserved at
`docs/superpowers/specs/assets/perplexity-model-picker.jpg`.

## Current Architecture

The repository implements each live provider as a pair of modules:

- `web-ai/{vendor}-live.mjs` owns browser lifecycle behavior and response capture.
- `web-ai/{vendor}-model.mjs` owns aliases, picker interaction, and selection
  verification.

`web-ai/cli.mjs` and `web-ai/mcp-server.mjs` dispatch directly to provider
functions. Common session, tab, artifact, capability, and context modules are
already provider-neutral enough to reuse.

The new provider will follow this existing architecture. Activating and
rewriting the contract-only `provider-adapter.mjs` layer is explicitly excluded
because it would create unrelated migration risk.

## Provider Modules

### `web-ai/perplexity-model.mjs`

This module owns:

- stable CLI alias normalization
- visible label normalization
- opening and closing the model picker
- reading the selected model
- selecting and verifying an unlocked model
- detecting locked entitlement-only models without clicking them
- reading and changing the binary "thinking" toggle
- capability probes for requested model and effort

Canonical model aliases:

| Alias | Visible label |
| --- | --- |
| `best` | `Best` / localized equivalent such as `최고` |
| `sonar-2` | `Sonar 2` (provisional; only admitted if live DOM proves it is selectable) |
| `gpt-5.6-terra` | `GPT-5.6 Terra` |
| `gpt-5.6-sol` | `GPT-5.6 Sol` |
| `gemini-3.1-pro` | `Gemini 3.1 Pro` |
| `claude-sonnet-5` | `Claude Sonnet 5` |
| `claude-opus-4.8` | `Claude Opus 4.8` |
| `glm-5.2` | `GLM 5.2` |
| `kimi-k2.6` | `Kimi K2.6` |
| `nemotron-3-ultra` | `Nemotron 3 Ultra` |

`gpt-5.6-sol` and `claude-opus-4.8` must remain valid aliases even when the UI
shows them as locked. A locked option produces a typed
`provider.model-entitlement` error before any click or prompt submission.

The supplied screenshot is ambiguous about `Sonar 2`: it may be a section
heading rather than a selectable option. The implementation must capture the
picker DOM before freezing this alias. If the fixture shows no selectable-row
semantics, `sonar-2` is omitted from the shipped alias set and retained only as
an observed group label. The runtime must never click a heading by text
fallback.

Model matching ignores case, repeated whitespace, localized descriptions,
`Max`, lock labels, and auxiliary badges such as `새로 만들기`. The actual model
name and version remain part of the verification contract.

No selector mutation occurs when `--model` is omitted.

### Thinking Toggle Contract

The Perplexity "thinking" toggle is independent of model selection.

No toggle mutation occurs when `--effort` is omitted.

Accepted values map to the binary UI state:

| Values | Required state |
| --- | --- |
| `off`, `low`, `light`, `standard`, `normal`, `default` | off |
| `on`, `extended`, `high`, `xhigh`, `heavy` | on |

The existing rule that `--effort` requires `--model` remains in force. If the
selected model does not expose a thinking toggle, the command fails before
prompt submission with `provider.mode-unavailable`.

Applying `--effort` to the current model without an explicit `--model` is
outside V1 and is rejected before browser mutation.

Selection is fail-closed: after clicking a model or toggle, the runtime must
read the resulting DOM state and verify it matches the request.

The thinking switch is nested inside the selected model row. The fixed order is
model selection and verification, then switch discovery inside that selected
row, switch mutation, and final verification of both states.

### `web-ai/perplexity-live.mjs`

This module owns:

- provider host verification for `perplexity.ai` and `www.perplexity.ai`
- non-destructive overlay dismissal
- composer and send-button discovery
- fresh-thread preparation
- model and thinking preflight
- file upload and attachment evidence
- prompt insertion and commit verification
- URL transition and response-turn detection
- response stability polling
- citation extraction
- stop via Escape

The provider must work for both initial searches that navigate to a new
`/search/...` URL and follow-up turns that remain on the same conversation URL.
URL change is evidence, not the sole completion condition.

## Capability Contract

Perplexity exposes the same capability rows as other providers:

- `perplexity-active-tab-verification`
- `perplexity-composer-visible`
- `perplexity-model-alias-selectable`
- `perplexity-upload-surface-visible`
- `perplexity-copy-button-present`
- `perplexity-response-streaming`

An unauthenticated page with a usable composer may report `ready` with a warning.
Requests for unavailable paid models or thinking controls fail before mutation.

Overlay dismissal may press Escape or click an unambiguous close control.
It must not click login, subscription, destructive, or consent controls.

## Send Data Flow

1. Ensure a headed provider tab and navigate to the requested/default
   Perplexity URL.
2. Verify the host and dismiss blocking overlays.
3. Prepare a fresh thread unless the request is session-bound.
4. Resolve the composer.
5. If `--model` is present, select the requested unlocked model and verify it.
6. If `--effort` is present, set the thinking toggle and verify it.
7. Insert the rendered question envelope.
8. Attach a file when requested and verify visible attachment evidence.
9. Capture the response count, URL, and visible text baseline.
10. Submit the prompt and verify the composer committed the turn.
11. Create and bind a session containing structured model-selection evidence:

```js
{
    requestedModel: 'gpt-5.6-terra',
    resolvedModel: 'gpt-5.6-terra',
    resolvedLabel: 'GPT-5.6 Terra',
    locked: false,
    thinking: 'on',
    verified: true,
}
```

The same state is stored in `envelopeSummary.model` and
`envelopeSummary.reasoningEffort` so timeout recovery and session inspection do
not depend on warning text.

## Poll Data Flow

1. Resolve the session-bound tab.
2. Accept either a new `/search/...` URL or a new response turn as progress.
3. Observe streaming state and response text.
4. Require non-empty text to remain stable for the provider stability window
   after streaming signals disappear.
5. Prefer DOM response extraction. Use the provider copy control only when the
   caller enables copy-markdown fallback.
6. Extract citations from the final response turn and normalize them.
7. Finalize the session and pool the tab using existing infrastructure.

## Citation Contract

Citation entries use this shape:

```js
{
    index: 1,
    title: 'Source title',
    url: 'https://example.com/source',
}
```

Rules:

- preserve visual citation order
- normalize `index` to a positive integer when available
- resolve relative URLs against the current Perplexity page
- discard non-HTTP(S) URLs
- deduplicate by normalized URL while retaining the first entry
- retain a citation with an empty title when the URL is valid

`answerText` remains the full string for compatibility.

`answerArtifact` gains an optional `citations` array. The shared implementation
must change before the provider poller is built:

- `web-ai/types.mjs` extends the `AnswerArtifact` typedef.
- `createAnswerArtifact()` validates and retains `input.citations`.
- `artifactFromPollResult()` forwards `result.citations` or an existing
  artifact's citations.
- `withAnswerArtifact()` must not rebuild an existing artifact and lose its
  citation data.

`finalizeProviderTab()` gains an `answerArtifact` option, normalizes it through
`createAnswerArtifact()`, and stores both:

```json
{
  "status": "complete",
  "answer": "full answer text",
  "answerArtifact": {
    "provider": "perplexity",
    "text": "full answer text",
    "markdown": "full answer markdown",
    "citations": [
      {
        "index": 1,
        "title": "Source title",
        "url": "https://example.com/source"
      }
    ]
  }
}
```

The session store already permits additive fields, so
`SESSION_STORE_VERSION` remains `1`.

The same artifact must be returned by:

- CLI `query --json`
- CLI `poll --session ... --json`
- CLI `sessions show ... --json`
- MCP submit/wait/resume structured responses
- direct reads of `web-ai-sessions.json`

Every completed Perplexity result and session contains `citations`, including
an empty array. This distinguishes "none found" from providers that do not
implement structured citations.

Missing citation DOM does not invalidate an otherwise complete answer. The
result completes with `citations: []` and the string warning
`citations-unavailable`.

Citation extraction remains DOM-primary even when copy-markdown supplies the
answer body. URL normalization resolves relative links, accepts only HTTP(S),
removes fragments, preserves query parameters, and deduplicates by the
resulting URL while retaining first visual order.

## CLI And MCP Integration

Add `perplexity` to:

- provider enums and typedefs
- CLI validation and usage text
- default URL maps
- send/query/poll/stop dispatch
- bound-session and resume dispatch
- MCP provider sets and schemas
- copy-selector dispatch
- timeout defaults
- eval vendor registries
- skills and reference documentation

The complete fan-out includes:

- `web-ai/types.mjs`
- `web-ai/question.mjs`
- `web-ai/cli.mjs`
- `web-ai/mcp-server.mjs`
- `web-ai/tool-schema.mjs`
- `web-ai/cli-sessions.mjs`
- `web-ai/session.mjs`
- `web-ai/copy-markdown.mjs`
- `web-ai/doctor.mjs`
- `web-ai/navigation-ready.mjs`
- `web-ai/policy/default-policy.mjs`
- `web-ai/vendor-editor-contract.mjs`
- capability catalogs used by doctor and eval
- `web-ai/eval/types.mjs`
- shared answer-artifact and tab-finalizer modules
- skills, CLI help, generated references, and structure counts

Perplexity's default timeout is 1200 seconds. Thinking-enabled requests use a
3600-second tier when no explicit timeout is supplied.

To make that timeout contract real:

- `deriveTimeoutTier()` accepts effort/reasoning-effort.
- `resolveTimeoutDefaultSec()` forwards the requested effort.
- CLI send/query timeout injection passes the effort value.
- `summarizeEnvelope()` persists `reasoningEffort`.
- session budget fallback reads `envelopeSummary.reasoningEffort`.
- a dedicated `perplexity-thinking` tier maps to 3600 seconds.

CLI validation adds a Perplexity-specific branch. It accepts the documented
binary effort aliases, requires `--model`, and leaves ChatGPT effort validation
unchanged. MCP schemas add `perplexity` and `on`/`off` without changing other
provider semantics.

`--follow-up`, ChatGPT tools/plugins, ChatGPT Deep Research, Work mode, and
generated-image output remain unsupported for Perplexity.

## Error Policy

All public failures use `WebAiError`.

| Condition | Error code | Retry hint |
| --- | --- | --- |
| Wrong active host | `cdp.target-mismatch` | `tab-switch` |
| Composer missing | `provider.composer-not-visible` | `re-snapshot` |
| Unknown model alias | `provider.model-mismatch` | `model-fallback` |
| Locked model | `provider.model-entitlement` | `choose-unlocked-model` |
| Thinking control unavailable | `provider.mode-unavailable` | `omit-effort-or-change-model` |
| Attachment not verified | `provider.attachment-evidence-missing` | `re-upload` |
| Submit not verified | `provider.commit-not-verified` | `re-snapshot` |
| Missing baseline | `provider.poll-timeout` | `send-first` |
| Response timeout | `provider.poll-timeout` | `poll-or-resume` |

No failure path silently falls back to another model.

`web-ai/errors.mjs`, CLI help, and skill error documentation list the new error
codes and their fixed retry hints.

A visible unambiguous Stop control is preferred; Escape is the fallback.

For `sessions reattach --navigate`, a Perplexity session may open its saved
`conversationUrl` in a fresh provider tab using the provider host allowlist and
session target rebinding rules. It must not use ChatGPT's `/c/...` URL pattern.

## Test Strategy

Implementation follows strict red-green-refactor TDD.

### Unit tests

- DOM reconnaissance establishes whether `Sonar 2` is selectable or a group
  heading before its alias test is admitted
- alias and visible-label normalization for every supported model
- locked model detection
- thinking alias mapping and unsupported-control errors
- citation normalization, ordering, URL resolution, and deduplication
- answer artifact citation preservation
- session finalization persistence
- timeout tier resolution
- CLI and MCP provider/model/effort validation

### Provider DOM fixtures

Add fixtures for:

- baseline composer
- model picker with all visible entries
- group-heading semantics for `Sonar 2`
- locked Max entries
- selected model with thinking off
- selected model with thinking on
- blocking overlay
- attachment preview
- streaming response
- stable response with citations
- cosmetic churn
- structural churn

Fixture tests must include Korean labels shown in the supplied model-picker
screen and desktop English variants where observed.

### Integration tests

- send creates a Perplexity session with model evidence
- poll returns answer text and structured citations
- session JSON round-trips the full artifact
- session resume dispatches to the Perplexity poller
- session-bound send/query dispatches to the Perplexity provider
- reattach with navigation restores a saved Perplexity conversation URL
- MCP submit/wait accepts `perplexity`
- existing ChatGPT/Gemini/Grok tests remain unchanged and passing

### Live smoke test

The manual smoke gate uses the user's authenticated headed Chrome:

1. `status` reports a usable Perplexity composer.
2. Select `gpt-5.6-terra`.
3. Enable thinking.
4. Submit a short query.
5. Verify a stable answer, conversation URL, citations, and persisted session.

Live smoke is not part of deterministic CI.

## Documentation

Update:

- `README.md`
- `skills/web-ai/SKILL.md`
- `skills/browser/SKILL.md` where provider enums appear
- CLI help text in `web-ai/cli.mjs`
- MCP descriptions in `web-ai/tool-schema.mjs`
- relevant generated/reference documentation and structure counts

Examples must use stable aliases rather than copying localized display text.

## Out Of Scope

- Perplexity Spaces
- Focus-mode automation
- provider-specific Deep Research
- account login automation
- subscription purchase or entitlement changes
- automatic fallback from a locked model
- broad refactoring of all provider dispatch into `provider-adapter.mjs`
