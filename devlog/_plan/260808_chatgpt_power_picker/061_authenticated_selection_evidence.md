# WP6 evidence — authenticated symlink selection proof

## Runtime identity

- Symlink: `/Users/jun/.local/bin/agbrowse` → repository `bin/agbrowse.mjs`
- Owned CDP endpoint: `http://127.0.0.1:9222`
- Active tab: `https://chatgpt.com/` title `ChatGPT`
- Auth proof: no Log in / Sign up controls; profile menu visible; Chat surface radio `aria-checked=true`
- Commands used `AGBROWSE_WEB_AI_AUTO_START=0`; no substitute browser was started

## Non-content selection sequence

Executed through the symlink-resolved repository runtime against the authenticated owned profile.

1. Before state
   - Browser-visible composer pill: `Pro`
   - Chat surface checked
2. Selection
   - `selectChatGptModel(page, "thinking", { effort: "high" })`
   - Result: `selected=thinking`, `effort=high`, `verified=true`
   - Fallbacks: `composer-model-pill`, `chat-power-slider`, `thinking-effort-power-slider`
   - Browser-visible composer pill: `High`
3. Restore
   - `selectChatGptModel(page, "pro")`
   - Result: `selected=pro`, `verified=true`
   - Fallbacks: `composer-model-pill`, `chat-power-slider`
   - Browser-visible composer pill: `Pro`

No prompt was typed and no send occurred.

## Root cause fixed during the proof

Current Chat Power reuses `composer-model-picker-slider-simple-view` / `advanced-view` markers that previously meant Work-only. `assertOpenMenuIsNotWorkPicker` now allows those markers when the open shell is the Chat Power menu or the Chat radio is active. Tier selection on the live shell uses the Power slider (`ArrowLeft` / `ArrowRight`) when the detached Effort radio portal is not exposed.

## Terminal classification

c5 is met for the authenticated owned-profile path: correlated endpoint identity plus browser-visible before / selected / restored proof.
