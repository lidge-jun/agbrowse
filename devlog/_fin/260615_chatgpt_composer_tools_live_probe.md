# ChatGPT composer tools live probe — PR #78

Date: 2026-06-15
Branch: `pr-78-chatgpt-tools`
Relevant commits at probe time:

- `51268ef Preserve ChatGPT web search tool pill`
- `fa2e806 Avoid implicit ChatGPT selector traversal`
- `74d6da7 Guard default ChatGPT composer selection`
- PR base commit: `525a0a2 [verified] Add ChatGPT composer tool selection`

## Product boundary being verified

Default ChatGPT sends must not traverse model/tool/plugin menus. Composer model/tool/menu selection is allowed only when the caller passes explicit flags such as `--model`, `--effort`, `--tool`, `--plugin`, `--web-search`, or `--auto-tools`.

This matters because several ChatGPT composer menus have side effects beyond a harmless selection:

- `Web search` becomes a removable composer pill and can be undone by extra Escape presses.
- Deep research opens a different composer UX with `Apps` and `Sites` submenus.
- Some app/plugin choices open external connector authorization flows.

## Live environment

- Attached to the existing ChatGPT browser session through agbrowse CDP (`http://127.0.0.1:9222`).
- No prompt was intentionally submitted for the Deep research/menu probe.
- Element IDs from `observe` are transient browser-tool IDs; role/name/state strings below are the stable evidence.

## Baseline model/effort UX

Starting state on a new ChatGPT composer showed the simplified Intelligence picker.

Observed model menu entries after opening the composer model button:

- `Instant`
- `Medium`
- `High`
- `Extra High`
- `Pro Extended`
- `GPT-5.5` submenu

Observed behavior:

- Selecting `Instant` changed the composer model pill to `Instant`.
- This maps to the user's requested "low"/light reasoning smoke path for the simplified picker.
- Model/effort selection is verified as an explicit path only; default sends must not touch this menu.

## Top-level composer plus menu

Opening the plus button (`aria`: `Add files and more`) on a normal composer produced the following accessible menu items:

- `Add photos & files Command U`
- `Recent files`
- `Create image` (`role=menuitemradio`, `checked=false`)
- `Deep research` (`role=menuitemradio`, `checked=false`)
- `Web search` (`role=menuitemradio`, `checked=false`)
- `More`
- `Projects`

Observed implications:

- `Create image`, `Deep research`, and `Web search` are radio-style tool selections, not ordinary inert menu items.
- Automation must not cycle through these in the default send path.
- Explicit `--web-search` must select only `Web search` and leave a visible `Search` pill checked in the menu.

## Web search toggle/pill behavior

Live web-search smoke before this probe established:

- Explicit `--web-search` successfully selected the top-level Web Search tool.
- The plus menu then showed `Web search` checked.
- The composer showed an active `Search` pill / accessible label `Search, click to remove`.
- Pressing Escape once closes the open menu while preserving the pill.
- Pressing Escape twice removes the active tool pill.

Code consequence already applied in `51268ef`:

- `closeComposerMenus()` now sends one Escape instead of two, because the second Escape can undo `Web search`.

## Deep research top-level selection

Clicking the top-level `Deep research` menu item changed the composer UX.

Observed accessible state after selection:

- Active pill: button name `Deep research, click to remove`
- Placeholder/visual affordance: `Get a detailed report`
- Additional composer buttons:
  - `Apps` (`expanded=false`)
  - `Sites, search the web, no sites saved` (`expanded=false`)
  - Model button `Instant` (`expanded=false`)
- Suggested tabs:
  - `Suggested` (`selected=true`)
  - `Reports` (`selected=false`)
- Suggested report prompt buttons appear below the composer.

Observed implication:

- Selecting Deep research is not the end of the UX; it exposes a second-level source selection area.
- The safe default after Deep research is already `Sites, search the web, no sites saved`.
- Automation should not force site/app submenus unless a future explicit option asks for that specific behavior.

## Deep research Sites menu

Opening `Sites` while Deep research is active produced a menu named `Sites, search the web, no sites saved`.

Observed menu items:

- `Search the web`
- `Specific sites (0)`
- `Manage sites`

Observed behavior for each direct click:

### `Search the web`

- It is the default/checked visual state when the menu opens.
- It represents the safe generic web source for Deep research.
- No separate URL/account flow is needed.

### `Specific sites (0)`

- Direct click opens a modal titled/visible as `Search specific sites`.
- DOM includes:
  - input name `Add a website`
  - placeholder `Add site URLs, separated by commas`
  - `Add` button disabled when input is empty
  - close button `Close`
- While the modal is open, the composer Sites button can show `Sites, specific sites, no sites saved` / `Sites (0)`.
- Closing without adding URLs returns the composer to `Sites, search the web, no sites saved`.

### `Manage sites`

- Direct click opens the same `Search specific sites` modal shape.
- DOM includes the same `Add a website` input and disabled `Add` button.
- This is not a safe implicit default path; it is a user-data/site-list management flow.

Clarification:

- A transient disappearance of the Deep research pill during this live session is excluded from automation evidence. The user clarified that they manually clicked the UI at that moment.

## Deep research Apps menu

Opening `Apps` while Deep research is active produced a menu named `Apps`.

Observed menu items:

- `Box (Legacy) Box Connect`
- `Dropbox (Legacy) Dropbox Connect`
- `GitHub GitHub Connect`
- `Gmail Gmail Connect`
- `Google Calendar Google Calendar Connect`
- `Google Drive Google Drive Connect`
- `Connect more`

Direct click smoke:

- Clicking `GitHub GitHub Connect` navigated/opened the settings connector flow:
  - URL hash: `#settings/Connectors?add-connector-link=true&product-sku=PROMPT_TEXT_AREA&connector=...&referrer=sources_dropdown`
  - dialog role: `dialog`
  - buttons/links included:
    - `Close`
    - `Learn more`
    - `Learn more on how to stay safe`
    - `Continue to GitHub`
- The connector flow was closed without clicking `Continue to GitHub`.
- After closing, ChatGPT returned to the Deep research composer state with:
  - `Deep research, click to remove`
  - `Sites, search the web, no sites saved`
  - `Instant`

Observed implication:

- App/plugin connector choices can leave the composer and enter authorization/account-linking UX.
- These choices must remain explicit-only and should not be part of `--auto-tools` unless the caller requested that connector and accepts auth-flow behavior.

## Deep research post-submit plan card

A later live submit smoke on 2026-06-15 confirmed an additional Deep Research UI after the prompt is submitted.

Prompt used:

`AGBROWSE_DEEP_RESEARCH_POST_SUBMIT_UI_TEST. Briefly research what RFC 2119 keyword MUST means; keep the final answer short.`

Observed across repeated post-submit windows:

- ChatGPT created a conversation URL and rendered the user message.
- A Deep Research plan card appeared above the composer.
- The plan card content is rendered inside a Deep Research app iframe (`about:blank` child frame observed under the `connector_openai_deep_research.web-sandbox.oaiusercontent.com` app frame), not reliably in the main ChatGPT DOM.
- Example card title: `Define RFC 2119 MUST`
- Example plan rows:
  - `Open RFC 2119 official document from IETF website.`
  - `Extract the exact definition and examples of MUST from RFC 2119.`
  - `Cross-check definition with RFC 8174 updates for keyword interpretation.`
  - `Summarize the meaning concisely for non-expert readers.`
- A more complex prompt produced card title `RFC keyword usage comparison` and five rows, with `Start` countdown values `46`, `41`, and `35` observed in successive screenshots.
- Another fresh branch probe produced `Lockfile security policy comparison` with `Start 59`, so the live countdown window is approximately 60 seconds, not 15 seconds.
- Buttons:
  - `Edit`
  - `Cancel`
  - `Start` with countdown text (`Plan starts in NN seconds.` in iframe text)
- Letting the countdown expire automatically transitions the card to `Researching...`; manual `Start` is an accelerator, not the only path forward.
- Clicking a plan row's left circular glyph did not toggle/select that row. The only observed text/body change was the countdown decrement, and the row HTML stayed effectively unchanged. Treat those left circles as status/progress icons, not user-selectable checklist toggles.
- AX/browser observe and ordinary main document query did not reliably expose this card; iframe scanning did. The repository runtime uses Playwright selectors, so the practical selector fix is to scan `page.frames()` and include `button:has-text("Start")` / Korean `button:has-text("시작")`.

## Current code judgment

Keep these constraints for PR #78 follow-up work:

1. No default model/effort selection.
2. No default composer tool traversal.
3. One Escape only after tool selection; a second Escape can remove selected tool pills.
4. `--web-search` should only select the Web Search pill and preserve it.
5. `--tool deep-research` should select the Deep research pill and preserve the default Deep Research source state (`Sites, search the web, no sites saved`).
6. Deep Research `Specific sites` / `Manage sites` and `Apps` connector flows are explicit future surfaces, not default behavior.
7. Plugin/app connector selections are potentially auth-sensitive and must stay gated behind explicit flags.

## Follow-up patches applied from this probe

- Removed `--auto-tools` plugin inference for GitHub/Supabase-style prompts.
- Kept explicit `--plugin <name>` support unchanged.
- Updated CLI help and bundled `skills/web-ai/SKILL.md` so `--auto-tools` is described as non-auth tool inference only.
- Added/updated unit expectations that GitHub/Supabase prompts do not auto-select plugins.
- Added post-submit Deep Research auto-confirm labels for `Start` / `시작`, then corrected the live behavior to scan Deep Research app iframes and wait up to 70 seconds for the observed ~60 second Start card.

### Follow-up: help and skill alignment

- User decision after the live probe: do not implement internal Deep Research
  Apps/Sites/specific-sites configuration. Keep only the top-level Deep
  Research selection and post-submit Start-card handling.
- `agbrowse web-ai --help` should direct agents to load/install the bundled
  `web-ai` skill, because help enumerates flags while the skill carries the
  workflow policy and safety boundaries.
- Top-level `agbrowse --help` should also mention `agbrowse skills get web-ai`
  and `agbrowse skills install --target <agent-skill-root>` near the Web AI
  section so agents do not discover provider flags without the matching skill.
- Bundled `skills/web-ai/SKILL.md` should explicitly say that Deep Research
  preserves ChatGPT's default source state (`Sites, search the web, no sites
  saved`) and must not configure Apps/Sites/connectors unless a future explicit
  flag requests that exact internal setting.

## Verification already run for the branch before this live probe

- `node --check web-ai/chatgpt-tools.mjs`
- `npm run -s typecheck:checkjs`
- `node_modules/.bin/vitest run test/unit/web-ai-chatgpt-tools.test.mjs`
- Live ChatGPT `--web-search` smoke: selected Web Search and preserved pill after the one-Escape fix.
- Live ChatGPT Deep research click smoke: selected Deep research, surfaced Apps/Sites UX, and preserved default `Sites, search the web` source state.
