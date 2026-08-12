# Evidence: Adaptive Fetch + Source Audit Guide Update (EN + KO)

## Task
Update the Adaptive Fetch guide and Source Audit guide (EN + KO) based on recent commits.

## Files Changed
| File | Bytes |
|---|---|
| docs/dev/guides/adaptive-fetch.html | 8961 |
| docs/dev/guides/source-audit.html | 4020 |
| docs/dev/ko/guides/adaptive-fetch.html | 7159 |
| docs/dev/ko/guides/source-audit.html | 3462 |

## Git Diff Summary
4 files changed, 35 insertions(+), 7 deletions(-)

## Verification 1: HTML Structure Integrity
All 4 files: valid HTML parse, no mismatched tags.
Each file contains exactly 1 of: topbar, sidebar, main#main, footer, _search.js ref, _shell.css ref.
VERDICT: PASS

## Verification 2: Content Coverage (28+8+20+8 terms)
### EN adaptive-fetch.html (28 terms)
All present: TLS-impersonation, curl-impersonate, chrome131, safari18, firefox133,
yt-dlp, Camoufox, RSS, Atom, JSON Feed, BM25, structured extractor, candidate discovery,
SSRF DNS pinning, curl --resolve, TOCTOU, Validated redirect loop, validateFetchUrl,
finalUrl, Cloudflare, Akamai, AWS WAF, Imperva, DataDome, PerimeterX, contentBytes,
contentTruncated, Escalation ladder.
VERDICT: PASS

### EN source-audit.html (8 terms)
All present: claim-audit, gate:no-cloud-claims, CAPABILITY_TRUTH_TABLE,
npm run gate:no-cloud-claims, npm run gate:all, live-status report,
source-audit-scope, source-audit-date.
VERDICT: PASS

### KO adaptive-fetch.html (20 terms)
All present: TLS-impersonation, curl-impersonate, chrome131, yt-dlp, Camoufox,
RSS, Atom, JSON Feed, BM25, SSRF, curl --resolve, TOCTOU, Cloudflare, Akamai,
AWS WAF, Imperva, DataDome, PerimeterX, contentBytes, Escalation ladder.
VERDICT: PASS

### KO source-audit.html (8 terms)
All present: claim-audit, gate:no-cloud-claims, CAPABILITY_TRUTH_TABLE,
npm run gate:no-cloud-claims, npm run gate:all, live-status report,
source-audit-scope, source-audit-date.
VERDICT: PASS

## Verification 3: Write Scope
Only the 4 listed files were modified by this task. All other dirty files
in the worktree are from other parallel workers or prior user commits.
VERDICT: PASS

## Verification 4: Shell Structure Preserved
Topbar, sidebar nav links, lang switcher, footer, _search.js script tag
are identical to originals. Only <main id="main">...</main> content was updated.
VERDICT: PASS

## Commits Incorporated
- feat(adaptive-fetch/203.1): TLS-impersonation rung (JA3 spoof via curl-impersonate)
- feat(adaptive-fetch/203.2+203.3): yt-dlp media reader + Camoufox stealth lane
- feat(adaptive-fetch/203.4): RSS/Atom/JSON-feed parser -> evidence
- feat(adaptive-fetch/203.5): BM25 lexical reranker
- feat(adaptive-fetch/203.6): structured table/heading extractor
- feat(adaptive-fetch/203.7): lane-classified candidate discovery
- feat(R6-C4): wire feed-parser + candidate-discovery into fetch ladder
- feat(R6): wire 203.x modules into adaptive-fetch ladder
- fix(R4-SSRF): pin curl to vetted DNS IPs via --resolve, close TOCTOU
- fix(R4/security): replace curl -L with per-hop validated redirect loop
- fix(R3): surface real finalUrl from curl effective URL + fix multi-hop header parse
- feat(web-ai/203.8): typed standalone live-status report struct
- feat(web-ai/203.9): copy-markdown lenient button fallback + real click
- claim-audit gate:no-cloud-claims integration documented

## Overall Verdict
PASS - all checks green.
