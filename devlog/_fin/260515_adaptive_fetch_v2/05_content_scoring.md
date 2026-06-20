---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, scoring, reader, network-api]
---

# Content Scoring And Network API Discovery

## Reader Candidate Shape

All phases normalize results into one shape before scoring:

```js
/** @typedef {object} ReaderCandidate */
{
  source: 'public_endpoint' | 'fetch' | 'metadata' | 'reader' |
          'browser_isolated' | 'browser_user' | 'network_api' |
          'human_resolved' | 'archive',
  phase: 0 | 1 | 2 | 3 | 4 | 5,
  url: string,
  finalUrl: string,       // after redirects
  title: string,
  text: string,           // readable extracted text
  html: string | null,
  contentType: string,
  byteCount: number,
  metadata: {
    ogp: object | null,
    jsonLd: object | null,
    canonical: string | null,
    rss: string[] | null,
  },
  challenge: object | null,  // detected challenge info if any
  score: number,             // filled by scorer
  evidence: string[],        // why this candidate scored well/poorly
  warnings: string[],
}
```

### Adapter Functions

```js
// reader-adapters.mjs
export function fromFetchResult(result) {}
export function fromPublicEndpointResult(result) {}
export function fromMetadataResult(result) {}
export function fromReaderServiceResult(result) {}
export function fromBrowserResult(result) {}
export function fromNetworkApiResult(result) {}
export function fromHumanResolvedResult(result) {}
```

Each adapter extracts text, title, metadata from its source format and returns
a normalized `ReaderCandidate`.

## Scoring Model

```js
const SCORE_WEIGHTS = {
  textLength:      0.25,
  textDensity:     0.20,
  metadataQuality: 0.15,
  structuralDepth: 0.15,
  schemaPresence:  0.10,
  sourceTrust:     0.10,
  negativePenalty: 0.05,
};
```

### Factor Details

**textLength** (0-1):
```
<100 chars:   0.0
100-500:      0.3
500-2000:     0.6
2000-5000:    0.8
>5000:        1.0
```

**textDensity** (0-1): ratio of visible text to HTML. SPA shells and challenge
pages have very low density. Articles have high density.

**metadataQuality** (0-1): presence and quality of title, description, OGP tags,
canonical URL. A page with complete metadata is more likely real content.

**structuralDepth** (0-1): presence of semantic HTML — article, main, h1-h6,
paragraph count. Well-structured content signals a real page.

**schemaPresence** (0-1): JSON-LD, schema.org, microdata. Presence indicates
structured content, not a challenge page.

**sourceTrust** (0-1): trust ranking by source type.
```
public_endpoint:  1.0
network_api:      0.9
browser_user:     0.8
human_resolved:   0.8
browser_isolated: 0.7
fetch:            0.6
reader:           0.5
archive:          0.4
metadata:         0.3
```

**negativePenalty** (0-1, inverted): challenge markers, error page patterns,
CAPTCHA elements, login forms, paywall gates. Higher penalty → lower score.

### Verdict From Score

```
score >= 0.70  → strong_ok
score >= 0.40  → weak_ok
score <  0.40  → needs escalation (not a final verdict)
```

Challenge-detected candidates with low score trigger next phase rather than
returning immediately.

## Best Candidate Selection

```js
export function chooseBestCandidate(candidates) {
  const scored = candidates.map(c => ({
    ...c,
    score: scoreCandidate(c),
  }));

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  best.evidence.push(
    `Won with score ${best.score.toFixed(2)} over ${scored.length - 1} other candidates`,
    `Source: ${best.source}, Phase: ${best.phase}`,
  );

  return best;
}
```

## Network API Discovery

When browser render (Phase 3/4) succeeds but content is thin, inspect browser
network requests for richer API endpoints.

### Flow

```
1. During browser navigation, intercept XHR/fetch requests
2. Filter candidates:
   - Same origin or known CDN
   - JSON content-type response
   - Body > 1KB
   - Not authentication/session endpoints
   - Not tracking/analytics endpoints
3. Score each as a ReaderCandidate (via fromNetworkApiResult)
4. If a network API candidate scores higher than DOM text, prefer it
5. Record discovery in trace
```

### Implementation Using Existing CDP

v1 `browser-escalation.mjs` already collects network JSON candidates using
`page.on('response')` listener pattern. v2 adds tracking/auth endpoint filters:

```js
// Actual v1 pattern — page.on('response') listener collects JSON responses.
// v2 addition: filter out tracking/auth endpoints before pushing.
const onResponse = async (response) => {
  const ct = response.headers?.()['content-type'] || '';
  if (!/\bjson\b/i.test(ct)) return;
  const url = response.url?.() || '';
  if (isTrackingEndpoint(url) || isAuthEndpoint(url)) return; // v2 filter
  const text = await response.text();
  networkCandidates.push({ source: 'network_api', finalUrl: url, text, ... });
};
page.on('response', onResponse);
```

No new CDP method needed. Reuse existing infrastructure.

### Safety

- Only inspect, never modify network requests
- Only read responses the browser already received
- Redact query params and auth headers in trace output
- Do not replay discovered endpoints without user awareness
