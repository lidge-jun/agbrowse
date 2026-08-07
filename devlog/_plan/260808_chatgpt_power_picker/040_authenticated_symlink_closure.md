# WP4 — Authenticated symlink picker closure

## Objective

Close criterion c5 without transferring cookies, copying profiles, or logging in on the user's behalf. Reuse an already-running signed-in Chrome only when it exposes an explicit local CDP endpoint that the symlinked `agbrowse` CLI can target safely.

## Read-only discovery

1. Inspect the existing Chrome plugin object's public connection/tab metadata without opening or mutating pages.
2. Inspect running Chrome command lines and local listening sockets for an explicit loopback remote-debugging endpoint.
3. Validate any candidate endpoint with `/json/version` and `/json/list`; reject extension-only or private plugin transports that do not expose a user-addressable CDP port. A candidate counts only when its listener PID, Chrome main-process flags, and redacted target title/host conclusively correlate it to the exact authenticated plugin tab. Do not persist full target URLs, profile paths, CDP WebSocket URLs, or capability tokens.
4. Reconfirm the symlink target and the owned agbrowse profile's signed-out status so the two browser identities cannot be confused.

## Conditional activation

- If a signed-in loopback CDP endpoint exists, run every symlink probe with `AGBROWSE_WEB_AI_AUTO_START=0`; `cdp.unreachable` is negative/indeterminate evidence and must never start a replacement browser. Run `agbrowse --port <port> web-ai status` only after endpoint identity correlation. Then use the smallest production model-selection path that does not submit user content, and verify before, selected, and restored states in Chrome plus Computer Use.
- If the only signed-in transport belongs to the Chrome plugin and has no reusable CDP endpoint, do not extract extension credentials, copy cookies, clone the profile, or restart the user's Chrome with new debugging flags. Record `NEEDS_HUMAN_LOGIN` with exact endpoint/process evidence.
- Do not disturb the user's selected `Extra High` state. Any safe selection probe must restore the initial family/tier before completion.

## Verification and terminal rule

- `DONE`: symlinked CLI reaches the authenticated browser and performs an actual non-content picker selection, with browser-visible before/after/restoration proof. Status-only or prompt-send evidence cannot satisfy this criterion.
- `NEEDS_HUMAN_LOGIN`: the signed-in browser has no safe reusable CDP endpoint and the owned agbrowse browser remains signed out. Independent audit must confirm that further progress requires user login or a user-approved Chrome restart/profile change.
- Evidence is appended to `041_authenticated_symlink_evidence.md`; no production code change is planned.
