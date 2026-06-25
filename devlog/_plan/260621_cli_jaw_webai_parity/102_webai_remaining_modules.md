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
| Navigation-settle gate | `navigation-ready.mjs`: `waitForNavigationReady` | **ABSENT** | P2 | Verify it isn't folded into another cli-jaw helper first. |
| Session doctor (read-only diag report) | `session-doctor.mjs` | **ABSENT** (cli-jaw has `doctor.ts`) | P2 | Confirm `doctor.ts` covers session-level redacted reporting. |
| Tab inspect | `tab-inspect.mjs`: `TabSummary` | **ABSENT** | P2 | Diagnostic/inspection helper. |
| Candidate reconcile | `candidate-reconcile.mjs` (BundleRef/box reconciliation) | **ABSENT** | P2 | Verify not merged into cli-jaw `observation-bundle.ts`/`ref-registry.ts`. |
| Control summary | `control-summary.mjs`: `ControlSummaryInput` | **ABSENT** | P2 | Likely CLI-presentation infra; confirm scope. |

> **Pre-port check (P2 rows):** `navigation-ready`, `candidate-reconcile`, `control-summary`, `session-doctor` may already be folded into a consolidated cli-jaw module. Grep cli-jaw before creating a new file.

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
