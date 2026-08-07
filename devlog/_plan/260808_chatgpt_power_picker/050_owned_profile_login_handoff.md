# WP5 — owned-profile login handoff

## Goal

Complete criterion c5 without transferring credentials or altering the user's current Chrome profile. The user authenticates the browser profile already owned by agbrowse; after that handoff, the symlinked CLI performs one non-content picker selection, verifies the visible selected state, and restores the original state.

## Boundary

- Start the symlink-resolved `agbrowse` browser explicitly in headed mode and navigate only that owned profile to `https://chatgpt.com/`.
- Do not copy cookies, storage, or profile data. Do not restart or add debugging flags to the user's current Chrome.
- Stop before typing credentials, approving identity prompts, or solving CAPTCHA. Ask the user to finish authentication in the opened owned-profile window.
- After the user confirms login, correlate the CLI status and target to the same owned runtime PID, loopback port, and tab before any picker mutation. Persist only redacted identity evidence.
- Run every post-login status, selection, verification, and restoration command with `AGBROWSE_WEB_AI_AUTO_START=0`. If the runtime disappears or returns `cdp.unreachable`, stop and leave c5 open instead of starting a replacement browser.

## Build and check

1. Open the owned browser and leave ChatGPT visible for user authentication.
2. Confirm the owned runtime remains the symlink target. Before mutation, require a sanitized browser-visible authenticated indicator on the correlated owned tab: no Log in/Sign up controls plus visible account UI and composer. User confirmation, CLI status, or a public composer alone is insufficient.
3. With auto-start disabled, capture the picker state, perform one current-family or effort selection through the symlinked CLI, capture browser-visible selected state, then restore and capture the original state. Stop on any runtime/target identity drift.
4. Record sanitized evidence, rerun the focused/release gates if a repository file changes, commit generated docs separately, push `dev`, and close c5 only if runtime correlation, positive authentication, and all three picker states are proven.

## Terminal rule

Until the user completes login in the owned browser, WP5 is waiting on authentication and c5 stays open. A login error, CAPTCHA, or identity approval remains user-owned; it is never bypassed or copied from another profile.
