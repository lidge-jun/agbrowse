# 203 — cli-jaw Fetch Ladder + Misc → agbrowse

Date: 2026-06-25 · Parent: [200](200_clijaw_to_agbrowse_overview.md) · **Convergence Pass 1**
Source: cli-jaw `src/browser/adaptive-fetch/*.ts` + `src/browser/web-ai/*.ts` · Target: agbrowse `skills/browser/adaptive-fetch/*.mjs` + `web-ai/*.mjs`

Pass 1 (adjacent-layer lens) found cli-jaw's **adaptive-fetch ladder is materially richer** than agbrowse's — a whole class of fetch capabilities agbrowse lacks. All 200-direction (port cli-jaw→agbrowse) unless noted. These are deliberate agbrowse-evolution decisions.

## Fetch ladder (cli-jaw → agbrowse)

| # | Gap | cli-jaw file:symbol | agbrowse status | Pri |
| --- | --- | --- | --- | --- |
| 203.1 | **TLS-impersonation fetch** (JA3 spoof via curl_cffi — chrome131/safari18/firefox133) | `adaptive-fetch/tls-fetch.ts:tlsFetch` | ABSENT — agbrowse anti-bot is header-only `waf-profiles.mjs` (`grep curl_cffi/impersonate/ja3` = 0) | **P1** |
| 203.2 | **yt-dlp media/transcript reader** (audio/video/caption extraction lane) | `adaptive-fetch/ytdlp-reader.ts` | ABSENT (`grep yt-dlp/ytdlp` = 0) | P2 |
| 203.3 | **Camoufox stealth-browser** fallback (hardened fingerprint) | `adaptive-fetch/camoufox-session.ts` | ABSENT — agbrowse escalates only to its own CDP Chrome | P2 |
| 203.4 | **RSS/Atom/JSON-feed parser → evidence** (title/date/author items) + public-endpoint normalizers | `adaptive-fetch/feed-parser.ts:parsePublicFeed`, `public-endpoint-normalizers.ts` | agbrowse only *discovers* feed URLs (`adaptive-fetch/index.mjs:177`), never parses items | P2 |
| 203.5 | **BM25 lexical reranker** (tf-idf query-term relevance) | `adaptive-fetch/bm25-filter.ts` | agbrowse `content-scorer.mjs` scores page *quality* only (`grep bm25/idf` = 0) | P2 |
| 203.6 | **Structured table/heading extractor** (table-grid/heading-tree) | `adaptive-fetch/structured-extractor.ts:StructuredTable` | agbrowse `defuddle-extractor.mjs` yields readable prose only | P3 |
| 203.7 | **Lane-classified candidate discovery** at fetch time (official/package/academic/community/realtime/archive/fetch URL ranking) | `adaptive-fetch/candidate-discovery.ts:rankDiscoveredCandidates` | ABSENT in agbrowse adaptive-fetch (distinct from [202](202_search_discipline_to_agbrowse.md) A7 research-lanes) | P3 |

## Misc reverse-direction (cli-jaw → agbrowse)

| # | Gap | cli-jaw file:symbol | agbrowse status | Pri |
| --- | --- | --- | --- | --- |
| 203.8 | Typed standalone **live status report** struct (vendor/status/runtimeEnabled/notes), reused by status+health | `gemini-live.ts:reportGeminiLiveStatus`/`GeminiLiveStatusReport` | agbrowse returns a raw capability list, no typed report symbol | P2 |
| 203.9 | Copy-markdown **lenient button fallback** (`scoped.at(-1)` + real `button.click?.()`) finds a button when agbrowse returns `missing-button` | `copy-markdown.ts:captureCopiedResponseText` | agbrowse clicks only a *visible* button via synthetic events | P2 |

## Notes
- 203.1 (TLS-impersonation) is the highest-value reverse port: agbrowse's fetch ladder has no transport-layer fingerprint spoofing, a real anti-bot gap.
- Excluded (not gaps): adaptive-fetch `scheduler.ts` = the parallel-fetch orchestrator already noted as a parallel impl ([103](103_search_agbrowse_research_for_clijaw.md) B6); `live-smoke-manifest.ts` = test fixtures; `keyed-mutex.mjs` consumer is MCP-server (agbrowse-only, OOS).
- These add a **new dimension** to the 200 backlog beyond [201](201_webai_capability_registry_and_tools.md) (web-ai capabilities): cli-jaw's **fetch/research transport layer** is ahead of agbrowse's.
