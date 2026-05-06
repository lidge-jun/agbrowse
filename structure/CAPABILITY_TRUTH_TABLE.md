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
| Gemini web-AI resolver | beta | `web-ai/gemini-live.mjs`, `web-ai/gemini-model.mjs` | `test/unit/web-ai-gemini*.test.mjs` | not mirrored; cli-jaw delegates via agbrowse. n/a in cli-jaw. |
| Grok web-AI resolver | beta | `web-ai/grok-live.mjs`, `web-ai/grok-model.mjs` | `test/unit/web-ai-grok*.test.mjs` | not mirrored. n/a in cli-jaw. |
| Action-intent / semantic target resolver (incl. `send.click`) | ready | `web-ai/action-intent.mjs`, `web-ai/target-resolver.mjs`, `web-ai/self-heal.mjs` | `test/unit/web-ai-action-intent.test.mjs`, `test/unit/web-ai-target-resolver.test.mjs` | `src/browser/web-ai/action-intent.ts`, `src/browser/web-ai/target-resolver.ts`. ready in cli-jaw. |
| `answerArtifact` on completed answers | ready | `web-ai/answer-artifact.mjs` | `test/unit/web-ai-answer-artifact.test.mjs` | `src/browser/web-ai/answer-artifact.ts`, `tests/unit/browser-web-ai-answer-artifact.test.ts`. ready in cli-jaw. |
| `sourceAudit` (`--require-source-audit`, ratio/scope/date flags) | ready | `web-ai/source-audit.mjs`, CLI surface in `web-ai/cli.mjs` | `test/unit/web-ai-source-audit*.test.mjs` | `src/browser/web-ai/source-audit.ts`, CLI flags via `src/browser/web-ai/index.ts`, HTTP via `src/routes/browser.ts`, `tests/unit/browser-web-ai-source-audit.test.ts`. ready in cli-jaw. |
| MCP tool: `browser_snapshot` | ready (frozen scope) | `web-ai/browser-tool-schema.mjs`, `web-ai/mcp-server.mjs` | `test/unit/browser-tool-schema.test.mjs`, `test/integration/web-ai-mcp-server.test.mjs` | n/a in cli-jaw (cli-jaw does not expose browser MCP tools). |
| MCP tool: `browser_click_ref` | ready (frozen scope) | `web-ai/browser-tool-schema.mjs`, `web-ai/mcp-server.mjs` | `test/unit/browser-tool-schema.test.mjs`, `test/integration/web-ai-mcp-server.test.mjs` | n/a in cli-jaw. |
| MCP tools: `browser_type_ref`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`, `browser_wait_for`, `browser_screenshot`, `browser_extract_text` | deferred (`not-implemented`) | listed in `web-ai/browser-tool-schema.mjs` `DEFERRED_BROWSER_TOOLS` (structured metadata) + `NOT_IMPLEMENTED_BROWSER_TOOLS` legacy alias; decision record in `structure/mcp_scope.md` (G04) | regression test in `test/unit/browser-tool-schema.test.mjs`, G04 metadata + envelope tests in `test/unit/g04-mcp-deferred-metadata.test.mjs` | n/a. |
| Web-AI MCP tools (`web_ai_*`) | beta | `web-ai/tool-schema.mjs`, `web-ai/mcp-server.mjs` | `test/integration/web-ai-mcp-server.test.mjs`, `test/unit/web-ai-tool-schema.test.mjs` | n/a. |
| Policy enforcement (`policy/*`) | ready | `web-ai/policy/` | `test/unit/web-ai-policy*.test.mjs`, `test/integration/web-ai-policy-*.test.mjs` | partial mirror via cli-jaw browser route policy; agbrowse remains source. |
| Trace evidence (Phase 12) | ready | `web-ai/trace/`, `web-ai/trace-persistence.mjs`, `scripts/render-trace-report.mjs` | `test/unit/web-ai-trace*.test.mjs` | n/a; cli-jaw does not mirror trace. |
| External / remote CDP adapter | deferred (experimental) | _no production code_; `docs/EXTERNAL_CDP.md` documents the deferral | none | deferred. See `docs/EXTERNAL_CDP.md` in both repos. |
| Benchmark trajectory writer | ready (offline bundle only) | `benchmarks/agbrowse/trajectory.mjs`, `benchmarks/agbrowse/run-task.mjs` | `test/unit/benchmark-trajectory.test.mjs` if present; smoke via `npm run benchmark:trajectory -- --help` | planned — cli-jaw consumes agbrowse trajectory bundles; no native writer. |
| Benchmark leaderboard / score claim | deferred | n/a | n/a | deferred. |
| Release gates (named) | ready | `scripts/release.sh`, `scripts/release-preview.sh`, `scripts/release-gates.mjs` (Phase 22, G10) | `npm run gate:*` series including `gate:no-cloud-claims` | mirrored via cli-jaw `scripts/release-gates.mjs`. ready in cli-jaw. |
| Claim audit (`gate:no-cloud-claims`, `agbrowse web-ai claim-audit`) | ready | `web-ai/claim-audit.mjs`, `scripts/release-gates.mjs` (G10) | `test/unit/web-ai-claim-audit.test.mjs`, `npm run gate:no-cloud-claims` | mirrored via cli-jaw claim-audit module + gate. ready in cli-jaw. |

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
