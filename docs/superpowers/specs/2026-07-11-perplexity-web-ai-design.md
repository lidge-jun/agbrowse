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
The authenticated desktop DOM observation from July 11, 2026 is recorded at
`docs/superpowers/specs/2026-07-11-perplexity-live-dom-observation.md` and is
the source of truth when it resolves ambiguity in the screenshot.

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
| `sonar-2` | `Sonar 2` |
| `gpt-5.6-terra` | `GPT-5.6 Terra` |
| `gpt-5.6-sol` | `GPT-5.6 Sol` |
| `gemini-3.1-pro` | `Gemini 3.1 Pro` |
| `claude-sonnet-5` | `Claude Sonnet 5` |
| `claude-opus-4.8` | `Claude Opus 4.8` |
| `glm-5.2` | `GLM 5.2` |
| `kimi-k2.6` | `Kimi K2.6` |
| `nemotron-3-ultra` | `Nemotron 3 Ultra` |

The observed selectable models are `Best`, `Sonar 2`, `GPT-5.6 Terra`,
`Gemini 3.1 Pro`, `Claude Sonnet 5`, `GLM 5.2`, `Kimi K2.6`, and
`Nemotron 3 Ultra`. The observed locked rows are `GPT-5.6 Sol Max` and
`Claude Opus 4.8 Max`.

`gpt-5.6-sol` and `claude-opus-4.8` remain valid aliases even when the UI
shows them as locked. A locked option produces a typed
`provider.model-entitlement` error before any click or prompt submission.

The live picker exposes selectable models as `role=menuitemradio` with
`aria-checked` and `data-state`. `Sonar 2` has those selectable-row semantics
and is not a group heading. Locked models are non-radio `role=menuitem` rows
with lock-icon evidence. The runtime never clicks a heading or a locked
non-radio row through text fallback.

Model matching ignores case, repeated whitespace, localized descriptions,
`Max`, lock labels, and auxiliary badges such as `새로 만들기`. The actual model
name and version remain part of the verification contract.

No selector mutation occurs when `--model` is omitted.

### Thinking Toggle Contract

The Perplexity "thinking" toggle is model-scoped and appears only for an
eligible selected model. Its requested state is a separate input from the model
alias, but its DOM availability cannot be inspected before selection.

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

The thinking control is not nested inside the selected model row. For an
eligible selected model, the observed structure is the immediate next element
sibling, not merely a later matching sibling: an adjacent
`role=menuitemcheckbox` with visible text `Thinking`, containing exactly one
direct-child `button[role=switch]`. Traversal may not skip an intervening row.
The fixed order is model selection and verification,
then adjacent checkbox/switch discovery, switch mutation only when effort is
explicit, and final verification of both states. When effort is omitted, the
runtime performs no switch click and records the state only when it can read
one unambiguous switch without mutation.
Any click that can close or rerender the picker invalidates every previously
created menu/row/checkbox/switch Locator. The runtime reopens and resolves a
fresh selected row before Thinking inspection and again before final
postcondition verification.

### `web-ai/perplexity-live.mjs`

This module owns:

- provider host verification for `perplexity.ai` and `www.perplexity.ai`
- non-destructive overlay dismissal
- composer discovery through the unique visible `#ask-input` textbox
- send-button discovery through the `Submit` accessible name after text entry
- fresh-thread preparation
- model and thinking preflight
- file upload through `Add files or tools` then `Upload files or images`,
  followed by attachment evidence
- prompt insertion and commit verification
- URL transition and response-turn detection
- response stability polling
- citation extraction
- stop via Escape

The provider must work for both initial searches that navigate to a new
`/search/<UUID>` URL and follow-up turns that remain on the same conversation URL.
URL change is evidence, not the sole completion condition.
Until another authenticated ID grammar is captured, stored-session recovery
accepts only UUID conversation paths. Both allowed hosts belong to one tab
lifecycle pool and cleanup limit. One shared provider-URL identity contract is
used by reusable-tab acquisition, driveability, navigation readiness, recovery,
and cleanup. The bare host is a redirect alias; successful navigation stores
the browser's canonical live `www` URL.
The durable lease store canonicalizes both aliases to
`https://www.perplexity.ai` for lease keys, scoped target identity, active
capacity, pooled checkout, and pool statistics. Caller-only normalization is
insufficient.
The observed Search and Computer controls are separate `aria-pressed`
buttons. V1 preserves their state and never clicks them.

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

Status reports fixture-backed `supportsThinking: true|false|null` separately
from live `thinkingControlPresent: true|false|null`. The latter is populated
only for the currently selected row; unselected models are always `null`.
Status never selects models to discover capability, and send always revalidates
the actual adjacent control after model selection.

Overlay dismissal exists only when an authenticated live capture proves a
unique close mechanism. If overlay provenance is `not-observed`, runtime uses a
zero-mutation no-overlay path and does not speculate with Escape or a generic
close selector. It must not click login, subscription, destructive, or consent
controls.

## Send Data Flow

1. Ensure a headed provider tab and navigate to the requested/default
   Perplexity URL.
2. Verify the host.
3. Prepare a fresh thread unless the request is session-bound, then discard
   pre-navigation Locators.
4. Re-verify the host, apply only an authenticated overlay dismissal path, and
   resolve the composer.
5. If `--model` is present, select the requested unlocked model and verify it.
6. If `--effort` is present, set the thinking toggle and verify it.
7. Insert the rendered question envelope.
8. Attach a file when requested and verify visible attachment evidence.
9. Capture the response count, URL, and visible text baseline.
10. Resolve the now-visible `Submit` button, submit the prompt, and verify the
    composer committed the turn.
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

Fresh-thread preparation no-ops only on a provider root with zero committed
responses. Otherwise it uses a live-captured unique control or guarded exact
root navigation and verifies allowed host, normalized root path, one visible
composer, zero committed responses, and no retained prior conversation UUID.
Failure prevents submit and session creation.

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
6. Within the committed response root, open its unique `${count} sources`
   footer control, read the associated Sources pane, and normalize only those
   source links.
7. Finalize the session and pool the tab using existing infrastructure.

If authenticated pane close fails or the pane remains visible, citation state
is non-terminal `unknown`. If turn identity, answer text, or response count
changes during close, discard citation candidates, reset response/citation
stability clocks, retry response resolution, and do not finalize.

## Citation Contract

Citation entries use this shape:

```js
{
    index: null,
    title: 'Source title',
    url: 'https://example.com/source',
}
```

Rules:

- preserve visual citation order
- normalize `index` to a positive integer when available
- use `index: null` when the UI exposes no explicit data/ARIA index evidence
- resolve relative URLs against the current Perplexity page
- discard non-HTTP(S) URLs
- deduplicate by normalized URL while retaining the first entry
- retain a citation with an empty title when the URL is valid
- never collect ordinary answer-body links, internal `/search/<UUID>` memory
  links, related questions, footer actions, or links from another turn

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
        "index": null,
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
`citations-unavailable` after the citation grace, but only after a unique
committed response root has been established. A missing/changed Sources
control, unresolvable pane, or normalization that drops every candidate maps to
the terminal degraded state `unavailable`; a missing or ambiguous committed
response root never completes.

Citation extraction remains DOM-primary even when copy-markdown supplies the
answer body. The extractor receives the committed response locator, opens only
that response's sources control, and reads only the associated Sources pane;
it never scans all anchors below the response. URL normalization resolves
relative links, accepts only HTTP(S), removes fragments, preserves query
parameters, and deduplicates by the resulting URL while retaining first
visual order.

Pane association is causal: record visible pane identities/fingerprints before
the committed footer click, then accept only one newly visible pane, one unique
changed pane fingerprint, or a fixture-proven ownership relation. Pane closing
uses only an authenticated captured mechanism and verifies the answer text and
response count did not change. V1 artifacts are immutable after completion;
citations that arrive after the grace do not rewrite a terminal session.

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
unchanged. It runs before headed-browser startup/tab acquisition and updates
the existing CLI vendor/model/effort allowlists rather than relying only on the
provider module. MCP schemas add `perplexity` and `on`/`off` without changing
other provider semantics. CLI and MCP option-conflict errors are provider-aware
and serialize `vendor: 'perplexity'`.

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
| Unknown effort alias | `provider.invalid-effort` | `use-on-off-effort-aliases` |
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

- fixture-backed tests verify `Sonar 2` is a selectable `menuitemradio`
- alias and visible-label normalization for every supported model
- locked model detection
- thinking alias mapping and unsupported-control errors
- citation normalization, ordering, URL resolution, and deduplication
- answer artifact citation preservation
- session finalization persistence
- timeout tier resolution
- CLI and MCP provider/model/effort validation

### Provider DOM fixtures

Authenticated live captures cover naturally observable surfaces only:

- baseline composer
- model picker with all visible entries
- authenticated non-mutating model-menu close behavior
- selectable `menuitemradio` semantics for `Sonar 2`
- locked Max entries
- selected model with thinking off
- selected model with thinking on
- blocking overlay only when live-observed with an authenticated close action
- fresh-thread root/control and zero-response postcondition
- attachment preview
- streaming response
- stable response with citations
- complete response footer and an opened/closed Sources pane

Deterministically derived fixtures cover duplicate/missing switches, adjacent
decoys, detached-locator remounts, Copy/pane decoys, stale/two-visible panes,
same-pane fingerprint replacement, late citations, cosmetic/structural churn,
and the breaking variant. Provenance records each parent hash and transform;
derived fixtures are never labeled `live-frontend`.

Capture screenshots are surface-cropped, redacted, local-only ignored files.
Provenance retains their hash/timestamp/redaction version with
`retained: false`; account/history screenshots are never committed.

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

The manual smoke gate uses the user's authenticated headed Chrome and the
repository-local `node ./bin/agbrowse.mjs` after `npm ci`:

1. Navigate explicitly to `https://www.perplexity.ai`.
2. `status` reports a usable composer and sanitized model options without
   changing the selected model or Thinking state.
3. Select `gpt-5.6-terra` only when status reports it unlocked with
   fixture-backed `supportsThinking: true`. Current evidence does not claim
   Thinking support for unobserved aliases.
4. Enable thinking.
5. Submit a short query.
6. Verify a stable answer, conversation URL, citations, and persisted session.
7. Resume and reattach the actual session, then test an observed locked alias
   only when status reports one.
8. Allow a 3,720-second external watcher limit for the 3,600-second Thinking
   deadline and record both values in smoke evidence.

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
