# 104 — Shared-Module + Vendor Divergences (agbrowse → cli-jaw)

Date: 2026-06-25 · Parent: [100](100_agbrowse_to_clijaw_overview.md) · **Convergence Pass 1**
Source: agbrowse `web-ai/*.mjs` + `skills/browser/` · Target: cli-jaw `src/browser/web-ai/*.ts`

Pass 1 line-diffed SHARED modules (the initial analysis only spot-checked them and wrongly concluded "agbrowse is a clean superset with no portable detail"). These are agbrowse behaviors cli-jaw **lacks**, found by line-level comparison. All 100-direction (port agbrowse→cli-jaw).

## Session / locking

| # | Gap | agbrowse file:symbol | cli-jaw status | Pri |
| --- | --- | --- | --- | --- |
| 104.1 | Command lock w/ **TTL + heartbeat + PID-liveness** staleness (`process.kill(pid,0)`) | `session-store.mjs:withSessionCommandLock`/`isSessionCommandLockStale`/`commandLockMetadata` | `session-store.ts:isStaleLock` (acquiredAt-only, no heartbeat/pid) | P1 |
| 104.2 | `isSessionActive` **deadline-aware** (excludes expired `deadlineAt`) + `readSessionCommandLock` export | `session-store.mjs:isSessionActive`, `readSessionCommandLock` | absent (inlines `active.has(status)`) | P1 |
| 104.3 | **Watcher cross-process FS lock** (mkdir lockdir + heartbeat + PID staleness → `watcher.already-running`) | `watcher.mjs:acquireWatcherSessionLock` | `watcher.ts:activeWatchers` (in-process Map only) | P1 |
| 104.4 | **Chrome profile heartbeat lock** (cross-process acquire, not just stale-detect) | `skills/browser/profile-lock.mjs:acquireProfileLock`/`updateHeartbeat` | read-only `runtime-diagnostics.ts:'stale-singleton-lock'` (detect only) | P2 |

## Model selection

| # | Gap | agbrowse file:symbol | cli-jaw status | Pri |
| --- | --- | --- | --- | --- |
| 104.5 | Structured **`modelSelection` evidence** (requested/resolved/normalized/strategy/status/verified/source) + `send` persists to session | `chatgpt-model.mjs:createModelSelectionEvidence`; `chatgpt.mjs:sendWebAi` `updateSession({modelSelection})` | `selectChatGptModel` returns no evidence; `send` persists none | P1 |
| 104.6 | **Korean-locale** model menu detect/normalize (`즉시/중간/높음/매우 높음/Pro 확장/지능`; Unicode `\p{L}\p{N}`) | `chatgpt-model.mjs:modelChoiceFromText`/`isModelMenuOpen`/`normalizeModelPickerText` | English-only regex + ASCII strip | P1 |
| 104.7 | Legacy **GPT-5.x-Pro row rejection** (`isLegacyProModelLabel` normalized `gpt 5 pro`) | `chatgpt-model.mjs:modelChoiceFromText`/`isLegacyProModelLabel` | narrower/divergent `isLegacyProModelLabel` | P2 |
| 104.8 | Per-vendor **runtime capability-probe arrays** (active-tab/composer/model-alias/upload/copy/streaming → `{state,evidence,next}`) | `gemini-live.mjs:geminiCapabilities`, `grok-live.mjs:grokCapabilities` + `capability.mjs:defineCapability/runCapabilities` | hand-rolled single status, no probe array (distinct from the **declarative** registry in [201](201_webai_capability_registry_and_tools.md)) | P1 |
| 104.9 | Gemini/Grok **model capability probe** (`{state,evidence,next}` + fallback ladder) | `gemini-model.mjs:geminiModelCapabilityProbe`, `grok-model.mjs:grokModelCapabilityProbe` | imperative `selectGeminiModel`/`selectGrokModel`, no probe | P1 |

## Code-mode / composer / attachments / errors

| # | Gap | agbrowse file:symbol | cli-jaw status | Pri |
| --- | --- | --- | --- | --- |
| 104.10 | `code-extract` **navigates to conversation URL** before retrieval (origin+convo-id compare, `code-extract.navigation-failed`) | `code-mode.mjs:extractCodeArtifacts`/`shouldNavigateForExtraction`/`resolveConversationUrl` | retrieves against active tab (no nav) | P1 |
| 104.11 | Zip scan in **chronological turn order** + skips user/`content_type:'code'` messages | `code-artifact.mjs:scanConversationForZip`/`orderedConversationMessages`/`extractZipPathsFromMessage` | unordered `Object.values(mapping)`, scans all | P1 |
| 104.12 | Composer accepts **resolver-verified send/composer targets** (`clickResolvedSendButton` force-retry) + configurable `sendButtonTimeoutMs` | `chatgpt-composer.mjs:submitPromptFromComposer`/`clickResolvedSendButton`/`findComposerCandidate` | no options; self-heal-resolved target path dead | P1 |
| 104.13 | Attachment readiness verifies **specific expected filenames** in chips (not count-only) | `chatgpt-attachments.mjs:buildAttachmentReadyExpression`/`waitForAttachmentAcceptedLive` | chip-COUNT only (can false-confirm wrong file) | P1 |
| 104.14 | Composer **CDP `Input.insertText`** path for large prompts | `chatgpt-composer.mjs:insertTextLikeProvider` (`getCdpSession`) | `insertText`/keyboard only | P2 |
| 104.15 | `wrapError` preserves `errorCode`/stage/retryHint/evidence from a plain error-like object + `traceId`/`ruleId` fields | `errors.mjs:wrapError` | jumps to `internal.unhandled` fallback | P2 |
| 104.16 | Typed `code-mode.vendor-unsupported` WebAiError (vs plain Error); `downloadAndSaveZip` write-guard → `code-artifact:write-failed` | `code-mode.mjs`, `code-artifact.mjs:downloadAndSaveZip` | plain `Error` / unguarded `writeFile` | P2 |
| 104.17 | Copy-markdown **scroll-jump suppression** (patches `scrollIntoView`→noop, `focus`→`preventScroll`) | `copy-markdown.mjs:captureCopiedResponseText` | none | P2 |
| 104.18 | `pollWebAi` **per-tick** `conversation-mismatch` (convo-id drift) + `tab-crashed` (recoverable) guards | `chatgpt.mjs:pollWebAi` (+`buildTargetMismatchResult`) | one-shot `assertSameTarget`, no per-tick drift/crash result | P2 |

## Notes
- **104.13 multi-file batch** (agbrowse `attachLocalFilesLive`): 00_plan listed multi-file as OOS (PRD32.7 Phase B), but agbrowse has since shipped it — reclassify as a real P2 gap.
- The vendor probe arrays (104.8/104.9) are **runtime/live** behaviors, distinct from cli-jaw's **declarative** capability-registry ([201](201_webai_capability_registry_and_tools.md)) — both directions have a piece the other lacks here.
- `action-*`/`ref-registry`/`ax-snapshot`/`observation-bundle`/`session-target-guard`/`self-heal`/`source-audit`/`contract-audit`/`dom-hash` confirmed at **behavioral parity** (TS type-export bloat only) — no gap.
