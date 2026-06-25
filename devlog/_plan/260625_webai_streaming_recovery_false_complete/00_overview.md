---
created: 2026-06-25
status: planning
tags: [agbrowse, web-ai, chatgpt, pabcd]
---
# Overview

## Goal

Fix a false-complete bug in ChatGPT web-ai polling/watching where `agbrowse`
can return `status:"complete"` while the live ChatGPT DOM still shows `Stop
answering`.

## Scope Lock

In scope:

- ChatGPT assistant-turn extraction in `web-ai/chatgpt.mjs`.
- Timeout recovery finality checks in `web-ai/chatgpt.mjs` and
  `web-ai/chatgpt-response-observer.mjs`.
- Watcher defensive handling in `web-ai/watcher.mjs`.
- Unit tests for nested assistant fragments, recovery finality, and watcher
  complete-plus-streaming deferral.
- Live smoke evidence under
  `devlog/_smoke/260625_webai_streaming_recovery_false_complete/`.

Out of scope:

- Moving DOM finality checks into `cli-jaw bgtask`.
- Changing generic `cli-jaw bgtask --cmd` exit semantics.
- Fixing ChatGPT `--web-search` composer-tool selection failure. That is a
  separate composer-tools patch.
- Replacing polling with CDP/network events as completion truth.

## Locked Decisions

1. Completion truth stays in provider pollers. Watcher can only add a defensive
   downgrade if it sees an impossible `complete` plus streaming state.
2. Timeout recovery must not call `finalizeProviderTab()` while a streaming
   indicator is visible.
3. Recovery may complete only when `streaming === false` and either a finished
   action surface is visible or a bounded re-read stability loop proves a
   non-zero stable window.
4. Nested assistant DOM nodes must be de-duplicated by top-level matched node,
   and the same extraction rule must apply to poll, recovery, and fallback.
5. `response-recovered-after-timeout` can remain as a warning for transparency
   when recovery succeeds, but it must never accompany `responseStableMs: 0` on
   a terminal result.
6. Live proof is required because the incident depends on real ChatGPT DOM
   nesting and stop-button behavior.

## P-Approval Checklist

- [x] Root cause documented with current line evidence.
- [x] Primary agbrowse bug separated from cli-jaw bgtask integration gap.
- [x] Patch plan names concrete files and functions.
- [x] Open design questions resolved into locked decisions.
- [x] Verification matrix includes unit and live proof.
- [x] Implementation remains scoped to web-ai poll/watch surfaces.

## Relationship To Prior Plans

This is a corrective follow-up to the implemented 33.3 recovery path in:

```text
devlog/_fin/260608_oracle_stability_gap/33_response_capture_dualpath_pabcd.md
```

That plan added timeout recovery, but the shipped recovery path did not include
a streaming/stop-button finality gate. This patch closes that regression rather
than adding a new feature surface.
