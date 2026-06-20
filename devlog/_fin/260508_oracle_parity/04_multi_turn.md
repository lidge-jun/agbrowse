# Plan: Multi-Turn Follow-Up Prompts

**Issue: #69** | **Priority: P2** | **Status: planned** | **Depends: #72**

## Problem

agbrowse `sendWebAi` creates a new session per submitted prompt. Oracle supports explicit follow-up prompts within the same conversation, with per-turn state and artifact tracking.

## Reference Implementation

Oracle multi-turn: explicit follow-up prompts (not autonomous generation). Skips archive for multi-turn runs. Persists per-turn state.

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/chatgpt-multi-turn.mjs` | NEW | Multi-turn orchestration |
| `web-ai/session.mjs` | MODIFY | Add turns array to session schema |
| `web-ai/cli.mjs` | MODIFY | `--follow-up <prompt>` repeatable flag |

## Diff Plan

### MODIFY `web-ai/session.mjs` — turns model

```javascript
// Add persisted turns array to session schema:
// session.turns = [{ index, prompt, answer, status, warnings, artifacts, sentAt, completedAt }]
// First turn (index 0) is the initial send
// Follow-ups append turns with incrementing index
// Persisted in web-ai-sessions.json
// session.followUpCount = session.turns.length - 1
```

### NEW `web-ai/chatgpt-multi-turn.mjs`

```javascript
export async function sendMultiTurn(page, deps, { prompts, session, opts })
// Hold session command lock for the ENTIRE multi-turn sequence
// (not just individual turns — prevents interleaving)
//
// CRITICAL: Do NOT call existing queryWebAi/pollWebAi unchanged per turn.
// Current pollWebAi calls finalizeProviderTab on completion, which marks
// session complete and pools the tab — breaking the follow-up sequence.
// Instead, refactor into lower-level submitTurn/pollTurn helpers:
//   - submitTurn: type + submit in existing conversation (no new session)
//   - pollTurn: poll for completion with finalize: false for intermediate turns
// Finalize and pool ONLY after the last successful turn.
// If a later turn fails: mark session partial/failed WITHOUT pooling.
//
// For each follow-up prompt:
//   1. Type into existing conversation's composer
//   2. submitTurn + pollTurn (no intermediate finalization)
//   3. Record turn: { index, prompt, answer, status, warnings, artifacts }
//   4. Save transcript artifact (via #72) after each turn
// After final turn: finalize session, pool tab normally
// Return structured results:
//   { sessionId, conversationUrl, turns: [...], finalAnswer }
// On failure mid-sequence: record partial turns, release lock, report which turn failed
```

### MODIFY `web-ai/cli.mjs`

```javascript
// --follow-up <prompt> — repeatable flag for multi-turn
// e.g., send chatgpt --prompt "initial" --follow-up "elaborate" --follow-up "summarize"
// Requires same session throughout (lock held)
// ChatGPT only initially — Gemini/Grok multi-turn deferred until
//   provider-specific selectors and tests are validated
```

## Guardrails

- Session command lock held for entire multi-turn sequence, not per-turn
- ChatGPT only initially — Gemini/Grok deferred
- Archive policy: `followUpCount > 0` → never auto-archive (oracle parity)
- Per-turn state persisted, not just final answer
- Structured per-turn results: prompt, answer, status, warnings, artifacts, conversationUrl
- Partial failure: record completed turns, report which turn failed

## Dependencies

- #72 (artifacts): transcript saved per-turn
- #71 (tab harvest): useful but not required — existing session recovery via conversationUrl works

## Test Plan

1. Initial + 2 follow-ups → verify 3 turns recorded, all answers captured
2. Follow-up failure mid-sequence → verify partial turns saved, error reported
3. Concurrent command during multi-turn → verify blocked by session lock
4. Multi-turn session → verify NOT auto-archived
5. Per-turn artifacts → verify transcript updated after each turn
