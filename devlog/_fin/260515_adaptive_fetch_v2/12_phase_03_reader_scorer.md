---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, phase-03, reader, scorer]
---

# Phase 03 — Reader Adapters, Content Scorer, Third-Party Readers

## Goal

Normalize all result sources into one ReaderCandidate shape. Score candidates.
Pick the best one with evidence. Add opt-in third-party readers.

## Modified Files (all exist from v1)

```
skills/browser/adaptive-fetch/reader-adapters.mjs       add fromHumanResolvedResult adapter
skills/browser/adaptive-fetch/content-scorer.mjs         add user_session/human_resolved source trust
skills/browser/adaptive-fetch/third-party-readers.mjs    already implemented
skills/browser/adaptive-fetch/index.mjs                  wire user/interactive session into scoring
skills/browser/adaptive-fetch/safety.mjs                 add credential-URL filtering for readers
```

## Existing Tests (update)

```
test/unit/browser-adaptive-fetch-reader-adapters.test.mjs     add human_resolved cases
test/unit/browser-adaptive-fetch-content-scorer.test.mjs       add source trust for new sources
test/unit/browser-adaptive-fetch-third-party-readers.test.mjs  already implemented
```

## Diff Shape

### reader-adapters.mjs

```js
export function fromFetchResult(result) { /* → ReaderCandidate */ }
export function fromPublicEndpointResult(result, endpoint) { /* → ReaderCandidate */ }
export function fromMetadataResult(result) { /* → ReaderCandidate */ }
export function fromReaderServiceResult(result) { /* → ReaderCandidate */ }
export function fromBrowserResult(result) { /* → ReaderCandidate */ }
export function fromNetworkApiResult(result) { /* → ReaderCandidate */ }
export function fromHumanResolvedResult(result) { /* → ReaderCandidate */ }
```

Each adapter:
1. Extracts text, title, metadata from its source format
2. Classifies content strength via validators
3. Attaches source and phase info
4. Returns normalized ReaderCandidate

### content-scorer.mjs

```js
export function scoreCandidate(candidate, options = {}) {
  const factors = {
    textLength: scoreTextLength(candidate.text),
    textDensity: scoreTextDensity(candidate.text, candidate.html),
    metadataQuality: scoreMetadata(candidate.metadata),
    structuralDepth: scoreStructure(candidate.html),
    schemaPresence: scoreSchema(candidate.metadata),
    sourceTrust: scoreSourceTrust(candidate.source),
    negativePenalty: scoreNegatives(candidate),
  };

  candidate.score = weightedSum(factors, SCORE_WEIGHTS);
  candidate.evidence.push(...explainScore(factors));
  return candidate;
}

export function chooseBestCandidate(candidates) {
  // Score all, sort by score, return best with evidence
}

export function verdictFromScore(score) {
  if (score >= 0.70) return 'strong_ok';
  if (score >= 0.40) return 'weak_ok';
  return null; // needs escalation
}
```

### third-party-readers.mjs

```js
export function shouldUseReader(options) {
  return options.reader !== 'none';
}

export function shouldUseArchive(options) {
  return !!options.archive;
}

export async function fetchJinaReader(url, options) {
  // GET https://r.jina.ai/<url>
  // Returns markdown text
  // Refuses private/local/credential URLs via safety.validateFetchUrl
}

export async function fetchWaybackMachine(url, options) {
  // Check CDX API for latest snapshot
  // Fetch archived version
  // Mark as low-trust with timestamp
}

export async function fetchGoogleCache(url, options) {
  // Try Google Cache URL
  // Mark as archive source
}
```

Rules:
- Default off
- Enabled only by `--reader jina`, `--archive`
- Source labeled `reader` or `archive`
- Private/local/credential URLs rejected
- Failures become trace warnings, not fake success

### index.mjs (modify)

Wire scoring into the scheduler:

```js
// After Phase 0 and Phase 1 candidates collected:
const scored = candidates.map(c => scoreCandidate(c));
const best = chooseBestCandidate(scored);
if (best && verdictFromScore(best.score) === 'strong_ok') {
  return buildResult(best, trace);
}

// Phase 2: reader services (opt-in)
if (shouldUseReader(options)) {
  const readerResult = await fetchJinaReader(url, options);
  candidates.push(fromReaderServiceResult(readerResult));
}
if (shouldUseArchive(options)) {
  const archiveResults = await Promise.allSettled([
    fetchWaybackMachine(url, options),
    fetchGoogleCache(url, options),
  ]);
  // ...push fulfilled results
}

// Re-score with new candidates
const allScored = candidates.map(c => scoreCandidate(c));
const bestAll = chooseBestCandidate(allScored);
```

## Tests

- fetch, metadata, public endpoint, browser shapes normalize to one contract
- 5000-char article text beats 200-char metadata-only shell
- public endpoint with full JSON body beats generic HTML shell
- challenge text with 200 status is penalized
- winner evidence includes score breakdown and reason
- Jina reader disabled by default
- Jina reader refuses localhost/private URLs
- archive results marked low-trust with snapshot timestamp
- third-party reader failures → trace warning, not fake success

## Acceptance

- Success selected by candidate quality, not first-response order
- Trace explains why a candidate won
- Third-party readers work as opt-in only

## Verify

```bash
npm test -- browser-adaptive-fetch-reader-adapters browser-adaptive-fetch-content-scorer browser-adaptive-fetch-third-party-readers
npm run typecheck
```
