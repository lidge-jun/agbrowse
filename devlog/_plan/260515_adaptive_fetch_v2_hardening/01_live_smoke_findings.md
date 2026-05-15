---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, smoke, findings]
---

# Live Smoke Findings

## Commands Used

Baseline HTTP-only command:

```bash
node bin/agbrowse.mjs fetch <url> --json --trace --browser never --timeout-ms 15000
```

Additional checks already run:

```bash
npm run smoke:bins
npm run typecheck
npm run typecheck:checkjs
npx vitest run test/unit/browser-adaptive-fetch-*.test.mjs
npx vitest run test/integration/browser-fetch-command.test.mjs
npm run docs:counts
npm run docs:drift
npm run check:module-graph
npm run pack:dry
```

## Passing Static And Deterministic Gates

| Gate | Result |
|---|---|
| bin smoke | PASS |
| `tsc --noEmit` | PASS |
| checkjs typecheck | PASS |
| adaptive fetch unit suite | PASS: 11 files, 68 tests |
| browser fetch integration | PASS: 1 file, 16 tests |
| docs counts/drift after count fix | PASS |
| module graph | PASS |
| package dry-run | PASS |

## Live HTTP-only Observations

| URL family | Current result | Notes |
|---|---|---|
| NYT | `blocked`, `fetch`, status 200 in latest run | Still blocked; older 403-specific expectation is not stable |
| GitHub repo | `strong_ok`, `public_endpoint` | Good public API path |
| HN item | `strong_ok`, `public_endpoint` | Good Algolia/Firebase ladder |
| Reddit root | command exits 0 but `--json` stdout is invalid at 65536 bytes | Blocker |
| Wikipedia | previously `strong_ok`, `public_endpoint` | Good public endpoint path |
| arXiv | previously `strong_ok`, `public_endpoint` | Good export path |
| Medium | previously `auth_required`, `fetch` | Classification differs from old blocked/Cloudflare note |
| WSJ | previously `auth_required`, `fetch` | Expected paywall/auth boundary |
| npm package | previously `blocked`, `fetch`, status `200,403,403` | Not consistently registry-backed strong_ok |

## Blocker: Invalid JSON Output

Reproducer:

```bash
node bin/agbrowse.mjs fetch https://www.reddit.com/ --json --trace --browser never --timeout-ms 15000
```

Observed:

```text
stdout length=65536
JSON.parse(stdout) -> Unexpected end of JSON input
```

The output starts as a normal JSON result:

```json
{
  "ok": true,
  "verdict": "strong_ok",
  "source": "public_endpoint",
  "finalUrl": "https://www.reddit.com/.json",
  "content": "{\"kind\": \"Listing\", ..."
}
```

The failure means stdout is being truncated after serialization, or a large
string is entering the serializer through a path that is later clipped. The fix
must guarantee that truncation happens before JSON serialization and preserves
valid JSON.

## Interpretation

The old v1 live table is no longer a reliable acceptance table for v2. v2 has
broader public endpoint routing, so some sites move to different sources. The
new acceptance bar should be:

- machine-readable JSON is always valid;
- all attempts disclose source, status, evidence, warning, and boundary;
- blocked/challenge/auth results are classified without stopping the ladder too
  early;
- browser and user-session modes are tested separately from HTTP-only mode.

