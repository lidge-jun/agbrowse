# WP4 evidence — authenticated symlink boundary

## Authenticated Chrome identity

- The Chrome plugin exposes browser-family control (`browserId`, tabs, user, capabilities) but no public CDP host, port, or reusable endpoint capability.
- A fresh plugin-controlled ChatGPT tab was authenticated: host `chatgpt.com`, composer visible, no Log in/Sign up controls, and the visible composer picker read `Pro`.
- The user's Chrome main process had no `--remote-debugging-port` or `--remote-debugging-pipe` flag. Its default profile had no `DevToolsActivePort` file, and no Chrome-owned loopback TCP listener was present.
- No full target URL, profile path, CDP WebSocket URL, cookie, storage value, or plugin capability token was persisted.

## Fail-closed symlink probe

- `/Users/jun/.local/bin/agbrowse` still resolved to this checkout's `bin/agbrowse.mjs`.
- With no agbrowse runtime active, `AGBROWSE_WEB_AI_AUTO_START=0 agbrowse web-ai status --vendor chatgpt --json` exited 1 with `errorCode=cdp.unreachable`, `stage=connect`, and `mutationAllowed=false`.
- A following `agbrowse status --json` remained `running=false`, `tabs=0`, `cdpUrl=null`, proving the probe did not auto-start or substitute another browser.

## Owned-profile control

- An explicit symlinked `agbrowse start --headed` created only the owned browser on loopback port 9222. After navigating it to ChatGPT, the compact provider snapshot showed two Log in controls, Sign up for free, and the text “Log in to get answers based on saved chats”.
- No model-selection probe was attempted in that signed-out browser. The owned browser was stopped; final status returned `running=false`, `tabs=0`, `cdpUrl=null`. The user's Chrome main process remained running and still had no debugging listener.
- `web-ai status` reported the signed-out page as `ready` because a public composer was visible; the accessibility snapshot is therefore the authoritative authentication evidence for this closure, not status alone.

## Terminal classification

There is no safe endpoint that lets the symlinked CLI attach to the exact authenticated Chrome plugin tab. The only symlink-reachable browser is the owned signed-out profile. Reaching DONE now requires one of these user actions:

1. Sign in to ChatGPT in the agbrowse-owned browser profile, then rerun the non-content selection and restoration probe; or
2. Explicitly approve restarting Chrome with a separate CDP-enabled profile and authenticate that profile.

Copying cookies/profile state, extracting plugin transport credentials, or restarting the user's current Chrome without approval is outside scope. Criterion c5 remains `NEEDS_HUMAN_LOGIN`; WP4 has exhausted safe autonomous paths.
