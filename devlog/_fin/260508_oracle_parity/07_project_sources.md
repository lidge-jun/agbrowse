# Plan: ChatGPT Project Sources Management

**Issue: #73** | **Priority: P3** | **Status: planned**

## Problem

Oracle supports file-based ChatGPT Project Sources management (list, add). agbrowse has no Project Sources support.

## Reference Implementation

Oracle `src/browser/chatgptProjectSources.ts`:
- Normalizes ChatGPT project URL, opens Project Sources tab/dialog
- `list`: waits for source entries to settle, returns `[{ name, type }]`
- `add`: uploads files via `DOM.setFileInputFiles` (file-input mechanics)
- Supports `--dry-run` (reports planned uploads without touching Chrome)
- Append-only: list and add only, no delete/update

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/chatgpt-project-sources.mjs` | NEW | Project Sources list/add via file upload |
| `web-ai/cli.mjs` | MODIFY | `project-sources list\|add` subcommand |

## Diff Plan

### NEW `web-ai/chatgpt-project-sources.mjs`

```javascript
export async function listProjectSources(cdpSession, { projectUrl })
// Navigate to project settings via projectUrl
// Wait for source entries DOM to settle
// Extract existing sources: [{ name, type }]

export async function addProjectSource(cdpSession, { projectUrl, filePaths, dryRun })
// Validate projectUrl is a ChatGPT project URL
// Validate each filePath: realpath, exists, regular file (no symlink escape)
// Optional: size limit check (reject unreasonably large files)
// If dryRun: return planned uploads WITHOUT opening Chrome — pure local validation
// Create/claim an ISOLATED tab (not a pooled conversation tab)
//   — project-sources navigates to project settings, which is NOT a conversation
//   — must not reuse or contaminate warm pooled provider tabs
// Navigate to project settings
// Click "Add source" / file upload trigger
// Upload files via DOM.setFileInputFiles (file-input element)
// Wait for upload confirmation
// Release/close the isolated tab after completion (do NOT return to send/poll pool)
// Return: [{ name, type, uploaded: true }]
// Append-only: never remove existing sources
```

### MODIFY `web-ai/cli.mjs`

```javascript
// project-sources list --chatgpt-url <project-url>
// project-sources add --chatgpt-url <project-url> --file <path> [--file <path>...] [--dry-run]
// Requires explicit ChatGPT project URL
// Uses existing browser profile/CDP/lease protections
// Does not drive arbitrary project tabs outside command/session ownership
```

## Guardrails

- Requires explicit `--chatgpt-url` — never infer project from session
- File-based uploads only — no inline content injection
- Local file validation: realpath, exists, regular file, optional size limit
- Append-only: list and add, no delete/update
- `--dry-run` reports planned uploads WITHOUT opening Chrome (pure local validation)
- Uses ISOLATED tab — not a pooled conversation tab (navigates to project settings)
- Isolated tab released/closed after completion, NOT returned to send/poll pool
- Uses existing command/session locking for concurrency safety

## Test Plan

1. List sources on empty project → verify empty array
2. Add file → verify uploaded and appears in list
3. Add duplicate file → verify no error, appears once
4. `--dry-run` → verify plan output, no Chrome interaction
5. Missing project URL → verify error, no fallback
