# 50 — Cycle 5: R8 + R9 Hygiene (both repos)

> Part of [00_plan.md](00_plan.md) · **Status: IN PROGRESS**

## R8: Convergence table correction

MODIFY `devlog/_plan/260625_webai_parity_impl/00_plan.md`:
- Update the convergence tracker to reflect remediation work
- Note that R1–R7 are now done, R8–R9 are the current cycle
- Mark 203.x wiring as DONE (was "unwired")
- Mark lock redesign as DONE (was structural concern)
- Add honest status notes for items GPT-Pro flagged as faith gaps

MODIFY `devlog/_plan/260627_gptpro_remediation/00_plan.md`:
- Fill final convergence tracker row for Cycle 5

## R9: Test coverage for R1–R4 fixes

Target: agbrowse test suite (these are the fixes made in agbrowse)

- NEW `test/unit/web-ai-tls-redirect.test.mjs`:
  - TLS redirect loop validates each hop
  - SSRF via open redirect is rejected
  - Multi-hop finalUrl is correct
  - Max redirects returns null

- NEW `test/unit/web-ai-envelope-shape.test.mjs`:
  - ProviderRuntimeDisabledError preserves errorCode/retryHint in envelope
  - Non-WebAiError objects don't accidentally match shape detection
