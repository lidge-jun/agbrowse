# 80 — Cycle (cli-jaw (.ts))

> Part of [00_plan.md](00_plan.md) · Goal `68727b6d-d01` · **Status: ⬜ PENDING (stub — diff-level detail filled at this cycle's P/B phase)**

## Target
- **Repo / lang:** cli-jaw (.ts)
- **Severity:** P2/P3
- **Gate command:** `npm test + npx tsc --noEmit`

## Gaps in scope
102 remaining modules: generated images, chatgpt-archive, project-sources, upload-surface max-file-size, navigation-ready, tab-inspect; 106 chatgpt-tools More-submenu/aria-checked, tab-lease capacity/dead-PID

## Plan (filled at cycle P-phase 2026-06-25)

All 9 `102` modules confirmed **ABSENT** in cli-jaw `src/browser/web-ai/` (no `.ts` counterpart). cli-jaw is pure `playwright-core` (no `chrome-remote-interface`); CDP-protocol modules port against `getCdpSession(port)` → `BrowserCdpSession.send(method, params)` (same `.send` shape as agbrowse), tab-enumeration against `listTabs`/`getPageByTargetId`. Each NEW module exported via `index.ts`; each ports its **pure** helpers verbatim (strict-TS) with a focused `tests/unit/browser-web-ai-*.test.ts`.

| # | NEW cli-jaw file | agbrowse source | Pure/testable symbols | Page/CDP-driven | Pri |
|---|---|---|---|---|---|
| 8.1 | `candidate-reconcile.ts` | `candidate-reconcile.mjs` | `reconcileVisionCandidate` (point-in-box + nearest-tie-margin), `assertFreshObservationBundle` | — (fully pure) | P2 |
| 8.2 | `control-summary.ts` | `control-summary.mjs` | `formatControlSummary` | `emitControlSummary` (stderr) | P3 |
| 8.3 | `navigation-ready.ts` | `navigation-ready.mjs` | `isProviderUrl`, `shouldNavigateToRequestedProviderUrl` | `waitForPageUrl`, `waitForConversationReady`, `isProviderPageDriveable` | **P1** |
| 8.4 | `chatgpt-archive.ts` | `chatgpt-archive.mjs` | `resolveArchivePolicy`, `isTemporaryChatgptUrl` | `archiveConversation` | P2 |
| 8.5 | `chatgpt-upload-surface.ts` | `chatgpt-upload-surface.mjs` | `scoreFileInputCandidate`, `isImageAttachmentPath` | `findFirstFileInput`, `setFilesViaUploadSurface` (Playwright `Page`) | P2 |
| 8.6 | `chatgpt-project-sources.ts` | `chatgpt-project-sources.mjs` | `validateProjectSourcesUrl`, `validateProjectSourceFiles`, `build*Expression` | `listProjectSources`, `addProjectSource` (CDP) | P2 |
| 8.7 | `tab-inspect.ts` | `tab-inspect.mjs` | `classifyTabState`, `INSPECT_EXPRESSION` | `inspectTab`/`harvestTab`/`collectTabs` (Playwright-adapted) | P2 |
| 8.8 | `session-doctor.ts` | `session-doctor.mjs` | `sanitizeSession`, `summarizeSession`, `recommendSessionActions` | `buildSessionDoctorReport` (deps-injected) | P2 |
| 8.9 | `chatgpt-images.ts` | `chatgpt-images.mjs` | `deriveGeneratedImageOutputPaths`, `isAllowedChatGptImageUrl`, `resolveGeneratedImageWaitTimeoutMs`, `isImageOnlyGeneratedImageChromeText`, `buildGeneratedImageDetectionExpression` | `detectGeneratedImages`/`downloadGeneratedImages`/`collectImages` (CDP + `saveImageArtifact`/`appendSessionArtifact`) | **P1** |

`106` MODIFY items (port WITH 105.6/.9 codes per Cycle-7 deferral):
- **8.10** `chatgpt-tools.ts` — add More/"더 보기" submenu expansion (`selectMoreComposerMenuItem`) + `aria-checked` confirmation read.
- **8.11** `tab-lease-store.ts` — pool capacity cap + dead-PID reclaim on checkout/record.

Adaptation notes: artifact capture follows cli-jaw idiom (`saveImageArtifact` → `appendSessionArtifact`), **not** agbrowse `appendArtifactRecord`. tab-inspect swaps raw `chrome-remote-interface` for `getPageByTargetId(port,id).evaluate(INSPECT_EXPRESSION)` + `listTabs(port)`.

## Build log (filled at cycle B-phase)
_Commits + gate output recorded below as each module lands._

## Verification
_A-phase: catalog already audited (master-plan A-phase PASS); per-module gap re-confirmed ABSENT at scope time (all 9 `.ts` files absent). C-phase: full `npm test` + `tsc --noEmit` green._
