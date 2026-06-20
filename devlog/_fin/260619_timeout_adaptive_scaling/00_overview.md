# Timeout Adaptive Scaling

## Problem
All vendors use fixed poll timeouts (ChatGPT/Gemini 1200s, Grok 600s) regardless of model or effort level. No adaptive scaling based on model type, reasoning effort, or response complexity.

## Key Gaps
- `chatgpt.mjs:329` — `reasoningEffort` tracked but not used for timeout scaling
- `chatgpt.mjs:62-78` — stability heuristic based on text length, not thinking state detection
- 500ms poll interval is fixed, no exponential backoff
- Intermediate "thinking" responses can trigger false completion
- Deep Research mode uses same base timeout as regular queries

## Goal
Model-aware timeout scaling: instant (short), thinking/standard (medium), pro/heavy/deep-research (long). Adaptive poll interval with backoff.

## Test Coverage Needed
- Unit tests for timeout calculation per model+effort combination
- Integration test: thinking model with heavy effort completes without premature timeout
- Integration test: instant model completes without unnecessary wait
- Edge case: response pauses mid-stream then resumes

## Decision (locked 2026-06-19)
Hardcoded timeout table (no history-learning). instant ≈ 120s, thinking/standard ≈ 600s, **pro/heavy/deep-research = 3600s**. This `resolveTimeoutSeconds` is the single source of truth for the model-aware deadline reused by `260619_tab_parallel_stability` (lease TTL). See `01_root_cause.md`, `10_solution_plan.md`.

## Pressure-test (2026-06-20) — DOWNSCOPE ~80%
`--timeout` escape hatch + action-button done-signal already exist. Real scope = 4-entry tier-default map + export `pro=3600` + 1 doc line + 1 test. Claims 2/3/4 dropped. See `20_pressure_test_verdict.md`.

## Status — CLOSED 2026-06-20 (implemented → _fin)
- [x] Interview/requirements gathering
- [x] Plan (`10_solution_plan.md`) — superseded for scope
- [x] Pressure-test (`20_pressure_test_verdict.md`)
- [x] Implementation (MVV): commit `1d86985` — `TIER_DEFAULT_TIMEOUT_SEC`/`resolveTimeoutDefaultSec` in `session.mjs`, applied at `cli.mjs` input builder, `--help` updated
- [x] Verification: vitest 837/837 unit + 14/14 affected + 6/6 integration, `npm run gate:all` 16/16
