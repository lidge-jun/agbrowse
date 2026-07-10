# README.md Update Evidence

**Task**: Update README.md to reflect recent feature additions from commit log.
**File**: `/Users/jun/Developer/new/700_projects/agbrowse/README.md`
**Date**: 2026-07-10

## Diff Summary

- 142 lines added, 20 lines modified
- Final line count: 1310 (was 1220)
- Only `README.md` was touched

## Sections Updated

### 1. Research Subcommands (new subsection under Standalone Search)
- Added `#### Research Subcommands` with examples for `plan`, `normalize-results`, `enrich-fetch`, `browse-plan`
- **Source verification**: All 4 commands confirmed in `structure/commands.md` (grep count: 1 match block)

### 2. Adaptive URL Fetch — Fetch Modules (203.x) (new subsection)
- Added table of 7 modules: 203.1 TLS impersonation, 203.2 yt-dlp, 203.3 Camoufox, 203.4 feed parser, 203.5 BM25, 203.6 structured extractor, 203.7 candidate discovery
- **Source verification**: All 7 module source files exist in `skills/browser/adaptive-fetch/`:
  - `tls-fetch.mjs` (6055 bytes)
  - `ytdlp-reader.mjs` (4257 bytes)
  - `camoufox-session.mjs` (3178 bytes)
  - `feed-parser.mjs` (8153 bytes)
  - `bm25-filter.mjs` (2485 bytes)
  - `structured-extractor.mjs` (5676 bytes)
  - `candidate-discovery.mjs` (6922 bytes)
- Commits confirmed: `58a3a4a` (203.1), `8b4e4e5` (203.2+203.3), `fd2acf7` (203.4), `bf08e76` (203.5), `d5b0250` (203.6), `6d60629` (203.7)

### 3. WAF Profile Detection (new subsection)
- Lists 6 detected WAF systems: Cloudflare (managed+Turnstile), Akamai Bot Manager, AWS WAF, Imperva/Incapsula, DataDome, PerimeterX
- **Source verification**: `skills/browser/adaptive-fetch/waf-profiles.mjs` exists (4021 bytes); confirmed in CAPABILITY_TRUTH_TABLE.md adaptive-fetch row

### 4. SSRF Mitigation and Redirect Safety (new subsection)
- Documents DNS pinning via `curl --resolve` and per-hop validated redirect loop
- **Source verification**: `safety.mjs` contains 2 matches for resolve/SSRF/pinning; commits `4a620a2` (R4-SSRF) and `3d7b42a` (R4 redirect) confirmed

### 5. Web-AI Runtime Capabilities (201.x / 203.8) (new subsection)
- Table of 7 capabilities: capability registry, annotated screenshots, interstitial detector, diagnostics stage taxonomy, provider lifecycle adapter, freshness gate, live-status report
- **Source verification**: All 7 commits confirmed in git log:
  - `398d29b` (201#1+1a+2+8), `29902da` (201#3+#5), `1c9bdb2` (201#4), `8276716` (201#6), `b8119c5` (201#7), `15564ff` (201#9), `c25c590` (203.8)

### 6. Safety Model — SSRF bullet added
- Added one bullet point cross-referencing the Adaptive Fetch SSRF details

### 7. Status section — Source structure table
- Added 6-row table from `structure/str_func.md` (dated 2026-06-27)
- Added search + research to Ready surfaces list
- Added 203.x modules + 201.x capabilities to Experimental surfaces list
- **Source verification**: Counts match `str_func.md`: skills/browser 54/15587, web-ai 112/25409, test/unit 136/15340

## Integrity Checks

- No duplicate section headers (verified via `rg '^##' | sort | uniq -c`)
- 87 table rows with proper pipe syntax (no broken tables)
- All 7 newly documented 203.x modules have README mentions (grep count: 7)
- All 7 web-ai 201.x capabilities have README mentions (grep count: 7)
- Research commands appear 4 times in README (grep count: 4)
- WAF/SSRF terms present in README (WAF: 4, SSRF: 6)
- Source counts from str_func.md present in README (grep count: 3)

## Judgement

PASS. All additions are sourced from verified commit log, source files, `commands.md`, and `CAPABILITY_TRUTH_TABLE.md`. No sections were rewritten unnecessarily. No files other than README.md were modified. Formatting is consistent with existing README conventions.
