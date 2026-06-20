---
created: 2026-05-14
tags: [agbrowse, operational-weakness, web-ai]
---

# Operational Weakness Register

이 register는 "보안 취약점 목록"이 아니다. 실제 사용 중 결과를 놓치거나,
잘못된 claim을 만들 수 있는 작동 취약점만 다룬다.

## Status Legend

| Status | Meaning |
| --- | --- |
| Closed | 구현과 검증이 끝난 항목 |
| Watch | 현재 방어는 있지만 provider UI 변화에 영향을 받는 항목 |
| Open | 다음 안정성 upgrade 후보 |
| Deferred | 지금 release claim에서 제외한 항목 |

## Register

| ID | Status | Weakness | User-visible symptom | Current defense | Next upgrade |
| --- | --- | --- | --- | --- | --- |
| STAB-01 | Closed | ChatGPT Pro row selection could not prove which row was used | "Pro로 돌린 게 맞나?"를 나중에 세션에서 확인하기 어려움 | `modelSelection` is stored on the session and printed by `sessions show`; focused tests cover switched/already-selected cases | Add elapsed/token warning only when send to poll timing is wired cleanly |
| STAB-02 | Watch | ChatGPT generated-image DOM changes can hide real images from collection | 이미지가 화면에는 있는데 `--output-image` 저장이 실패함 | detector reads conversation-turn/data-turn assistant roots, follows estuary redirects, and fail-closes explicit output | Keep a short live smoke: normal question -> image -> normal question -> image |
| STAB-03 | Open | Browser or tab can close during long image generation/poll | command returns `tab-crashed` although provider work may have continued | session ids and conversation URL remain recoverable; `sessions resume` can re-poll when the tab is available | Add a documented retry recipe and a testable recovery envelope for page-close during image poll |
| STAB-04 | Watch | Attachment chip selectors drift with ChatGPT UI | upload appears accepted but send evidence is missing | upload waits for visible attachment evidence and sent-turn evidence where available; warnings surface missing sent evidence | Refresh fixture selectors when live smoke shows chip mismatch |
| STAB-05 | Watch | Project Sources live add depends on ChatGPT project page DOM | dry-run passes but live add may fail to attach/list source rows | explicit `--chatgpt-url`, real-file validation, dry-run, and upload evidence expression | Add a manual smoke recipe with a disposable project URL before claiming ready |
| STAB-06 | Deferred | Deep Research can run longer than normal poll/finalize assumptions | report may be partial or artifact warning may appear | marked experimental; report save uses structured artifact warnings and skips auto archive | Promote only after repeated live long-run smoke and report extraction fixtures |
| STAB-07 | Closed | Temporary Chat could be archived despite being intentionally non-durable | archive claim would be misleading or no-op | Temporary Chat URL check wins even when archive is forced | None unless ChatGPT changes temporary URL shape |
| STAB-08 | Closed | MCP `web_ai_*` accepted misspelled/unknown fields | agents could think a field worked when runtime ignored it | strict schema rejects unknown fields while preserving documented aliases | Keep deferred advanced surfaces documented in MCP descriptions |
| STAB-09 | Closed | MCP wait/resume bypassed session-bound recovery on long provider runs | `web_ai_wait_response` could time out before a long ChatGPT Pro response while CLI `poll --session` later recovered it; later timeout polls could downgrade completed sessions | MCP wait/resume uses session lock/recovery plus active-command ownership; provider timeouts are recoverable and completed sessions are monotonic | Add a future non-blocking MCP lease/cancel protocol only if host request timeout remains a practical blocker |

## Easy Read

- The risky parts are not "security tricks"; they are provider UI drift and
  long-running browser state.
- The newest Oracle parity gap, model evidence, is closed locally.
- The biggest open item is recovery UX when the browser closes mid-generation.
- MCP wait/resume now shares the stored-session recovery path, but MCP host
  request timeout remains a client/runtime boundary rather than a provider crash.
- Deep Research and Project Sources should stay beta/experimental until live
  smoke evidence is stronger.
