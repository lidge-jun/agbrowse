# 31 — ChatGPT Downloadable Artifacts PABCD

Date: 2026-06-20
Status: PABCD plan; 2026-06-24 current-code re-audit complete
Parent: [30_oracle_0_15_delta_followup.md](30_oracle_0_15_delta_followup.md)

## Purpose

Oracle 0.14+ added generic ChatGPT downloadable-file capture for CSV, PDF,
ZIP, wheel, source-distribution, and similar file outputs. agbrowse currently
has two narrower paths:

- code-mode `/mnt/data/*.zip` retrieval in `web-ai/code-artifact.mjs`
- generated image retrieval in `web-ai/chatgpt-images.mjs`

This plan keeps code-mode ZIP strictness intact and adds a separate generic
file artifact lane for normal ChatGPT answers that expose downloadable files.

## 2026-06-24 Current-Code Re-audit

The old "ZIP gap" wording is too broad. agbrowse already has several ZIP and
artifact surfaces; the remaining Oracle delta is narrower: generic downloadable
files from normal ChatGPT answers are not yet persisted as session artifacts.

| Surface | Current agbrowse evidence | Status | Decision |
| --- | --- | --- | --- |
| Code-mode single ZIP retrieval | `web-ai/code-artifact.mjs`, `web-ai/cli.mjs` `code`/`code-extract`, `test/unit/web-ai-code-artifact.test.mjs` | Implemented | Do not widen this path; it is stricter than generic files because it validates ZIP structure and requires `PLAN.md`/`00_plan.md` for new code-mode artifacts. |
| Code-mode multi-ZIP retrieval | `scanConversationForAllZips()`, `retrieveAllCodeArtifacts()`, `--multi-zip`, `--output-dir` | Implemented | Keep as code-mode only; generic file capture must not reuse stale tool-message assumptions from code mode. |
| Generated images | `web-ai/chatgpt-images.mjs`, `session-artifacts.mjs` `kind: 'image'` | Implemented | Keep independent from generic downloadable files. |
| Session artifacts | `web-ai/session-artifacts.mjs` supports `transcript`, `report`, `image` | Partial | Add `kind: 'file'` only when generic downloads are implemented. |
| Context-package upload ZIP | `web-ai/context-pack/builder.mjs`, `web-ai/context-pack/file-selector.mjs`; `test/unit/web-ai-context-pack.test.mjs` covers text-source packaging/dry-run behavior | Text-only package implemented | Do not describe this as byte-preserving archive upload. Binary/archive/office inputs are excluded as `binary-or-non-text`; add focused test coverage before making that exclusion a release claim. |
| User `--file` uploads | `web-ai/chatgpt.mjs`, `web-ai/chatgpt-attachments.mjs` | Implemented for direct local uploads | Out of scope for this download-side feature unless upload verification fails in a separate audit. |

Implication: 31.1-31.3 should implement only the missing generic download lane.
31.4 should stay an audit/decision item, not a hidden requirement for the P0
download work.

## Priority Map

| ID | Priority | Outcome |
| --- | --- | --- |
| 31.1 | P0 | Generic assistant-turn downloadable file detection and safe URL/path allowlist |
| 31.2 | P0 | Sequential browser/download attribution and session artifact records |
| 31.3 | P1 | CLI/session visibility for saved generic file artifacts |
| 31.4 | P2 | Upload-side context-pack/direct-file audit and explicit byte-preservation decision |

## P — Plan

### Part 1 — Easy Explanation

When ChatGPT creates a file that is not a code-mode ZIP or generated image,
agbrowse should save that file beside the session transcript. The feature must
only trust files from the current assistant turn, must reject unsafe URLs, and
must not accidentally attach a late download to the next file. Code-mode stays
separate because it has a stricter container-contract requirement.

### Part 2 — Diff-level Precision

#### NEW `web-ai/chatgpt-files.mjs`

Create a new module instead of widening `web-ai/code-artifact.mjs`.

Do not import from `web-ai/code-artifact.mjs`. That module is conversation-JSON
and code-mode ZIP oriented: it scans `/mnt/data/*.zip`, tries tool message ids
newest-first, verifies ZIP central-directory structure, and enforces the
code-agent plan-file contract. Generic downloadable files need DOM/current-turn
scoping and browser filename attribution instead.

Exports:

```js
export function normalizeChatGptFileDownloadUrl(value) {}
export function normalizeChatGptSandboxUrl(value) {}
export async function readAssistantDownloadableFiles(page, { baselineAssistantCount } = {}) {}
export async function saveAssistantDownloadableFiles(page, deps, opts = {}) {}
```

Required behavior:

- Accept only `https://chatgpt.com` and `https://chat.openai.com`.
- Accept only:
  - `/backend-api/sandbox/download?path=/mnt/data/...`
  - `/backend-api/files/<id>/download`
  - `/backend-api/files/<id>/content`
  - `/backend-api/estuary/content?id=file_...`
- Convert safe `sandbox:/mnt/data/...` URLs to `/backend-api/sandbox/download`.
- Reject `blob:`, external hosts, non-HTTPS URLs, explicit ports, backslashes,
  null bytes, and any `..` path segment.
- Scan only assistant turns after `baselineAssistantCount`.
- Deduplicate aliases by `downloadUrl`, `sandboxUrl`, and original URL.
- Prefer filenames from `Content-Disposition`, then DOM `download`, then URL
  basename, then `chatgpt-file-N.<ext>`.

Suggested result shape:

```js
{
  ok: true,
  files: [{
    kind: 'file',
    label: 'result.csv',
    path: 'result.csv',
    mimeType: 'text/csv',
    sizeBytes: 1234,
    sourceUrl: 'https://chatgpt.com/backend-api/files/.../download',
    savedAt: '...'
  }],
  warnings: []
}
```

#### MODIFY `web-ai/session-artifacts.mjs`

Before:

```js
 * @property {'transcript'|'report'|'image'} kind
```

After:

```js
 * @property {'transcript'|'report'|'image'|'file'} kind
```

Add:

```js
export function saveFileArtifact(sessionId, { filename, buffer, mimeType, sourceUrl }) {}
export function trySaveFileArtifact(sessionId, file) {}
```

Rules:

- Reuse `resolveArtifactsDir(sessionId)`.
- Sanitize filename stem with the same path traversal protection used for
  image artifacts.
- Preserve the extension from the resolved filename when present.
- Return `stage: 'artifact-file'` on save failure.
- Keep `appendArtifactRecord()` dedupe by `(kind, path)`.
- Keep `transcript`, `report`, and `image` descriptor behavior byte-for-byte
  compatible.

#### MODIFY `web-ai/chatgpt.mjs`

Capture the assistant baseline at send time and pass it through poll/finalize.

Existing signals to reuse:

- `session.envelopeSummary?.assistantCount` as the already-recorded baseline
- private `countAssistantMessages(page)` only inside `web-ai/chatgpt.mjs` if a
  new baseline must be captured in that same module
- `finalizeProviderTab(...)`
- `collectImages(...)`
- `resolveArtifactsDir(...)`

Expected integration point:

```js
const savedFiles = await saveAssistantDownloadableFiles(page, deps, {
  sessionId: session.sessionId,
  baselineAssistantCount: session.envelopeSummary?.assistantCount,
});
```

Rules:

- Run after a final assistant answer is detected and before archive.
- Do not run in `web-ai code` retrieval; code-mode continues to use
  `web-ai/code-artifact.mjs`.
- Do not run in `web-ai code-extract`; that path intentionally recovers code
  artifacts from an existing saved conversation.
- Add warnings such as `file-artifact-save-failed:<reason>` without hiding the
  answer.
- Append descriptors to the existing `session.artifacts` array.

#### MODIFY `web-ai/tab-finalizer.mjs`

If generic files are saved before archive, archive can proceed. If saving was
explicitly required by a future flag and failed, preserve the current
artifact-before-archive rule.

No new archive policy should be introduced in this slice unless a caller adds a
required-file-artifact flag.

#### MODIFY `web-ai/cli.mjs`

No new top-level command in the first implementation slice.

Human `sessions show` should already list session artifact descriptors through
the existing artifacts display. Add only the smallest text needed if generic
`kind: 'file'` descriptors render poorly.

#### NEW `test/unit/chatgpt-files.test.mjs`

Required tests:

- Allows the four known ChatGPT file endpoint shapes.
- Rejects external hosts, non-HTTPS URLs, ports, `blob:`, unsafe sandbox paths,
  encoded traversal, backslash, and null byte.
- Converts `sandbox:/mnt/data/result.csv` to a safe download URL.
- Scopes DOM scan to assistant turns after the baseline.
- Ignores user-turn links and stale assistant-turn links before the baseline.
- Deduplicates aliases for the same file.
- Derives filename from `Content-Disposition`.
- Stops sequential attribution after a timeout.

#### MODIFY `test/unit/web-ai-session-artifacts.test.mjs`

Add coverage for:

- `trySaveFileArtifact()` success.
- `artifact-file` structured failure.
- `appendArtifactRecord()` dedupes `kind: 'file'` separately from `kind: 'image'`
  even when paths match.

#### OPTIONAL MODIFY `test/unit/web-ai-chatgpt*.test.mjs`

Add only if the first implementation wires generic file capture directly into
`pollWebAi`/`queryWebAi` with testable fake pages.

## A — Plan Audit Checklist

Audit must verify:

- The new module does not change code-mode ZIP behavior.
- `session-artifacts.mjs` remains under 500 lines after additions; split if not.
- `chatgpt.mjs` integration does not trigger downloads before final answer
  completion.
- Existing generated-image collection remains independent.
- Artifacts are stored under `BROWSER_AGENT_HOME/sessions/<session>/artifacts`.
- No external URL or local path can escape the artifacts directory.

## B — Build Slices

1. Implement pure URL/path normalization helpers first.
2. Implement assistant-turn DOM scanner and dedupe.
3. Add `file` artifact save helpers.
4. Add sequential download/save behavior.
5. Wire into ChatGPT poll/finalization.
6. Add focused unit tests.
7. Run release gates and targeted tests.

## C — Check

Minimum verification:

```bash
npm run test:release-gates
npx vitest run test/unit/chatgpt-files.test.mjs test/unit/web-ai-session-artifacts.test.mjs
git diff --check
```

Run broader tests if `chatgpt.mjs` finalization behavior changes:

```bash
npx vitest run test/unit/web-ai-tab-finalizer.test.mjs test/unit/chatgpt-images.test.mjs
```

## D — Done Criteria

- Generic ChatGPT file artifacts are saved and listed in session artifacts.
- Code-mode ZIP retrieval still uses `web-ai/code-artifact.mjs`.
- Generated images still use `web-ai/chatgpt-images.mjs`.
- Unsafe URLs and sandbox paths fail closed.
- Late downloads cannot be attributed to later file candidates.
- `structure/str_func.md` count snapshots are updated and
  `bash structure/verify-counts.sh` passes if files are added.

## 31.4 — Upload-side ZIP Integrity Audit

This is not part of the P0 downloadable-file implementation. It is a P2 audit
because upload-side ZIP byte preservation is a different direction from
download-side artifact capture.

Audit targets:

- `web-ai/context-pack/`
- `web-ai/chatgpt-attachments.mjs`
- `skills/web-ai/modules/gpt-dev-agent-context.zip`

Current known state:

- `prepareContextForBrowser()` creates
  `web-ai-context-package-<uuid>.zip` for upload transport.
- `zipContextFiles()` writes `CONTEXT_PACKAGE.md` plus selected source files as
  UTF-8 text entries through `archiver('zip', { zlib: { level: 6 } })`.
- `readContextFile()` rejects binary-like inputs with `binary-or-non-text`;
  therefore archive/office/media byte preservation is not a current claim.
- `--file` upload is the direct path for user-provided archives and binary-ish
  files; context packaging is a text-source transport.

Questions:

- Should context-package remain explicitly text-only, with archives/office/media
  routed through repeatable `--file` uploads?
- If byte-preserving package mode is needed later, should it be a new transport
  such as `--context-transport archive` rather than changing current upload
  semantics?
- Do deflated ZIP entries matter for ChatGPT upload parsing, or is the current
  `archiver` output sufficient for text-source context?
- Are source filenames, extensions, and relative paths preserved well enough for
  text-source context packages?

If a patch is needed, create a separate `33_...` implementation plan rather
than mixing upload behavior into this P0 file-download slice.

Recommended default: keep context-package upload text-only and document the
byte-preserving path as repeatable `--file`. Revisit only if a real workflow
requires bundling binary/archive/office files into a generated context package.
