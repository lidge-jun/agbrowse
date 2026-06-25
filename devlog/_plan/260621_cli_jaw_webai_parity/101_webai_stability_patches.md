# 101 — Web-AI Stability Patches (agbrowse → cli-jaw)

Date: 2026-06-25 · Parent: [100](100_agbrowse_to_clijaw_overview.md)
Source: agbrowse `web-ai/*.mjs` (v0.1.16-preview) · Target: cli-jaw `src/browser/web-ai/*.ts`

The Oracle stability-gap backlog (devlog `_fin/260608_oracle_stability_gap/` specs 31–35) shipped in agbrowse and is **not yet mirrored** in cli-jaw. Verified by grepping the cli-jaw `.ts` side.

## Port backlog

| # | Feature | agbrowse file:symbol | cli-jaw status | cli-jaw file | Pri |
| --- | --- | --- | --- | --- | --- |
| 7 | **Session-artifact registry** `kind:'file'` + `kind:'diagnostics'` (+ image/report/transcript) save helpers | `session-artifacts.mjs`: `saveFileArtifact`/`trySaveFileArtifact`, `saveDiagnosticsArtifact`/`trySaveDiagnosticsArtifact`, `resolveArtifactsDir` | **ABSENT** | missing (only in-memory `answer-artifact.ts`/`code-artifact.ts`) | **P0** |
| 1 | **Generic downloadable-file capture** | `chatgpt-files.mjs`: `normalizeChatGptFileDownloadUrl`, `normalizeChatGptSandboxUrl`, `readAssistantDownloadableFiles`, `saveAssistantDownloadableFiles` (URL allowlist + DOM scan + sequential download w/ timeout attribution) | **ABSENT** | missing | **P0** |
| 2 | **Dual-path capture**: MutationObserver early-wake + 3rd-tier recovery | `chatgpt-response-observer.mjs` (`buildResponseObserverExpression`/`observeAssistantResponse`/`recoverAssistantResponse`) + `chatgpt-response-dom.mjs` (`readTopLevelAssistantTexts`) | **ABSENT** (poll-only) | `chatgpt-response.ts` | **P0** |
| 4 | **Deep-research target-scope** capture + report selection + resume + not-started | `chatgpt-deep-research.mjs`: `extractResearchReport` (target+frame), `resumeDeepResearch`, `deep-research-not-started`; `chatgpt-deep-research-report.mjs`: `chooseDeepResearchReportRead`, `isIncompleteDeepResearchText` | **BEHIND** (private first-hit `extractResearchReport`, no completeness/arbitration/resume) | `chatgpt-deep-research.ts` | **P1** |
| 5 | **New-tab reattach recovery** | `tab-recovery.mjs`: `isSafeChatGptConversationUrl`, `openConversationInNewTab` | **BEHIND** (same-tab `page.goto` only) | `cli-sessions.ts` | **P1** |
| 6 | **Model-pill mount-wait + bounded retry** | `chatgpt-model.mjs`: `waitForModelPillEvidence`, `MODEL_SELECT_MAX_ATTEMPTS=3` | **BEHIND** (flat 8s deadline, unbounded selector loop) | `chatgpt-model.ts` | **P1** |
| 8 | **Resume `researchMode:'deep'` routing + new-tab reattach** | `cli-sessions.mjs` (`researchMode === 'deep'` → `resumeDeepResearch`; reattach → `openConversationInNewTab`) | **BEHIND** (no deep branch, no new-tab path) | `cli-sessions.ts` | **P1** (deps #4,#5) |
| 3 | **Failure-time DOM+screenshot artifact** | `failure-diagnostics.mjs`: `captureFailureDiagnostics`, `readConversationSnapshot`, `diagnosticsEnabled` → `kind:'diagnostics'` | **BEHIND** (cli-jaw `diagnostics.ts` is a redacted error *envelope*, not a saved DOM/screenshot artifact) | `diagnostics.ts` | **P1** (dep #7) |
| 9 | **Streaming false-complete fix + watcher streaming-recovery** (cff76ed, 2026-06-25 — landed during the parity analysis) | `chatgpt.mjs` + `chatgpt-response-observer.mjs` (`readStreaming`/`readFinished` finality evidence, `responseStableMs`, top-level-fragment dedupe) + `watcher.mjs` (streaming-recovery) + `chatgpt-response-dom.mjs` (`readTopLevelAssistantTexts`); tests `web-ai-provider-session.test.mjs`, `web-ai-chatgpt-response-fragments.test.mjs` | **ABSENT** | `chatgpt-response.ts` / `watcher.ts` | **P1** |

## Suggested porting order
1. **#7 session-artifacts** (P0 foundation — unblocks #1 and #3).
2. **#1 chatgpt-files** + **#2 response-observer** (P0).
3. **#5 tab-recovery** → **#4 deep-research-report** → **#8 resume-deep/new-tab-reattach** (P1 chain).
4. **#6 model-pill** + **#3 failure-diagnostics artifact** (P1, after #7).

## Porting notes
- cli-jaw is **TypeScript** — port with explicit types (the agbrowse `.mjs` uses `// @ts-check` JSDoc; translate to `.ts` signatures).
- agbrowse keeps these as small focused modules (<500 lines) with pure helpers + unit tests first — mirror that test-first shape (cli-jaw has `tests/unit/browser-web-ai-*.test.ts`).
- #4: cli-jaw must add `chatgpt-deep-research-report.ts` (the pure selection helpers) to keep `chatgpt-deep-research.ts` small, as agbrowse did.
- #2/#3: reuse cli-jaw's existing placeholder/streaming predicates (don't duplicate) — agbrowse injects `isFinalAnswer` into recovery to avoid a cycle; cli-jaw should do the same.
- Reference implementations (read-only): agbrowse `_fin/260608_oracle_stability_gap/31..35` PABCD specs carry the diff-level designs + test lists.

## Verification target (in cli-jaw, when ported)
`npx tsc --noEmit` + `npm test -- tests/unit/browser-web-ai-*.test.ts` + new unit tests per module (URL allowlist, report-selection, guard, pill-wait).
