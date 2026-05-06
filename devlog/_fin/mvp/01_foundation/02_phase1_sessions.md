# Phase 1 — Session IDs + resume / reattach ⭐

GPT Pro's ship-one-first pick. Splits into 3 PRs that must land in order.
Phase 2 PR1 (errors core) lands first so this phase can throw `WebAiError`s
from the start. Total estimate: 5–7 engineer-days.

## Decisions resolved (post-critique)

- **ID format:** 26-char ULID — 48-bit timestamp prefix + 80-bit
  `crypto.getRandomValues` randomness. Sortable, compact, dependency-free.
- **Deadline default:** `--deadline` if set, else `--timeout`, else vendor
  poll default (ChatGPT/Gemini 1200s, Grok 600s).
- **Legacy baselines:** keep read + dual-write for one minor release; mark
  deprecated in docs and stop documenting the file. Remove next minor.
- **Resume navigation:** default to **warn/fail** if current tab does not
  match `conversationUrl`; require explicit `--navigate` to switch tabs.
- **External CDP URL for reattach:** **out of scope** for Phase 1; rely on
  `CDP_PORT` + `BROWSER_AGENT_HOME` for now.
- **Top-level `bin/agbrowse-sessions.mjs`:** **dropped** (route through
  `agbrowse web-ai sessions`).
- **`sessions prune`:** in scope. Add `web-ai sessions prune --older-than <duration>`
  in PR3 plus a startup background sweep for >30d records.

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Storage + API | NEW `web-ai/session-store.mjs`; MODIFY `web-ai/session.mjs`; legacy baseline shim; unit tests. |
| **PR2** | Provider integration | MODIFY `chatgpt.mjs`, `gemini-live.mjs`, `grok-live.mjs`; new flags `--session`, `--deadline`, `--navigate`; deadline plumbing. |
| **PR3** | Session commands | MODIFY `cli.mjs` (commands + `runSessionsCommand`); `sessions list/show/resume/reattach/prune`; docs; smoke recipes. |

Do not parallelize PR2 with Phase 2 PR2 — both rewrite the same throw/poll
paths.

## Data model

`~/.browser-agent/web-ai-sessions.json`:

```json
{
  "version": 1,
  "sessions": [
    {
      "sessionId": "01J...ULID",
      "vendor": "chatgpt",
      "createdAt": "2026-05-01T07:32:30.618Z",
      "updatedAt": "2026-05-01T07:36:50.421Z",
      "deadlineAt": "2026-05-01T07:52:30.618Z",
      "targetId": "...CDP target id...",
      "originalUrl": "https://chatgpt.com/",
      "conversationUrl": "https://chatgpt.com/c/69f3d889-fe30-83ab-be42-ebf2d9fd692f",
      "promptHash": "sha256:...",
      "envelopeSummary": { "model": "pro", "attachmentPolicy": "upload", "fileCount": 27 },
      "status": "sent | polling | complete | timeout | aborted | failed",
      "answer": null,
      "lastError": null,
      "warnings": []
    }
  ]
}
```

Legacy `web-ai-baselines.json` stays — `session-store.mjs` reads it on first
load and writes both stores during the transition window.

## Diffs (PR1 — storage + API)

### NEW `web-ai/session-store.mjs`

API surface:

```js
export const SESSION_STORE_VERSION = 1;
export function generateSessionId(now = Date.now()) {}
export function readSessionStore() {}
export function writeSessionStore(store) {}
export function withStoreLock(fn, options = {}) {}
export function insertSession(session) {}
export function patchSession(sessionId, patch) {}
export function listStoredSessions(filter = {}) {}
export function loadLegacyBaselines() {}
```

Skeleton:

```js
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const STORE = join(HOME, 'web-ai-sessions.json');
const LOCK = `${STORE}.lock`;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateSessionId(now = Date.now()) {
    return encodeTime(now) + encodeRandom();
}

function encodeTime(ms) { /* 10 chars Crockford base32 of 48-bit ms */ }
function encodeRandom() { /* 16 chars Crockford base32 of 80-bit randomBytes */ }

export function readSessionStore() {
    if (!existsSync(STORE)) return { version: SESSION_STORE_VERSION, sessions: [] };
    try { return JSON.parse(readFileSync(STORE, 'utf8')); }
    catch { return { version: SESSION_STORE_VERSION, sessions: [] }; }
}

export function writeSessionStore(store) {
    mkdirSync(dirname(STORE), { recursive: true });
    const tmp = `${STORE}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
    renameSync(tmp, STORE);
}

export function withStoreLock(fn) {
    const fd = openSync(LOCK, 'wx');
    try { return fn(); } finally { try { closeSync(fd); } catch {} try { unlinkSync(LOCK); } catch {} }
}
```

`insertSession`, `patchSession`, `listStoredSessions` are thin wrappers that
read/mutate/write through `withStoreLock`. `loadLegacyBaselines()` returns
the array from `web-ai-baselines.json` for the migration shim.

### MODIFY `web-ai/session.mjs`

Becomes a public API consumed by provider runtimes. Legacy
`saveBaseline`/`getBaseline`/`getLatestBaseline` stay as deprecated shims
that internally write both stores during the transition window.

Before:

```js
export function saveBaseline({ vendor, url, envelope, assistantCount, textHash }) {
    loadStore();
    const baseline = {
        vendor,
        url,
        promptHash: hashPrompt(envelope),
        assistantCount,
        textHash,
        capturedAt: new Date().toISOString(),
    };
```

After (new `createSession`, plus existing `saveBaseline` keeps writing the
legacy file):

```js
export function createSession(envelope, meta = {}) {
    const now = new Date().toISOString();
    const session = {
        sessionId: generateSessionId(),
        vendor: envelope.vendor,
        createdAt: now,
        updatedAt: now,
        deadlineAt: meta.deadlineAt,
        targetId: meta.targetId || null,
        originalUrl: meta.originalUrl || null,
        conversationUrl: meta.conversationUrl || meta.originalUrl || null,
        promptHash: `sha256:${hashPrompt(envelope)}`,
        envelopeSummary: meta.envelopeSummary || {},
        status: 'sent',
        answer: null,
        lastError: null,
        warnings: [],
    };
    insertSession(session);
    return session;
}
```

Public API additions:

```js
export function updateSession(sessionId, patch) {
    return patchSession(sessionId, { ...patch, updatedAt: new Date().toISOString() });
}

export function getSession(sessionId) {
    return listStoredSessions({ sessionId, limit: 1 })[0] || null;
}

export function findActiveSession({ vendor, targetId, conversationUrl }) {
    return listStoredSessions({ vendor, active: true })
        .find(s => targetId && s.targetId === targetId)
        || listStoredSessions({ vendor, active: true })
        .find(s => conversationUrl && s.conversationUrl === conversationUrl)
        || listStoredSessions({ vendor, active: true, limit: 1 })[0]
        || null;
}

export function sessionToBaseline(session) {
    return { vendor: session.vendor, url: session.conversationUrl, promptHash: session.promptHash, assistantCount: session.envelopeSummary?.assistantCount ?? 0, textHash: '0', capturedAt: session.createdAt };
}
```

## Diffs (PR2 — provider integration)

### MODIFY `web-ai/chatgpt.mjs` — `sendWebAi`

Before (existing baseline save):

```js
const baseline = saveBaseline({
    vendor: envelope.vendor,
    url: page.url(),
    envelope,
    assistantCount,
    textHash: String((await page.innerText('body').catch(() => '')).length),
});
```

After (dual write — legacy baseline + new session):

```js
const baseline = saveBaseline({
    vendor: envelope.vendor,
    url: page.url(),
    envelope,
    assistantCount,
    textHash: String((await page.innerText('body').catch(() => '')).length),
});
const session = createSession(envelope, {
    targetId: await deps.getTargetId?.(),
    originalUrl: input.url || page.url(),
    conversationUrl: page.url(),
    deadlineAt: resolveDeadlineAt(input, 'chatgpt'),
    envelopeSummary: summarizeEnvelope(input, contextPack),
});
```

And in the return:

```js
return {
    ok: true,
    vendor: envelope.vendor,
    status: 'sent',
    url: page.url(),
    sessionId: session.sessionId,
    baseline,
    ...
};
```

### MODIFY `web-ai/chatgpt.mjs` — `pollWebAi`

Before (after Phase 0 already lands the three-tier fallback):

```js
const baseline = getBaseline(vendor, page.url())
    || getLatestBaseline(vendor, { sameHostUrl: page.url() })
    || getLatestBaseline(vendor);
if (!baseline) throw new Error('baseline required. Run web-ai send or query first.');
```

After:

```js
const session = input.session
    ? getSession(input.session)
    : findActiveSession({ vendor, targetId: await deps.getTargetId?.(), conversationUrl: page.url() });
const baseline = session
    ? sessionToBaseline(session)
    : getBaseline(vendor, page.url()) || getLatestBaseline(vendor, { sameHostUrl: page.url() });
if (!baseline) throw new WebAiError({
    errorCode: 'provider.poll-timeout',
    stage: 'poll',
    vendor: 'chatgpt',
    retryHint: 'poll-or-resume',
    message: 'baseline required. Run web-ai send/query first.',
});
if (session) updateSession(session.sessionId, { status: 'polling', conversationUrl: page.url() });
```

### MODIFY `web-ai/chatgpt.mjs` — completion

Before:

```js
return {
    ok: true,
    vendor,
    status: 'complete',
    url: page.url(),
    answerText,
    ...
};
```

After:

```js
if (session) updateSession(session.sessionId, {
    status: 'complete',
    conversationUrl: page.url(),
    answer: answerText,
});
return {
    ok: true,
    vendor,
    status: 'complete',
    url: page.url(),
    sessionId: session?.sessionId,
    answerText,
    ...
};
```

### MODIFY `web-ai/gemini-live.mjs` and `web-ai/grok-live.mjs`

Same shape as ChatGPT. Each `saveBaseline` call gets a paired `createSession`
in `send`; each `pollWebAi` adds the `session = input.session ? getSession :
findActiveSession` logic; each completion `updateSession`s and returns
`sessionId`.

### MODIFY `web-ai/cli.mjs` — flags

Before:

```js
timeout: { type: 'string' },
'inline-only': { type: 'boolean', default: false },
```

After:

```js
timeout: { type: 'string' },
deadline: { type: 'string' },
session: { type: 'string' },
navigate: { type: 'boolean', default: false },
'inline-only': { type: 'boolean', default: false },
```

### MODIFY `web-ai/cli.mjs` — input mapping

Pipe the new flags into `input.session`, `input.deadline`, `input.navigate`,
and forward to provider runtimes.

## Diffs (PR3 — session commands)

### MODIFY `web-ai/cli.mjs` — command set

Before:

```js
const COMMANDS = new Set(['render', 'status', 'send', 'poll', 'query', 'stop', 'context-dry-run', 'context-render']);
```

After:

```js
const COMMANDS = new Set([
    'render', 'status', 'send', 'poll', 'query', 'stop',
    'sessions', 'resume', 'reattach',
    'context-dry-run', 'context-render',
]);
```

### MODIFY `web-ai/cli.mjs` — dispatch

Before:

```js
const result = isContextCommand(command)
    ? await runContextCommand(command, input, values)
    : await runCommand(command, deps, input);
```

After:

```js
const result = command === 'sessions'
    ? await runSessionsCommand(argv.slice(1), values)
    : isContextCommand(command)
        ? await runContextCommand(command, input, values)
        : await runCommand(command, deps, input);
```

### NEW `web-ai/sessions-command.mjs`

API surface:

```js
export async function runSessionsCommand(args, values) {}
```

Skeleton:

```js
import { listStoredSessions, getSession, patchSession } from './session-store.mjs';

export async function runSessionsCommand(args, values) {
    const [sub, ...rest] = args;
    switch (sub) {
        case 'list': return listStoredSessions({ vendor: values.vendor, status: values.status, limit: Number(values.limit || 20) });
        case 'show': return getSession(rest[0]);
        case 'resume': return resumeSession(rest[0], values);
        case 'reattach': return reattachSession(rest[0], values);
        case 'prune': return pruneSessions(values);
        default: throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'help', message: `unknown sessions subcommand: ${sub}` });
    }
}
```

`resumeSession` invokes the vendor's `pollWebAi` with `input.session`.
`reattachSession` switches to the matching tab (or warns if `--navigate` not
set and the conversation URL differs).
`pruneSessions` deletes records older than `--older-than` (default 30d) or
matching `--status complete --before <iso>`.

### MODIFY `skills/web-ai/SKILL.md`

Before:

```md
agbrowse web-ai poll
agbrowse web-ai query
agbrowse web-ai stop
```

After:

```md
agbrowse web-ai poll --session <id>
agbrowse web-ai query
agbrowse web-ai stop --session <id>
agbrowse web-ai sessions list
agbrowse web-ai sessions show <id>
agbrowse web-ai sessions resume <id>
agbrowse web-ai sessions prune --older-than 30d
```

### MODIFY `README.md`

Before:

```md
The provider tab and the agbrowse Chrome process stay open across a
poll timeout — only the polling loop gives up.
```

After:

```md
`send` returns a `sessionId`. Use `agbrowse web-ai sessions resume <id>`
after shell exit, OS sleep, or a long model run. `poll --session <id>`
resolves that session before any URL-based fallback.
```

## Public-surface changes

- `send`/`query` JSON output adds `sessionId`.
- `poll`/`query` JSON output adds `sessionId` and `status` from the canonical
  store.
- New commands: `web-ai sessions list|show|resume|reattach|prune`.
- New flags on `poll`/`query`/`stop`: `--session <id>`, `--deadline <duration>`,
  `--navigate`.

## Test plan

- `session-store` create/list/update round-trip against a tmp store dir.
- `findActiveSession` priority order: `sessionId` > `targetId` > `conversationUrl` > vendor latest.
- Concurrent writes: `Promise.all([...Array(25)].map(createSession))`; assert
  all 25 records survive and the JSON parses.
- Legacy baseline shim: a `saveBaseline` call writes both stores.
- Contract: `cli.mjs` exposes `sessions`, `resume`, `reattach` and the new flags.
- Integration: fake ChatGPT-like page; verify multi-poll resume scenario
  closes the session with `status: 'complete'` and persists the answer.
- Pruning: with `--older-than 7d`, only old records are removed.

## Smoke plan

- ChatGPT Pro: `send` returns `sessionId`; close terminal; new shell;
  `agbrowse web-ai sessions list --json` shows the polling record;
  `agbrowse web-ai sessions resume <id>` completes.
- Gemini Deep Think: same flow.
- Grok inline + Pro mode: same flow.
- `sessions prune --older-than 30d` against a synthetic store with mixed ages
  removes only old records.

## Exit criteria

- A 25-minute Pro run survives a Bash timeout / shell exit and is reattached
  cleanly from a new shell.
- Legacy `web-ai-baselines.json` is no longer required for documented command
  paths; consulted only as a read-on-startup shim.
- `vendor:url` collisions are unreachable from documented commands.
- `sessions prune` keeps the store under a configurable size cap.

## Risks

- **Most likely regression:** store corruption or lost records from
  concurrent CLI invocations.
- **Test:** `Promise.all([...Array(25)].map(createSession/updateSession))`
  against a temp store; assert all sessions survive and JSON parses.
- **Secondary:** `bin/agbrowse-sessions.mjs` shortcut tempting to add later;
  resist it — duplicate command surface for no new capability.

## cli-jaw mirror

cli-jaw is **already partially ahead** of agbrowse on sessions:

- `src/browser/web-ai/session.ts` exports `createSession`,
  `findSessionByTarget`, `getSession`, `listSessions`,
  `updateSessionStatus`, `updateSessionResult`, `assertSameTarget`. Records
  carry `sessionId` (UUID), `targetId`, `url`, `conversationUrl`,
  `promptHash`, `assistantCount`, `status`, `timeoutMs`, `notifyOnComplete`,
  `capabilityMode`, `createdAt`, `updatedAt`.
- `src/browser/web-ai/watcher.ts` is a production watcher with reattach,
  notify-on-complete, and stale-session detection. The agbrowse Phase 6
  watcher work mirrors this back into the standalone.
- HTTP routes already exist: `/api/browser/web-ai/sessions`,
  `/api/browser/web-ai/watchers`, `/api/browser/web-ai/notifications`. CLI
  surface in `bin/commands/browser-web-ai.ts` already accepts a `--session`
  flag on `poll`/`watch`.

| Item | cli-jaw status |
| --- | --- |
| `sessionId` shape | **Already exists** — but uses `randomUUID()` not ULID. Phase 1 should align to ULID for sortability and pass through to agbrowse via the `generateSessionId` helper, or accept the difference and document it. Recommend: keep cli-jaw's UUID for now, add a `sortKey` derived from `createdAt` for ordering. |
| `findActiveSession` | **Already exists** as `findSessionByTarget`. Add `findByConversationUrl` fallback if needed. |
| `sessions resume` | **Missing CLI command** — server route exists; add `bin/commands/browser-web-ai.ts` `resume` subcommand that calls `/api/browser/web-ai/poll?session=<id>`. |
| `sessions reattach` | **Missing CLI command** — `bin/commands/browser-web-ai.ts` should add `reattach` that switches the active tab to the session's `targetId` (not URL — cli-jaw is targetId-keyed). |
| `sessions prune --older-than` | **Missing** — add to `session.ts` and expose via `/api/browser/web-ai/sessions/prune`. |
| `--deadline` flag | **Missing** — add to `bin/commands/browser-web-ai.ts` and pipe to `timeoutMs`. |
| `--navigate` flag for `resume` | **Missing** — add when implementing `resume`. |
| Provider integration | **Already wired** — `chatgpt.ts:230` already does `getSession(input.session) ?? findSessionByTarget(...)`. Just align on shape. |
| `withStoreLock` for concurrent writes | **Missing** in cli-jaw too. Both repos need it; share design. |
| `sessions-command.mjs` ↔ cli-jaw | agbrowse uses local `runSessionsCommand`; cli-jaw uses HTTP routes. Each repo keeps its style. |

**Direction note (post-closeout, GPT Pro):** Phase 1 in agbrowse **adapts
cli-jaw's session model**; it is not greenfield. Use cli-jaw
`session.ts` field names and lifecycle states as the canonical shape. The
ULID-vs-UUID divergence is a deliberate trade-off — keep `randomUUID()` in
cli-jaw to avoid touching watcher and notification ledgers, generate ULIDs
in agbrowse, and add a shared `sortKey` derived from `createdAt` so listing
by recency works the same in both repos.

PR slicing for cli-jaw:

- **PR1**: agbrowse already shipped. Mirror the store improvements
  (`withStoreLock`, `prune`, derived `sortKey`) to `session.ts` plus
  contract tests that match `tests/unit/browser-web-ai-session-lifecycle.test.ts`.
- **PR2**: align provider integration with the agbrowse changes; ensure
  `chatgpt.ts`/`gemini-live.ts`/`grok-live.ts` use the same `findSession`
  priority order. Most of this is already done.
- **PR3**: add the missing CLI surfaces (`resume`/`reattach`/`prune` +
  `--deadline`/`--navigate`) and matching HTTP routes
  (`/api/browser/web-ai/sessions/prune` is new); sync
  `cli-jaw/skills_ref/web-ai/SKILL.md`.

Watcher reattach (Phase 6) stays cli-jaw-led; agbrowse Phase 6 ports a
minimal subset of `watcher.ts` only after Phase 1 ships in both repos.
