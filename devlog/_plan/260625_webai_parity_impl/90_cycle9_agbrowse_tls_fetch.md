# 90 — Cycle (agbrowse (.mjs))

> Part of [00_plan.md](00_plan.md) · Goal `68727b6d-d01` · **Status: ⬜ PENDING (stub — diff-level detail filled at this cycle's P/B phase)**

## Target
- **Repo / lang:** agbrowse (.mjs)
- **Severity:** P1
- **Gate command:** `npm run gate:typecheck && npm run gate:tests && npm run docs:drift && npm run docs:counts`

## Gaps in scope
203.1 TLS-impersonation (JA3 / curl-impersonate) [P1] + adaptive-fetch ladder core integration. (203.2–203.9 — yt-dlp, camoufox, feed-parser, BM25, table extractor, lane discovery, live-status struct, copy-markdown fallback — deferred to Cycle 11 per the slice map.)

## Plan (P-phase 2026-06-25)
Reverse port of cli-jaw `src/browser/adaptive-fetch/tls-fetch.ts` → agbrowse `skills/browser/adaptive-fetch/tls-fetch.mjs` (`.ts`→`.mjs`, `// @ts-check` + JSDoc). agbrowse already has the matching `validateFetchUrl(url,{allowPrivateNetwork})` in `safety.mjs` and the ladder-result shape in `fetcher.mjs:fetchTextCandidate`. Integration mirrors cli-jaw `scheduler.ts:172` — on a blocked fetch (403/429/challenge) try TLS before browser escalation. New branch `feat/webai-parity-200-260625` off `main`.

| File | Change |
|---|---|
| `skills/browser/adaptive-fetch/tls-fetch.mjs` | NEW — `detectCurlImpersonate`, `selectProfile`, `tlsFetch`, ladder adapter `tlsFetchCandidate` |
| `skills/browser/adaptive-fetch/index.mjs` | MODIFY — import + Phase 04b TLS fallback rung (after challenge classify, before browser escalation) |
| `structure/str_func.md` · `CAPABILITY_TRUTH_TABLE.md` | doc sync (new module row + capability list/desc) |

## Build log (B-phase)
- **Commit `58a3a4a`** on `feat/webai-parity-200-260625`: tls-fetch.mjs (158 ln) + index.mjs Phase-04b rung + 3 unit tests + structure-doc sync. No-op when curl-impersonate is absent (CI-safe); SSRF-guarded on initial + post-redirect URL.

## Verification
- **A-phase:** catalog 203.1 re-confirmed against live agbrowse — `grep curl_cffi/impersonate/ja3` = 0 (header-only waf-profiles); `safety.mjs:validateFetchUrl` + `fetcher.mjs` ladder shape present as expected.
- **C-phase (gate):** full agbrowse gate green — `gate:typecheck` PASS (node --check 7 entries + drift), `gate:tests` PASS (unit + MCP + source-audit + trace-policy), `docs:drift` 144 checks, `docs:counts` 63 checks. New TLS test 3/3.
