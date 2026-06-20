# 00 — MCP Wait Response Recovery Plan

Date: 2026-06-21
Issue: https://github.com/lidge-jun/agbrowse/issues/79
Scope: one PABCD pass

## Summary

`agbrowse@0.1.14` can submit a long ChatGPT Pro Extended run through MCP, but
`web_ai_wait_response` currently waits through the direct provider poll path.
That path does not reuse the CLI session-bound recovery path, does not register
an MCP active command, and can mark an already completed session as `timeout`.

This plan fixes the local code-level MCP wait/resume contract while keeping the
CLI poll behavior compatible. It does not claim to prevent every MCP host from
enforcing its own request timeout, because a host-side `-32001 Request timed out`
can still terminate the client request before agbrowse returns a payload. The
goal of this pass is to make the agbrowse side session-bound, visible in
active-command evidence, recoverable when the provider poll returns a timeout,
and monotonic with respect to completed sessions. Docs will explicitly tell MCP
callers to preserve `sessionId` and use short repeated waits, resume, CLI poll,
or a sufficiently long host timeout for long Pro/Deep Research runs.

## Root Cause Evidence

- `web-ai/mcp-server.mjs` wraps `web_ai_submit_prompt` and `web_ai_copy_markdown`
  in `withMcpActiveCommand(...)`, but `web_ai_wait_response` and
  `web_ai_session_resume` call `pollByProvider(...)` directly.
- `agbrowse web-ai poll --session <id>` uses `withSessionCommandLock(...)`,
  session page resolution, and active-command recording before provider poll.
- `web-ai/chatgpt.mjs`, `web-ai/gemini-live.mjs`, and `web-ai/grok-live.mjs`
  set `updateSession(session.sessionId, { status: 'timeout' })` on poll timeout.
- `web-ai/session-store.mjs` applies patches as a plain merge, so a later timeout
  can overwrite `status: 'complete'`.
- Existing MCP tests pass, but they do not cover long-running
  `web_ai_wait_response`, session-bound recovery, or complete-to-timeout
  downgrade prevention.

## Requirements

1. MCP `web_ai_wait_response` and `web_ai_session_resume` must use the same
   session-bound lock/recovery semantics as CLI `poll --session`.
2. MCP wait/resume must register an active command so diagnostics can identify
   which MCP tool owns a provider target.
3. Provider poll timeout must remain recoverable for incomplete sessions and
   include enough session evidence for later poll/resume.
4. Completed sessions must not be downgraded to `timeout` by later polls.
5. MCP schema/help must communicate that long waits are recoverable and that
   callers should preserve `sessionId`.
6. Add focused regression tests and update source-of-truth docs/counts.

## Plan

### 10.1 — Session Timeout Mutation Helper

Modify:

- `web-ai/session.mjs`
- `web-ai/chatgpt.mjs`
- `web-ai/gemini-live.mjs`
- `web-ai/grok-live.mjs`

Add a helper in `session.mjs`:

```js
export function markSessionTimeout(sessionId, patch = {}) {}
```

Behavior:

- Re-read the current session before mutation.
- If no session exists, return `null`.
- If current status is `complete` or `completedAt`/`answer` is present, keep
  `status: 'complete'` and append a warning such as
  `timeout-after-complete-ignored`.
- Otherwise patch `status: 'timeout'`, `lastError`, warnings, and `updatedAt`.
- Merge warnings explicitly by reading the current `session.warnings`; the
  session store patch operation is a plain merge and does not append arrays.

Replace direct provider calls:

```js
updateSession(session.sessionId, { status: 'timeout' })
```

with:

```js
markSessionTimeout(session.sessionId, {
  lastError: { errorCode: 'provider.poll-timeout', message: 'timed out waiting for answer' },
})
```

Provider return objects should include:

- `recoverable: true`
- `retryHint: 'poll-or-resume'`
- `deadlineAt` when a session exists
- `conversationUrl` when a session exists

### 10.2 — MCP Session-bound Wait/Resume

Modify:

- `web-ai/mcp-server.mjs`

Add imports:

```js
import { withSessionCommandLock } from './session-store.mjs';
import { withSessionPage } from './tab-recovery.mjs';
```

Add a helper:

```js
async function runMcpSessionPoll(name, args, deps) {}
```

Behavior:

1. Resolve `sessionId` from `args.sessionId`.
2. Load the stored session and provider, failing fast if missing.
3. Run:
   - `withSessionCommandLock(sessionId, ...)`
   - `withSessionPage(deps, sessionId, ...)`
   - `withMcpActiveCommand(name, provider, sessionDeps, argsWithSessionId, ...)`
   - provider `pollByProvider(...)`
4. Pass a session-aware `deps` object whose `getPage`, `getTargetId`, and
   `getCdpSession` resolve to the recovered session page.
5. Return provider poll result, preserving structured `timeout` evidence instead
   of throwing a hard MCP error for normal provider timeout.
6. If provider poll returns a recoverable `tab-crashed` result, keep the result
   structured and recoverable for MCP callers rather than throwing like the CLI
   interactive path. MCP callers need the `sessionId` evidence more than a thrown
   terminal shell error.

This deliberately does not add a new cancellation protocol in this pass. It
does make active command ownership visible and prevents concurrent session
mutation while the MCP wait/resume is running.

### 10.3 — MCP Schema and Source-of-truth Docs

Modify:

- `web-ai/tool-schema.mjs`
- `structure/commands.md`
- `structure/runtime_contracts.md`
- `structure/stability-upgrade/01_operational_weakness_register.md`
- `skills/web-ai/SKILL.md`
- `devlog/00_index.md`
- `structure/str_func.md`

Schema/doc wording:

- `web_ai_wait_response`: session-bound wait that can return recoverable
  `timeout` while provider work continues.
- `web_ai_session_resume`: resume stored session through the same recovery path.
- Long Pro/Deep Research runs should preserve `sessionId` and retry/poll later.
- MCP clients with short host-level request timeouts should prefer repeated
  bounded waits or CLI `web-ai poll --session` instead of a single long blocking
  MCP request.

Add register row:

- `STAB-09`: MCP wait timeout/session recovery mismatch, closed by this pass.

### 10.4 — Regression Tests

Modify:

- `test/integration/web-ai-mcp-server.test.mjs`
- `test/unit/web-ai-provider-session.test.mjs`
- `test/unit/web-ai-tool-schema.test.mjs`

Tests:

1. MCP `web_ai_wait_response` and `web_ai_session_resume` source path uses
   `withSessionCommandLock`, `withSessionPage`, and `withMcpActiveCommand`.
2. Provider-level fake-page timeout tests verify structured timeout payloads
   with `recoverable`, `retryHint`, `sessionId`, `deadlineAt`, and
   `conversationUrl`. Do not make this a live-browser MCP integration test.
   If a behavioral MCP test is needed, mock `tab-recovery.mjs` explicitly before
   importing `mcp-server.mjs`; otherwise keep MCP wait coverage as source-string
   contract plus provider fake-page timeout tests.
3. `markSessionTimeout` preserves completed sessions and appends a warning.
4. Existing provider source contracts expect `markSessionTimeout` instead of
   raw `updateSession(... { status: 'timeout' })`.
5. MCP tool schema descriptions mention recoverable/session-bound wait.

## Verification

Run:

```bash
npm run test:mcp
npx vitest run test/unit/web-ai-provider-session.test.mjs test/unit/web-ai-tool-schema.test.mjs
npm run test:release-gates
git diff --check
```

If source counts change, update `structure/str_func.md` and verify:

```bash
bash structure/verify-counts.sh
```

## Acceptance Criteria

- GitHub issue #79's local code-level root causes are addressed: MCP wait/resume
  no longer bypasses session lock/recovery/active-command semantics, provider
  timeout results are recoverable, and completed sessions cannot be downgraded
  by later timeout polls.
- Host-side MCP request timeout (`-32001`) is documented as a client/runtime
  timeout boundary; this pass does not implement a background cancellation or
  lease protocol.
- MCP wait/resume no longer bypasses session lock/recovery/active-command
  semantics.
- Completed session records remain complete after later timeout polls.
- Timeout result remains recoverable and points users back to session poll/resume.
- Docs and structure counts are consistent.
- Changes are committed locally and not pushed.
