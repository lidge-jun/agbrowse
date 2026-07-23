# 002 — Cloudflare False-Positive Gating + ChatGPT Work Session Normalization

Date: 2026-07-24
Status: P (research)
Theme: T2 + T4
Upstream: `/tmp/oracle-chase-260724` (`steipete/oracle`)
Local: `web-ai/*.mjs` (Node/Playwright-CDP)

## Upstream mechanisms

### T2 — Cloudflare false-positive gating

1. `4bfe3c04` replaces Oracle's unconditional `/challenge-platform/` script test with one DOM verdict. A title containing `Just a moment` or both `Attention Required` and `Cloudflare` is challenge evidence. Otherwise, a rendered ChatGPT app shell (`#prompt-textarea`, the prompt test id, conversation turns, profile button, main composer form, or conversation navigation) vetoes the challenge classification. With no shell, a challenge widget or verification copy qualifies; a challenge script qualifies only when normalized body text is shorter than 600 characters. This specifically prevents a normal GPT-5.6 Work page carrying Cloudflare bot-management script from being rejected.

2. `66588753` splits the verdict into `strong`, `shell`, and `weak`. Strong means shell absent plus challenge title/widget/verification copy and returns true immediately; shell returns false immediately; weak means shell absent plus challenge script plus body length `< 600`. Weak evidence must persist for a 12,000 ms hydration grace window, sampled every 500 ms. Shell appearance or loss of weak evidence clears the verdict; persistent weak evidence becomes a challenge at the deadline. This avoids treating a healthy SPA between `readyState` and React hydration as blocked.

3. `46512488` gates generic verification copy by page size: `verify(ing) you are human`, `checking your browser`, `needs to review the security of your connection`, or `just a moment` counts as strong only on a shell-less page with normalized body length `< 600`. Challenge title and structured widget remain immediate strong signals. The change prevents content-rich normal pages that merely quote challenge-like prose from being classified as Cloudflare.

### T4 — ChatGPT Work session normalization

1. `80ebcf86` adds a mode probe before prompt submission in both local and remote browser paths. On a non-conversation page it requires visible exact `Chat` and `Work` role-radio controls, recognizes selection from `aria-checked=true` or `data-state=on`, and clicks the center of Chat when Work is selected. On `/c/<id>`, it finds the matching history link and classifies its Work metadata/badge. An existing Work conversation is reset to a new Chat only when the caller supplied a safe reset callback (attached tab, but not explicit conversation resume); otherwise it throws at `chat-mode-selection`. Verification is capped at 10 seconds and normally polls every 200 ms; after a switch Oracle re-runs prompt readiness.

2. `eb22ee25` makes existing-conversation detection title-safe. It removes free-form `aria-label` metadata parsing and accepts only a structured leaf `SPAN` whose text is exactly `work`, has no `dir`, has class `shrink-0`, and sits under `span.flex.items-center`. Matching history links must be same-origin and match the current conversation id. Missing labels or suspicious trailing `, work` text remains unresolved instead of allowing a conversation title containing “Work” to determine mode. It also resets the full, capped 10-second verification window after leaving Work and fails if Chat cannot then be verified.

3. `77c0b197` narrows conversation candidates to renderer-owned sidebar anchors, `a.__menu-item[href*="/c/"]`, so links inside message content cannot masquerade as the active history item. A persistent `conversation-unresolved` state now fails closed: if a safe reset callback exists, open a new Chat and verify it; otherwise throw rather than return `unavailable` and continue an ambiguous resume.

## agbrowse current state (path:line)

### Interstitial detector and consumption

- `web-ai/interstitial.mjs:14-19` defines four plain body-substring Cloudflare patterns: `just a moment`, secure-connection copy, JavaScript/cookies copy, and `ray id`.
- `web-ai/interstitial.mjs:29-39` knows composer and assistant-turn selectors, but `web-ai/interstitial.mjs:46-52` checks Cloudflare text first and returns `cloudflare-challenge` without consulting `hasComposer` or `hasTurns`. Therefore a healthy Chat/Work app shell that displays or quotes one of those phrases is false-positive eligible.
- `web-ai/interstitial.mjs:62-67` uses app-shell absence only for `empty-shell`; this does not veto the earlier Cloudflare return. There is no title, widget, Cloudflare script, short-page gate, evidence strength, polling, or hydration grace-window signal.
- `web-ai/interstitial.mjs:75-84` performs one live snapshot and fails open to `none` on detector errors. `web-ai/interstitial.mjs:101-106` treats selector presence, not visibility, as shell evidence.
- Repository search finds `detectInterstitial`/`classifyInterstitial` only in `web-ai/interstitial.mjs:46,75,81` and unit tests (`test/unit/web-ai-interstitial.test.mjs:2-44`); no current production `web-ai` path imports or consumes the verdict. The false-positive is therefore latent in this intended unified detector, not currently a proven send-path abort.

### Chat/Work surfaces and sessions

- `web-ai/product-surfaces.mjs:95-103` specifies a read-only, fail-closed radio contract. `web-ai/product-surfaces.mjs:107-158` requires both visible exact Chat/Work radios and consistent `aria-checked` plus `data-state`; one-sided, mismatched, both-active, and both-inactive states become `ambiguous`.
- `web-ai/chatgpt-work-picker.mjs:234-289` intentionally switches Chat to Work for the dedicated Work command, rejects legacy/ambiguous states, and verifies Work after clicking. `web-ai/chatgpt-work-picker.mjs:1007-1045` re-detects Work immediately before submit and fails on drift.
- Dedicated Work entry points are explicit at `web-ai/cli.mjs:1918-1934` and `web-ai/mcp-server.mjs:223-246`; automatic global Work-to-Chat normalization would conflict with this product surface.
- For Chat model mutation, `web-ai/chatgpt-model.mjs:490-525` rejects active Work or ambiguous state with `capability.unsupported` and `retryHint: switch-to-chat`; it does not switch to Chat itself.
- `detectChatGptComposerSurface` has no URL/conversation-id or sidebar-history inspection (`web-ai/product-surfaces.mjs:107-158`). Both radios absent are treated as benign `legacy` at `web-ai/product-surfaces.mjs:112-114,135-136`, so agbrowse has no title-safe existing-conversation Work detector and no fail-closed `/c/<id>` ambiguity policy equivalent to Oracle's.

## Classification

| ID | Upstream mechanism | Classification | Priority | agbrowse evidence / concrete change |
| --- | --- | --- | --- | --- |
| T2-1 | App-shell veto plus structured Cloudflare signals; script only on shell-less body `< 600` | **Gap** | P1 | `web-ai/interstitial.mjs:46-52` returns on body copy before the composer/turn signals gathered at `:75-81`; shell does not veto. Add a structured strong/shell/weak verdict. agbrowse does not inspect challenge scripts, so Oracle's exact script-only bug is absent, but normal GPT-5.6 Work UI or other healthy content quoting a configured phrase can still false-flag. |
| T2-2 | Weak script-only evidence persists for 12 s, polled every 500 ms, before challenge | **Gap** | P1 | `web-ai/interstitial.mjs:75-84` takes one snapshot; no evidence strength or hydration grace exists. Add bounded re-probing for weak evidence while allowing shell appearance/no-evidence to clear immediately. Production integration is separately required because current search shows no consumer. |
| T2-3 | Generic verification copy is strong only on shell-less short page (`< 600`) | **Gap** | P1 | `web-ai/interstitial.mjs:14-19,46-52` matches generic copy at any body length and regardless of app shell. Gate generic copy by shell absence and short-page threshold; reserve immediate classification for title/structured-widget evidence. |
| T4-1 | Normalize Work to Chat before ordinary Chat submission; reset non-resume Work conversation safely and verify within capped 10 s | **Gap** | P2 | `web-ai/chatgpt-model.mjs:490-525` fails with `switch-to-chat` instead of normalizing, while `web-ai/product-surfaces.mjs:107-158` only observes radios. Add a Chat-path-only `ensureChatSurface` that clicks Chat, verifies post-state, and opens new Chat only when not explicitly resuming. Do not apply it to dedicated Work entry points (`web-ai/cli.mjs:1918-1934`, `web-ai/mcp-server.mjs:223-246`). |
| T4-2 | Title-safe existing `/c/<id>` Work detection using same-origin matching and structured Work badge | **Gap** | P2 | `web-ai/product-surfaces.mjs:107-158` has no conversation URL/sidebar probe. Add current-conversation-id matching against renderer-owned sidebar links and accept only a structured Work badge; never infer Work from free-form title/aria text. |
| T4-3 | Fail closed when existing-conversation mode remains ambiguous; safe new-Chat reset or throw | **Gap** | P2 | Radio ambiguity is covered for visible toggle UI (`web-ai/product-surfaces.mjs:142-158`; `web-ai/chatgpt-work-picker.mjs:241-249`), but absent controls are labeled `legacy` (`web-ai/product-surfaces.mjs:112-114,135-136`) and `/c/<id>` mode is not resolved. Add a conversation-specific unresolved state that either resets only in a non-resume flow or throws before Chat submission/resume. |
| T4-4 | Preserve intentional Work operation rather than globally forcing Chat | **Covered** | P3 | Dedicated Work commands intentionally select and verify Work at `web-ai/chatgpt-work-picker.mjs:234-289,1007-1045`, reached from `web-ai/cli.mjs:1918-1934` and `web-ai/mcp-server.mjs:223-246`. Any parity port must be scoped to ordinary Chat paths. |

## Proposed gap rows

G-T2-CF-STRUCTURED | app-shell veto and strong/shell/weak Cloudflare evidence with short-page generic-copy gate | Gap | web-ai/interstitial.mjs | `web-ai/interstitial.mjs:14-19,46-52,62-67`

G-T2-CF-HYDRATION | 12 s weak-evidence hydration grace sampled every 500 ms, plus production verdict consumption | Gap | web-ai/interstitial.mjs | `web-ai/interstitial.mjs:75-84`; no production importer found by repository search

G-T4-CHAT-NORMALIZE | Chat-path-only Work-to-Chat switch/new-Chat reset with post-switch verification | Gap | web-ai/chatgpt-model.mjs | `web-ai/chatgpt-model.mjs:490-525`; preserve `web-ai/chatgpt-work-picker.mjs:234-289`

G-T4-CONVERSATION-MODE | title-safe `/c/<id>` structured Work detection and fail-closed unresolved resume | Gap | web-ai/product-surfaces.mjs | `web-ai/product-surfaces.mjs:107-158`
