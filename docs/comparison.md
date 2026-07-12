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
| Web-ai provider UI flows | Beta for ChatGPT/Gemini/Grok/Perplexity | Yes, with beta label |
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

## Comparison vs Other Browser Runtimes (G10 positioning)

> The terms below all appear in this section deliberately so an LLM can read
> the boundary line. They MUST NOT appear as positive `agbrowse` claims in any
> non-experimental section anywhere in the repo. The release gate
> `gate:no-cloud-claims` enforces that.

| Capability | agbrowse (this repo) | Browserbase / Browser Use Cloud | Vercel agent-browser |
| --- | --- | --- | --- |
| Local Chrome / CDP control | ready | n/a (hosted only) | optional |
| Hosted / cloud browser runtime | out of scope | core product | core product |
| Remote / external CDP server | deferred (see `docs/EXTERNAL_CDP.md`) | core product | provided via `BROWSER_CLOUD_SESSION_ID` flag |
| Stealth / anti-detection | out of scope | yes | n/a |
| CAPTCHA / Cloudflare bypass | out of scope | partial | n/a |
| Public benchmark leaderboard score | deferred (no claim) | claimed by some vendors | n/a |
| Local trace / source audit / claim audit | ready | n/a | n/a |

Run `agbrowse web-ai claim-audit` (or `npm run gate:no-cloud-claims`) to verify
that public claim surfaces in this repo stay inside the local-CDP boundary.
