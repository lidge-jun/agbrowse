# Plan: Session Artifacts

**Issue: #72** | **Priority: P2** | **Status: planned**

## Problem

agbrowse only persists session metadata in `web-ai-sessions.json`. Oracle saves durable artifacts per session: transcripts, Deep Research reports, generated images.

## Reference Implementation

Oracle stores artifacts under `sessions/<sessionId>/artifacts/`. Minimal artifact sink: text artifact writing + artifact-list append to session record.

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/session-artifacts.mjs` | NEW | Artifact storage (minimal sink) |
| `web-ai/tab-finalizer.mjs` | MODIFY | Save artifacts before archive/pool |
| `web-ai/session.mjs` | MODIFY | Artifact list in session record |

## Diff Plan

### NEW `web-ai/session-artifacts.mjs`

```javascript
// Artifacts directory: $BROWSER_AGENT_HOME/sessions/<sessionId>/artifacts/
// Minimal types: transcript.md, report.md, image-*.{png,jpg,webp}

export function resolveArtifactsDir(sessionId)
// Returns $BROWSER_AGENT_HOME/sessions/<sessionId>/artifacts/
// Creates directory on first write, not eagerly
// All path segments sanitized — no path traversal

export async function saveTranscript(sessionId, markdown)
// Write transcript.md to artifacts dir
// Overwrites on re-save (idempotent)

export async function saveReport(sessionId, { text, sources })
// Write report.md (Deep Research) to artifacts dir

export async function saveImageArtifact(sessionId, { filename, buffer, mimeType })
// Write image file to artifacts dir
// filename sanitized, no arbitrary paths

export function appendArtifactRecord(session, { kind, label, filename, mimeType, sizeBytes, sourceUrl })
// Append artifact descriptor to session.artifacts array:
//   { kind, label, path (relative to artifacts dir), mimeType, sizeBytes, sourceUrl, savedAt }
// kind: 'transcript' | 'report' | 'image'
// Use relative paths for artifacts in session dir; absolute for explicit user output paths
// Session record persisted through existing session.mjs updateSession path
```

### MODIFY `web-ai/tab-finalizer.mjs`

```javascript
// In finalizeProviderTab, after updating session answer/status
// and BEFORE archive decisions or returning tab to pool:
// 1. Save conversation transcript as markdown
// 2. Append artifact records to session
// 3. (Images and reports saved by their respective features, not here)
```

### MODIFY `web-ai/session.mjs`

```javascript
// Add artifacts array to session schema:
// session.artifacts = [{ kind, label, path, mimeType, sizeBytes, sourceUrl, savedAt }]
// Initialize as [] in createSession
// Append via appendArtifactRecord (updateSession persists)
// Persisted in web-ai-sessions.json alongside existing fields
```

## Storage Layout

```
$BROWSER_AGENT_HOME/sessions/
  <sessionId>/
    artifacts/
      transcript.md     # Conversation turns in markdown
      report.md         # Deep Research report (if applicable)
      image-1.png       # Generated images (saved by #68)
```

## Guardrails

- All writes confined to `$BROWSER_AGENT_HOME/sessions/` — no arbitrary paths
- Path segments sanitized against traversal
- No `cleanupOldArtifacts` or `metadata.json` — keep minimal
- No `artifacts` CLI subcommand unless agent-piped need emerges
- Explicit user output paths (e.g., `--output-image`) bypass artifact dir

## Test Plan

1. Complete session → verify transcript.md saved in correct dir
2. Artifact record → verify appended to session in web-ai-sessions.json
3. Path traversal attempt → verify sanitized/rejected
4. Explicit output path → verify bypasses artifact dir
