# 30 — Bridge Artifact Transfer: Oracle Analysis

Date: 2026-07-12
Oracle commit: `bda0326d43b02c5346e742692865fc21d8c5fc35` (PR #277, Jul 2)
Oracle files: `src/browser/artifacts.ts`, `src/browser/chatgptFiles.ts`, `src/remote/server.ts`, `src/remote/client.ts`, `src/remote/types.ts`
agbrowse files: `web-ai/session-artifacts.mjs`, `web-ai/chatgpt-files.mjs`, `web-ai/code-artifact.mjs`

## Oracle's Bridge Artifact Transfer

Oracle added a complete cross-machine file transfer protocol for its "bridge" architecture (Windows browser host + Linux API client). This is a substantial feature (the commit touches ~20 files with 1000+ lines of new code).

### Architecture

1. **Host side**: The browser host saves ChatGPT-generated files locally, then emits a redacted `artifact-ready` event over the NDJSON run stream. The event contains only: artifact ID, safe filename, MIME type, byte size, SHA-256, validation status, and source kind. It does NOT expose cookies, bearer tokens, signed ChatGPT download URLs, or Windows filesystem paths.

2. **Client side**: The Linux client fetches `GET /runs/<runId>/artifacts/<artifactId>` with the bridge bearer token, writes to the local session artifacts directory, verifies size and SHA-256, validates ZIP structure, and publishes the final path.

3. **Capability discovery**: `/health` now returns `capabilities.artifactTransfer: true` and `capabilities.artifactProtocolVersion: 1`. The client uses this to determine if artifact transfer is available.

4. **Fallback**: If transfer fails or versions are mixed, Oracle keeps the text response and prints manual-copy instructions.

### Reusable Patterns (Applicable to agbrowse)

Several patterns from this commit are independently valuable, regardless of bridge architecture:

#### 1. `sanitizeArtifactFilename()`

```javascript
// Normalizes path separators, strips null bytes, removes .crdownload suffix,
// falls back to "artifact.bin" for empty/dot-only results
export function sanitizeArtifactFilename(value, fallback = "artifact.bin") {
  const normalized = String(value ?? "").replace(/\0/g, "").replace(/\\/g, "/");
  const basename = path.basename(normalized).replace(/\.crdownload$/i, "");
  // ... sanitize and fallback
}
```

agbrowse's `session-artifacts.mjs` has `sanitizeSegment()` and `chatgpt-files.mjs` has `sanitizeDownloadFilename()`. These should be compared for equivalence.

#### 2. ZIP Structure Validation

Oracle now validates ZIP files at the binary level:
- Local file header signature check (`0x04034b50`)
- End of Central Directory (EOCD) signature search (`0x06054b50`)
- EOCD comment length consistency
- Central directory offset/size bounds check
- Both buffer-based (`validateZipBuffer`) and file-based (`validateZipFile`) variants

agbrowse's `code-artifact.mjs` already performs thorough ZIP validation (local-header magic, EOCD search, central-directory entry count/offset/bounds checks at line 188+). This is on par with Oracle's `validateZipBuffer`/`validateZipFile`.

#### 3. SHA-256 Artifact Hashing

Oracle now computes and records SHA-256 for every artifact (`computeBufferSha256`, `computeFileSha256`). This enables integrity verification during transfer and provides a deduplication key.

agbrowse does not currently hash artifacts.

#### 4. Artifact Validation Metadata

Every artifact now carries `validation: { type, ok, error? }` and `transfer: { status }` fields. This structured metadata makes it possible to distinguish between "file saved but corrupt" and "file saved and verified".

#### 5. Download Diagnostics

`safeDiagnosticText()` redacts tokens, URLs, and secrets from diagnostic output. `decodeDiagnosticBodySnippet()` safely extracts the first ~180 bytes of a response body for logging without exposing sensitive data.

#### 6. Broader File-Card/Download Discovery

`buildClickAssistantDownloadButtonsExpression` was hardened to:
- Ignore non-interactive elements (DIV) with download metadata
- Allow sandbox anchors as fallback controls
- Reject external download anchors (only ChatGPT-origin allowed)
- Mark clicked controls to prevent re-clicking

## agbrowse Relevance

| Pattern | agbrowse Status | Adoptable? |
| --- | --- | --- |
| Bridge artifact transfer protocol | N/A — agbrowse has no bridge architecture | No |
| `sanitizeArtifactFilename` | `chatgpt-files.mjs:sanitizeDownloadFilename()` exists | Compare and align |
| ZIP structure validation (EOCD, central directory) | `code-artifact.mjs:188+` already has EOCD + central-directory validation | **Covered** — no action needed |
| SHA-256 artifact hashing | Not implemented | **P2 — add** for integrity |
| Artifact validation metadata | Not implemented | **P2 — add** structured validation |
| Download diagnostics with secret redaction | Not implemented | **P2 — useful for debugging** |
| Broader download-button discovery | `chatgpt-files.mjs` has its own approach | Compare scope |

### Recommended Actions

1. **P2 — Add SHA-256 to artifact records**: Compute and store SHA-256 for saved artifacts in `session-artifacts.mjs`. Useful for dedup, integrity verification, and eventual remote-transfer scenarios.

3. **P2 — Compare `sanitizeDownloadFilename` vs Oracle's `sanitizeArtifactFilename`**: Verify that agbrowse's sanitization handles the same edge cases (null bytes, .crdownload suffix, path traversal via backslash normalization).

4. **Defer — Bridge architecture**: No action needed unless agbrowse grows a remote execution model.

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
