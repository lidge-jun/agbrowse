# Plan: Artifacts Before Archive Contract

**Status: draft** | **Priority: P1**

## Problem

agbrowse writes session artifacts, but artifact writes are best-effort and
archive can proceed even if required local artifacts were not saved. Oracle's
contract is stricter: browser conversations are archived only after required
local artifacts are saved, or when archive is deliberately skipped.

Current shallow state:

- `saveTranscript` is called in `tab-finalizer`.
- failures are swallowed;
- archive policy is computed after the swallowed write;
- sessions list/show does not expose artifact descriptors;
- tests cover Temporary Chat archive skip but not artifact-before-archive.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/session-artifacts.mjs` | MODIFY | Add safe artifact result objects and de-duplication. |
| `web-ai/tab-finalizer.mjs` | MODIFY | Require artifact save before archive when answer exists. |
| `web-ai/chatgpt-archive.mjs` | MODIFY | Accept artifact status in archive policy. |
| `web-ai/cli-sessions.mjs` | MODIFY | Show artifact descriptors in `sessions show`. |
| `web-ai/session.mjs` | MODIFY | Ensure artifact descriptors are stable and serializable. |
| `test/unit/web-ai-session-artifacts.test.mjs` | NEW | Artifact path, sanitize, save, append, de-dupe tests. |
| `test/unit/web-ai-tab-finalizer.test.mjs` | NEW | Archive is skipped when required artifacts fail. |
| `test/unit/web-ai-sessions-command.test.mjs` | MODIFY | Show artifact metadata. |

## Diff Plan

### `web-ai/session-artifacts.mjs`

Add non-throwing save wrappers:

```javascript
export function trySaveTranscript(sessionId, markdown)
export function trySaveReport(sessionId, report)
export function trySaveImageArtifact(sessionId, image)
```

Return:

```javascript
{ ok: true, descriptor } | { ok: false, error, stage }
```

Add `appendArtifactRecord` de-duplication by `kind + path`.

### `web-ai/tab-finalizer.mjs`

Current behavior:

```javascript
try {
  const desc = saveTranscript(...)
  appendArtifactRecord(...)
} catch (_) { /* best-effort */ }
// archive policy still runs
```

Target behavior:

- If `answerText` exists and transcript save fails:
  - update session warning;
  - skip archive in `auto` and `always` unless user has explicitly accepted
    unsafe archive without artifacts in a future flag.
- If transcript save succeeds:
  - append artifact descriptor;
  - then evaluate archive policy.
- If no artifact is required, record why.

### `cli-sessions`

`sessions show <id>` should print:

```text
Artifacts:
- transcript: transcript.md (1234 bytes)
- image: image-1.png (image/png, 456789 bytes)
```

JSON output should include the existing `artifacts` array unchanged.

## Guardrails

- Never archive a conversation if the only transcript/report/image artifact
  promised by the run failed to save.
- Do not turn artifact failures into silent warnings when archive would mutate
  the provider UI.
- Use relative artifact paths inside session artifact directories.
- Explicit user output paths remain absolute or caller-provided as today.
- Do not duplicate artifact descriptors on repeated finalization/resume.

## Test Plan

1. Transcript save success appends one descriptor.
2. Repeated transcript save de-duplicates descriptor records.
3. Transcript save failure skips archive.
4. Archive success only occurs after artifact success.
5. `sessions show --json` includes artifacts.
6. `sessions show` human output lists artifacts without answer text leakage.
7. Generated image implicit save appends image artifact descriptor.
8. Deep Research report save appends report artifact descriptor.

## Acceptance Criteria

- Archive mutation is gated on required local artifact success.
- Artifact records are visible in session inspection.
- Artifact behavior has focused tests.
- Future image, multi-turn, and Deep Research plans can rely on this contract.
