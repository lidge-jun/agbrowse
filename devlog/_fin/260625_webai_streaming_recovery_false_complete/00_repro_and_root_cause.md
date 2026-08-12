---
created: 2026-06-25
status: planning
tags: [agbrowse, web-ai, chatgpt, watcher, polling, false-complete]
---
# Web-AI Streaming Recovery False Complete

## Incident

During a long ChatGPT Pro Extended review run, `agbrowse web-ai watch` exited
successfully and `cli-jaw bgtask` reported completion while the live ChatGPT DOM
still exposed `Stop answering`.

The returned answer was not the final report. It was only the last visible
fragment of a still-running assistant response.

Session:

```text
sessionId: 01KVYG4BZ2E5CFTF16RQ8KWVGD
conversationUrl: https://chatgpt.com/c/6a3cac9c-3714-83ee-aa44-4d68cb81de24
```

Observed bad poll result:

```json
{
  "ok": true,
  "status": "complete",
  "answerText": "Public dev cross-checks confirm the SSRF/Camoufox issues are not just ZIP artifacts. Test failures mostly reflect packaging gaps, while final weighting is shifting toward conditional local-only beta rather than unrestricted public approval.",
  "warnings": ["response-recovered-after-timeout"],
  "responseStableMs": 0,
  "answerArtifact": {
    "capturedBy": "dom-fallback",
    "exactnessScore": 0.75,
    "responseStableMs": 0
  }
}
```

Live DOM at the same time:

```text
button "Stop answering"
```

## Root Cause

Primary bug is in `agbrowse`, not `cli-jaw bgtask`.

`cli-jaw bgtask` ran `agbrowse web-ai watch ... --json` as a generic child
command. The child exited 0 after `agbrowse` emitted `watch.complete`, so the
generic runner correctly marked the background task complete.

The false terminal signal came from `agbrowse web-ai poll/watch`.

## Failure Chain

1. `pollWebAi()` times out while ChatGPT is still streaming.
2. The timeout recovery path calls `recoverAssistantResponse()`.
3. `recoverAssistantResponse()` reads any latest assistant DOM text after the
   baseline and returns it as recovered text.
4. The recovery branch finalizes the provider tab and returns `status:
   "complete"` without re-checking `isStreaming(page)`.
5. `watchSessionOnce()` trusts the poll result/session status and emits
   `watch.complete`.
6. `cli-jaw bgtask` sees child exit 0 and reports completion.

## DOM Fragment Problem

ChatGPT's current DOM can expose nested assistant nodes for one visible answer.
In the incident, this direct DOM probe returned:

```json
[
  {
    "i": 0,
    "len": 774,
    "text": "I’ll first inspect the ZIP’s GPT_PRO_REQUEST.md plus source/devlog/git metadata..."
  },
  {
    "i": 1,
    "len": 230,
    "text": "I’ll first inspect the ZIP’s GPT_PRO_REQUEST.md plus source/devlog/git metadata..."
  },
  {
    "i": 2,
    "len": 273,
    "text": "The attached evidence shows /search is a routing/prompt workflow..."
  },
  {
    "i": 3,
    "len": 240,
    "text": "Public dev cross-checks confirm the SSRF/Camoufox issues..."
  }
]
```

`i=0` is the broader assistant block. `i=1..3` are nested/fragment nodes.

Current `readAssistantMessages()` returns the first selector's whole text list
without removing nested descendants. The poll/recovery logic then uses the last
array entry, so it can treat the last paragraph fragment as the latest assistant
answer.

## Affected Files

```text
web-ai/chatgpt.mjs
web-ai/chatgpt-response-observer.mjs
web-ai/watcher.mjs
test/unit/web-ai-chatgpt-response-observer.test.mjs
test/unit/web-ai-watcher.test.mjs
```

This is a direct corrective follow-up to the 33.3 recovery path shipped from:

```text
devlog/_fin/260608_oracle_stability_gap/33_response_capture_dualpath_pabcd.md
```

That plan introduced recovery but did not require a streaming/stop-button gate
before terminal completion.

Potential integration reference:

```text
devlog/_fin/260619_watch_notification_gaps/01_root_cause.md
devlog/_fin/260619_watch_notification_gaps/10_solution_plan.md
```

## Evidence Index

```text
web-ai/chatgpt.mjs:548-572
  Timeout recovery calls recoverAssistantResponse(), finalizes, and returns
  status:"complete" with responseStableMs:0.

web-ai/chatgpt.mjs:985-1006
  readAssistantMessages() returns every matched assistant DOM node with no
  descendant de-duplication, including fallback locator path.

web-ai/chatgpt-response-observer.mjs:85-102
  recoverAssistantResponse() hardcodes assistant selectors, slices raw matched
  nodes, selects the last text, and returns no streaming/finished metadata.

web-ai/watcher.mjs:155-161
  Existing terminal session statuses short-circuit to terminal without live DOM
  re-check.

web-ai/watcher.mjs:218-250
  watchSessionOnce() trusts poll/session status for terminal classification.

web-ai/watcher.mjs:467-469
  appendUniqueWarning() is currently local to watcher.mjs.

web-ai/tab-finalizer.mjs:66-72
  finalizeProviderTab() writes status:"complete" to the session.
```

## Non-Goals

- Do not make `cli-jaw bgtask` responsible for inspecting ChatGPT DOM.
- Do not trust CDP/network events as authoritative completion.
- Do not disable timeout recovery entirely; make it safe.
- Do not add broad provider-specific hacks without fixture coverage.
