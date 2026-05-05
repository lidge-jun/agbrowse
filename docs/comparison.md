---
created: 2026-05-05
tags: [agbrowse, comparison, release-claims]
---

# Comparison Boundary

`agbrowse` should be described as a local Chrome/CDP browser automation and
web-ai runtime for agents. It is not a hosted browser platform, autonomous
planner, CAPTCHA bypass system, or official provider API.

## Current Positioning

| Area | agbrowse current state | Claim allowed |
| --- | --- | --- |
| Local CDP control | Ready for local Chrome profile workflows | Yes |
| Web-ai provider UI flows | Beta for ChatGPT/Gemini/Grok | Yes, with beta label |
| Offline DOM churn eval | Ready | Yes |
| Trace/policy/source audit | Ready in agbrowse | Yes |
| MCP bridge | Narrow ready surface only | Only listed tools |
| Remote hosted browser | Deferred | No |
| Benchmarks vs competitors | Trajectory format only | No score/leaderboard claim |

## Comparison Rules

- Compare features only against implemented and tested surfaces.
- Label live-provider flows as beta even when smoke tests pass.
- Do not claim parity with hosted browser products until remote-CDP adapters and
  cloud security boundaries are implemented.
- Do not claim benchmark superiority until Phase 20 has a fixed task set,
  model, planner, browser environment, and published trajectory artifacts.
- Do not claim stealth, CAPTCHA bypass, Cloudflare bypass, or subscription
  entitlement guarantees.

## Known Gaps to Track

| Gap | Closeout owner |
| --- | --- |
| cli-jaw mirror for semantic resolver/source audit | cli-jaw Phase 22 closeout |
| external-CDP adapter | Future Phase 19 implementation |
| broader MCP browser tool set | Future Phase 18 expansion |
| benchmark task runner against real tasks | Future Phase 20 expansion |
| public comparison citations and score methodology | Future release docs |
