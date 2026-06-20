---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, phase-02, http, endpoints]
---

# Phase 02 — Browser-Grade HTTP, Public Endpoints, Metadata

## Goal

First useful non-browser reads. Browser-grade headers by default.
Public endpoint resolution. Metadata extraction. URL transforms.

## Modified Files (all exist from v1)

```
skills/browser/adaptive-fetch/fetcher.mjs              add browser-grade headers as default
skills/browser/adaptive-fetch/endpoint-resolvers.mjs   already implemented
skills/browser/adaptive-fetch/metadata.mjs             already implemented
skills/browser/adaptive-fetch/transforms.mjs           already implemented
skills/browser/adaptive-fetch/index.mjs                wire identity option
```

## Existing Tests (update)

```
test/unit/browser-adaptive-fetch-endpoints.test.mjs    add identity header tests
test/unit/browser-adaptive-fetch-transforms.test.mjs   already implemented
```

## Diff Shape

### fetcher.mjs

```js
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const MINIMAL_HEADERS = {
  'Accept': '*/*',
};

export function getIdentityHeaders(identity = 'auto') {
  if (identity === 'minimal') return MINIMAL_HEADERS;
  return BROWSER_HEADERS; // auto and chrome both use browser headers
}

export async function fetchTextCandidate(url, options = {}) {
  // Uses getIdentityHeaders(options.identity)
  // Enforces maxBytes, timeoutMs
  // Follows redirects (max 10), re-checks each target via safety.validateFetchUrl
  // Returns: { status, headers, body, finalUrl, elapsed, bytes, contentType }
}
```

### endpoint-resolvers.mjs

```js
export function resolvePublicEndpointCandidates(url) {
  // Returns array of { url, source, label } for known platforms
  // Platform-agnostic: matches URL patterns, not hostnames
}

// Resolver registry
const RESOLVERS = [
  githubResolver,      // /repos/:owner/:repo → API, raw content
  redditResolver,      // reddit.com/r/... → .json suffix
  hackerNewsResolver,  // news.ycombinator.com/item → HN API
  arxivResolver,       // arxiv.org/abs/ → export API
  wikipediaResolver,   // wikipedia.org/wiki/ → REST summary
  npmResolver,         // npmjs.com/package/ → registry JSON
  pypiResolver,        // pypi.org/project/ → JSON API
  rssDiscoveryResolver, // any URL → check for RSS/Atom autodiscovery
];
```

### metadata.mjs

```js
export function extractMetadataFromHtml(html, url) {
  return {
    title: extractTitle(html),
    description: extractDescription(html),
    ogp: extractOpenGraph(html),
    jsonLd: extractJsonLd(html),
    canonical: extractCanonical(html),
    rssFeeds: extractRssLinks(html),
    favicon: extractFavicon(html),
  };
}
```

### transforms.mjs

```js
export function generateUrlTransforms(url) {
  // Returns max 4 URL variants:
  // original, mobile_subdomain, drop_www, canonical (if different)
}

export function htmlToReadableText(html) {
  // Strip tags, collapse whitespace, preserve structure
}

export function dedupeCandidateUrls(urls) {
  // Remove duplicates after normalization
}
```

### index.mjs (modify)

Wire Phase 0 and Phase 1 into the scheduler:

```js
// Phase 0: public endpoints
if (!options.noPublicEndpoints) {
  const endpoints = resolvePublicEndpointCandidates(url);
  for (const ep of endpoints) {
    const result = await fetchTextCandidate(ep.url, options);
    candidates.push(fromPublicEndpointResult(result, ep));
    appendAttempt(trace, { phase: 0, method: 'public_endpoint', ... });
    if (isStrongOk(result)) return buildResult(best(candidates), trace);
  }
}

// Phase 1: browser-grade HTTP + transforms
const urls = options.noTransforms ? [url] : generateUrlTransforms(url);
for (const u of urls) {
  const result = await fetchTextCandidate(u, options);
  candidates.push(fromFetchResult(result));
  appendAttempt(trace, { phase: 1, method: 'fetch', ... });
}
```

## Tests

- browser-grade headers sent by default (User-Agent, Sec-Fetch-*)
- minimal identity sends bare headers
- public endpoint resolvers only emit known safe endpoint shapes
- unknown domains return empty candidate list (no fake scrapers)
- metadata extracts title, OGP, JSON-LD, canonical, RSS from sample HTML
- weak metadata-only page → weak_ok verdict
- URL transforms produce max 4 variants
- fetch respects maxBytes and timeoutMs
- redirect targets validated via safety.validateFetchUrl

## Acceptance

- Normal public pages return useful fetch results
- Public endpoint hits return `source: "public_endpoint"`
- Browser-grade headers used by default
- No browser launch in this phase

## Verify

```bash
npm test -- browser-adaptive-fetch-endpoints browser-adaptive-fetch-transforms
npm run typecheck
```
