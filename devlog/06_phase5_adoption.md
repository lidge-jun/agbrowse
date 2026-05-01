# Phase 5 — Adoption hardening

Closes the gaps that show up when external users run agbrowse beside cli-jaw,
share profiles across multiple processes, or hit provider DOM churn at scale.
Splits into 3 PRs. Depends on Phase 4 for useful churn-log content.

## Decisions resolved (post-critique)

- **`agbrowse churn report`:** **dropped**. JSONL is enough for downstream
  tools.
- **`--port-strict` default:** **off**. Keep default permissive until real
  users report collision frequency.
- **Public known-DOM-changes list:** **no**. Local churn log + GitHub issues
  are enough.
- **`BROWSER_AGENT_HOME` profile lock file (added per critique):** add an
  explicit `~/.browser-agent/profile.lock` owner file. Refuse to launch a
  second Chrome from the same `BROWSER_AGENT_HOME` while the lock is held.

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Browser profile/port guard + lock file | MODIFY `skills/browser/browser.mjs`; NEW `skills/browser/profile-lock.mjs`; docs. |
| **PR2** | Churn-log tied to `doctor` | NEW `web-ai/churn-log.mjs`; MODIFY `cli.mjs` (record on `doctor`); MODIFY README/SKILL. |
| **PR3** | Adoption checklist + integration recipes | NEW `docs/adoption-checklist.md`; MODIFY README/SKILL "Posture" section. |

## Diffs (PR1)

### MODIFY `skills/browser/browser.mjs` — guards (schematic)

Source not in the attached bundle; schematic before/after at the
existing-CDP-listener call site:

Before:

```js
if (await isCdpListening(port)) {
    return reuseExistingCdp(port);
}
```

After:

```js
if (await isCdpListening(port)) {
    if (options.portStrict) {
        throw new Error(`CDP port ${port} is already in use; pass another --port or unset --port-strict`);
    }
    const reuse = await inspectReuseSafety(port, readBrowserState());
    if (reuse.foreign && !options.reuseForeignChrome) {
        throw new Error(`CDP port ${port} appears to belong to another Chrome profile; pass --reuse-foreign-chrome to override`);
    }
    return { ...await reuseExistingCdp(port), warnings: reuse.warnings };
}
```

Option parse:

Before:

```js
port: { type: 'string' },
headless: { type: 'boolean', default: false },
```

After:

```js
port: { type: 'string' },
headless: { type: 'boolean', default: false },
'port-strict': { type: 'boolean', default: false },
'reuse-foreign-chrome': { type: 'boolean', default: false },
```

### NEW `skills/browser/profile-lock.mjs`

API surface:

```js
export function acquireProfileLock(homeDir = defaultHome()) {}
export function releaseProfileLock(lockHandle) {}
export function readProfileLock(homeDir = defaultHome()) {}
export function isStaleLock(lock) {}
```

Skeleton:

```js
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const LOCK = join(HOME, 'profile.lock');
const STALE_AFTER_MS = 5 * 60 * 1000;

export function acquireProfileLock() {
    mkdirSync(dirname(LOCK), { recursive: true });
    if (existsSync(LOCK)) {
        const prior = readProfileLock();
        if (!isStaleLock(prior)) {
            throw new Error(`profile.lock held by pid ${prior.pid} since ${prior.acquiredAt}; refuse to launch second Chrome from same BROWSER_AGENT_HOME`);
        }
        unlinkSync(LOCK);
    }
    const fd = openSync(LOCK, 'wx');
    const lock = { pid: process.pid, acquiredAt: new Date().toISOString() };
    writeFileSync(fd, JSON.stringify(lock));
    closeSync(fd);
    return lock;
}

export function releaseProfileLock() { try { unlinkSync(LOCK); } catch {} }
export function readProfileLock() { try { return JSON.parse(readFileSync(LOCK, 'utf8')); } catch { return null; } }
export function isStaleLock(lock) { return !lock || (Date.now() - Date.parse(lock.acquiredAt)) > STALE_AFTER_MS; }
```

`browser.mjs` calls `acquireProfileLock()` before launching a fresh Chrome
and `releaseProfileLock()` on exit. Reusing an already-listening CDP does
not acquire the lock (the running Chrome owns it).

## Diffs (PR2)

### NEW `web-ai/churn-log.mjs`

API surface:

```js
export function maybeRecordChurn(report, options = {}) {}
export function readChurnLog() {}
export function appendChurnRecord(record) {}
export function compactChurnLog(records, limit) {}
```

Skeleton:

```js
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const LOG = join(HOME, 'churn-log.jsonl');

export function maybeRecordChurn(report, options = {}) {
    if (process.env.AGBROWSE_CHURN_LOG !== '1') return null;
    const prior = readChurnLog();
    const records = changedFeatureRecords(report, prior);
    for (const record of records) appendChurnRecord(record);
    return records;
}

export function readChurnLog() {
    return existsSync(LOG)
        ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        : [];
}

export function appendChurnRecord(record) {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, `${JSON.stringify(record)}\n`);
}

export function compactChurnLog(records, limit) {
    return records.slice(-limit);
}
```

`changedFeatureRecords(report, prior)` returns one record per
`(vendor, feature)` whose `domHash` differs from the most recent prior
record for the same key.

### MODIFY `web-ai/cli.mjs` — wire churn log to doctor

Inside the doctor branch:

```js
if (command === 'doctor') {
    const churnRecords = maybeRecordChurn(result);
    if (churnRecords?.length) result.warnings.push(`churn-log-recorded:${churnRecords.length}`);
}
```

Note: the phase critique flagged that `web-ai/cli.mjs` has no `start`
command — the `--port-strict` and `--reuse-foreign-chrome` flags belong to
`skills/browser/browser.mjs`, not `web-ai/cli.mjs`.

## Diffs (PR3)

### MODIFY `skills/web-ai/SKILL.md` — posture section

Before:

```md
- Human verification and login screens must be completed by the user.
```

After:

```md
- Human verification and login screens must be completed by the user.
- agbrowse does not bypass anti-bot, captcha, or Cloudflare checks.
- Do not share one Chrome `--user-data-dir` across multiple CDP-controlled instances.
- For agent integrations, prefer `AGBROWSE_JSON_ERRORS=1`.
```

### MODIFY `README.md`

Before:

```md
Do not commit or share `~/.browser-agent`; it contains browser session state.
```

After:

```md
Do not commit or share `~/.browser-agent`; it contains browser session state.
Use separate `BROWSER_AGENT_HOME` and `CDP_PORT` values when running agbrowse
beside cli-jaw or other browser automation tools.
```

### NEW `docs/adoption-checklist.md`

```md
# agbrowse adoption checklist

- Pick one `BROWSER_AGENT_HOME` per project or agent.
- Pick one `CDP_PORT` per browser automation stack.
- Use `AGBROWSE_JSON_ERRORS=1` for machine integrations.
- Run `agbrowse web-ai status --json` before mutation.
- Run `agbrowse web-ai doctor --vendor <v> --json` after selector failures.
- Do not assume agbrowse bypasses provider anti-bot checks.
- Do not share Chrome `userDataDir` between live Chrome instances.
- Keep provider logins user-managed and local.
```

## Public-surface changes

- New flags: `--port-strict`, `--reuse-foreign-chrome` on `agbrowse start`.
- New env: `AGBROWSE_CHURN_LOG=1`.
- New file: `~/.browser-agent/profile.lock`.
- New file: `~/.browser-agent/churn-log.jsonl` (when enabled).
- New doc: `docs/adoption-checklist.md`.

## Test plan

- Unit: `acquireProfileLock` succeeds on a clean home; second call within
  `STALE_AFTER_MS` throws; stale lock is reclaimed.
- Unit: `churn-log` rotation and `compactChurnLog(records, limit)` keeps
  newest N.
- Unit: `changedFeatureRecords` only emits when `(vendor, feature)` hash
  changes vs prior.
- Source: SKILL.md documents the posture; `docs/adoption-checklist.md`
  exists.
- Contract: `start --port-strict` exits non-zero with a clear message when
  the port is already CDP-occupied by a foreign profile.

## Smoke plan

- Run two `agbrowse start` invocations against the same
  `BROWSER_AGENT_HOME`; second one fails on the lock.
- Run `agbrowse start` with `--port-strict` while a foreign Chrome occupies
  the default port; expect refusal with remediation hint.
- Enable `AGBROWSE_CHURN_LOG=1`; run `web-ai doctor` twice with a forced
  selector change between runs; assert one record was appended for the
  changed feature only.

## Exit criteria

- A new user can read `docs/adoption-checklist.md` and run agbrowse without
  silently colliding with their existing browser tooling.
- A churn report covering one full provider DOM change cycle is reproducible
  from local logs alone.

## Phase 5 expansion (post-research, 2026-05-01)

Based on GPT Pro and Grok research. See
`context/260501_gpt_pro_phase4plus_research.md`.

### Action policy / domain allowlist

Vercel Labs agent-browser documents domain allowlist, action confirmation,
and output length limits. agbrowse also controls provider UIs, so:

NEW `web-ai/action-policy.mjs`:

```js
export function assertAllowedProviderHost(url, provider) {}
export function assertAllowedAction({ provider, action, url, session }) {}
export function clampDiagnosticOutput(text, { maxChars }) {}
```

Default policy:
- ChatGPT actions: `chatgpt.com` / `chat.openai.com` only.
- Gemini actions: `gemini.google.com` only.
- Grok actions: `grok.com` / `x.ai` only.
- Doctor output: max chars limit.
- Network/console diagnostics: body storage forbidden.

This is a safety net, not a user-facing feature. Actions on unexpected
hosts throw immediately.

### Churn-log healing fields

Churn-log entries gain `healing` metadata so downstream tools can track
self-healing effectiveness:

```json
{
  "healing": {
    "cacheHit": false,
    "resolution": "snapshot-semantic"
  }
}
```

This prepares for Phase 8 (self-healing selectors) integration.

### Profile lock heartbeat

Profile lock gains a `heartbeatAt` field that the running process updates
periodically. Stale detection uses `heartbeatAt` instead of just
`acquiredAt`, preventing false reclaims when a long-running process is
still alive but was started > 5 minutes ago.

## Risks

- **Most likely regression:** false-positive foreign Chrome refusal blocks
  legitimate reuse (e.g. user manually restarted Chrome with the same
  profile dir).
- **Test:** fake persisted state + fake `/json/version`; assert same-state
  reuse succeeds, foreign reuse fails, and `--reuse-foreign-chrome`
  overrides.
- **Secondary:** profile lock left dangling after a `kill -9` of the agbrowse
  process; mitigated by the `STALE_AFTER_MS` reclaim path.

## cli-jaw mirror

cli-jaw already differentiates Chrome ownership at the runtime layer:

- `src/browser/connection.ts` exports `createExternalBrowserRuntime` and
  `createJawOwnedBrowserRuntime`. `runtimeOwner` tracks which one is
  active. The Phase 0 stderr warning already fires from the external
  branch.
- cli-jaw also has an idle reaper that auto-closes Chrome after 10 min
  idle (`ensureIdleReaperStarted`) — agbrowse has no equivalent and Phase
  5 should consider whether to port it.

| Item | cli-jaw status |
| --- | --- |
| `--port-strict` | **Ports as-is, but new in cli-jaw** — must be added to `resolveBrowserStartOptions`, `bin/commands/browser-web-ai.ts` (or the browser-start command file), the `/api/browser/start` route plumbing, and `launchChrome` itself. Today neither the route nor the CLI exposes this flag. |
| `--reuse-foreign-chrome` | **Ports as-is, also new in cli-jaw** — same plumbing path as `--port-strict`. Flips the existing stderr warning into an explicit user ack and demotes the warning. |
| `BROWSER_AGENT_HOME/profile.lock` | **Apply both** — runtime-owner is in-process state; `profile.lock` is the cross-process guard. Keep both; runtime-owner does not replace the lock file. cli-jaw uses `JAW_HOME` style path (`process.env.JAW_HOME` or default); name it `profile.lock` under there. |
| `churn-log.jsonl` | **Ports as-is** — same JSONL semantics; tied to whichever command emits feature-level `domHash` (Phase 4 doctor/diagnose). |
| `AGBROWSE_CHURN_LOG=1` env | **Rename to `JAW_CHURN_LOG=1`** for cli-jaw to avoid agbrowse-prefixed env in cli-jaw runtime. Both can coexist. |
| Adoption checklist | `docs/adoption-checklist.md` lives in agbrowse; cli-jaw points at it from `cli-jaw/skills_ref/web-ai/SKILL.md` rather than maintaining a duplicate. |
| Idle reaper | **cli-jaw-only** — agbrowse Phase 5 may consider adding a simple equivalent in `skills/browser/browser.mjs`, but it is out of scope here. |

PR slicing in cli-jaw mirrors agbrowse three-way:

- **PR1**: profile lock + port guards in `src/browser/connection.ts`.
- **PR2**: churn-log wired to `web-ai doctor`/`diagnose`.
- **PR3**: cross-link adoption checklist; sync SKILL with the new flags
  and env vars.

Source of truth: agbrowse `docs/adoption-checklist.md` is canonical;
cli-jaw skills link out rather than duplicate.
