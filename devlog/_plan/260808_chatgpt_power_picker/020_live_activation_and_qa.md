# WP2 — Symlink activation, contract sync, and QA

Depends on: `010_picker_contract.md` landed and focused tests green.

## Documentation/SoT delta

- MODIFY `skills/web-ai/SKILL.md`, `README.md`, `structure/commands.md`, and generated reference pages that already repeat the family contract.
- MODIFY bundled CLI help in `skills/browser/browser.mjs` only through the repository's existing source/count workflow; do not hand-diverge generated copies.
- State the observed five-step Chat Power UI as an implementation detail mapped by Advanced Model/Effort, while Work retains its separate six-step public `--power` API.
- Record observation date and cohort caveat; remove 5.4/5.3 from current family tables.

## Live activation

1. Use symlinked `agbrowse`, not `node web-ai/...`.
2. `agbrowse navigate https://chatgpt.com/`; if login is absent, report NEEDS_HUMAN rather than borrowing browser cookies.
3. `agbrowse web-ai status --vendor chatgpt --probe chatgpt-model-alias-selectable --json` with the requested family/model/effort inputs through the supported status surface where available.
4. Run a minimal `web-ai send` only after status is ready, with an exact harmless response request and `--url https://chatgpt.com/`; preserve session id and poll it rather than resending.
5. Browser-observe the selected family/effort and restore the pre-test Extra High state.

## Verification matrix

- Focused selector/fixture/CLI/schema tests.
- `npm run typecheck`, `npm run typecheck:checkjs`, `npm run test:contract-drift`.
- `npm test`, `npm run test:mcp`, `npm run test:source-audit`, `npm run test:trace-policy`.
- `npm run test:release-gates`, `npm run gate:all`, `npm pack --dry-run`, `git diff --check`.
- QA adversaries: closed shell, compact/advanced toggles, sibling portal submenu, missing family, Work rejection, legacy flat menu, checked-state inconsistency.
- Independent fresh reviewer reads the final diff and live evidence; blockers are repaired and re-audited by the same reviewer.

## Evidence artifacts

- Persist one live screenshot and sanitized AX/DOM summary in this devlog unit.
- Capture command/exit code outputs in `090_closeout.md` during C/D.
- Promote the unit from `_plan` to `_fin` only after all local and live gates pass.
