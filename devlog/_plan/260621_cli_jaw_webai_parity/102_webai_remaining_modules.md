# 102 — Remaining Web-AI Module Gaps (agbrowse → cli-jaw)

Date: 2026-06-25 · Parent: [100](100_agbrowse_to_clijaw_overview.md)
Source: agbrowse `web-ai/*.mjs` · Target: cli-jaw `src/browser/web-ai/*.ts`

Beyond the 31–35 stability patches ([101](101_webai_stability_patches.md)), these agbrowse web-ai modules have **no cli-jaw counterpart** (or are partial). Several need a quick "is it folded elsewhere in cli-jaw?" check before porting — cli-jaw consolidates some agbrowse modules.

## In-scope gaps

| Feature | agbrowse file:symbol | cli-jaw status | Pri | Note |
| --- | --- | --- | --- | --- |
| Generated-image (DALL·E) capture/download | `chatgpt-images.mjs`: `detectGeneratedImages`, `downloadGeneratedImages`, `collectImages`, `deriveGeneratedImageOutputPaths` | **ABSENT** | **P1** | cli-jaw has only `annotated-screenshot.ts` (unrelated). Depends on the session-artifacts foundation (101 #7). |
| Auto-archive old conversations | `chatgpt-archive.mjs`: `shouldArchive`, `ArchivePolicyResult` | **ABSENT** | P2 | Hygiene/policy; lower urgency. |
| Project-sources reader | `chatgpt-project-sources.mjs`: `ProjectSource` (upload/mutation flow) | **ABSENT** | P2 | Distinct from cli-jaw `product-surfaces.ts` (read-only detection — see [201](201_webai_capability_registry_and_tools.md)). |
| Upload-surface scoring/probe | `chatgpt-upload-surface.mjs`: `scoreFileInputCandidate`, `findFirstFileInput`, `setFilesViaUploadSurface` | **BEHIND** | P2 | cli-jaw `chatgpt-attachments.ts` has inline selectors but not the scored candidate/probe split — likely acceptable partial parity. |
| Provider-page **driveability** + navigation-settle gate | `navigation-ready.mjs`: `isProviderPageDriveable`, `waitForConversationReady`, `shouldNavigateToRequestedProviderUrl`, `waitForPageUrl`, `isProviderUrl`, `waitForNavigationReady` | **ABSENT** (confirmed Pass 2 — no equivalent under cli-jaw `web-ai/`) | **P1** | A stale CDP target appears in `/json/list` but leaves Playwright wedged after reconnect → the driveability guard treats it non-reusable (reuse-vs-fresh-tab + URL-settle). Without it cli-jaw can hang before the provider timeout. |
| Session doctor (read-only diag report) | `session-doctor.mjs`: `buildSessionDoctorReport`, `sanitizeSession` | **ABSENT** (confirmed Pass 2) | P2 | cli-jaw `doctor.ts` is a feature-capability prober — it does **not** cover session-level reporting (lock PID/staleness + `verifySessionTab`, convo URLs redacted to host+path). Resolves the open question. |
| Multi-tab CDP inspect/harvest + state classify | `tab-inspect.mjs`: `collectTabs`, `inspectTab`, `harvestTab`, `classifyTabState` (`TabSummary`) | **ABSENT** (confirmed Pass 2) | P2 | Enumerate ALL ChatGPT tabs → running/completed/detached/stalled + stall re-probe via fingerprint + orphan-harvest. cli-jaw `tab-recovery.ts` handles a single known session only. |
| Vision-candidate → ref-box reconcile | `candidate-reconcile.mjs`: `reconcileVisionCandidate`, `assertFreshObservationBundle` | **ABSENT** (confirmed Pass 2 — NOT folded into `observation-bundle.ts`/`ref-registry.ts`) | P2 | point-in-box + nearest-with-tie-margin → ref-click vs raw-coordinate decision; `COMPUTER_TARGET_AMBIGUOUS`. |
| Control-state summary line | `control-summary.mjs`: `formatControlSummary`, `emitControlSummary` (`ControlSummaryInput`) | **ABSENT** (confirmed Pass 2) | P3 | stderr observability (`[browser] cdp=… tab=pooled session=recovered`); behavior, not type-bloat. Cosmetic → demoted P3. |

> **Pre-port check — RESOLVED (Pass 2):** `navigation-ready`, `candidate-reconcile`, `control-summary`, `session-doctor`, `tab-inspect` were all confirmed **genuinely absent** by line-comparison (not folded into any consolidated cli-jaw module). Symbols above verified. `navigation-ready` upgraded **P2 → P1** (stale-CDP driveability is a real hang risk).

## §3 — agbrowse-only / OUT OF SCOPE (not gaps)

Present in agbrowse, absent in cli-jaw, and intentionally agbrowse-owned per the parity model — **do not port**:

- `eval/` (fixtures, metrics, provider-targets, scrub-dom, types), `eval-adapters/webvoyager.mjs`, `eval-runner.mjs` — evaluation harness.
- `policy/` (content-boundary, default-policy, enforce, schema) — policy engine.
- `trace/` (action-timeline, redact, report, types, writer) — full trace subsystem (cli-jaw has the lighter `trace-persistence.ts`).
- `mcp-server.mjs`, `mcp-state.mjs` — MCP server runtime.
- `cli.mjs` — agbrowse standalone CLI entry (cli-jaw wires into `jaw`).
- `tool-schema.mjs`, `browser-tool-schema.mjs` — agbrowse tool-schema surface.
- `planner-loop.mjs` (G01), `extract-schema.mjs` (G05), `claim-audit.mjs` (G10), `active-command-store.mjs` — experimental/autonomous-planner runtime.

### Not a gap — a refactor
`capability.mjs` (agbrowse runtime probes) ↔ cli-jaw split into `capability-registry/-types/-freshness/-observation-presets/-observed-tool-entries.ts`. This is the **reverse** direction (cli-jaw's declarative registry is a candidate to bring INTO agbrowse) — see [201](201_webai_capability_registry_and_tools.md).
