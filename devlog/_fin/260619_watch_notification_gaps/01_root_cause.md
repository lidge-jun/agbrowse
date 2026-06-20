# Watch / Notification Gaps — Root Cause (verified)

> All paths under `web-ai/` unless noted. Line numbers observed 2026-06-19. User stance (constraint): a fully event-driven "fire a hook the instant the AI finishes" is **risky** (provider DOM churn, truncated/errored responses, many edge cases). So: fix the cheap robust wins; treat CDP events as an optional, bounded enhancement *on top of* polling.

## Gap 1 — Poll-only, fixed 15s floor → up to 15s detection latency

`watcher.mjs:26` → `export const DEFAULT_WATCH_INTERVAL_MS = 15_000;`

The loop sleeps a constant interval between ticks — no DOM mutation observer, no network-idle, no CDP event (`watcher.mjs:68-96`):

```js
for (let iteration = 1; ; iteration += 1) {
    lock.heartbeat({ iteration });
    const tick = await watchSessionOnce(deps, { ...options, session: options.sessionId });
    if (tick.terminal === true) { ...; break; }
    if (options.once) { ...; break; }
    if (options.maxIterations && iteration >= options.maxIterations) break;
    await sleep(options.intervalMs);          // constant; no adaptivity, no early-wake
}
```

`intervalMs` is parsed once (`watcher.mjs:281`) and never recomputed. Inside one tick `pollWebAi` *does* detect completion (stop-button + action-button + stability), but `watchSessionOnce` caps each poll at `DEFAULT_WATCH_POLL_TIMEOUT_SEC = 30` (`watcher.mjs:27`), and **between** ticks the loop is blind for the full 15s. Completion signals that already exist during a poll (stop button at `chatgpt.mjs:106-109,548`; copy/action buttons at `:55-60`) are not wired to wake the *watcher* early.

## Gap 2 — `conversationUrl` captured only at send time; ID extractor is `/c/{id}`-hardcoded

`conversationUrl` is written at session create (`chatgpt.mjs:193`) and once more at the end of `sendWebAi` (`:288-291`); nothing re-reads the live tab URL into the session during watch. If the provider redirects *after* send (root `/` → `/c/<id>` settle, locale/share rewrite, `chatgpt.com` ↔ `chat.openai.com`), the stored URL goes stale and reattach fails.

The only conversation-identity primitive is a single hardcoded ChatGPT regex (`chatgpt.mjs:908-912`):

```js
function extractConversationId(url) {
    if (!url) return null;
    const match = url.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
}
```

used in the poll mismatch guard (`chatgpt.mjs:372-381`). For Gemini (`gemini.google.com/app/<id>`) and Grok (`grok.com/chat/<id>`) — both first-class watcher vendors (`PROVIDER_HOSTS`, `watcher.mjs:31-35`) — it returns `null`, collapsing the identity check to a raw string compare that any harmless query-param/hash change breaks.

## Gap 3 — Reattach-mismatch only auto-recovers with explicit `--navigate` (Issue #77, P0)

`ensureWatcherAttached` (`watcher.mjs:398-412`) does an exact (hash-stripped only) URL compare and hard-fails unless `--navigate`:

```js
const targetUrl = session.conversationUrl || session.originalUrl;
const currentUrl = page.url?.() || '';
if (urlsEquivalentForWatch(currentUrl, targetUrl)) return { ok: true, url: currentUrl, warnings: [] };
if (options.navigate) { await page.goto(targetUrl, ...); return { ok: true, url: targetUrl, warnings: [`reattached:...`] }; }
return { ok: false, url: currentUrl, warnings: [`current tab ${currentUrl} does not match session conversationUrl ${targetUrl}; pass --navigate to switch tabs`] };
```

`urlsEquivalentForWatch` (`watcher.mjs:559-569`) strips only the hash — not host aliases, trailing slashes, or root→conversation drift. The mismatch surfaces as a non-terminal `status: 'reattach-mismatch'` (`watcher.mjs:183-187`) that keeps polling forever, and the CLI prints "pass --navigate" (`cli-sessions.mjs:212-215`).

**Issue #77 confirmed in-repo** — `docs/production-readiness.md:41`: *"Web-AI durable session recovery | Beta until the #77 matrix is green: closed target recovery, root-to-conversation URL drift, stale command lock, wrong active tab, and watch transient timeout recovery."*

**Key asymmetry:** `sessions reattach`/`resume` go through `resolveSessionPage` (`tab-recovery.mjs:259`), which **already** tolerates drift via `shouldPreferCurrentProviderUrl` and self-heals by writing the live URL back (`tab-recovery.mjs:314-325`):

```js
if (current.conversationUrl && page.url() !== current.conversationUrl) {
    const liveUrl = page.url();
    if (shouldPreferCurrentProviderUrl(current.conversationUrl, liveUrl)) {
        updateSession(sessionId, { conversationUrl: liveUrl });   // self-heal exists here
```

The watcher reimplements its own stricter compare and does NOT call this helper. **The watch path is strictly more fragile than the reattach path for the same drift** — a large part of the fix is "make the watcher reuse tolerance that already ships."

## Gap 4 — pro=3600s-class waits hammer the page

Deadlines from `resolveDeadlineAt` (`session.mjs:329-336`; defaults chatgpt/gemini 1200s, grok 600s; `--timeout` can push pro far higher). During a long pro/Deep-Research wait the watcher still polls every 15s, each spinning `pollWebAi`'s inner 500ms loop (`chatgpt.mjs:483`) up to the 30s poll-timeout. A naive "poll faster" change makes this worse — any adaptive scheme must **back off** to a slow floor while a long reasoning job is mid-flight (ties to `260619_timeout_adaptive_scaling`).

## Confirmed infrastructure (good news)

- Notifier is **pluggable/duck-typed**: `watchSession(deps, input, notifier = null)` (`watcher.mjs:42`), defaults to `createStdoutNotifier` (`:54,258-274`), invoked as bare `await notify(enriched)` (`:60`). Any `async (event) => {}` works → cli-jaw can register a bgtask notifier with no core change.
- `send`/`watch` separation is real: `send` persists a session + returns `status:'sent'`; `watch` (`cli.mjs:719-720`) is a separate command driving `watchSession`.
- CDP event infra already exists to reuse: `Network.enable` + `Network.requestWillBeSent` listener (`skills/browser/browser.mjs:1989-2003`); `Page.enable`/`DOM.enable` precedent (`chatgpt-project-sources.mjs:152,195`); `getCdpSession` via `page.context().newCDPSession(page)` (`cli-sessions.mjs:108`).

## Evidence index

`watcher.mjs` 26, 27, 31-35, 42, 54, 60, 68-96, 142, 163-173, 176-188, 236, 258-274, 281, 398-412, 449-453, 559-569 · `chatgpt.mjs` 55-60, 106-109, 193, 288-291, 372-381, 386-398, 483, 485-495, 547-553, 558-581, 908-912 · `tab-recovery.mjs` 259-309, 314-325 · `cli-sessions.mjs` 108, 114-145, 212-215 · `session.mjs` 322, 329-336 · `cli.mjs` 16, 230-233, 719-720 · `skills/browser/browser.mjs` 1989-2003 · `chatgpt-project-sources.mjs` 152, 195 · `docs/production-readiness.md` 41 (Issue #77).
