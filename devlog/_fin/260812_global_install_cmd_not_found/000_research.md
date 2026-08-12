# 000 — global-install command-not-found: Research

## Trigger

User report (2026-08-12 23:20 KST, junui-MacBookPro, zsh):

```
$ npm install -g agbrowse
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   agbrowse@0.1.22 (postinstall: node scripts/postinstall.mjs)
...
$ agbrowse start
zsh: command not found: agbrowse
```

Ask: make this class of problem not recur, then run the release train
(dev push -> main merge -> preview -> npm publish).

## Evidence gathered (all on the affected machine)

1. **The install itself worked.** npm linked both shims at 23:20:53:
   `/Users/jun/.nvm/versions/node/v24.17.0/bin/agbrowse ->
   ../lib/node_modules/agbrowse/bin/agbrowse.mjs` (birth=mtime 23:20:53).
   Running the shim prints the help banner, exit 0. The 60-byte bin is the
   intended thin shim (`import '../skills/browser/browser.mjs'`).
2. **Fresh shells resolve `agbrowse` fine.** `zsh -ic 'which agbrowse'` ->
   `/Users/jun/.local/bin/agbrowse` (a Jun-27 symlink into this repo, earlier
   in PATH than the nvm bin). Both resolution paths work today.
3. **zsh does not cache negative lookups.** Controlled experiment
   (`/tmp/zhashtest.*`): `command not found`, then create the binary in a PATH
   dir, re-run -> found, exit 0. So a stale-hash explanation is ruled out;
   the failing shell must have had a PATH containing neither the nvm bin dir
   nor `~/.local/bin` (a stale/odd terminal tab — the paste shows a dead SSH
   session immediately before). Not package-fixable; doc-fixable.
4. **npm 11.16+ warns about unapproved lifecycle scripts — but still runs
   them; npm 12 will default-deny.** Verified by controlled probe on this
   machine's npm 11.18.0: installing a scratch package with a `postinstall`
   that writes a marker file printed the `allow-scripts` warning AND wrote
   the marker (`postinstall-ran`). Sources: npm v11 changelog ("adds a
   warning… for any packages with install scripts that are not approved…
   preview of behavior in npm v12"), npm v12 changelog ("lifecycle scripts
   will not run during install unless explicitly allowed"), GitHub changelog
   2026-06-09. So the hook still executes today, but (a) the warning reads
   like a partial/broken install, and (b) the trigger dies when npm 12 lands.
   Bin linking is core npm behavior and is unaffected by script policy.
5. **The user's 23:20 install DID run the hook — silently.**
   `~/.agbrowse/state/star-prompt.json` shows `prompted_at:
   2026-07-11T05:47:46Z`, so the prompt short-circuited (already prompted).
   Consistent with the pasted transcript showing no prompt.
6. **release.yml already smoke-verifies the packed artifact** (npm pack ->
   install to a temp prefix -> `node scripts/postinstall.mjs` -> `agbrowse
   --help`), and post-publish does a registry install smoke. The
   broken-bin class is therefore already gated in CI; the local gap was the
   lifecycle-script warning + missing user guidance.
7. **`test/integration/bin-shim-contract.test.mjs` freezes
   `package.json#files`** (P00 invariant, incl. `scripts/postinstall.mjs`).
   Consequence: keep the file shipped; only drop the hook.
8. **Local npm token is invalid** (`npm whoami` -> 401). Irrelevant: the
   release train publishes via GitHub Actions OIDC Trusted Publishing.
9. **Branch state**: `dev` == `origin/dev` (0/0). `origin/dev` is 269 ahead /
   33 behind `origin/main`; main's unique commits are the v0.1.18..v0.1.22
   release lineage. `main` is checked out at the leftover worktree
   `/private/tmp/agbrowse-picker-release.Vq4gR0` (at 5334413 ==
   `release: v0.1.22` == origin/main HEAD).

## Root-cause classification

| Class | Fixable in package? | Fix |
| --- | --- | --- |
| npm >= 11.16 prints an `allow-scripts` warning for our hook; npm 12 will skip the hook entirely | yes | drop the hook, move prompt to first CLI run |
| Hook-based trigger is unreliable across npm versions/configs | yes | same change makes the prompt fire on first CLI run instead |
| Stale shell session not seeing a newly installed global bin | no (user env) | README troubleshooting row |
| Broken/missing bins in a published tarball | already gated | release.yml pack smoke + registry smoke |

## References

- `scripts/postinstall.mjs` (current hook), `scripts/agent-driven.mjs`,
  `scripts/interactive-confirm.mjs`
- `skills/browser/browser.mjs` line ~2364: `maybeEmitUpdateNotice` call site
  (the notice pattern to mirror; `skills/browser/update-check.mjs`)
- `test/unit/star-prompt-confirm.test.mjs` (source-pattern assertions to
  preserve), `test/integration/bin-shim-contract.test.mjs` (frozen files
  manifest)
- `.github/workflows/release.yml` (pack smoke + registry smoke + OIDC publish)
