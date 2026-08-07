# WP1 — Power picker contract and selector implementation

Depends on: `001_live_dom_evidence.md`.

## P stale check at WP1 entry

- `createFakeModelPage` already owns mutable family-submenu state and checked-state serialization (`test/unit/web-ai-chatgpt-model.test.mjs:864-1228`); extend it instead of introducing a browser runner.
- Its `simplifiedIntelligenceMenu` branch still models one flat root and exposes family menus only under the old selector assumptions. Add a `powerPickerShell` mode that returns the top root, exact multiline Model/Effort triggers, and sibling open portal menus.
- The source remains unchanged since roadmap lock at `8970ca2`; all path targets below are current.

## Test-first delta

1. MODIFY `test/fixtures/provider-dom/chatgpt-gpt56-chat.html`.
   - Replace the flat Intelligence group with the observed Power shell.
   - Keep the composer trigger linked through `aria-controls`.
   - Add Power menuitem, 0..4 slider, Advanced row, Model/Effort triggers, and sibling portal submenu records.
   - Remove 5.4/5.3 and the retirement badge; preserve scrub/network safety and stable `data-eval-key` records.
2. MODIFY `test/unit/web-ai-provider-dom-contract.test.mjs`.
   - Assert shell, slider bounds/current value, exact five-step mapping, Model/Effort submenu triggers, current three-family set, and checked-state pairs.
   - Run before production changes and capture RED from the retired root/flat-tier assumptions.
3. MODIFY `test/unit/web-ai-chatgpt-model.test.mjs`.
   - Extend the existing fake page owner; do not add a second fake framework.
   - Add an executable activation case whose top shell opens sibling effort/family portal menus through the same locator and click paths used by production, with no content test id.
   - In `powerPickerShell` mode, make `makeLocator(...).locator(childSelector)` return only elements owned by that fake root or submenu. It must not delegate scoped child queries back to the whole page as the legacy fake currently does.
   - Disable generic CSS/text effort triggers in the shell activation case and assert their click counters stay zero, so only the exact multiline `Effort\n<value>` and `Model\n<family>` submenu triggers can arm the path.
   - Require four independent mutation REDs before GREEN: restore the old root-only selector; remove the sibling open-menu search; remove the exact Effort/Model trigger opener; restore the retired five-family enum/fixture expectation. Static template/label presence is not activation evidence.

## Production delta

1. MODIFY `web-ai/chatgpt-model.mjs`.
   - Make the current root accept the old content-testid child OR a composer-controlled open menu containing the Power/Model/Effort shell.
   - Recognize the shell as open before any submenu radio exists.
   - Add one owned exact-line submenu-trigger helper and reuse it for Model/Effort; no broad text-only page clicks.
   - Search all visible open picker menus only after the composer root is established, so sibling portal submenus can supply exact radio labels.
   - Keep surface preflight and Work marker rejection before mutation.
   - Remove retired families from `FamilyChoice`, options, and aliases; retain legacy tier aliases such as `gpt-5.3 -> instant` only where they are explicitly model aliases rather than family rows.
2. MODIFY `web-ai/cli.mjs` and `web-ai/tool-schema.mjs`.
   - Public family enum/help becomes `gpt-5.6-sol|gpt-5.5|o3`.
   - Unsupported retired family input fails before browser mutation.

## Activation scenarios

- Closed live shell: opener click produces a recognized top root without radio descendants.
- Thinking from Pro: exact `Effort` trigger opens sibling radio menu; Medium is selected and checked.
- Pro from Thinking: same path selects Pro and verifies the composer pill.
- Family switch: exact Model trigger opens sibling family menu; requested row is visible/enabled and checked after click.
- Work surface: surface guard rejects before any selector click.
- Legacy flat menu: existing test-id and flat-radio tests stay green.

## Whole field/enum chain

Family values:

- Creation: CLI `--family`, MCP `web_ai_submit_prompt.family`.
- Serialization: CLI/MCP input object into `chatgpt.mjs`.
- Deserialization: `normalizeChatGptFamilyChoice` and CLI preflight.
- Consumers: capability probe, selector, evidence, help/docs/fixtures/tests.

No persistence format change. No migration.

## Enforcement/bypass record

- Tier: E7 runtime selector + schema/CLI preflight.
- Surface: CLI/MCP before mutation, then DOM checked-state verification.
- Bypass: direct internal call can pass a page double; live provider can A/B a different DOM.
- Residual: account cohorts may expose additional families.
- Wording: current verified set, not universal permanent support.
- Final layer: live option visibility/enabled check and post-click checked-state verification.

## WP1 build evidence

- RED contract commit: `ea3eb34 test(web-ai): capture the Chat Power picker contract`.
- Initial RED: the current-shell Pro and o3 paths could not resolve the retired content-testid root; 5.4/5.3 reached browser mutation instead of failing preflight.
- GREEN: selector, fixture, and MCP schema suites passed 102/102 after the Power root, exact submenu triggers, sibling portal signature, checked-tier mapping, and three-family enum landed in the working tree.
- Mutation checks all returned non-zero, then passed after restoration:
  - old content-testid-only root: current Pro and o3 both RED;
  - removed sibling portal search: current Pro RED with `model option not found`;
  - removed exact Effort trigger match: current Pro RED;
  - restored five-family aliases: both retired-family zero-touch assertions RED.
- TypeScript project gate: `npm run typecheck` passed. `typecheck:checkjs` remains a noisy repository baseline with existing DOM-lib and check-JS errors; the one new implicit-array diagnostic was removed before commit.
