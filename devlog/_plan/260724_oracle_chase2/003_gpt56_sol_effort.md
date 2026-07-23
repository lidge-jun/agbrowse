# 003 — GPT-5.6 Sol, unified effort picker, and current-effort preservation

Date: 2026-07-24  
Scope: Oracle chase round 3, T3 + T11  
Upstream: `/tmp/oracle-chase-260724` (`steipete/oracle`)  
Local: `/Users/jun/Developer/new/700_projects/agbrowse`

## Upstream mechanisms

### `f2f4a6c3` — GPT-5.6 Sol aliases and picker traversal

- Normalizes GPT-5.6 spellings/testids (`5.6`, `5-6`, `56`, `gpt56`, `gpt-5.6 Sol`) and requires both version `5-6` and variant token `sol` in resolved evidence.
- Treats a `5.6` row with `aria-haspopup="menu"` as version-submenu navigation, hovers/clicks through the nested picker, and accepts version/variant from the configured dialog, composer pill, button, or final option only when both tokens match.
- Uses centered pointer/mouse hover coordinates, tracks whether a target option was actually clicked, waits for the composer signal to settle, and reports `switched` rather than `already-selected` after a click.

### `52649bad` — Sol is not Pro

- Strengthens every selection/evidence layer: a Sol resolution fails if the resolved label or configured variant contains `pro`; a candidate containing Pro scores zero; a final Sol option with Pro text/testid is rejected; an active Pro composer pill invalidates Sol verification.
- The composer matcher for GPT-5.6 Sol explicitly includes `5 6 sol` and excludes `pro`. This prevents a generic Pro row/pill from satisfying a Sol request.

### `89c344c4` — safe Sol limits

- Browser-side safety tightens the final GPT-5.6 option check: even an otherwise matching `5.6 Sol` option is accepted only when no Pro composer pill is active (`modelSelection.ts`).
- The same commit's token/context limits live in Oracle API configuration (`src/oracle/config.ts`), not browser picker effort handling. They have no agbrowse API-routing equivalent.

### `220fbd18` — GPT-5.6 unified Intelligence effort picker

- Recognizes the open unified picker by either root testid `composer-intelligence-picker-content` or a descendant matching the Intelligence selector; it does not require a legacy nested effort menu.
- Expands bilingual effort matching (including Chinese `极速/中/高/极高`) and disambiguates `High` from `Extra High`; bare Chinese `高` is only a second-pass fallback for heavy so it cannot beat `极高`.
- For GPT-5.6, finds the composer `.__composer-pill`; when that pill says `Pro`, treats it as a valid unified-picker trigger. It forces GPT-5.6 to model kind `versioned` so a Pro-labelled trigger is not mistaken for the legacy Pro model.
- In the flat picker, non-Pro requests skip Pro. Legacy `Pro + extended` maps to the direct `Pro` radio only when no legacy Pro-effort trigger exists.
- Re-queries a composer trigger if React detached it after selection, then verifies against the fresh pill/menu state.

### `e827942f` — preserve current browser effort

- `options.ts` and `runOptions.ts` provide the existing option/source plumbing; the behavioral change is in `src/cli/browserDefaults.ts`.
- If `browserModelStrategy=current` came explicitly from CLI, configured `browser.thinkingTime` is not inherited. Therefore selecting no model preserves the browser's current effort.
- An explicit CLI thinking-time still wins. A config-defined `modelStrategy=current` continues to inherit its paired configured thinking time, and CLI `select`/`ignore` strategies retain normal inheritance.

### Confirmed excluded routing commit

- `a6138173` remains **Not-applicable**: it is Oracle API-model routing, already ruled out in `000_plan.md`; no further analysis was performed.

## agbrowse current state

- The core module declares the separate family axis and `gpt-5.6-sol` family (`web-ai/chatgpt-model.mjs:6-14`, `web-ai/chatgpt-model.mjs:109-125`). It normalizes only the exact canonical family aliases.
- The current Intelligence picker is composer-scoped to an open menu containing `composer-intelligence-picker-content`, with Work markers kept separate (`web-ai/chatgpt-model.mjs:165-172`, `web-ai/chatgpt-model.mjs:491-539`, `web-ai/chatgpt-model.mjs:643-669`).
- Family selection opens a submenu, finds exact family radio labels, requires consistent `aria-checked`/`data-state`, clicks, and re-verifies (`web-ai/chatgpt-model.mjs:717-866`, `web-ai/chatgpt-model.mjs:885-903`). This structurally separates `GPT-5.6 Sol` from the flat `Pro` tier.
- Flat Intelligence tiers are exact-label rows: Instant, Medium, High, Extra High, Pro. Thinking effort maps only to medium/high/xhigh; Pro has no enforceable effort (`web-ai/chatgpt-model.mjs:60-107`, `web-ai/chatgpt-model.mjs:142-163`). Selection uses exact composer-root labels before legacy testids (`web-ai/chatgpt-model.mjs:677-713`, `web-ai/chatgpt-model.mjs:912-950`, `web-ai/chatgpt-model.mjs:1163-1173`).
- With no model, effort, or family request, selection returns before opening a picker, preserving browser state (`web-ai/chatgpt-model.mjs:266-283`). If called directly with effort only, it reads the currently selected tier and applies effort to that tier (`web-ai/chatgpt-model.mjs:326-388`).
- The public CLI says selectors are untouched unless flags are explicit, and carries `model` plus `reasoningEffort` into input (`web-ai/cli.mjs:125-133`, `web-ai/cli.mjs:682-725`, `web-ai/cli.mjs:1619-1629`). However, it has no `family` parse/input field (`web-ai/cli.mjs:590-654`, `web-ai/cli.mjs:682-725`), and ChatGPT invocation passes only effort (`web-ai/chatgpt.mjs:298-310`). Thus the implemented Sol family selector is not reachable from the normal CLI/send path.
- CLI validation rejects effort unless `--model` is also supplied (`web-ai/cli.mjs:1654-1665`), despite the core's current-tier effort resolution. This preserves current effort when neither flag is supplied, but cannot express “current model + explicit effort,” the explicit override allowed upstream.

## Classification

| ID | Upstream mechanism | Classification | Priority | agbrowse evidence / concrete delta |
| --- | --- | --- | --- | --- |
| T3-1 | GPT-5.6 Sol family identity and picker selection | **Gap** | P1 | Core family support exists at `web-ai/chatgpt-model.mjs:109-125,266-325,717-866`, but `web-ai/cli.mjs:590-654,682-725` has no `--family` parse/input and `web-ai/chatgpt.mjs:298-310` does not pass family. Sol selection is unreachable from ordinary CLI/send. |
| T3-2 | Keep GPT-5.6 Sol separate from Pro | **Covered** | P2 | Exact family submenu verification is separate from flat Pro tier: `web-ai/chatgpt-model.mjs:60-116,717-866,885-903`; exact-label tier matching is composer-scoped at `web-ai/chatgpt-model.mjs:643-713`. No generic Pro row can satisfy the `GPT-5.6 Sol` family check. |
| T3-3 | Safe browser-side Sol/Pro final-state guard | **Gap** | P2 | Family verification proves the Sol row was checked (`web-ai/chatgpt-model.mjs:784-810`), but final result verification records family evidence without re-reading/rejecting an active Pro-conflicting family state (`web-ai/chatgpt-model.mjs:389-415`). Oracle explicitly vetoes Sol whenever a Pro composer pill is active. |
| T3-4 | Oracle API context/output limits for Sol | **Not-applicable** | P3 | `89c344c4` places these limits in Oracle `src/oracle/config.ts`; agbrowse is browser automation and has no API-model routing. `a6138173` is the already-excluded routing analogue. |
| T3-5 | Unified flat Intelligence picker and effort mapping | **Covered** | P2 | Current root/selectors and exact flat rows are implemented at `web-ai/chatgpt-model.mjs:92-107,165-172,643-713,912-950,1163-1173`; Pro effort is deliberately unenforced at `web-ai/chatgpt-model.mjs:359-387`. This matches the current English UI strategy, while legacy selectors remain fallback-only. |
| T3-6 | Latest multilingual/stale-trigger resilience from unified-picker patch | **Gap** | P3 | Local labels cover English/Korean (`web-ai/chatgpt-model.mjs:60-107`) but not Oracle's new Chinese `极速/中/高/极高`, and local click verification does not explicitly refresh a detached React composer trigger (`web-ai/chatgpt-model.mjs:912-932,959-1028`). Add only if those locales/stale-node failures are in supported runtime scope. |
| T11-1 | No implicit effort mutation when current browser model is preserved | **Covered** | P1 | Zero-request selection returns without touching the picker (`web-ai/chatgpt-model.mjs:266-283`); CLI injects no defaults (`web-ai/cli.mjs:1619-1629`) and documents that omitted effort preserves checked browser effort (`web-ai/cli.mjs:125-129`). |
| T11-2 | Explicit effort override while keeping current model | **Gap** | P1 | Core can resolve the current tier for effort-only selection (`web-ai/chatgpt-model.mjs:326-388`), but CLI rejects effort without `--model` (`web-ai/cli.mjs:1654-1665`). Upstream permits an explicit thinking-time override with current-model strategy. |

## Proposed gap rows

- `G-T3-CLI-FAMILY | expose and forward ChatGPT --family so gpt-5.6-sol selection is reachable | Gap | web-ai/cli.mjs, web-ai/chatgpt.mjs | chatgpt-model.mjs already implements exact family selection, but CLI parsing/input and invocation omit family`
- `G-T3-SOL-PRO-VETO | re-verify Sol family and reject a conflicting active Pro family/pill state in final evidence | Gap | web-ai/chatgpt-model.mjs | final verification checks tier only and carries earlier family evidence; Oracle vetoes Sol when Pro is active`
- `G-T3-UNIFIED-RESILIENCE | add scoped Chinese effort labels and detached-trigger refresh parity where supported | Gap | web-ai/chatgpt-model.mjs | current labels are English/Korean and trigger verification has no explicit React-detachment refresh`
- `G-T11-CURRENT-EFFORT | allow explicit effort against the currently selected model without requiring --model | Gap | web-ai/cli.mjs | core supports current-tier effort resolution but CLI validation rejects the request`
