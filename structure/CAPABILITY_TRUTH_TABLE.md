---
created: 2026-05-05
phase: 22
tags: [agbrowse, truth-table, release-claims, source-of-truth]
aliases: [agbrowse capability truth table]
---

# agbrowse Capability Truth Table

This is the **single source of truth** for capability status across `agbrowse`
and its `cli-jaw` mirror. Phase 22 introduces this table to keep public claims
aligned with code, tests, and the cli-jaw mirror surface. Update this file in
the same commit as any capability or claim change.

Status legend:

- `ready` — implementation, tests, and public docs all agree.
- `beta` — implementation exists; depends on live provider UI / accounts.
- `experimental` — opt-in, narrow scope, no production claim.
- `deferred` — explicitly not implemented; do not market.

`Mirror In cli-jaw` describes the equivalent surface in `cli-jaw` if any. A
mirror entry of `n/a` means the capability is intentionally agbrowse-only.

| Capability | Status | Code Location | Tests | Mirror In cli-jaw |
| --- | --- | --- | --- | --- |
| Browser runtime cleanup / `doctor` | ready | `web-ai/doctor.mjs`, `skills/browser/browser.mjs` | `test/integration/web-ai-doctor*.test.mjs`, `test/unit/web-ai-doctor.test.mjs` | `src/browser/runtime/*` (cleanup); doctor surface re-exported via cli-jaw browser command. ready in cli-jaw. |
| ChatGPT web-AI resolver | beta | `web-ai/chatgpt.mjs`, `web-ai/chatgpt-composer.mjs`, `web-ai/chatgpt-model.mjs` | `test/unit/web-ai-chatgpt*.test.mjs`, fixture evals under `test/fixtures/provider-dom/` | `src/browser/web-ai/chatgpt.ts` — beta in cli-jaw. |
| ChatGPT code mode (`web-ai code`) | beta | `web-ai/code-mode.mjs`, `web-ai/code-mode-prompt.mjs`, `web-ai/code-artifact.mjs`, `web-ai/code-dev-context.mjs`, `skills/web-ai/modules/gpt-dev-agent-context.*` | `test/unit/web-ai-code-mode*.test.mjs`, `test/unit/web-ai-code-artifact.test.mjs`, `test/unit/web-ai-code-dev-context.test.mjs` | saved GPT dev-agent context zip auto-upload → strict contract prompt → headless single/multi zip retrieval via in-page presigned fetch. New code artifacts must include `PLAN.md` or `00_plan.md`. cli-jaw independent mirror is tracked in `devlog/_fin/260611_code_mode_gpt_agent_context/00_plan.md`. |
| ChatGPT code artifact extraction (`web-ai code-extract`) | beta | `web-ai/code-mode.mjs`, `web-ai/code-artifact.mjs`, CLI surface in `web-ai/cli.mjs` | `test/unit/web-ai-code-mode.test.mjs`, `test/unit/web-ai-code-artifact.test.mjs`, `test/integration/web-ai-cli-contract.test.mjs` | re-retrieves existing ChatGPT code-mode zip artifacts from an accessible conversation without sending a new prompt. ChatGPT-only; selectors are `--url`, `--conversation`, `--session`, or the current ChatGPT conversation tab. |
| Gemini web-AI resolver | beta | `web-ai/gemini-live.mjs`, `web-ai/gemini-model.mjs` | `test/unit/web-ai-gemini*.test.mjs` | not mirrored; cli-jaw delegates via agbrowse. n/a in cli-jaw. |
| Grok web-AI resolver | beta | `web-ai/grok-live.mjs`, `web-ai/grok-model.mjs` | `test/unit/web-ai-grok*.test.mjs` | not mirrored. n/a in cli-jaw. |
| Action-intent / semantic target resolver (incl. `send.click`) | ready | `web-ai/action-intent.mjs`, `web-ai/target-resolver.mjs`, `web-ai/self-heal.mjs` | `test/unit/web-ai-action-intent.test.mjs`, `test/unit/web-ai-target-resolver.test.mjs` | `src/browser/web-ai/action-intent.ts`, `src/browser/web-ai/target-resolver.ts`. ready in cli-jaw. |
| `answerArtifact` on completed answers | ready | `web-ai/answer-artifact.mjs` | `test/unit/web-ai-answer-artifact.test.mjs` | `src/browser/web-ai/answer-artifact.ts`, `tests/unit/browser-web-ai-answer-artifact.test.ts`. ready in cli-jaw. |
| `sourceAudit` (`--require-source-audit`, ratio/scope/date flags) | ready | `web-ai/source-audit.mjs`, CLI surface in `web-ai/cli.mjs` | `test/unit/web-ai-source-audit*.test.mjs` | `src/browser/web-ai/source-audit.ts`, CLI flags via `src/browser/web-ai/index.ts`, HTTP via `src/routes/browser.ts`, `tests/unit/browser-web-ai-source-audit.test.ts`. ready in cli-jaw. |
| Artifact-before-archive contract | ready | `web-ai/session-artifacts.mjs`, `web-ai/tab-finalizer.mjs`, `web-ai/chatgpt-archive.mjs` | `test/unit/web-ai-session-artifacts.test.mjs`, `test/unit/web-ai-tab-finalizer.test.mjs` | n/a; agbrowse owns provider artifact/archive lifecycle. |
| Generated ChatGPT image output (`--output-image`) | beta | `web-ai/chatgpt-images.mjs`, `web-ai/chatgpt.mjs`, CLI surface in `web-ai/cli.mjs` | `test/unit/chatgpt-images.test.mjs`, `test/integration/web-ai-cli-contract.test.mjs` | n/a; CLI-only in agbrowse for now. |
| ChatGPT Project Sources (`project-sources list/add`) | beta | `web-ai/chatgpt-project-sources.mjs`, CLI surface in `web-ai/cli.mjs` | `test/unit/web-ai-project-sources.test.mjs`, `test/integration/web-ai-cli-contract.test.mjs` | n/a; append-only CLI surface. MCP remains deferred. |
| ChatGPT batch follow-ups (`--follow-up`) | beta | `web-ai/chatgpt-multi-turn.mjs`, `web-ai/cli.mjs` | `test/integration/web-ai-cli-contract.test.mjs` plus lifecycle coverage through finalizer/session artifact tests | n/a; later-session follow-up remains deferred. |
| ChatGPT Deep Research (`--research deep`) | experimental | `web-ai/chatgpt-deep-research.mjs`, `web-ai/chatgpt.mjs`, CLI surface in `web-ai/cli.mjs` | `test/integration/web-ai-cli-contract.test.mjs`; live-provider behavior remains beta/experimental | n/a; ChatGPT-only experimental beta. |
| Live upload size cap (`--max-upload-file-size`) | ready | `web-ai/chatgpt-attachments.mjs`, provider send modules, CLI surface in `web-ai/cli.mjs` | `test/unit/chatgpt-attachments.test.mjs`, `test/integration/web-ai-cli-contract.test.mjs` | n/a; `--max-file-size` remains context-budget alias. |
| MCP tool: `browser_snapshot` | ready (frozen scope) | `web-ai/browser-tool-schema.mjs`, `web-ai/mcp-server.mjs` | `test/unit/browser-tool-schema.test.mjs`, `test/integration/web-ai-mcp-server.test.mjs` | n/a in cli-jaw (cli-jaw does not expose browser MCP tools). |
| MCP tool: `browser_click_ref` | ready (frozen scope) | `web-ai/browser-tool-schema.mjs`, `web-ai/mcp-server.mjs` | `test/unit/browser-tool-schema.test.mjs`, `test/integration/web-ai-mcp-server.test.mjs` | n/a in cli-jaw. |
| MCP tools: `browser_type_ref`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`, `browser_wait_for`, `browser_screenshot`, `browser_extract_text` | deferred (`not-implemented`) | listed in `web-ai/browser-tool-schema.mjs` `DEFERRED_BROWSER_TOOLS` (structured metadata) + `NOT_IMPLEMENTED_BROWSER_TOOLS` legacy alias; decision record in `structure/mcp_scope.md` (G04) | regression test in `test/unit/browser-tool-schema.test.mjs`, G04 metadata + envelope tests in `test/unit/g04-mcp-deferred-metadata.test.mjs` | n/a. |
| Web-AI MCP tools (`web_ai_*`) | beta | `web-ai/tool-schema.mjs`, `web-ai/mcp-server.mjs` | `test/integration/web-ai-mcp-server.test.mjs`, `test/unit/web-ai-tool-schema.test.mjs`, `test/unit/web-ai-tool-validation.test.mjs` | strict input schemas; documented compatibility aliases only. n/a in cli-jaw. |
| Policy enforcement (`policy/*`) | ready | `web-ai/policy/` | `test/unit/web-ai-policy*.test.mjs`, `test/integration/web-ai-policy-*.test.mjs` | partial mirror via cli-jaw browser route policy; agbrowse remains source. |
| Trace evidence (Phase 12) | ready | `web-ai/trace/`, `web-ai/trace-persistence.mjs`, `scripts/render-trace-report.mjs` | `test/unit/web-ai-trace*.test.mjs` | n/a; cli-jaw does not mirror trace. |
| External / remote CDP adapter | deferred (experimental) | _no production code_; `docs/EXTERNAL_CDP.md` documents the deferral | none | deferred. See `docs/EXTERNAL_CDP.md` in both repos. |
| Benchmark trajectory writer | ready (offline bundle only) | `benchmarks/agbrowse/trajectory.mjs`, `benchmarks/agbrowse/run-task.mjs` | `test/unit/benchmark-trajectory.test.mjs` if present; smoke via `npm run benchmark:trajectory -- --help` | planned — cli-jaw consumes agbrowse trajectory bundles; no native writer. |
| Benchmark leaderboard / score claim | deferred | n/a | n/a | deferred. |
| Release gates (named) | ready | `scripts/release.sh`, `scripts/release-preview.sh`, `scripts/release-gates.mjs` (Phase 22, G10) | `npm run gate:*` series including `gate:no-cloud-claims` | mirrored via cli-jaw `scripts/release-gates.mjs`. ready in cli-jaw. |
| Claim audit (`gate:no-cloud-claims`, `agbrowse web-ai claim-audit`) | ready | `web-ai/claim-audit.mjs`, `scripts/release-gates.mjs` (G10) | `test/unit/web-ai-claim-audit.test.mjs`, `npm run gate:no-cloud-claims` | mirrored via cli-jaw claim-audit module + gate. ready in cli-jaw. |
| Observe actions API (`agbrowse observe-actions`, `buildObserveActions`) | ready | `web-ai/observe-actions.mjs`, `skills/browser/browser.mjs` (G02) | `test/unit/g02-observe-actions.test.mjs`, `npm run gate:observe-actions-fixtures` | mirrored via cli-jaw `src/browser/web-ai/observe-actions.ts` + gate. ready in cli-jaw. |
| Observation bundle (`agbrowse observe-bundle`, ObservationBundleV1) | ready | `web-ai/observation-bundle.mjs`, `skills/browser/browser.mjs` (G06) | `test/unit/g06-observation-bundle.test.mjs`, `npm run gate:observation-bundle-fixtures` | mirrored via cli-jaw `src/browser/web-ai/observation-bundle.ts` + gate. ready in cli-jaw. |
| Action breadth (local-CDP primitives, 22 wired: click/type/press/hover/select/check/uncheck/upload/drag/scroll/wait-for/...) | ready | `web-ai/action-breadth.mjs`, `skills/browser/browser.mjs` (G03) | `test/unit/g03-action-breadth.test.mjs`, `npm run gate:browser-primitives-complete` | mirrored via cli-jaw `src/browser/web-ai/action-breadth.ts` + gate. ready in cli-jaw. Vercel agent-browser/Playwright MCP parity. |
| Adaptive URL fetch (`agbrowse fetch <url>`) | experimental | `skills/browser/adaptive-fetch/*.mjs` (index, safety, trace, fetcher, endpoint-resolvers, metadata, transforms, reader-adapters, content-scorer, third-party-readers, challenge-detector, waf-profiles, browser-escalation, browser-runtime, browser-session, human-loop, output), `skills/browser/browser.mjs` | `test/unit/browser-adaptive-fetch-*.test.mjs`, `test/integration/browser-fetch-command.test.mjs` including large JSON stdout compaction | v2: 6-phase escalation ladder (public endpoints → browser-grade HTTP → readers → isolated browser → user session → human resolution). Session modes: none/isolated/existing/user/interactive. Identity modes: auto/minimal/chrome. WAF profile detection (Cloudflare managed+Turnstile, Akamai Bot Manager, AWS WAF, Imperva/Incapsula, DataDome, PerimeterX). DNS rebinding guard. Content scoring with multi-signal evidence. JSON output content is compacted with `contentBytes`/`contentLimitBytes`/`contentTruncated`. planned as `cli-jaw browser fetch <url>` after agbrowse v2 proves stable. |
| Local action timeline (`buildActionTimeline`, ActionTimelineV1) | ready | `web-ai/trace/action-timeline.mjs` (G11) | `test/unit/g11-action-timeline.test.mjs`, `npm run gate:trace-browser-actions` | local-only artifact; correlates observe/mutate/wait/capture events per traceId. No cli-jaw mirror by design (cli-jaw does not mirror trace surfaces). |
| Action memory cache (`createActionMemory`, ActionMemoryV1) | experimental | `web-ai/action-memory.mjs` (G07), `skills/browser/browser.mjs action-memory list/clear` | `test/unit/g07-action-memory.test.mjs`, `npm run gate:action-memory-safe-replay` | `src/browser/web-ai/action-memory.ts`, `tests/unit/action-memory.test.ts`. experimental in both repos. Pure store + signature-validated lookup (drift = miss). NOT yet wired into self-heal/resolver — opt-in surface only. |
| G09 model-adapter (provider API clients / hosted model routing) | deferred (frozen) | n/a — `web-ai/constants.mjs` exposes `MAX_MODEL_ADAPTER_ATTEMPTS = 2` + `isModelAdapterTransient` for the shared retry policy. The web-ai skill (`agbrowse web-ai query`) IS the adapter surface. | `test/unit/g09-model-adapter-frozen.test.mjs`, `npm run gate:model-adapter-frozen` | cli-jaw mirror = deferred row + skill capability row + negative-parity assertion. No provider SDK deps (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `@google/genai`, `ai`, `@ai-sdk/*`). No `api-query` / `--api` / `--transport api` aliases. No `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`MODEL_ADAPTER_*` env vars. No `web-ai/model-adapter/*` paths. |
| Local autonomous planner loop (`runPlannerLoop`, PlannerResultV1) | experimental | `web-ai/planner-loop.mjs`, `web-ai/planner-contract.mjs` (G01) | `test/unit/g01-planner-loop.test.mjs`, `npm run gate:planner-loop-local` | observe → propose → act → verify orchestrator. 100% local: no hosted/cloud planner, no provider SDKs. Shares G09's retry cap (`MAX_MODEL_ADAPTER_ATTEMPTS = 2`) for transient act failures only. Caller supplies `propose`/`observe`/`act`/`verify` deps — pure runtime, no built-in model. cli-jaw mirror: experimental row only. |
| Schema-bound page extraction (`validateExtraction`, EXTRACT_SCHEMA_VERSION='extract-schema-v1') | experimental | `web-ai/extract-schema.mjs` (G05) | `test/unit/g05-extract-schema.test.mjs`, `npm run gate:extract-schema-fixtures` | Fail-closed JSON-Schema-subset validator (object/array/string/number/integer/boolean/null + required + items + min/maxItems + enum). Unsupported keywords raise `capability.unsupported` at schema-load time so partial validation cannot leak. cli-jaw does NOT mirror the runtime — extraction stays first-party in agbrowse `web-ai/extract-schema.mjs`. |
| Reference benchmark adapters (WebVoyager/WebArena/VWA/Mind2Web) | experimental (webvoyager dry-run only) / deferred (others) | `web-ai/eval-adapters/webvoyager.mjs` (G08), `structure/benchmarks.md` | `test/unit/g08-eval-adapters.test.mjs`, `npm run gate:eval-adapters-no-score-claims` | Trajectory capture only. `scoreClaim: null` enforced on every adapter output. Forbidden invariants: no leaderboard claims, no auto-upload, no external grading. WebArena/VWA/Mind2Web adapters are deferred until G06/G02/G03/G01/G11 stay green and a score-claim review process exists. cli-jaw mirror: NONE — agbrowse owns the trajectory format; cli-jaw can later consume bundles. |

## Mirror Rules

- A `ready` claim in agbrowse does **not** automatically mean `ready` in
  `cli-jaw`. The cli-jaw column above governs cross-repo claims.
- New capability or claim ⇒ update this table and the equivalent in cli-jaw in
  the same commit (`gate:truth-table-fresh` enforces ≤7 day staleness).
- Frozen MCP scope: only the two `browser_*` tools above may be registered
  without an explicit table change (`gate:mcp-scope-frozen`).

## Forbidden Claims

- No `ready` claim for hosted/cloud, remote/external CDP, or stealth flows.
- No leaderboard or competitor benchmark score until a fixed
  model/planner/environment/task set lands.
- No `ready` MCP claim beyond the two frozen tools.

## Cross-References

- Phase truth table: [phase_status.md](phase_status.md)
- Release gate checklist: [release_gates.md](release_gates.md)
- External CDP deferral: [../docs/EXTERNAL_CDP.md](../docs/EXTERNAL_CDP.md)
- Phase 22 plan: `cli-jaw/devlog/_plan/260505_browser_runtime_phase22/22_agbrowse_parity_closeout.md`
