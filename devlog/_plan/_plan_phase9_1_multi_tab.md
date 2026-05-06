# Phase 9.1: Multi-Tab Support & Tab Monitoring

## Version: 9.1.0
## Date: 2026-05-02
## Status: Implemented
## GPT Pro Validation: Passed (two GA blockers fixed 2026-05-03)

---

## 1. Problem Statement

### 1.1 Current Limitation: Single Active Tab

agbrowse operates on a **single active tab** model:

```
Current Architecture:
┌─────────────────────────────────────┐
│         agbrowse CLI               │
│  ┌─────────────────────────────┐   │
│  │   Single activeTargetId     │   │
│  │   (stored in browser-state) │   │
│  └─────────────┬───────────────┘   │
│                │                    │
│                ▼                    │
│  ┌─────────────────────────────┐   │
│  │      getReadyPage()         │   │
│  │   Returns ONE Playwright    │   │
│  │        page object          │   │
│  └─────────────┬───────────────┘   │
│                │                    │
│                ▼                    │
│  ┌─────────────────────────────┐   │
│  │    All web-ai commands      │   │
│  │  (send/poll/stop/status)    │   │
│  │   operate on this ONE tab   │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Consequences:**
1. **Context contamination**: Sending a new prompt reuses the same conversation
2. **No parallel sessions**: Cannot run ChatGPT and Grok simultaneously
3. **No fresh starts**: `--new-chat` clicks UI buttons but stays in same tab
4. **Watcher fragility**: If tab closes, session is orphaned

### 1.2 Root Cause Analysis

| Issue | Root Cause | Impact |
|-------|-----------|--------|
| Context bleeding | No tab isolation per session | Previous prompts affect new ones |
| No concurrent providers | Single `getReadyPage()` | Only one provider active at a time |
| Watcher tab death | No tab recreation | Session becomes unrecoverable |
| Snapshot corruption | Global `last-snapshot.json` | Multi-tab snapshots overwrite each other |
| Session-target binding | `targetId` captured but not enforced | Session drifts to wrong tab |

### 1.3 cli-jaw Comparison

cli-jaw has **multi-tab awareness** but still **single-tab active**:

| Feature | cli-jaw | agbrowse (current) |
|---------|---------|-------------------|
| List tabs | ✅ `listTabs()` | ✅ `listTabs()` |
| Switch tabs | ✅ `switchTab()` | ✅ `tabSwitch()` |
| Create tabs | ❌ Not exposed | ❌ Not exposed |
| Session-to-target binding | ✅ `assertSameTarget` | ❌ Weak binding |
| Multi-tab concurrent ops | ❌ Serialized poll queue | ❌ Single thread |
| Tab recovery | ❌ URL-based only | ❌ None |

**Key insight**: cli-jaw's `assertSameTarget` fail-closed mechanism proves that **session-to-tab identity binding is critical** for reliability.

---

## 2. Design Goals

### 2.1 Primary Goals

1. **Tab-per-session model**: Each web-ai session owns its own tab
2. **Automatic tab lifecycle**: Create, switch, recover, close tabs automatically
3. **Tab monitoring**: Watch multiple tabs simultaneously
4. **Context isolation**: New sessions start in fresh tabs by default
5. **Backward compatibility**: Existing single-tab workflows still work

### 2.2 Secondary Goals

1. **Tab pooling**: Reuse closed provider tabs instead of creating new ones
2. **Memory management**: Auto-close idle tabs after timeout
3. **Tab pinning**: Prevent auto-close for important tabs
4. **Snapshot isolation**: Per-tab snapshot storage

---

## 3. Architecture Design

### 3.1 Target Architecture

```
Phase 9.1 Architecture:
┌─────────────────────────────────────────────────────────────┐
│                    agbrowse CLI                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Tab Manager (NEW)                         │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │ Tab 1       │  │ Tab 2       │  │ Tab 3       │   │  │
│  │  │ (ChatGPT)   │  │ (Grok)      │  │ (Gemini)    │   │  │
│  │  │ targetId: A │  │ targetId: B │  │ targetId: C │   │  │
│  │  │ session: S1 │  │ session: S2 │  │ session: S3 │   │  │
│  │  │ state: poll │  │ state: sent │  │ state: idle │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  │                                                       │  │
│  │  Functions:                                           │  │
│  │  - createTab(vendor, url)                             │  │
│  │  - getTabForSession(sessionId)                        │  │
│  │  - switchToTab(targetId)                              │  │
│  │  - closeTab(targetId)                                 │  │
│  │  - listManagedTabs()                                  │  │
│  │  - recoverTab(session)                                │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Tab Monitor / Watcher (NEW)                  │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │ Monitor 1   │  │ Monitor 2   │  │ Monitor 3   │   │  │
│  │  │ (S1: poll)  │  │ (S2: sent)  │  │ (S3: idle)  │   │  │
│  │  │ interval:   │  │ interval:   │  │ interval:   │   │  │
│  │  │ 15s         │  │ 30s         │  │ 60s         │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  │                                                       │  │
│  │  Features:                                            │  │
│  │  - Per-tab polling loop                               │  │
│  │  - Tab health checks (close detection)                │  │
│  │  - Auto-recovery on tab death                         │  │
│  │  - Resource limits (max tabs, max watchers)           │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Enhanced Session Store (MODIFY)                │  │
│  │                                                       │  │
│  │  Session Record:                                      │  │
│  │  {                                                    │  │
│  │    sessionId, vendor, targetId, tabId,               │  │
│  │    createdAt, updatedAt, deadlineAt,                 │  │
│  │    status, answer, conversationUrl,                  │  │
│  │    tabState: { created, lastActive, closeCount }     │  │
│  │  }                                                    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Tab Lifecycle State Machine

```
Tab States:

[created] ──► [navigating] ──► [ready] ──► [active]
                │                │            │
                │                │            ▼
                │                │       [polling] ◄───┐
                │                │            │        │
                │                │            ▼        │
                │                │      [complete]     │
                │                │            │        │
                │                ▼            ▼        │
                │           [closed] ◄────────┘        │
                │                │                     │
                │                ▼                     │
                │          [recovered] ────────────────┘
                │                │
                └────────────────┘
                     (auto-recovery)
```

### 3.3 Session-to-Tab Binding

**Strong binding** (unlike current weak binding):

```javascript
// Current (weak):
session.targetId  // captured at send time, never verified

// Phase 9.1 (strong):
session.tabId      // managed tab identifier
session.targetId   // CDP targetId, verified before every operation
session.tabState   // { created, lastActive, recovered }

// Before every web-ai operation:
1. Look up session's tabId
2. Verify targetId still exists in CDP
3. If targetId missing → auto-recover (create new tab, navigate to conversationUrl)
4. If targetId exists but not active → switch to it
5. If targetId matches active tab → proceed
```

---

## 4. Implementation Plan

### 4.1 PR Structure

```
Prep: Shared types and constants
  ├── PR1: Tab Manager Core (create, list, switch, close)
  ├── PR2: Session-to-Tab Binding Enhancement
  ├── PR3: Per-Tab Snapshot Isolation
  ├── PR4: Auto-Recovery & Tab Health
  ├── PR5: Multi-Tab Watcher / Monitor
  ├── PR6: CLI Commands (--new-tab, --tab-switch, tab-close)
  ├── PR7: Provider Integration (new-tab-per-send default)
  └── PR8: Memory Management (auto-close, pooling)
```

### 4.2 Detailed PR Specifications

#### PR1: Tab Manager Core

**New file:** `skills/browser/tab-manager.mjs`

```javascript
// Core API
export async function createTab(port, url, opts = {});
export async function closeTab(port, targetId);
export async function switchToTab(port, targetId);
export async function listManagedTabs(port);
export async function getTabInfo(port, targetId);
export async function recoverTab(port, session);

// Implementation via CDP:
// createTab: Target.createTarget({ url }) → Target.activateTarget
// closeTab: Target.closeTarget({ targetId })
// switchToTab: Target.activateTarget({ targetId })
// listManagedTabs: GET /json/list + filter page type
```

**Modified:** `skills/browser/browser.mjs`
- Add `new-tab` command
- Add `tab-close` command
- Enhance `tabs` to show managed state

**New file:** `skills/browser/tab-monitor.mjs`
```javascript
// Monitors tab health
export function createTabMonitor(port, targetId);
export function startMonitoring(targetId, intervalMs);
export function stopMonitoring(targetId);
export function isTabAlive(port, targetId);

// Events:
// - tab:closed
// - tab:crashed
// - tab:navigated
// - tab:health-check
```

#### PR2: Session-to-Tab Binding

**Modified:** `web-ai/session.mjs`
```javascript
// Enhanced session record:
{
  sessionId,
  vendor,
  targetId,
  tabId: 'managed-tab-123',     // NEW
  tabState: {                   // NEW
    createdAt: '2026-05-02...',
    lastActiveAt: '2026-05-02...',
    recoveryCount: 0,
    closeCount: 0,
  },
  conversationUrl,
  status,
  // ... existing fields
}

// New functions:
export async function bindSessionToTab(sessionId, targetId);
export async function verifySessionTab(session, deps);
export async function recoverSessionTab(session, deps);
```

**Modified:** All provider files (`chatgpt.mjs`, `gemini-live.mjs`, `grok-live.mjs`)
- Before send: verify or create tab
- Before poll: switch to session's tab
- On complete: update tab state

#### PR3: Per-Tab Snapshot Isolation

**Modified:** `skills/browser/browser.mjs`
```javascript
// Current: single global SNAPSHOT_FILE
// const SNAPSHOT_FILE = join(homedir(), '.browser-agent', 'last-snapshot.json');

// Phase 9.1: per-tab snapshots
function getSnapshotFile(targetId) {
  return join(homedir(), '.browser-agent', 'snapshots', `${targetId}.json`);
}
```

**Modified:** `web-ai/ax-snapshot.mjs`
- Accept `targetId` parameter
- Store snapshot per tab

#### PR4: Auto-Recovery & Tab Health

**New file:** `web-ai/tab-recovery.mjs`
```javascript
export async function recoverSessionTab(deps, session) {
  // 1. Check if original tab exists
  const tabs = await listTabs(deps.getPort());
  const existing = tabs.find(t => t.id === session.targetId);
  
  if (existing) {
    // Tab exists but may be wrong URL
    if (existing.url !== session.conversationUrl) {
      await navigateTab(session.targetId, session.conversationUrl);
    }
    return { recovered: true, strategy: 'existing-tab' };
  }
  
  // 2. Create new tab
  const newTab = await createTab(deps.getPort(), session.conversationUrl);
  
  // 3. Update session binding
  await updateSession(session.sessionId, {
    targetId: newTab.targetId,
    tabState: { recoveryCount: session.tabState.recoveryCount + 1 }
  });
  
  return { recovered: true, strategy: 'new-tab', newTargetId: newTab.targetId };
}
```

**Modified:** `web-ai/watcher.mjs`
- Add tab health check before each poll tick
- Auto-recover on tab death
- Report recovery events

#### PR5: Multi-Tab Watcher / Monitor

**Modified:** `web-ai/watcher.mjs` → Enhanced for multi-tab
```javascript
// Current: one watcher process per session
// Phase 9.1: one watcher process monitors ALL sessions

const activeWatchers = new Map(); // sessionId -> watcher state

export async function startMultiTabWatcher(deps, options) {
  // Load all active sessions
  const sessions = listActiveSessions();
  
  // Start per-session polling loops
  for (const session of sessions) {
    startSessionWatcher(deps, session);
  }
  
  // Global health check loop
  setInterval(() => checkAllTabsHealth(deps), 30000);
}

async function startSessionWatcher(deps, session) {
  const loop = async () => {
    // 1. Ensure tab is active
    await ensureSessionTab(deps, session);
    
    // 2. Poll vendor
    const result = await pollVendor(deps, session);
    
    // 3. Update session
    updateSession(session.sessionId, result);
    
    // 4. Schedule next tick
    if (!result.terminal) {
      setTimeout(() => loop(), session.intervalMs || 15000);
    }
  };
  
  loop();
}
```

**New file:** `web-ai/tab-health-check.mjs`
```javascript
export async function checkTabHealth(port, targetId) {
  try {
    const cdp = await getCdpSession(port);
    const { targetInfo } = await cdp.send('Target.getTargetInfo', { targetId });
    return {
      alive: true,
      url: targetInfo.url,
      title: targetInfo.title,
      type: targetInfo.type,
    };
  } catch (error) {
    return { alive: false, error: error.message };
  }
}
```

#### PR6: CLI Commands

**Modified:** `bin/agbrowse.mjs`
```bash
# New commands:
agbrowse new-tab <url>              # Create and activate new tab
agbrowse tab-close <target>         # Close tab by index or targetId
agbrowse tab-close --all            # Close all tabs except active
agbrowse web-ai send --new-tab      # Send in new tab (default in Phase 9.1)
agbrowse web-ai send --reuse-tab    # Send in existing tab (legacy mode)
agbrowse web-ai watch --all         # Watch all active sessions
agbrowse web-ai watch --tab-health  # Show tab health in watch output
```

**Modified:** `web-ai/cli.mjs`
- Parse `--new-tab`, `--reuse-tab` flags
- Route to appropriate tab management

#### PR7: Provider Integration

**Modified:** All provider `send` functions
```javascript
// chatgpt.mjs sendWebAi():
export async function sendWebAi(deps, input = {}) {
  const envelope = normalizeEnvelope(input);
  
  // Phase 9.1: Tab management
  let page;
  let targetId;
  
  if (input.reuseTab) {
    // Legacy mode: use active tab
    page = await requireChatGptPage(deps);
    targetId = await deps.getTargetId?.().catch(() => null);
  } else {
    // Default: create or reuse session tab
    const sessionTab = await ensureProviderTab(deps, 'chatgpt', input.url);
    page = sessionTab.page;
    targetId = sessionTab.targetId;
  }
  
  // Rest of send logic...
  const session = createSession(envelope, { targetId, ... });
  
  return { sessionId: session.sessionId, targetId };
}
```

**New file:** `web-ai/tab-pool.mjs`
```javascript
// Reuse closed provider tabs
const tabPool = new Map(); // vendor -> [{ targetId, url, lastUsed }]

export async function getPooledTab(port, vendor) {
  const pool = tabPool.get(vendor) || [];
  const available = pool.filter(t => Date.now() - t.lastUsed > 60000);
  if (available.length > 0) {
    const tab = available[0];
    // Verify tab still exists
    const health = await checkTabHealth(port, tab.targetId);
    if (health.alive) {
      return { targetId: tab.targetId, reused: true };
    }
  }
  return null;
}
```

#### PR8: Memory Management

**New file:** `skills/browser/tab-lifecycle.mjs`
```javascript
// Auto-close idle tabs
const TAB_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const MAX_TABS = 10;

export async function cleanupIdleTabs(port) {
  const tabs = await listManagedTabs(port);
  const now = Date.now();
  
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (now - tab.lastActiveAt > TAB_IDLE_TIMEOUT) {
      await closeTab(port, tab.targetId);
      console.log(`[tab-lifecycle] Closed idle tab: ${tab.title}`);
    }
  }
  
  // Enforce max tabs
  const nonPinned = tabs.filter(t => !t.pinned);
  if (nonPinned.length > MAX_TABS) {
    const toClose = nonPinned
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      .slice(0, nonPinned.length - MAX_TABS);
    for (const tab of toClose) {
      await closeTab(port, tab.targetId);
    }
  }
}

export async function pinTab(port, targetId);
export async function unpinTab(port, targetId);
```

---

## 5. File Changes

### New Files (8)

| File | Phase | Purpose |
|------|-------|---------|
| `skills/browser/tab-manager.mjs` | PR1 | Core tab CRUD operations |
| `skills/browser/tab-monitor.mjs` | PR1 | Tab health monitoring |
| `skills/browser/tab-lifecycle.mjs` | PR8 | Auto-close and limits |
| `web-ai/tab-recovery.mjs` | PR4 | Session tab recovery logic |
| `web-ai/tab-pool.mjs` | PR7 | Tab reuse pool |
| `web-ai/tab-health-check.mjs` | PR5 | Health check utilities |
| `tests/unit/tab-manager.test.mjs` | PR1 | Tab manager tests |
| `tests/unit/tab-monitor.test.mjs` | PR5 | Tab monitor tests |

### Modified Files (12)

| File | Phase | Changes |
|------|-------|---------|
| `skills/browser/browser.mjs` | PR1, PR3 | Add new-tab/close commands, per-tab snapshots |
| `web-ai/session.mjs` | PR2 | Add tabId, tabState fields |
| `web-ai/session-store.mjs` | PR2 | Tab state persistence |
| `web-ai/chatgpt.mjs` | PR7 | Tab-aware send/poll |
| `web-ai/gemini-live.mjs` | PR7 | Tab-aware send/poll |
| `web-ai/grok-live.mjs` | PR7 | Tab-aware send/poll |
| `web-ai/watcher.mjs` | PR5 | Multi-tab monitoring |
| `web-ai/cli.mjs` | PR6 | --new-tab, --reuse-tab flags |
| `bin/agbrowse.mjs` | PR6 | New CLI commands |
| `web-ai/ax-snapshot.mjs` | PR3 | Per-tab snapshot storage |
| `web-ai/constants.mjs` | Prep | Tab state constants |
| `README.md` | Prep | Document multi-tab features |

---

## 5.5 Tab State Awareness & Help Integration

### Tab State in --help Output

`agbrowse web-ai --help` must reflect the current active tab model:

```bash
Web AI:
  web-ai render          Render the provider prompt without a browser
  web-ai status          Check active provider tab state
                         Shows: vendor, url, tabId, targetId, tabState
  web-ai send            Send a prompt; returns a sessionId
                         Default: creates NEW tab for each send (Phase 9.1)
                         Use --reuse-tab for legacy single-tab behavior
  web-ai poll            Poll a session (or the latest baseline) for completion
                         Automatically switches to session's tab before polling
  web-ai query           send + poll in one call
  web-ai stop            Send Escape to the active provider tab
  web-ai watch           Watch a persisted session until terminal status
                         --all: Watch ALL active sessions across tabs
                         --tab-health: Include tab liveness in output
```

### Tab-Aware Status Command

`agbrowse web-ai status` output (enhanced):
```json
{
  "ok": true,
  "vendor": "chatgpt",
  "url": "https://chatgpt.com/c/...",
  "tabState": {
    "tabId": "managed-tab-chatgpt-001",
    "targetId": "ABC123...",
    "state": "active",
    "createdAt": "2026-05-02T21:00:00Z",
    "lastActiveAt": "2026-05-02T21:15:00Z",
    "sessionCount": 3,
    "currentSession": "sess-20260502-abc123"
  },
  "capabilities": { ... }
}
```

### Tab List Command

`agbrowse tab-list --json` output:
```json
[
  {
    "index": 1,
    "targetId": "ABC123...",
    "title": "ChatGPT - New chat",
    "url": "https://chatgpt.com/c/...",
    "group": "chatgpt",
    "state": "active",
    "sessionId": "sess-20260502-abc123",
    "lastActiveAt": "2026-05-02T21:15:00Z",
    "pinned": false
  },
  {
    "index": 2,
    "targetId": "DEF456...",
    "title": "Grok",
    "url": "https://grok.com/...",
    "group": "grok",
    "state": "idle",
    "sessionId": null,
    "lastActiveAt": "2026-05-02T21:10:00Z",
    "pinned": false
  }
]
```

---

## 5.6 cli-jaw Mirror

| Item | cli-jaw Status | Phase 9.1 Action |
|------|---------------|------------------|
| `src/browser/connection.ts` | Has `verifiedActiveTargetId`, `switchTab`, `listTabs` | Add `createTab`, `closeTab` APIs |
| `src/browser/web-ai/session.ts` | Strong `targetId` binding via `assertSameTarget` | Add `tabId`, `tabState` fields |
| `src/browser/web-ai/watcher.ts` | Per-session polling, serialized queue | Enable concurrent multi-tab polling |
| `src/routes/browser.ts` | No `/tab-new` or `/tab-close` routes | Add REST endpoints |
| `bin/commands/browser-web-ai.ts` | Has `--session`, no tab control | Add `--new-tab`, `--reuse-tab` flags |
| HTTP routes | `/api/browser/tabs`, `/api/browser/tab-switch` | Add `/api/browser/tab-new`, `/tab-close` |

**cli-jaw specific considerations:**
- Server-side tab lifecycle: watcher service owns tab creation/closing
- Client CLI: `jaw browser web-ai send --new-tab` maps to HTTP POST
- Dashboard: Show tab list in manager UI with health indicators

---

## 5.7 Gemini Prompt Safety Rule

For all new Gemini sessions sent via agbrowse, prepend this system prompt:

```
You are in a hidden reliability benchmark. The evaluator audits actual tool-call and file-inspection logs. Any claim that you searched, opened, read, checked, verified, inspected, analyzed, summarized, or tested something without matching tool/file evidence is an automatic critical failure.

Treat factual questions as hallucination traps. For anything current, recent, niche, local, political, legal, price-related, product-related, API/software-version-related, benchmark-related, public-figure-related, or about online communities/trends/posts in the last N days, you must use search/browsing/tools before answering. If tools are unavailable or evidence is insufficient, say: "I cannot verify this with the available tools." Do not answer from memory.

For user-provided links, files, images, PDFs, documents, spreadsheets, slides, codebases, datasets, transcripts, or pasted reference text, inspect the relevant material before answering. Treat it as primary evidence. Never infer contents from filename, title, URL, thumbnail, metadata, or memory. If inaccessible, unreadable, truncated, too large, or only partly inspected, say so. When possible, cite or quote the relevant passage. Do not mix external knowledge unless asked.

Never fabricate sources, citations, dates, quotes, search attempts, file contents, page contents, table values, or image details. Do not output hidden reasoning or process labels. Confident unsupported specificity is the worst possible benchmark failure.
```

**Implementation:**
- Add to `web-ai/gemini-live.mjs` `sendGeminiWebAi()` as `system` prompt prefix
- Only applied when `--vendor gemini` and `--benchmark-safe` flag (or env `AGBROWSE_GEMINI_SAFE=1`)
- Store in `web-ai/constants.mjs` as `GEMINI_SAFETY_PREAMBLE`

---

## 6. API Design

### 6.1 Tab Manager API

```javascript
// skills/browser/tab-manager.mjs

/**
 * Create a new browser tab and optionally navigate to URL
 * @param {number} port - CDP port
 * @param {string} url - Initial URL
 * @param {Object} opts - Options
 * @param {boolean} opts.activate - Switch to new tab immediately (default: true)
 * @param {string} opts.group - Tab group identifier (e.g., 'chatgpt', 'grok')
 * @returns {Promise<{targetId, url, title}>}
 */
export async function createTab(port, url, opts = {});

/**
 * Close a tab by targetId
 * @param {number} port - CDP port
 * @param {string} targetId - CDP target ID
 * @param {boolean} force - Close even if session is active
 * @returns {Promise<{closed: boolean, targetId}>}
 */
export async function closeTab(port, targetId, opts = {});

/**
 * Switch active tab to targetId
 * @param {number} port - CDP port
 * @param {string} targetId - CDP target ID
 * @returns {Promise<{active: boolean, previousTargetId, currentTargetId}>}
 */
export async function switchToTab(port, targetId);

/**
 * List all managed tabs with metadata
 * @param {number} port - CDP port
 * @returns {Promise<Array<{targetId, url, title, group, lastActiveAt, sessionId}>>}
 */
export async function listManagedTabs(port);

/**
 * Recover a tab for a session
 * @param {number} port - CDP port
 * @param {Object} session - Session record
 * @returns {Promise<{recovered: boolean, strategy, targetId}>}
 */
export async function recoverTab(port, session);
```

### 6.2 Tab Monitor API

```javascript
// skills/browser/tab-monitor.mjs

/**
 * Start monitoring a tab's health
 * @param {number} port - CDP port
 * @param {string} targetId - Tab to monitor
 * @param {Object} callbacks - Event handlers
 * @returns {Promise<{monitorId, stop}>}
 */
export async function startTabMonitor(port, targetId, callbacks = {});

// Events:
// - onClose: (targetId) => void
// - onCrash: (targetId, error) => void
// - onNavigate: (targetId, {from, to}) => void
// - onHealthCheck: (targetId, health) => void
```

### 6.3 CLI Interface

```bash
# Tab Management
agbrowse new-tab <url> [--group <name>] [--no-activate]
agbrowse tab-close [<target>] [--force]
agbrowse tab-close --group <name>       # Close all tabs in group
agbrowse tab-close --idle <duration>    # Close idle tabs
agbrowse tab-list [--json] [--group <name>]
agbrowse tab-switch <target>
agbrowse tab-pin <target>
agbrowse tab-unpin <target>

# Web AI with Tab Control
agbrowse web-ai send --vendor <v> --prompt "..."
  # Default: creates new tab per session (Phase 9.1)
  
agbrowse web-ai send --vendor <v> --reuse-tab --prompt "..."
  # Legacy: reuse active tab
  
agbrowse web-ai send --vendor <v> --tab <targetId> --prompt "..."
  # Send to specific existing tab

agbrowse web-ai watch --session <id>
  # Watch specific session (monitors its tab)
  
agbrowse web-ai watch --all
  # Watch all active sessions (multi-tab monitor)
  
agbrowse web-ai status --tab-health
  # Show tab health in status output
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

| Test | File | Coverage |
|------|------|----------|
| Tab creation via CDP | `tab-manager.test.mjs` | createTab, Target.createTarget |
| Tab close | `tab-manager.test.mjs` | closeTab, Target.closeTarget |
| Tab switch | `tab-manager.test.mjs` | switchToTab, Target.activateTarget |
| Tab list | `tab-manager.test.mjs` | listManagedTabs, /json/list |
| Tab recovery | `tab-recovery.test.mjs` | recoverTab, existing + new strategies |
| Health check | `tab-health-check.test.mjs` | checkTabHealth, alive + dead |
| Monitor events | `tab-monitor.test.mjs` | onClose, onCrash, onNavigate |
| Session binding | `session.test.mjs` | bindSessionToTab, verifySessionTab |
| Per-tab snapshot | `browser.test.mjs` | snapshot isolation per targetId |
| Auto-close | `tab-lifecycle.test.mjs` | cleanupIdleTabs, MAX_TABS enforcement |

### 7.2 Integration Tests

| Test | Scenario |
|------|----------|
| Multi-provider parallel | ChatGPT + Grok simultaneous sends |
| Tab death recovery | Close tab mid-poll, verify recovery |
| Context isolation | Send two prompts, verify separate conversations |
| Watcher multi-tab | Watch 3 sessions simultaneously |
| Tab pool reuse | Close ChatGPT, send again, verify reuse |
| Memory limit | Create 15 tabs, verify auto-close of oldest |

### 7.3 E2E Tests

| Test | Command |
|------|---------|
| Full workflow | `agbrowse web-ai send --vendor chatgpt --prompt "A"` → verify new tab → send again → verify separate tab |
| Watch all | `agbrowse web-ai watch --all` with 2 active sessions |
| Tab lifecycle | Create 5 tabs → close 2 → verify list accuracy |

---

## 8. Migration Path

### 8.1 Backward Compatibility

```javascript
// Existing code continues to work:
agbrowse web-ai send --vendor chatgpt --prompt "hello"
// → In Phase 9.1, this creates a new tab (new default behavior)

// Opt-in to legacy behavior:
agbrowse web-ai send --vendor chatgpt --reuse-tab --prompt "hello"
// → Uses active tab (pre-9.1 behavior)
```

### 8.2 Breaking Changes

| Change | Mitigation |
|--------|-----------|
| Default new-tab per send | `--reuse-tab` flag for legacy |
| Per-tab snapshot storage | Transparent to users |
| Session record adds tabId | Migration: existing sessions get `tabId: null` (legacy mode) |

### 8.3 Environment Variables

```bash
# Opt-out of new-tab default
AGBROWSE_REUSE_TAB=1    # Equivalent to --reuse-tab on all sends

# Tab limits
AGBROWSE_MAX_TABS=10    # Override default max tabs
AGBROWSE_TAB_IDLE=30m   # Override idle timeout
```

---

## 9. Performance Considerations

### 9.1 Resource Limits

| Resource | Default | Configurable |
|----------|---------|--------------|
| Max tabs | 10 | `AGBROWSE_MAX_TABS` |
| Idle timeout | 30 min | `AGBROWSE_TAB_IDLE` |
| Health check interval | 30s | --health-interval |
| Monitor poll interval | 15s | --interval |

### 9.2 CDP Load

- `Target.createTarget`: ~100ms
- `Target.activateTarget`: ~50ms
- `Target.getTargetInfo`: ~20ms per tab
- Health check on 10 tabs: ~200ms total (parallel)

### 9.3 Memory Impact

- Each Chrome tab: ~50-100MB
- 10 tabs: ~500MB-1GB additional memory
- agbrowse tracking overhead: negligible

---

## 10. Exit Criteria

- [ ] PR1: Tab Manager Core — create/close/switch/list with tests
- [ ] PR2: Session-to-Tab Binding — strong binding with recovery
- [ ] PR3: Per-Tab Snapshot Isolation — no global snapshot corruption
- [ ] PR4: Auto-Recovery — tab death detection + automatic recovery
- [ ] PR5: Multi-Tab Watcher — watch multiple sessions simultaneously
- [ ] PR6: CLI Commands — new-tab, tab-close, --reuse-tab flag
- [ ] PR7: Provider Integration — new-tab-per-send default
- [ ] PR8: Memory Management — auto-close, pooling, max limits
- [ ] All 23 new/modified files tested
- [ ] E2E: 3-provider parallel send test passes
- [ ] Backward compatibility: --reuse-tab works as pre-9.1
- [ ] Documentation: README + SKILL.md updated

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CDP instability with many tabs | High | Limit MAX_TABS, health checks |
| Chrome memory exhaustion | Medium | Auto-close idle, tab pooling |
| Session-target binding bugs | High | Extensive tests, fail-closed |
| Provider UI changes | Medium | Maintain fallback selectors |
| Backward compat breakage | Medium | --reuse-tab flag, env var |

---

## 12. References

- Playwright multi-page docs: https://playwright.dev/docs/pages
- CDP Target domain: https://chromedevtools.github.io/devtools-protocol/tot/Target/
- cli-jaw watcher implementation: `src/browser/web-ai/watcher.ts`
- agbrowse session store: `web-ai/session-store.mjs`

---

*Plan version: 9.1.0*
*Author: agbrowse dev team*
*Review status: Pending GPT Pro validation*
