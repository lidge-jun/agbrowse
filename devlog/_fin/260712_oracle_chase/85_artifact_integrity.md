# 85 — Artifact Integrity Assessment (G11 + G13 + G14)

Date: 2026-07-13
Status: audited — implement recommended, deferred to dedicated hardening cycle
Oracle commit: `bda0326d43b02c5346e742692865fc21d8c5fc35`
Sol explorer: Hooke, reasoning_effort=high

## G11 — SHA-256 Artifact Hashing

**Status: Missing. Recommendation: implement (moderate complexity)**

`session-artifacts.mjs` computes no hash. No crypto import exists. The `ArtifactDescriptor` schema has no hash/checksum field.

Current artifact record schema (`session-artifacts.mjs:10`):
```js
{ kind, label, path, mimeType?, sizeBytes?, sourceUrl?, screenshotPath?, savedAt }
```

Implementation would require:
- Import `createHash` from `node:crypto`
- Add `sha256?: string` to descriptor
- Hash bytes at 5 save sites: transcript (line 67), report (111), image (152), file (211), diagnostics (256)
- Diagnostics has a two-file case (JSON + optional screenshot) needing separate hashes

**Deferred rationale**: moderate complexity across all artifact types. Generic file hashing alone is trivial, but consistent schema coverage requires a helper + integration + tests. Not blocking any current workflow; prioritize after G8/G9 fixes.

## G13 — Artifact Validation Metadata

**Status: Missing. Recommendation: implement (moderate complexity)**

Stored artifact records have no `validation` metadata. The transient save-result envelope (`trySaveFileArtifact` at `session-artifacts.mjs:21`) returns `{ok, stage, error}` but this is not persisted on the artifact record. `chatgpt-files.mjs:421` appends only successful `res.descriptor` objects.

Oracle's schema: `validation: { type: 'zip'|'generic', ok: boolean, error?: string }`

Implementation needs a decision: should invalid files be rejected (not recorded) or retained with `validation.ok === false`? Oracle retains them with validation metadata for diagnostic visibility. Broad format-specific validation (CSV/PDF/ZIP) is separate work; the metadata schema itself is simple.

**Deferred rationale**: the metadata schema is simple but the validator dispatch and "retain vs reject" policy decision make this moderate complexity. agbrowse's existing ZIP validation in `code-artifact.mjs:188+` is thorough for code artifacts; extending to generic downloaded files requires defining which formats get validated.

## G14 — Download Diagnostics with Secret Redaction

**Status: Missing. Recommendation: implement (priority — security concern)**

`chatgpt-files.mjs` has no redaction. Diagnostics go through the `warnings` array:

- 5 warning patterns: `file-artifact-no-session`, `file-artifact-skipped-after-timeout:${sourceUrl}`, `file-artifact-timeout:${sourceUrl}`, `file-artifact-fetch-failed:${sourceUrl}`, `file-artifact-save-failed:${stage}`
- URL-bearing warnings interpolate the complete normalized URL including query parameters (`chatgpt-files.mjs:117` preserves them via `u.toString()`)
- Non-2xx responses discard HTTP status and redirected URL (`chatgpt-files.mjs:350`)
- Other exceptions discard error name/message/code (`chatgpt-files.mjs:360`)
- Cookie retrieval failures silently return empty (`chatgpt-files.mjs:327`)
- No `safeDiagnostic`, redaction, or URL masking exists

**Security concern**: sandbox paths, file IDs, query parameters, and token-like values can reach warning output unredacted. While cookies themselves are never in warnings, the URLs may contain signed download tokens.

**Implementation needed**:
1. `safeDiagnosticUrl()` helper: strip credentials, query strings, fragments, opaque file IDs
2. Structured fetch failure result: `{reason, status?, timeoutMs?, errorCode?}` instead of bare `{failed: true}`
3. Format warnings exclusively from redacted structured data
4. Tests for URLs with `token`, `sig`, sandbox filenames, and file IDs

**Deferred rationale**: this is the highest-priority artifact integrity item (raw URLs in diagnostic output). Should be first in the implementation sequence. Complexity is moderate — one redaction helper + fetch result enrichment + warning integration.

## Implementation Order (when ready)

1. **G14** first — security (raw URLs in diagnostics)
2. **G11** next — integrity (SHA-256 hashing)
3. **G13** last — observability (validation metadata)

All three fit within the artifact/download boundary and don't require architectural changes.

## Source Anchors

| File | Lines | Finding |
| --- | --- | --- |
| `session-artifacts.mjs` | 2 | No crypto import |
| `session-artifacts.mjs` | 10 | ArtifactDescriptor schema (no hash/validation) |
| `session-artifacts.mjs` | 21, 228 | `trySaveFileArtifact` transient envelope (ok/stage/error) |
| `session-artifacts.mjs` | 67, 111, 152, 211, 256 | Five save sites needing SHA-256 |
| `session-artifacts.mjs` | 295 | `appendArtifactRecord` dedup by kind+path |
| `chatgpt-files.mjs` | 117 | URL normalization preserves query params |
| `chatgpt-files.mjs` | 327 | Cookie failure → empty header (silent) |
| `chatgpt-files.mjs` | 346-360 | Download failure: status/error discarded |
| `chatgpt-files.mjs` | 385-422 | Five warning patterns with raw URLs |
| `chatgpt-files.mjs` | 421 | Only successful descriptors appended |

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
