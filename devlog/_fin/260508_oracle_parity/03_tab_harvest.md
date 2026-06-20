# Plan: Rich Tab State Model + Harvest/Reattach

**Issue: #71** | **Priority: P1** | **Status: planned**

## Problem

agbrowse's tab-manager tracks lease metadata (targetId, vendor, url, owner) but can't inspect live tab content. Oracle's `liveTabs.ts` inspects model label, button states, auth status, response text, and classifies tab state.

## Reference Implementation

Oracle `src/browser/liveTabs.ts` (commit `d376a3b`):
- `ChatGptTabSummary`: model label, stop/send button state, auth state, assistant count, last assistant text/markdown, conversation ID, fingerprint, state classification
- `classifyTabState()`: detached → running → completed → stalled
- `harvestChatGptTab()`: extracts response markdown from existing tab
- `inspectChatGptTab()`: DOM evaluation for full tab state
- ChatGPT-specific — not a generic provider-neutral inspector

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/tab-inspect.mjs` | NEW | ChatGPT tab state inspection + harvest |
| `web-ai/tab-inspect-expressions.mjs` | NEW | DOM evaluation JS expressions |
| `skills/browser/browser.mjs` | MODIFY | `tabs --inspect` enriched output |

## Diff Plan

### NEW `web-ai/tab-inspect.mjs`

```javascript
// ChatGPT-specific tab inspection (scope to ChatGPT first)
// Gemini/Grok inspectors added separately when provider-specific selectors are validated

// TabSummary: { targetId, title, url, vendor, modelLabel, stopExists,
//   sendExists, promptReady, authenticated, assistantCount,
//   lastAssistantText, lastAssistantSnippet, conversationId,
//   fingerprint, state }

export async function inspectTab(port, targetId)
// Connect CDP to target, evaluate inspection expression
// MUST close CDP session/client after use
// Reject targets currently bound to active command/session (via lease store)
// Return TabSummary

export function classifyTabState(summary)
// !authenticated → 'detached'
// stopExists → 'running'
// sendExists || promptReady || assistantCount > 0 → 'completed'
// else → 'detached'

export async function harvestTab(port, targetId, { stallWindowMs } = {})
// inspectTab + extract assistant markdown
// If running + stallWindowMs: wait, re-inspect, compare fingerprint → 'stalled'
// Return TabSummary with lastAssistantMarkdown
// Close CDP session after use

export async function collectTabs(port)
// List all ChatGPT targets (ChatGPT only, not Gemini/Grok)
// Skip targets with active lease/command (read-only, no interference)
// inspectTab each, sort by focused + conversation URL
// Close all CDP sessions after collection
```

### MODIFY `skills/browser/browser.mjs` — tabs command

```javascript
// Add --inspect flag to existing tabs [--json] command
// When --inspect: call collectTabs, show enriched state
// Output: targetId, url, state (running/completed/detached), model, snippet
// Read-only: does not modify tab state, lease store, or session locks
// Mark targets with active commands as "[in-use]"
```

## Guardrails

- ChatGPT-specific first — no generic provider-neutral inspector
- Read-only: `tabs --inspect` never modifies tab state
- CDP sessions opened for inspection MUST be closed after use
- Targets bound to active command/session are marked but not inspected intrusively
- No `--tab <ref>` reuse flag until integrated with session locks and tab lease store
- Existing session-bound tab recovery (via saved conversationUrl) remains unchanged

## Dependencies

None — can be implemented independently. Useful infrastructure for #69 (multi-turn) and #70 (deep research), but not a hard prerequisite since agbrowse already has session recovery via saved conversation URLs.

## Test Plan

1. ChatGPT tab with completed response → verify state='completed', text extracted
2. ChatGPT tab mid-generation (stop button visible) → verify state='running'
3. Non-ChatGPT tab → verify filtered out
4. Stall detection: running tab with no fingerprint change → verify state='stalled'
5. Tab with active lease → verify marked "[in-use]", not intrusively inspected
6. After inspection → verify CDP sessions closed (no leaked connections)
