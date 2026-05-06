# Session Isolation & Duplicate Request Prevention Plan

## Problem Statement

### 1. Context Contamination
When `agbrowse web-ai send` is executed, it sends the prompt to the **active tab** without checking whether to:
- Start a **new conversation** (clean context)
- Continue the **existing conversation** (preserves context)

This causes:
- Previous conversation context bleeding into new prompts
- GPT Pro continuing from old context unexpectedly
- No way for the user to explicitly request a fresh start

### 2. Duplicate Requests
The CLI has no deduplication mechanism:
- Running the same command twice sends two identical prompts
- No tracking of "in-flight" requests
- No warning when a similar prompt was just sent

## Root Cause Analysis

```
Current flow:
  agbrowse web-ai send --prompt "hello"
    → get active tab
    → send prompt to active tab (regardless of existing context)
    → no dedup check
    → no new-chat option
```

Missing features:
1. `--new-chat` flag to explicitly start fresh
2. Prompt hash tracking for deduplication
3. In-flight request tracking
4. Session isolation (clear composer before send)

## Proposed Solution

### Phase 1: New Chat Support (Immediate)

Add `--new-chat` flag to `send` and `query` commands:

```bash
agbrowse web-ai send --vendor chatgpt --new-chat --prompt "hello"
```

**Implementation:**
- Click "New chat" button before sending (provider-specific)
- Clear composer if new-chat fails (fallback)
- Store `newChat: true` in session metadata

**Files to modify:**
- `web-ai/cli.mjs` — add `--new-chat` to argument parsing
- `web-ai/chatgpt.mjs` — implement `startNewChat()` helper
- `web-ai/gemini-live.mjs` — implement `startNewChat()` helper  
- `web-ai/grok-live.mjs` — implement `startNewChat()` helper
- `web-ai/session.mjs` — track `newChat` in baseline

### Phase 2: Deduplication (P1)

Track in-flight requests by prompt hash:

```javascript
// In-flight tracking
const inFlight = new Map(); // promptHash -> { sentAt, sessionId }

function isDuplicatePrompt(envelope) {
    const hash = hashPrompt(envelope);
    const existing = inFlight.get(hash);
    if (existing && Date.now() - existing.sentAt < 60_000) {
        return existing; // Duplicate within 60s
    }
    return null;
}
```

**Behavior:**
- If duplicate detected within 60s: warn and return existing sessionId
- `--force` flag to bypass dedup
- Auto-clear in-flight on completion/timeout

**Files to modify:**
- `web-ai/session.mjs` — add `inFlight` tracking
- `web-ai/cli.mjs` — add `--force` flag, dedup check
- `web-ai/chatgpt.mjs` — check dedup before send

### Phase 3: Smart Session Isolation (P2)

Auto-detect when to start new chat:

```javascript
function shouldStartNewChat(page, envelope, baseline) {
    // Start new chat if:
    // 1. --new-chat explicitly requested
    // 2. Last interaction was > 30 min ago
    // 3. Composer has existing text from different prompt
    // 4. Previous session completed successfully
}
```

**Heuristics:**
- Time-based: > 30 min since last send → suggest new chat
- Content-based: composer text doesn't match expected prompt → new chat
- Explicit: `--new-chat` always starts fresh

## CLI Changes

```bash
# New chat explicitly
agbrowse web-ai send --new-chat --prompt "hello"

# Force send even if duplicate detected
agbrowse web-ai send --force --prompt "hello"

# Status shows whether session used new chat
agbrowse web-ai status --vendor chatgpt
# { ..., newChat: true, conversationUrl: "..." }
```

## Provider-Specific New Chat Selectors

| Provider | New Chat Button | Fallback |
|----------|----------------|----------|
| ChatGPT | `[data-testid="new-chat-button"]` | Navigate to chatgpt.com |
| Gemini | `[aria-label="New chat"]` | Navigate to gemini.google.com |
| Grok | `[aria-label="New chat"]` | Navigate to grok.com |

## Exit Criteria

- [ ] `--new-chat` flag works for all 3 providers
- [ ] `--force` flag bypasses dedup
- [ ] Duplicate detection warns within 60s window
- [ ] Session metadata tracks `newChat: true/false`
- [ ] Status command shows new-chat state
- [ ] Tests cover dedup and new-chat scenarios

## Date: 2026-05-02
