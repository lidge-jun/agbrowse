# WP2 — Symlink activation, contract sync, and QA

Depends on: `010_picker_contract.md` landed and focused tests green.

## P stale check at WP2 entry

- `/Users/jun/.local/bin/agbrowse` still resolves to this checkout's `bin/agbrowse.mjs`; runtime CDP is healthy on port 9222.
- The agbrowse-owned Chrome has one active `about:blank` tab, so initial `web-ai status` correctly returns `blocked` with `chatgpt-active-tab-verification: fail` and `next: tab-switch`.
- Live activation must navigate that owned tab to `https://chatgpt.com/` and verify its own login state. The already authenticated Chrome-plugin tab is evidence only and must not be used to transfer cookies.
- Current source commits are `ea3eb34` (RED contract) and `a2171c3` (Power selector implementation); local docs remain a separate pending commit.

## Documentation/SoT delta

- MODIFY `skills/web-ai/SKILL.md`, `README.md`, `structure/commands.md`, and generated reference pages that already repeat the family contract.
- MODIFY bundled CLI help in `skills/browser/browser.mjs` only through the repository's existing source/count workflow; do not hand-diverge generated copies.
- State the observed five-step Chat Power UI as an implementation detail mapped by Advanced Model/Effort, while Work retains its separate six-step public `--power` API.
- Record observation date and cohort caveat; remove 5.4/5.3 from current family tables.

## Live activation

### Fresh executable and checkout anchors

Run immediately before mutation and persist stdout in `021_symlink_activation_evidence.md`:

```bash
command -v agbrowse
readlink /Users/jun/.local/bin/agbrowse
realpath /Users/jun/.local/bin/agbrowse
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
```

Pass only if all executable paths resolve to this checkout's `bin/agbrowse.mjs`, branch is `dev`, HEAD contains `ea3eb34` and `a2171c3`, and scoped changed files are listed separately from pre-existing `.codexclaw`/probe dirt.

### Failure-safe live sequence

1. Capture `PRE_TABS_JSON="$(agbrowse tabs --json)"`, active `PRE_URL`, and a sanitized `agbrowse web-ai snapshot --vendor chatgpt --interactive --json` before selection. Parse the current exact `Model\n<family>` and `Effort\n<tier>` lines after navigating to ChatGPT. Gate mutation on exactly `Model\nGPT-5.6 Sol` and `Effort\nExtra High`; any other state or absent login stops as `NEEDS_HUMAN` before mutation. Never borrow Chrome-plugin cookies.
2. Install a shell `trap cleanup_picker EXIT INT TERM`. `cleanup_picker` starts with `trap - EXIT INT TERM` so a signal path cannot invoke it again through `EXIT`. It must, on every exit path after the exact pre-state gate:
   - close any open picker with `agbrowse press Escape`;
   - restore the captured family/tier with a minimal `agbrowse web-ai send` using the same exact family plus `--model thinking --effort xhigh --prompt "Reply exactly AGBROWSE_RESTORE_OK"` when the pre-state is the observed Sol/Extra High state;
   - poll that one restore session once by captured session id, verify `Model\nGPT-5.6 Sol` and `Effort\nExtra High` in a fresh interactive snapshot, then `agbrowse navigate "$PRE_URL"` (currently `about:blank`);
   - re-run `agbrowse tabs --json` and fail the cleanup record if URL, menu-closed state, family, or tier is not restored. Cleanup failure is a task failure, not a warning.
3. Navigate and preflight exactly:

```bash
agbrowse navigate https://chatgpt.com/
agbrowse web-ai status --vendor chatgpt --url https://chatgpt.com/ --json
agbrowse web-ai snapshot --vendor chatgpt --interactive --json
```

4. Submit one exact production-path smoke and capture its session id without resending:

```bash
SEND_JSON="$(agbrowse web-ai send --vendor chatgpt --url https://chatgpt.com/ \
  --family gpt-5.6-sol --model thinking --effort medium --inline-only \
  --prompt "Reply exactly AGBROWSE_POWER_PICKER_OK" --timeout 120 --json)"
SID="$(printf '%s' "$SEND_JSON" | jq -er '.sessionId')"
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 120 --json
```

Pass only if send returns one session id, poll returns terminal success with the exact reply, `modelSelection.familyLabel == "GPT-5.6 Sol"`, `normalizedModel == "thinking"`, `verified == true`, and selected effort is `medium`.
5. Before cleanup, capture a fresh browser snapshot and screenshot proving `Model\nGPT-5.6 Sol` and `Effort\nMedium`; then let the trap restore Extra High and `PRE_URL`. Chrome-plugin and Computer Use observations are independent cross-check evidence only.

## Verification matrix

Run these exact commands; every command must exit 0 except `typecheck:checkjs`, whose pre-existing baseline must be diffed and must contain no new unique diagnostic message:

```bash
npx vitest run test/unit/web-ai-chatgpt-model.test.mjs test/unit/web-ai-provider-dom-contract.test.mjs test/unit/web-ai-tool-schema.test.mjs
npm run typecheck
set -o pipefail
set +e
npm run typecheck:checkjs 2>&1 | tee /tmp/agbrowse-checkjs-current.log
CURRENT_CHECKJS_RC=${PIPESTATUS[0]}
set -e
BASE_WT="$(mktemp -d)"
git worktree add --detach "$BASE_WT" origin/dev
ln -s "$PWD/node_modules" "$BASE_WT/node_modules"
(cd "$BASE_WT"; set +e; npm run typecheck:checkjs > /tmp/agbrowse-checkjs-base.log 2>&1; exit 0)
sed -E 's#^[^ ]+\.mjs\([0-9]+,[0-9]+\): ##' /tmp/agbrowse-checkjs-current.log | sort -u > /tmp/agbrowse-checkjs-current.norm
sed -E 's#^[^ ]+\.mjs\([0-9]+,[0-9]+\): ##' /tmp/agbrowse-checkjs-base.log | sort -u > /tmp/agbrowse-checkjs-base.norm
comm -13 /tmp/agbrowse-checkjs-base.norm /tmp/agbrowse-checkjs-current.norm > /tmp/agbrowse-checkjs-new.log
test ! -s /tmp/agbrowse-checkjs-new.log
git worktree remove "$BASE_WT"
npm run test:contract-drift
npm test
npm run test:mcp
npm run test:source-audit
npm run test:trace-policy
npm run test:release-gates
npm run gate:all
npm pack --dry-run --json
git diff --check
```

Executable adversary assertions are the named unit tests for current Power Pro/o3, unrelated checked-radio decoy, unrelated one-label family menu, retired family zero-touch, Work rejection, hidden family rows, and legacy flat menu. Compact/advanced evidence is the live shell snapshot plus exact root-owned Model/Effort trigger test. Any failure is blocking.

After executor evidence is complete, an independent reviewer must freshly rerun `command -v`/`realpath`, `git rev-parse HEAD`, symlinked `web-ai status`, the post-cleanup tabs/snapshot proof, and this exact six-scenario command (the retired-family case is parameterized but one scenario):

```bash
npx vitest run test/unit/web-ai-chatgpt-model.test.mjs test/unit/web-ai-product-surfaces.test.mjs \
  -t "selects Pro through the current Chat Power|selects o3 through the current Chat Power|does not verify a Power tier from an unrelated checked radio|does not accept a one-label unrelated menu as the family portal|retired Chat family|detects active Work surface"
```

Repair blockers and re-audit with the same reviewer.

## Evidence artifacts

- Persist anchors, send/poll JSON summaries, sanitized AX/DOM, pre/post restore tabs, and artifact paths in `021_symlink_activation_evidence.md`.
- Persist one live screenshot path from the agbrowse-owned profile and keep Chrome/Computer Use cross-checks separately identified.
- Anchor the evidence to `origin/dev`, pre-activation HEAD, exact scoped changed paths, and the pre-existing dirty-path allowlist.
- Capture gate command/exit-code summaries in `090_closeout.md` during C/D.
- Promote the unit from `_plan` to `_fin` only after all local and live gates pass.
