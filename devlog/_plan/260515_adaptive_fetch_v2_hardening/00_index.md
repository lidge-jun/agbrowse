---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, hardening, live-smoke]
---

# Adaptive Fetch v2 Hardening Follow-up

## Why This Exists

The v2 implementation passed unit, integration, docs, package, and basic live
smoke checks, but harder live URL tests exposed gaps that are not fully covered
by deterministic fixtures:

- `fetch --json` can emit invalid truncated JSON when a large public endpoint
  response is selected, reproduced with Reddit.
- Some live classifications diverge from the older v1 observation table:
  Reddit now routes to `.json`, npm can be blocked instead of registry-backed,
  and Medium may classify as `auth_required` instead of generic `blocked`.
- The skill text needs to train agents to run the full escalation ladder without
  treating CAPTCHA/login/paywall markers as immediate stops.
- cli-jaw must receive the mirror patch, and its bundled OfficeCLI checkout must
  be audited for related skill guidance before the mirror is called complete.

## Document Set

| File | Purpose |
|---|---|
| `01_live_smoke_findings.md` | Current hard smoke evidence and divergences |
| `02_agbrowse_patch_plan.md` | Exact agbrowse implementation patch plan |
| `03_skill_patch_plan.md` | Browser skill and agent instruction patch plan |
| `04_cli_jaw_officecli_mirror_plan.md` | cli-jaw mirror plus OfficeCLI audit plan |
| `05_verification_matrix.md` | Commands that must pass before commit/push |

## Priority

1. Make `--json` output structurally valid for all result sizes.
2. Make live result schemas compact enough for agents to consume safely.
3. Preserve broader legitimate surface coverage:
   public endpoint -> direct fetch -> metadata/RSS/oEmbed -> opt-in reader ->
   isolated browser -> user session -> human loop.
4. Update skills so agents use the ladder intentionally and report boundaries.
5. Mirror to cli-jaw, including the OfficeCLI checkout audit requested by Jun.

## Non-goals

- No CAPTCHA solving.
- No stealth TLS/browser fingerprint impersonation libraries.
- No credential stuffing or private network access.
- No claim that all paywalled content is readable. User session mode can only
  use the user's own already-authorized browser state.

