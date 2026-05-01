# Phase 6 — Watcher reattach (deferred)

GPT Pro's phase critique flagged that **watcher reattach** is genuinely
missing from the current plan. Phase 1 covers CLI session reattach (a human
or agent in a fresh shell can resume a session by ID), but a long-running
watcher process that survives across reboots and pushes notifications is a
different surface.

This phase is **deferred** — kept as a stub so future planning has a place
to land.

## Goals (sketch)

- A long-running `agbrowse web-ai watch --session <id>` process that polls
  a session, persists progress, and survives Chrome restart / system sleep.
- Notifications when a session completes or hits its deadline (via the
  channel send endpoint or a configurable webhook).
- Survive `agbrowse start --reuse-foreign-chrome` re-attaching the lock to a
  different Chrome process.

## Non-goals

- No web UI dashboard.
- No multi-machine sync.
- No background daemon installation.

## Why deferred

- Phase 1 sessions cover the common case: long Pro/Deep Think runs an agent
  resumes with `sessions resume <id>` from a fresh shell.
- The watcher needs a lifecycle and notification target story (channel send
  endpoint? user-defined webhook? local file?). That decision can wait until
  Phases 0–5 land and we have real users asking for it.

## Prerequisites

- Phase 1 (sessions) — in progress.
- Phase 2 (errors) — must define `provider.poll-timeout` and a watcher-
  specific `watcher.heartbeat-stale` code.
- Phase 3 (capabilities) — watcher should run pre-poll capability checks.
- Phase 4 (doctor) — watcher should auto-`doctor` on failure.
- Phase 5 (profile lock) — watcher must respect the same lock semantics.

## Open questions

- File-based heartbeat vs PID file vs systemd-style supervision?
- Notification target: channel send endpoint (cli-jaw style) only, or also a
  user-defined webhook URL?
- Watcher process supervision: agbrowse-managed (`agbrowse watcher start`)
  or external supervisor (`launchctl`/`systemd`/`pm2`)?
- One watcher per session vs one watcher fanning out to many sessions?
- How does the watcher survive `agbrowse start --reuse-foreign-chrome`
  swapping Chrome instances?

## Phase 6 concrete design (post-research, 2026-05-01)

Based on GPT Pro and Grok research into Browser-Use CLI daemon pattern,
Playwright MCP persistent sessions, and Stagehand session replay. See
`context/260501_gpt_pro_phase4plus_research.md`.

### Watcher state machine

Poll loop uses snapshot hashes to detect state transitions:

```json
{
  "sessionId": "01J...",
  "provider": "chatgpt",
  "lastPollAt": "2026-05-01T...",
  "lastKnownStage": "polling",
  "lastStreamingState": "streaming|idle|unknown",
  "lastDomHash": "sha256:...",
  "lastAxHash": "sha256:...",
  "lastResponseCharCount": 1234,
  "lastChromeEndpoint": "ws://...",
  "deadlineAt": "..."
}
```

Poll sequence:
1. Read session from session-store.
2. Check profile lock / Chrome endpoint.
3. Run provider active-tab probe (Phase 3 capability).
4. Compare `lastSession.before/after` snippets.
5. Run streaming probe.
6. Compare snapshot `axHash` / `domHash`.
7. Check response length or copy fallback availability.
8. Record complete/deadline/reattach event.

This lets the watcher survive Chrome restart, system sleep, and provider
tab reload by comparing hashes — "is the current tab state the same
session I was watching?"

### Session JSON preparation (do now)

Even though Phase 6 is deferred, these fields should be added to session
JSON **now** (Phase 1 or Phase 3 timeframe) so future watcher has
historical data:

- `lastDomHash` — written on every poll.
- `lastAxHash` — written on every poll (when Phase 7 lands).
- `lastStreamingState` — `streaming`, `idle`, or `unknown`.
- `lastResponseCharCount` — character count of last seen response text.

## Status

Deferred. Re-open after Phase 5 ships. Until then, agents needing watcher
behavior should run their own loop calling `agbrowse web-ai sessions resume
<id>` on a cron or supervisor.

## cli-jaw mirror

**Direction reverses for this phase:** cli-jaw is the source of truth, not
agbrowse.

cli-jaw already has a production watcher:

- `src/browser/web-ai/watcher.ts` — long-running poll loop with reattach,
  notify-on-complete, expired-session detection, and resume-after-restart
  recovery (`resumeStoredWebAiWatchers`).
- `src/browser/web-ai/notifications.ts` — channel send helper + ledger
  (delivery target wired through `src/messaging/send.ts`, not a single
  HTTP route).
- HTTP routes `/api/browser/web-ai/watch` and `/api/browser/web-ai/watchers`
  expose the lifecycle.
- CLI command `cli-jaw browser web-ai watch --vendor <v> --session <id>`
  starts a watcher; `web-ai watchers` lists them.
- Tests `tests/unit/browser-web-ai-watcher.test.ts` cover 8+ lifecycle
  scenarios.

| Item | cli-jaw status |
| --- | --- |
| Long-running poll | **Already production** — Phase 6 work in cli-jaw is incremental: e.g. better webhook target story, multi-machine sync (out of scope). |
| Notification target | **Already production** — channel send endpoint (`/api/channel/send`). |
| Resume after restart | **Already production** — `resumeStoredWebAiWatchers` runs at server start. |
| Stale session detection | **Already production** — `WEB-AI-WATCH-005`. |

Phase 6 in **agbrowse** therefore ports a minimal subset:

- A polling-loop helper (`web-ai watcher start --session <id>` that just
  re-runs poll on a configurable interval until terminal).
- No notification channels initially — print to stdout so a user-supplied
  cron/supervisor can pipe to whatever they want.
- No HTTP server, no resume-after-restart-of-agbrowse-itself (each shell
  starts a fresh loop).

If agbrowse needs the full feature set later, fold the agbrowse runtime
into cli-jaw rather than reimplementing.

Open question for the phase: **does agbrowse even need a watcher**, or is
"call `agbrowse web-ai sessions resume <id>` from cron" enough? Likely the
latter for v1; revisit after Phase 5 ships and real users ask.
