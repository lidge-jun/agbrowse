---
created: 2026-05-05
tags: [agbrowse, production-readiness, release]
---

# Production Readiness

This document maps public support labels to code-backed evidence. It is not a
guarantee that provider web UIs, accounts, subscriptions, CAPTCHA, or Cloudflare
checks will remain stable.

## Ready

Ready surfaces are deterministic or fail-closed and have local tests.

| Surface | Evidence |
| --- | --- |
| CLI browser primitives | `structure/commands.md`, unit/integration tests |
| Session, tab, and active command ownership | `web-ai/active-command-store.mjs`, tab lifecycle tests |
| Offline DOM churn eval | `web-ai/eval-runner.mjs`, `npm run test:eval` |
| Trace evidence and redaction | `web-ai/trace/`, `npm run test:trace-policy` |
| Safety policy schema and enforcement | `web-ai/policy/`, CLI/MCP policy tests |
| Semantic resolver in agbrowse | `web-ai/action-intent.mjs`, `web-ai/target-resolver.mjs` |
| Answer artifact and source audit in agbrowse | `web-ai/answer-artifact.mjs`, `web-ai/source-audit.mjs` |
| Narrow MCP bridge | `web_ai_*`, `browser_snapshot`, `browser_click_ref`, `npm run test:mcp` |
| Benchmark trajectory bundle format | `benchmarks/agbrowse/trajectory.mjs`, `benchmarks/agbrowse/run-task.mjs` |

## Beta

Beta surfaces are implemented but depend on live provider web UIs, account
state, and browser profile state.

| Surface | Required caution |
| --- | --- |
| ChatGPT/Gemini/Grok `send`, `poll`, `query` | Provider UI can change without notice |
| Model and reasoning-effort selection | Provider menus can be hidden or renamed |
| Provider source/citation behavior | Models may place citations in source drawers or omit inline sources |
| Context-package upload | Provider upload UI and file limits can change |

## Experimental / Deferred

| Surface | Current status |
| --- | --- |
| Remote `external-cdp` provider mode | Deferred; do not claim hosted/cloud support |
| Broad production MCP bridge | Deferred beyond current listed tools |
| Benchmark score or leaderboard comparison | Deferred until fixed model/planner/environment/task set exists |
| Stealth, CAPTCHA, Cloudflare bypass | Out of scope |

## Release Rules

- Use `structure/phase_status.md` as the phase truth table.
- Use `structure/release_gates.md` as the command checklist.
- Do not promote a beta or experimental surface to ready without code, tests,
  docs, and release-gate coverage.
- Do not describe live provider flows as a contractual API.
