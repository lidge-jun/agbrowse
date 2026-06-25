---
created: 2026-06-25
status: build-verification
tags: [agbrowse, web-ai, chatgpt, smoke]
---
# Smoke Notes

## Automated Evidence

Targeted unit gate passed:

```bash
npx vitest run test/unit/web-ai-chatgpt-response-observer.test.mjs test/unit/web-ai-chatgpt-response-fragments.test.mjs test/unit/web-ai-watcher.test.mjs test/unit/web-ai-provider-session.test.mjs --reporter=verbose
```

Result:

```text
Test Files  4 passed (4)
Tests  54 passed (54)
```

Regression gate passed:

```bash
npx vitest run test/unit/web-ai-provider-session.test.mjs test/unit/chatgpt-attachments.test.mjs test/unit/web-ai-navigation-ready.test.mjs --reporter=verbose
```

Result:

```text
Test Files  3 passed (3)
Tests  40 passed (40)
```

Release structure gate passed:

```bash
npm run test:release-gates
```

Result:

```text
All structure drift checks passed (144).
All structure count checks passed (62).
```

Whitespace check passed:

```bash
git diff --check
```

Result: no output.

## Live Evidence

Live ChatGPT smoke used the local worktree command:

```bash
node bin/agbrowse.mjs web-ai send --vendor chatgpt --url https://chatgpt.com/ --inline-only --new-tab --prompt "..."
```

Primary live session:

```text
sessionId: 01KVYK7NR5D21EBAFD5MFM7GVA
conversationUrl: https://chatgpt.com/c/6a3cb94e-f428-83ee-a333-c8179e1d8e47
```

Streaming-phase check:

```text
02_poll_while_stop_visible_long.json
  status: timeout
  recoverable: true
  retryHint: poll-or-resume

03_watch_while_stop_visible_long.json
  status: watch-once
  terminal: false
```

Both commands printed a live poll heartbeat:

```text
[poll] 0s - streaming...
```

Completion check:

```text
04_final_poll_complete.json
  status: complete
  answer length: 7545
  responseStableMs: 1641
```

The long streaming smoke session was stopped after collecting non-terminal
poll/watch evidence:

```text
06_stop_long.json
  status: blocked
  warning: sent Escape to stop generation
```

Artifacts:

```text
01_streaming_dom_snapshot.json
01_session_after_streaming_poll.json
02_poll_while_stop_visible.json
02_poll_while_stop_visible_long.json
03_watch_while_stop_visible.json
03_watch_while_stop_visible_long.json
04_final_poll_complete.json
06_stop_long.json
```
