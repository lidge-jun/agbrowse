---
created: 2026-05-05
tags: [agbrowse, phase-status, release-claims]
---

# Phase Status Truth Table

This file is the code-backed status table for Phase 11 onward. A phase is
`ready` only when the implementation, tests, and public docs all agree. A
partial phase must not be marketed as complete.

| Phase | Status | Code-backed surface | Closeout requirement |
| --- | --- | --- | --- |
| 11 DOM churn eval | ready | `web-ai/eval-runner.mjs`, `scripts/run-web-ai-eval.mjs`, fixture tests | Keep fixture evals in release gates |
| 12 trace evidence | ready | `web-ai/trace/`, `scripts/render-trace-report.mjs` | Keep raw prompt/answer redaction tests |
| 13 safety policy | ready | `web-ai/policy/`, policy CLI/MCP tests | Keep policy schema strict |
| 14 active command ownership | ready | `web-ai/active-command-store.mjs` | Keep active target cleanup protection |
| 15 browser primitives | ready | `skills/browser/browser.mjs`, primitive tests | Keep general CLI claims local-only |
| 16 semantic resolver | ready in agbrowse | `web-ai/action-intent.mjs`, `web-ai/target-resolver.mjs` | Mirror into cli-jaw before cross-repo ready claim |
| 17 provider contracts/source audit | ready in agbrowse | `web-ai/answer-artifact.mjs`, `web-ai/source-audit.mjs` | Mirror into cli-jaw before cross-repo ready claim |
| 18 MCP/AI SDK | partial | `web-ai/mcp-server.mjs`, `web-ai/tool-schema.mjs`, `browser_snapshot`, `browser_click_ref` | Either keep narrow ready scope or implement remaining generic browser tools |
| 19 remote CDP adapters | deferred | No `external-cdp` provider runtime yet | Do not claim hosted/cloud/external-CDP support |
| 20 benchmark trajectory | ready for trajectory bundles | `benchmarks/agbrowse/trajectory.mjs`, `benchmarks/agbrowse/run-task.mjs`, `docs/benchmarks.md` | Do not publish scores until fixed tasks/planner/environment exist |
| 21 release gates | ready | `scripts/release*.sh`, `.github/workflows/release.yml`, `structure/release_gates.md`, `docs/production-readiness.md`, `docs/comparison.md` | Keep named claim gates visible in release output |

## Mirror Rules

- `cli-jaw` must not claim parity for a phase until the equivalent command
  surface, output shape, tests, and installed skills exist.
- `agbrowse` is the source implementation for web-AI resolver and source-audit
  contracts; `cli-jaw` may port or adapt them, but must preserve fail-closed
  behavior.
- Browser runtime cleanup in `cli-jaw` is a native cli-jaw surface, not proof
  that `agbrowse` remote-CDP or hosted browser claims are ready.

## Forbidden Claims

- No stealth, CAPTCHA bypass, Cloudflare bypass, or provider account-access
  guarantee.
- No leaderboard score or competitor benchmark claim until Phase 20 has a fixed
  model, planner, browser environment, task set, and trajectory artifacts.
- No production MCP claim beyond the tools listed in `structure/commands.md`.
