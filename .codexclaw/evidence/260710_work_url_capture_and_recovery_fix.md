# Work URL capture + recovery wrong-tab fix (round 2)

Date: 2026-07-10 KST
Worker: K (leaf agent)
Branch: dev

## Root cause

After Worker J's round-1 fix, `work send --power 2` committed successfully,
but the persisted session had:
- `taskUrl: "https://chatgpt.com/"` (bare origin, captured BEFORE the SPA
  URL transition to `/c/<uuid>`)
- `taskId: null`
- `conversationUrl: "https://chatgpt.com/"` (same bare origin)

Because `conversationUrl` was the bare origin, the session-page recovery layer
(`resolveSessionPage`/`recoverSessionTab`) matched ANY chatgpt.com tab as
the session's tab -- including a generic home tab. The Work poll then read
that wrong page and never found completion evidence.

## Fixes applied

### Fix 1: Bounded URL transition wait in submitWorkPrompt

After commit evidence (user turn + running indicators), `submitWorkPrompt`
now polls up to 15 s (at 500 ms intervals) for `location.pathname` to
transition to `/c/<uuid>`. If the URL transitions, `taskUrl` and `taskId`
are captured from the final URL. If it never transitions within the bound,
the commit is still accepted (it was verified) but `taskUrl` and `taskId`
are stored as `null` with a `work-task-url-unresolved` warning -- the bare
origin is **never** stored.

Constants: `WORK_URL_TRANSITION_TIMEOUT_MS = 15_000`,
`WORK_URL_TRANSITION_POLL_MS = 500`.

### Fix 2: Session creation stores null, not bare origin

Both CLI `runWorkCommand` and MCP `web_ai_work_send` pass
`commitResult.taskUrl` directly as `originalUrl` and `conversationUrl`.
When `taskUrl` is null, `createSession` stores `null` for both fields.
This prevents recovery from matching a wrong tab.

Both callers also now store `responseContract: 'work'` directly on the
session record (in addition to `envelopeSummary.surface: 'work'`) and
propagate `commitResult.warnings` in the return.

### Fix 3: Work session tab recovery guards

**`recoverSessionTab`** (tab-recovery.mjs):
- Before recovery, checks `isRunningWork && isWorkSessionWithBareOrigin(session)`.
  If true, throws immediately -- cannot recover to the correct task tab.
- When the original tab is alive, checks `isWorkTabUrlConsistent(session, currentUrl)`.
  If the tab shows a bare-origin URL or a different `/c/<uuid>`, rejects it
  instead of accepting it as the session's tab.

**`resolveSessionPage`** (tab-recovery.mjs):
- Before navigating, checks `_isWorkSession(current) && current.status !== 'complete'
  && isWorkSessionWithBareOrigin(current)`. If true, returns `mismatch: true` with
  `provider.work-reattach-unverified` -- fail closed.
- Completed work sessions (`status === 'complete'`) are NOT blocked, allowing
  completed-task reopen by taskUrl (R07).

### Fix 4: Repair helper for legacy sessions

**`isBareOriginConversationUrl`** (chatgpt-work-picker.mjs):
- Detects work sessions with bare-origin conversationUrl (the broken shape from
  pre-fix submissions).

**`pollWorkSession`** bare-origin guard:
- After the existing targetId mismatch check, polls now also check
  `isBareOriginConversationUrl(session)`. If detected, throws
  `provider.work-reattach-unverified` with a diagnostic message instead
  of silently reading the wrong tab.

### New helpers (tab-recovery.mjs)

- `isBareOriginUrl(url)`: checks if a URL is just the origin with no path
- `isWorkTabUrlConsistent(session, tabUrl)`: verifies a tab's URL is consistent
  with the session's taskUrl; rejects bare-origin and cross-task URLs
- `isWorkSessionWithBareOrigin(session)`: detects work sessions with the
  broken bare-origin conversationUrl pattern

### Tab resolution preference order (04 section 6)

For **running** work sessions:
1. Stored targetId if alive AND URL matches taskUrl or is a /c/<uuid> page
2. Exact-match taskUrl among open tabs (via existing resolution)
3. **Never** rebind to a generic origin-URL tab -- fail closed with
   `provider.work-reattach-unverified`

For **completed** work sessions:
- Reopen by taskUrl is allowed (R07)
- Bare-origin guard does not block completed sessions

## Files changed

| File | Change |
|------|--------|
| web-ai/chatgpt-work-picker.mjs | +URL transition wait in submitWorkPrompt; +isBareOriginConversationUrl; +bare-origin guard in pollWorkSession; return type gains `warnings` field |
| web-ai/tab-recovery.mjs | +import isWorkSession; +isBareOriginUrl, isWorkTabUrlConsistent, isWorkSessionWithBareOrigin helpers; +work-session guards in recoverSessionTab and resolveSessionPage |
| web-ai/cli.mjs | +responseContract:'work' on session record; +warnings propagation in result |
| web-ai/mcp-server.mjs | +responseContract:'work' on session record; +warnings propagation in result |
| test/unit/web-ai-chatgpt-work-picker.test.mjs | +10 tests: URL transition (delayed, never, immediate), isBareOriginConversationUrl (6 cases), pollWorkSession bare-origin guard |
| test/unit/web-ai-tab-recovery.test.mjs | +20 tests: isBareOriginUrl (5), isWorkTabUrlConsistent (6), isWorkSessionWithBareOrigin (4), source-string guards (5) |

## Verification output

### Touched suites (76 tests, all pass)

```
$ npx vitest run test/unit/web-ai-chatgpt-work-picker.test.mjs test/unit/web-ai-tab-recovery.test.mjs

 RUN  v3.2.4 /Users/jun/Developer/new/700_projects/agbrowse

 Test Files  2 passed (2)
      Tests  76 passed (76)
   Start at  22:49:29
   Duration  18.97s
```

### Full suite (141 files, 1291 tests, all pass)

```
$ npm run test:unit

 Test Files  141 passed (141)
      Tests  1291 passed (1291)
   Start at  22:49:53
   Duration  69.28s
```

Baseline was 141 files / 1261 tests. Added 30 new tests (10 + 20).

## Judgement

PASS. All four fix items from the task spec are implemented and verified:

1. **URL-transition capture**: `submitWorkPrompt` waits up to 15 s for /c/<uuid>;
   tested with delayed-transition, never-transition, and immediate-transition cases.
2. **Session persistence**: null stored instead of bare origin; `responseContract`
   and `warnings` propagated.
3. **Recovery guards**: running work sessions fail closed on bare-origin or
   inconsistent-URL tabs; completed tasks can still reopen.
4. **Repair helper**: `pollWorkSession` detects and rejects the broken legacy shape.

Full test suite green with zero regressions.

## Deviations from plan

None. All four fix items implemented per the task spec.
