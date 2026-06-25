# 201 — cli-jaw Web-AI Capabilities → agbrowse

Date: 2026-06-25 · Parent: [200](200_clijaw_to_agbrowse_overview.md)
Source: cli-jaw `src/browser/web-ai/*.ts` · Target: agbrowse `web-ai/*.mjs`

cli-jaw-only web-ai capabilities (no agbrowse counterpart) that are genuine, portable capabilities — not Electron/CLI glue. Evidence = grep both sides.

## Port candidates

| # | Capability | cli-jaw file:symbol | agbrowse status | Pri | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | **Declarative capability registry** (entries w/ status, ownerPrd, browserGate, fail-closed stage, family) | `capability-registry.ts:REGISTRY`/`lookupCapability` (+`listCapabilities`/`isCapabilityEnabled`/`requireCapabilityOrFailClosed`) | ABSENT — agbrowse `capability.mjs` is runtime probes only | **P1** | The structural centerpiece. agbrowse has no declarative capability inventory/gating model. |
| 1a | Capability type model (CapabilityEntry, FrontendCapabilityObservation, MutationRisk) | `capability-types.ts` | ABSENT | **P1** | Required substrate for #1/#2. |
| 2 | **Frontend observation presets** (selector/text/activation-path/active-signals per capability: model switcher, web search, image gen, deep think) | `capability-observation-presets.ts:CHATGPT_*_OBSERVATION`, `GEMINI_*_OBSERVATION` | ABSENT | **P1** | Curated live-UI selector intel as data; complements agbrowse vendor selector contracts. |
| 3 | **Annotated / set-of-mark screenshot** (highlight refs, bounding boxes, image hash) | `annotated-screenshot.ts:buildAnnotatedScreenshot` | ABSENT (agbrowse uses inline boundingBox only) | **P1** | Genuine visual-grounding capability agbrowse lacks. |
| 4 | **Unified interstitial detector** (cloudflare/login-wall/empty-shell/loading → typed retryHint) + `isPageDeathError` | `interstitial.ts:detectInterstitial`, `InterstitialKind` | ABSENT as a unit (agbrowse scatters per-vendor patterns across chatgpt/grok/gemini-live; none in tab-recovery/navigation-ready) | **P1** | One typed detector with retry guidance vs ad-hoc strings. |
| 5 | **Read-only product-surface detector** (Projects/Library/Apps/Deep-Research/Canvas presence; mutation-forbidden) | `product-surfaces.ts:detectChatGptProductSurfaces`, `detectGeminiProductSurfaces` | ABSENT (agbrowse `chatgpt-project-sources.mjs` is upload/*mutation*, not detection) | P2 | Non-mutating awareness of which product flows exist. |
| 6 | **Richer diagnostics stage taxonomy** (selectorCounts, sendButtonStates, stage-typed envelope) | `diagnostics.ts:WebAiDiagnostics`, `captureWebAiDiagnostics` (274 ln) | DIVERGED — agbrowse `failure-diagnostics.mjs` is slimmer (83 ln) | P2 | **Enrich** the existing agbrowse module, don't replace; cli-jaw's richer taxonomy/selectorCounts could fold in. |
| 7 | **Provider lifecycle adapter interface** (waitForUi/typePrompt/submitPrompt/waitForResponse/diagnose + disabled factory) | `provider-adapter.ts:WebAiProviderAdapter`, `createDisabledProviderAdapter` | DIVERGED — agbrowse `vendor-editor-contract.mjs` is per-vendor selector *data*, not a behavioral runtime interface | P2 (light) | Contract-scaffold; mostly "contract-only". |
| 8 | Observed-but-unported tool entries (Gemini Canvas/Deep-research/video/music, schema-ready) | `capability-observed-tool-entries.ts:OBSERVED_TOOL_CAPABILITY_ENTRIES` | ABSENT | P2 | Backlog inventory; lower value than #1. |
| 9 | Freshness gate (force official-doc retrieval evidence before trusting a capability) | `capability-freshness.ts:validateFreshnessGate` | ABSENT | P2 | Process-enforcement guard for a docs-first posture. |

## Skip (cli-jaw glue, obsolete, or agbrowse ahead)
- `notifications.ts` (`drainPendingWebAiNotifications`) — bound to cli-jaw `messaging/send.js` channel/Telegram; concept reasonable but impl is cli-jaw glue.
- `gemini-contract.ts` (disabled Deep-Think blueprint) — **cli-jaw is BEHIND here**; agbrowse already shipped the live `gemini-live.mjs` runtime.
- `context-pack/zip-writer.ts` (`writeStoredZip`) — agbrowse achieves the same via the `archiver` dep; not a capability gap.
- `context-pack/runtime.ts`, `index.ts` barrel — thin orchestration/packaging.
- `chatgpt-response.ts` (placeholder/streaming) — **already present** in agbrowse (`chatgpt.mjs` patterns + `chatgpt-response-dom.mjs`/`-observer.mjs`); agbrowse arguably more decomposed.
- `code-dev-context-template.ts` (Pass 2 file-coverage miss) — cli-jaw split the dev-context template into its own module; agbrowse inlines the same template inside `code-dev-context.mjs` (no separate file). Pure layout, **not** a capability gap. Was the only file (either side) previously unnamed in any doc.

## Shared modules — agbrowse already ahead (no back-port)
`chatgpt.ts` (950 ln vs agbrowse 1101), `chatgpt-model.ts` (801 vs 1160; identical model id sets), `cli-sessions.ts` (208 vs 291) — agbrowse is the strict superset on every spot-check; cli-jaw "unique" symbols are command-handler glue agbrowse relocated to `cli.mjs`/`planner-loop.mjs`. No cli-jaw-only behavioral fixes surfaced.

## Suggested order (if agbrowse adopts)
1. **#1+#1a+#2 capability registry cluster** (P1 — the one structural feature; brings agbrowse to cli-jaw's declarative model).
2. **#3 annotated-screenshot**, **#4 interstitial detector** (P1 standalone tools).
3. **#5 product-surfaces**, **#6 diagnostics enrich**, **#7 provider-adapter** (P2).

Each is a deliberate agbrowse evolution decision (this is the reverse-parity direction) — gate behind agbrowse's own PABCD when picked up. **No code here — docs-only.**
