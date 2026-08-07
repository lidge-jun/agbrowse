# WP3 closeout — GPT picker repair and release proof

## Outcome

- Final shipped version: `agbrowse@0.1.21` (`latest`).
- `origin/main`, GitHub Release `v0.1.21`, and successful Release run `31211622366` all resolve to `136d5583f222326bc2da5d3c126006e3527db004`.
- npm integrity: `sha512-GK6zO+MnJT8riHqY0BwSpnX3b2XkudmVNUw6c43QcEyTf9ADiijwRdOBk+lMIGmCpzviI9U4tFidSp5e5UxIYA==`; shasum: `030e32419824bf4bf8d317ea8be43261d0172727`.
- A fresh registry install into `/tmp/agbrowse-v0121-registry-verify.iaxvcu` succeeded. The installed postinstall module executed directly with exit 0, package version read `0.1.21`, and the installed `agbrowse --help` command exited 0.

## Picker contract evidence

- Authenticated Chrome and Computer Use agreed on the current Chat Power shell: opener `button.__composer-pill[aria-haspopup="menu"]`, Power menu, Model and Effort submenus, family rows `GPT-5.6 Sol` / `GPT-5.5` / `o3`, and effort rows `Instant` / `Medium` / `High` / `Extra High` / `Pro`.
- The observed Power slider range was `0..4`; the selected value was restored to `Extra High` after inspection.
- RED commit `ea3eb34` captured the changed shell and retired-family rejection. Implementation commit `a2171c3` added the current root/portal selectors and exact active-state checks.
- Independent review found two false-green paths; unrelated checked-Pro and one-label-o3 decoys were added before the same reviewer returned PASS.

## Verification

- Picker-focused verification: 104/104 on dev; integrated-main focused verification: 190/190.
- Dev full suite before integration: 2,202 passed, 12 skipped. Integrated release suite with system Chrome passed all 164 active test files; the final remote Release workflow passed `npm test`, MCP, source-audit, trace/policy, fixture, structure, and all 16 named release gates.
- Structure gates passed 164 drift checks and 76 count checks. `git diff --check` and package dry-runs passed.
- Final package contains 717 files, including `scripts/postinstall.mjs` and both relative helper imports.
- The release workflow now installs the packed tarball before publish, directly executes its installed postinstall module, runs the installed CLI, then repeats the same smoke from the registry after publish with bounded retries.

## Release repair ledger

1. Run `31209035347` stopped before publish: integrated CI exposed missing `jsdom` and two stale effort-only CLI assertions.
2. The repairs were split into `7c2a8c2` and `ac6f5c4`; run `31209807727` published `0.1.20` and created its release.
3. A separate clean-prefix install then proved `0.1.20` was not installable because the package included `postinstall.mjs` but omitted `agent-driven.mjs` and `interactive-confirm.mjs`.
4. The package closure and permanent packed/published install smokes were added as meaning-separated commits. Two `0.1.21` runs (`31210731837`, `31211173729`) stopped before publish while hardening npm 24 pack-output handling.
5. The final workflow removed JSON-shape dependence and installed the deterministic tarball path. Run `31211622366` passed pre-publish install smoke, Trusted Publishing, post-publish registry install smoke, and GitHub Release creation.

## Remaining human boundary

The symlink itself is correct: `/Users/jun/.local/bin/agbrowse` resolves to this repository's `bin/agbrowse.mjs`, and its owned CDP runtime was healthy. The agbrowse-owned Chrome profile is signed out of ChatGPT, so an authenticated symlinked prompt send/model-selection smoke was not performed. Cookies were not copied from the user's signed-in Chrome and no login was attempted. This remains `NEEDS_HUMAN_LOGIN`; it does not invalidate the DOM contract, automated regression, package deployment, or registry-install evidence above.

## Rollback

- npm package versions are immutable. If `0.1.21` must be withdrawn from `latest`, move the dist-tag back to `0.1.20` or another verified version and mark `v0.1.21` superseded.
- Do not recommend `0.1.20`: its clean-prefix install is broken. The next safe published version is `0.1.21`.
