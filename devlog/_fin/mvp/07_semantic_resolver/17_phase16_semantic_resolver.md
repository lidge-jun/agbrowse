# Phase 16 — Semantic action resolver

Replace scattered selector stacks with a ranked, explainable resolver. This is
the deterministic repair layer that must exist before any LLM-based selector
repair is considered.

## PR 16.1 — ActionIntent contract

### Diff

- NEW `web-ai/action-intent.mjs`
- NEW `web-ai/target-resolver.mjs`
- MODIFY `web-ai/self-heal.mjs`
- MODIFY `web-ai/action-cache.mjs`
- NEW `test/unit/target-resolver.test.mjs`
- NEW `test/unit/action-intent.test.mjs`

### Intent shape

```js
{
  intentId: 'composer.fill',
  provider: 'chatgpt',
  operation: 'fill',
  roleHints: ['textbox'],
  nameHints: ['message', 'prompt'],
  testIds: [],
  cssFallbacks: [],
  requiredEvidence: ['visible', 'editable'],
  ambiguityPolicy: 'reject'
}
```

### Tests

- Resolver returns ranked candidates with confidence and evidence.
- Ambiguous matches reject unless policy allows.
- Hidden/disabled elements are rejected.
- Cache hit/miss/stale metrics are exposed.

### PASS

- Target resolution is explainable in JSON.
- No provider code directly hides selector fallback logic outside resolver
  contracts after PR 16.2.

## PR 16.2 — Provider integration

### Diff

- MODIFY `web-ai/chatgpt.mjs`
- MODIFY `web-ai/gemini-live.mjs`
- MODIFY `web-ai/grok-live.mjs`
- MODIFY `web-ai/doctor.mjs`
- MODIFY `web-ai/capability.mjs`
- NEW `test/integration/provider-target-resolver.test.mjs`

### Tests

- Composer, upload, send, stop, model menu, copy, and source affordances use
  resolver contracts.
- Doctor output shows resolver confidence and fallback path.
- Phase 11 eval harness consumes resolver metrics once Phase 16 lands.

### PASS

- Provider actions expose `intentId`, selected candidate, confidence, and
  fallback path in diagnostics.

### Progress

- 2026-05-05: ChatGPT `composer.fill` now resolves through the ActionIntent
  target resolver before prompt insertion.
- 2026-05-05: ChatGPT `send.click` now resolves through the ActionIntent
  target resolver before falling back to legacy submit behavior.
- 2026-05-05: ChatGPT `upload.attach` now resolves through the ActionIntent
  target resolver before falling back to legacy upload surface scanning.
- 2026-05-05: ChatGPT `copy.lastResponse` now resolves through the ActionIntent
  target resolver when unambiguous, then stays scoped to the last assistant turn.
- 2026-05-05: ChatGPT send path now persists `composer.fill`, `send.click`,
  and optional `upload.attach` resolver metadata in the session trace without
  prompt or answer text.
- 2026-05-05: ChatGPT copy fallback now persists `copy.lastResponse` resolver
  metadata and returns a trace summary covering the full persisted session trace.
- 2026-05-05: ChatGPT reasoning effort selection now tolerates model-first
  effort labels and generic effort controls for hero/new-chat model menus.

## Not now

- No embedding service.
- No model call for selector repair.
- No cross-site semantic query language.

## cli-jaw mirror

- Port the `ActionIntent` and resolver result shapes to TypeScript.
- Reuse cli-jaw's existing browser diagnostics where available.
- Keep confidence, ambiguity, and fallback fields JSON-compatible with
  agbrowse so eval reports can compare both repos.
