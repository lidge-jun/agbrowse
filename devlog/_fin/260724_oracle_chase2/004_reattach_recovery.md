# 004 — Reattach and Recovery Parity (T5 + T6 + T7)

Date: 2026-07-24
Status: Research complete
Upstream: `/tmp/oracle-chase-260724` (`steipete/oracle`)
Local: `/Users/jun/Developer/new/700_projects/agbrowse`
Scope: Deep Research wrapper recovery, durable conversation-URL gating, and recoverable CDP disconnects

## Upstream mechanisms

### T5 — Deep Research tool-call wrapper reattach recovery

A **wrapper capture** is not the Deep Research report. It is the assistant capture left by ChatGPT's Deep Research App connector, beginning with a localized tool marker such as `Called tool` or `Used tool`, followed by wrapper structure such as `Deep Research App`, `Call tool`, `Request {`, `Response {`, or `session_id`. Oracle treats the one-line marker as a placeholder only when usage is absent or at most eight output tokens; a multiline value must mention `deep research app` and satisfy at least two structural signals (`src/cli/sessionDisplay.ts:66-94`, commits `e7526efa`, `ccd582bc`). This constraint avoids classifying a real report that merely starts with tool-related prose as recoverable.

For a browser Deep Research session, that placeholder changes display/session handling from replaying the stale capture to reattaching to the existing Chrome conversation and harvesting the OOPIF-backed report. A recovered capture is not re-flagged: Oracle recognizes an explicit `[reattach] ... Answer:` section (`src/cli/sessionDisplay.ts:96-106`, commit `9851d608`, tightened by `ccd582bc`), and `trimBeforeFirstAnswer` only skips the first capture when a structurally valid wrapper occurs before the reattach marker and a later answer (`src/cli/sessionDisplay.ts:721-735`). Reattach therefore depends on Deep Research browser metadata, a structurally recognized placeholder, no prior recovered answer, and an otherwise reattachable retained browser/session.

### T6 — durable conversation-URL gating

Oracle defines a durable URL as one whose **path** contains `/c/<id>` where `<id>` consists of letters, digits, or hyphens and is immediately followed by `/`, `?`, `#`, or end-of-input (`src/browser/conversationUrl.ts:1-16`, commit `2157ab73`). A normal persisted route such as `/c/abc-123` is durable. `/c/WEB:<request-id>` is transient: it is a client-created route exposed briefly before ChatGPT assigns the persisted conversation URL, and the colon prevents the required boundary match. Root/project pages are not conversation URLs.

The URL monitor polls until that stable predicate succeeds before persisting (`src/browser/conversationUrlMonitor.ts:27-49`). Reattach also requires HTTPS, no explicit port, an allowed ChatGPT hostname, and the stable predicate applied to `url.pathname` (`src/browser/reattachability.ts:10-24`, commits `aa4e0f75`, `7936b6e5`). Applying it to the pathname is material: strings such as `?next=/c/abc` or `#/c/abc` are non-path hints and cannot authorize reattach.

### T7 — recoverable CDP disconnect answer recovery

Oracle does not equate every CDP client disconnect with a closed Chrome. After disconnect it probes the DevTools endpoint and, when a target id is available, the target list (`src/browser/cdpLiveness.ts:12-68`, commit `28c584db`). Recovery is allowed when the endpoint and requested target are confirmed alive, or when only an endpoint check was requested and it succeeds. It is rejected when the endpoint is unavailable, the target is confirmed missing, or target-list inspection fails for a requested id; the last case deliberately fails closed (`src/browser/cdpLiveness.ts:71-86`).

The browser error records `stage=connection-lost`, the liveness classification, disconnect cause, target/runtime identity, and the best matched URL. The session stays running/incomplete. Only `recoverableDisconnect=true` enters the existing auto-reattach path; without configured periodic reattach Oracle makes one bounded attempt, while a configured interval can continue under the existing timeout/hard cap (`src/cli/sessionRunner.ts:585-638`). That resume reopens the retained conversation/target and harvests the completed answer. Closed-Chrome and unverified-target cases keep guidance/state but skip futile automatic recovery.

## agbrowse current state

### T5 local capture and resume

agbrowse does not serialize Oracle-style CLI `Answer:` logs, so the exact display-layer re-flag/suppression mechanism is not applicable. It does, however, encounter the same UI payload class. Deep Research reads the latest assistant text, then scans research child frames and prefers a completed assistant read over a completed frame (`web-ai/chatgpt-deep-research.mjs:166-206`; `web-ai/chatgpt-deep-research-report.mjs:48-72`). `sessions resume` rebinds the saved session and invokes the Deep Research capture path without sending a prompt (`web-ai/cli-sessions.mjs:93-111`; `web-ai/chatgpt-deep-research.mjs:392-444`).

There is no `Called tool` / `Deep Research App` structural rejection in the report classifier. Its only generic defenses are a 120-character minimum and planning/progress first-line markers (`web-ai/chatgpt-deep-research-report.mjs:8-22,34-45`). A long wrapper can therefore be marked `completed:true` at the preferred assistant source before a valid frame report is considered (`web-ai/chatgpt-deep-research-report.mjs:63-67`). The Oracle CLI-display hook is not portable, but wrapper recognition belongs in agbrowse's report-selection layer.

### T6 local persistence and recovery gates

agbrowse has a strong intended later-session gate: `openConversationInNewTab` calls `isSafeChatGptConversationUrl` before creating a tab and closes mismatches (`web-ai/tab-recovery.mjs:325-380`). Navigation-based recovery also rejects unsafe ChatGPT targets (`web-ai/tab-recovery.mjs:520-540`), and running Work sessions separately reject bare origins (`web-ai/tab-recovery.mjs:35-45,221-285`). Query/fragment-only hints do not pass because the regex is applied to `URL.pathname` (`web-ai/tab-recovery.mjs:337-345`).

The durable-id check is nevertheless incomplete. `/\/c\/[A-Za-z0-9_-]+/` is not segment-bounded, so `https://chatgpt.com/c/WEB:request-id` partially matches `/c/WEB` and is accepted (`web-ai/tab-recovery.mjs:334-345`). Persistence is also ungated:

- session creation falls back from `conversationUrl` to `originalUrl`, including a provider root (`web-ai/session.mjs:184-216`);
- recovery persists any preferred current provider URL or final provider URL (`web-ai/tab-recovery.mjs:67-82,95-120,472-475,536-540`);
- normal ChatGPT send persists `page.url()` immediately after prompt commit (`web-ai/chatgpt.mjs:419-443`);
- Deep Research success/failure paths repeatedly persist `page.url()` without a durable check (`web-ai/chatgpt-deep-research.mjs:308-339,425-439`).

Therefore a transient `/c/WEB:...` or another non-durable provider path can overwrite `conversationUrl`, survive in the generic store (which performs no field validation; `web-ai/session-store.mjs:331-344`), and later poison recovery. The fresh-tab guard blocks roots/foreign URLs but currently fails to block the transient route.

### T7 local disconnect handling

The shared tab manager drops a cached Playwright connection on `browser.disconnected`; the next lookup reconnects via `connectOverCDP` (`skills/browser/tab-manager.mjs:103-115`). `withSessionPage` catches selected page-death errors and retries once through forced session recovery (`web-ai/tab-recovery.mjs:210-219,570-590`). Target existence is checked through the target list (`skills/browser/tab-manager.mjs:390-401`), and a dead original target can be replaced by a new tab at the stored URL (`web-ai/tab-recovery.mjs:95-130`). These are useful lower-level recovery primitives.

They do not provide Oracle's disconnect contract. The page-death matcher covers `target closed`, `page closed`, browser closed, and crash, but not generic WebSocket/CDP client-disconnect wording (`web-ai/tab-recovery.mjs:210-219`). There is no explicit endpoint-plus-target liveness probe, no recoverable/non-recoverable classification, no fail-closed handling for target-list uncertainty, and no watcher-level transition that preserves an in-flight session then performs a bounded automatic answer harvest. `ensureWatcherAttached` only checks URL compatibility/navigation once it already has a working page (`web-ai/watcher.mjs:480-506`). A transient Playwright socket loss can thus either escape the retry classifier or be conflated with target death; conversely force recovery may create a new tab without first proving Chrome and the original target state.

## Classification

| Theme | Mechanism | Classification | Priority | agbrowse evidence | Concrete change needed |
| --- | --- | --- | --- | --- | --- |
| T5 | Reject Deep Research App tool-call wrappers and recover the real report on resume/reattach | **Gap** | P2 | `web-ai/chatgpt-deep-research.mjs:166-206,392-444`; `web-ai/chatgpt-deep-research-report.mjs:8-22,34-72` | Add constrained wrapper-placeholder recognition to report selection (localized leading marker + Deep Research App structural signals), mark it incomplete, and prefer/wait for the completed frame or later assistant report. Oracle's CLI log `[reattach] Answer:` suppression itself is not applicable. |
| T6 | Persist and reattach only with durable, path-derived ChatGPT conversation URLs | **Gap** | P1 | `web-ai/tab-recovery.mjs:67-82,95-120,334-345,472-475,520-540`; `web-ai/session.mjs:184-216`; `web-ai/chatgpt.mjs:419-443`; `web-ai/session-store.mjs:331-344` | Introduce one canonical stable-conversation parser with a segment boundary, reject `/c/WEB:...`, apply it to `URL.pathname`, and gate every ChatGPT `conversationUrl` update. Preserve the last durable URL while a root/transient URL is visible. |
| T7 | Classify recoverable CDP client disconnects and perform bounded automatic answer recovery | **Gap** | P1 | `skills/browser/tab-manager.mjs:103-115,390-401`; `web-ai/tab-recovery.mjs:210-219,570-590`; `web-ai/watcher.mjs:188-204,480-506` | Probe DevTools endpoint plus saved target after disconnect, fail closed on unverified/missing targets, classify socket loss separately from Chrome closure, preserve running session state, and run one bounded reattach/harvest attempt (or configured retries) only when liveness is proven. |

## Proposed gap rows

- `G-R3-T5-01 | Deep Research wrapper-placeholder rejection before report selection | Gap | web-ai/chatgpt-deep-research-report.mjs | long Called tool / Deep Research App wrappers are not incomplete markers and can win as completed target reads at lines 66-67`
- `G-R3-T6-01 | canonical durable ChatGPT conversation URL parser and persistence gate | Gap | web-ai/tab-recovery.mjs, web-ai/session.mjs, web-ai/chatgpt.mjs, web-ai/chatgpt-deep-research.mjs | isSafeChatGptConversationUrl partially accepts /c/WEB:... at tab-recovery.mjs:334-345 while update sites persist provider/page URLs without durability checks`
- `G-R3-T7-01 | recoverable CDP disconnect liveness classification and bounded harvest | Gap | skills/browser/tab-manager.mjs, web-ai/tab-recovery.mjs, web-ai/watcher.mjs | cached reconnect and page-death retry exist, but no endpoint+target proof or watcher-level recoverable-disconnect flow`
