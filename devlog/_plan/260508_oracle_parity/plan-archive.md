# Plan: Auto-Archive One-Shot Browser Runs

**Issue: #74** | **Priority: P3** | **Status: planned** | **Depends: #72**

## Problem

Completed one-shot conversations remain open in ChatGPT indefinitely, cluttering the sidebar.

## Reference Implementation

Oracle archive policy:
- `--browser-archive auto|always|never` (not a simple boolean)
- `auto` (default): archive successful non-project, non-Deep-Research, non-multi-turn ChatGPT one-shots
- Skips: missing conversationUrl, project chats, Deep Research, follow-up runs, failed/partial sessions
- Archives only after local artifacts are saved

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/chatgpt-archive.mjs` | NEW | Archive conversation via ChatGPT UI |
| `web-ai/tab-finalizer.mjs` | MODIFY | Archive on completion per policy |
| `web-ai/cli.mjs` | MODIFY | `--archive auto\|always\|never` flag |

## Diff Plan

### NEW `web-ai/chatgpt-archive.mjs`

```javascript
export function resolveArchivePolicy({ archiveFlag, session })
// archiveFlag: 'auto' | 'always' | 'never' (default: 'auto')
// Returns: { shouldArchive: boolean, reason: string }
// auto skips:
//   - No conversationUrl → skip
//   - session.followUpCount > 0 → skip (multi-turn)
//   - session.researchMode === 'deep' → skip (Deep Research)
//   - session.projectUrl → skip (project chat)
//   - session.status !== 'completed' → skip (failed/partial)
// auto archives:
//   - Successful, single-turn, non-project, non-Deep-Research ChatGPT one-shots

export async function archiveConversation(cdpSession, { conversationUrl })
// Navigate to conversation if needed
// Click conversation menu → Archive
// Wait for archive confirmation
// Only called AFTER artifacts are saved (#72)
```

### MODIFY `web-ai/tab-finalizer.mjs`

```javascript
// Finalizer branch order (explicit):
// 1. Save artifacts (transcript, images, report) via #72
// 2. Resolve archive policy (auto|always|never + session state)
// 3. If shouldArchive:
//    a. Archive conversation via archiveConversation()
//    b. Update session: archived=true
//    c. Skip poolTab — archived tab's page state changed, not safe for reuse
// 4. If NOT archived:
//    a. Pool tab normally via existing poolTab path
// 5. Session/command lock held throughout steps 1-4
//
// 'always' mode is FORCED: archives after conversationUrl exists,
//   NOT subject to project/deep/multi-turn auto-skips.
//   (oracle parity: always overrides all skip conditions)
```

### MODIFY `web-ai/cli.mjs`

```javascript
// --archive auto|always|never (default: auto)
// auto: oracle-parity behavior (archive successful one-shots)
// always: archive regardless of session type
// never: never archive
```

## Guardrails

- Three-way flag (`auto|always|never`), not simple boolean
- `always` is forced: overrides all skip conditions (oracle parity), only requires conversationUrl
- `auto` default matches oracle behavior
- Archive only AFTER #72 artifacts saved
- Skip archive for: failed, partial, project, Deep Research, multi-turn
- Archived tab NOT returned to pool as warm reusable (page state changed)
- Session/command lock held around archive to prevent concurrent command interference
- Uses existing tab lease store guards

## Dependencies

- #72 (artifacts): must save artifacts before archive decision
- #69 (multi-turn): archive policy checks `followUpCount`
- #70 (deep research): archive policy checks `researchMode`

## Test Plan

1. `--archive auto` with successful one-shot → verify archived
2. `--archive auto` with multi-turn → verify NOT archived
3. `--archive auto` with Deep Research → verify NOT archived
4. `--archive auto` with failed session → verify NOT archived
5. `--archive never` → verify never archived
6. `--archive always` → verify always archived
7. After archive → verify tab NOT returned to pool as warm reusable
