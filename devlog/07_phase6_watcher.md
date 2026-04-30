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
- `src/browser/web-ai/notifications.ts` — channel send + ledger.
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
