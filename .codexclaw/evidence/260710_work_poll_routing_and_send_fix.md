# Work poll routing + send commit verification fix

Date: 2026-07-10 KST
Worker: J (leaf agent)
Branch: dev

## Bug 1: Poll routing gap

**Symptom**: `web-ai poll --session <id>` on a Work session (responseContract:'work')
routed to Chat `pollWebAi` (chatgpt.mjs), which watches Chat DOM baselines and
times out. It never called `readWorkTaskState`.

**Root cause**: Four entry points (`runBoundCommand` in cli.mjs, `resume` in
cli-sessions.mjs, `runMcpSessionPoll` in mcp-server.mjs, `callVendorPoll` in
watcher.mjs) all dispatched poll by vendor only (chatgpt/gemini/grok), with no
check for `responseContract` or `surface`.

**Fix**: Added `isWorkSession(session)` predicate (checks `responseContract === 'work'`
or `envelopeSummary.surface === 'work'`). All four entry points now check
`isWorkSession` first and route to `pollWorkSession` which loops `readWorkTaskState`
with the correct running/complete/unknown state machine per 04 section 5.

## Bug 2: Work send false positive

**Symptom**: `work send` returned `status: work-sent` but the page still showed
the prompt in the composer with no committed user turn. A stray "ㅇ" character was
appended to the composer text.

**Root cause**: The send path used `submitPromptFromComposer` from chatgpt-composer.mjs
which (a) searches for send buttons globally with fallback to `document`, potentially
clicking the wrong element, and (b) falls back to `page.keyboard.press('Enter')` when
the button click fails. On a ProseMirror contenteditable with Korean IME, pressing
Enter can produce composition characters. The session was created immediately after
the click attempt with no commit verification.

**Fix**: Added `submitWorkPrompt(page, prompt, opts)` which:
1. Clicks `form button[data-testid="send-button"]` scoped to the Work composer form
2. NEVER falls back to keyboard Enter
3. Waits for commit evidence per WP1 R03: conversation turn visible + running
   indicators (Thinking text or Stop button)
4. Captures taskUrl/taskId from URL transition to `/c/<uuid>`
5. Throws `provider.work-submit-unverified` if evidence doesn't appear within timeout
6. Session is created ONLY after commit is verified

Both `runWorkCommand` (cli.mjs) and `web_ai_work_send` (mcp-server.mjs) now use
`submitWorkPrompt`.

## Files changed

| File | Change |
|------|--------|
| web-ai/chatgpt-work-picker.mjs | +isWorkSession, +submitWorkPrompt, +pollWorkSession (269 lines added) |
| web-ai/cli.mjs | runBoundCommand routes work->pollWorkSession; runWorkCommand uses submitWorkPrompt |
| web-ai/cli-sessions.mjs | resume routes work sessions to pollWorkSession |
| web-ai/mcp-server.mjs | runMcpSessionPoll routes work; web_ai_work_send uses submitWorkPrompt |
| web-ai/watcher.mjs | callVendorPoll routes work sessions to pollWorkSession |
| test/unit/web-ai-chatgpt-work-picker.test.mjs | +17 tests (isWorkSession, pollWorkSession, submitWorkPrompt) |
| test/unit/web-ai-sessions-command.test.mjs | +8 source-string contract tests for routing wiring |

## Routing decision (code path)

```
poll/resume/watch --session <id>
  -> load session from store
  -> isWorkSession(session)?
     YES -> pollWorkSession(deps, input)
            -> readWorkTaskState(page) loop
            -> running: heartbeat, keep polling until deadline
            -> complete: updateSession, return answer artifact
            -> unknown: throw provider.work-state-unknown (fail closed)
            -> target mismatch: throw provider.work-reattach-unverified
     NO  -> existing vendor dispatch (pollWebAi/geminiPollWebAi/grokPollWebAi)
```

## Deviations from 04

None. Implementation follows:
- 04 section 5: running/complete/unknown state machine, fail-closed on unknown,
  never return complete on initial acknowledgement
- 04 section 6: session stores surface/taskId/taskUrl/responseContract, running
  target loss -> provider.work-reattach-unverified, completed-task reattach by
  taskUrl allowed per R07
- URL-never-discriminates-surface rule preserved (isWorkSession checks stored
  session fields, not URL patterns)

## Test output

### Touched suites (65 tests, all pass)

```
npx vitest run test/unit/web-ai-chatgpt-work-picker.test.mjs test/unit/web-ai-sessions-command.test.mjs

 Test Files  2 passed (2)
      Tests  65 passed (65)
   Duration  2.20s
```

### Full suite (141 files, 1261 tests, all pass)

```
npm run test:unit

 Test Files  141 passed (141)
      Tests  1261 passed (1261)
   Duration  55.80s
```

Baseline was 141 files / 1237 tests. Added 24 new tests (17 + 8 - 1 overlap = 24).

## Judgement

PASS. Both bugs are fixed end-to-end:
- Poll routing: all 4 entry points (cli poll, cli-sessions resume, mcp wait/resume,
  watcher tick) now route work sessions to pollWorkSession
- Send verification: submitWorkPrompt enforces button-only click + commit evidence
  before session creation; false-positive case tested and throws
- Full test suite green with no regressions
