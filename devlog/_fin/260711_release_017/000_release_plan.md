# agbrowse 0.1.17 release plan

Date: 2026-07-11
Class: C4 release
Build branch: `dev`
Publish branch: `main` through GitHub Actions OIDC
Base: `origin/dev` at `55e0dec`
Target: `agbrowse@0.1.17` with npm dist-tag `latest`

## Loop spec

- Loop archetype: spec-satisfaction release loop.
- Trigger: publish the completed GPT-5.6, ChatGPT Work, search, extract, skills,
  and GitHub Pages work.
- Goal: users can discover the new surfaces from README/changelog, install
  `agbrowse@0.1.17`, and run the documented commands.
- Non-goals: changing cli-jaw; adding new runtime behavior; publishing preview;
  committing local `.codexclaw` session state.
- Verifier: typecheck, full Vitest suite, GPT-5.6 fixture eval, release gates,
  package dry-run, bin smoke, git remote verification, npm registry verification.
- Stop condition: `dev` and fast-forwarded `main` are pushed, the trusted
  publishing workflow succeeds, npm `latest` points to `agbrowse@0.1.17`, and
  a fresh registry install passes bin smoke.
- Memory artifact: this plan plus `010_release_evidence.md`.
- Expected terminal outcomes: DONE; NEEDS_HUMAN when GitHub trusted-publisher
  authorization is the only remaining blocker; UNSAFE on gate failure or
  package-content mismatch.
- Escalation condition: OIDC/trusted-publisher failure, remote divergence,
  unexpected registry ownership, or a failing release gate that changes scope.

## Scope

### In

- Existing local commits `origin/dev..bd8f8f1` (inclusive list begins at
  `6b1fbe6`): GPT-5.6 Chat picker contract,
  ChatGPT Work surface v1, timeout tiers, fixtures, docs, SoT, and evidence.
- Dirty product work: `agbrowse extract`, four bundled skills, modular search
  references, Playwright/browser-QA skill routing, and the GitHub Pages landing
  redesign.
- README and EN/KO changelog release highlights.
- `package.json` and lockfile version `0.1.17`.
- Tests and numbered implementation records that prove the shipped behavior.

### Out

- `/Users/jun/Developer/new/700_projects/cli-jaw/**`.
- Additional dirty `.codexclaw/ledger.jsonl`,
  `.codexclaw/render-observations.jsonl`, session files, and transient goalplan
  state created after `bd8f8f1`. Historical `.codexclaw` evidence already
  committed in `2615c0f`/`bd8f8f1` remains in Git history; rewriting or deleting
  that provenance is outside this release and it is excluded from npm by the
  package allowlist.
- New features, selector changes, provider entitlement claims, or new package
  dependencies.

## File-level build plan

1. Update `README.md` with a 0.1.17 release section that names GPT-5.6 Chat
   family/effort routing, Work Power 1..6, the dedicated Work command/MCP tool,
   search proof, extract, skills, and Pages redesign without changing readiness
   labels.
2. Update `docs/dev/changelog.html` and `docs/dev/ko/changelog.html` with matching
   0.1.17 entries.
3. Add the exact `package.json#files` negation
   `"!devlog/context/redesign-candidates/**"`; keep the design evidence on
   GitHub while preventing the 42 candidate/QA artifacts from entering npm.
4. Bump `package.json` and `package-lock.json` via npm's version command without
   creating a tag.
5. Refresh `structure/str_func.md` counts after all edits.
6. Run an independent Sol audit before build completion; fold every High or
   Critical blocker into this plan or explicitly record a rebuttal.
7. Run all release checks and write exact results to `010_release_evidence.md`.
8. Assemble a clean release branch without the unpushed local `.codexclaw`
   history: add a temporary worktree from `origin/dev`, apply
   `git diff --binary origin/dev..dev -- . ':(exclude).codexclaw'`, then overlay
   exactly the paths from `002_release_paths.txt`. The resulting branch is
   `codex/release-0.1.17`; assert its diff from `origin/dev` has no
   `.codexclaw/` path. This preserves the current local `dev` branch and avoids
   destructive history rewriting.
9. In the clean release worktree, stage only with
   `git add --pathspec-from-file=devlog/_plan/260711_release_017/002_release_paths.txt`.
   The checked manifest enumerates every allowed file or directory pathspec.
   Then capture `git diff --cached --name-only` and assert every row matches an
   allowlisted pathspec, contains no `.codexclaw/` or `test/fixtures/vision-qa/`
   path, and includes every modified/untracked file under the manifest. Review
   the staged diff, commit, and push `dev`.
10. Commit the clean release branch, push it to `origin/dev` as a fast-forward
    from the existing remote tip, then fast-forward local `main` in that same
    worktree to the release commit and run
    `npm run release -- 0.1.17 --publish`. The repository script pushes `main`
    and dispatches `release.yml` with OIDC.
11. Verify origin `dev` and `main`, workflow success, `latest` dist-tag, and a
    fresh registry install/bin smoke. Remove the temporary worktree afterward.

## Acceptance criteria

- README exposes both `--family gpt-5.6-sol --effort medium|high|xhigh` and
  `web-ai work send --power 1..6`, and states that Chat commands reject Work.
- EN and KO changelogs identify version 0.1.17 and the same public surfaces.
- Package and lockfile versions are exactly `0.1.17`.
- Existing readiness labels remain honest: provider UI automation stays beta;
  schema extraction stays experimental where the truth table says so.
- All tests and gates exit 0, including GPT-5.6 fixture evaluation.
- `npm pack --dry-run --json` contains `skills/search/references/`,
  `skills/browser/extract.mjs`, docs, and package bins; it excludes `.codexclaw`
  and every `devlog/context/redesign-candidates/` path. The package intentionally
  includes tracked `devlog/` plus new `devlog/_plan/260705_gapclose/**` and
  `devlog/_plan/260711_release_017/**`; it excludes the untracked redesign
  subtree via the exact negated `files` entry. Save the JSON pack file list in
  `010_release_evidence.md` and fail if any filesystem-only untracked subtree
  outside those two release-plan directories appears.
- The staged diff is generated from an explicit path manifest and excludes
  cli-jaw and every `.codexclaw/` path.
- `git ls-remote origin refs/heads/dev` equals local HEAD after push.
- `origin/main` equals the release SHA after the clean-worktree fast-forward.
- The release workflow exits successfully and creates tag/release `v0.1.17`.
- `npm view agbrowse@0.1.17 version` returns `0.1.17`,
  `npm view agbrowse dist-tags.latest` returns `0.1.17`, and a clean temporary
  prefix installation uses:
  `tmp=$(mktemp -d)`,
  `npm install --prefix "$tmp" agbrowse@0.1.17`,
  `"$tmp/node_modules/.bin/agbrowse" --help`, and
  `"$tmp/node_modules/.bin/agbrowse-vision-click" --help`. Also assert
  `node -p "require('$tmp/node_modules/agbrowse/package.json').version"` is
  `0.1.17`; clean up only that newly-created temporary directory afterward.

## Rollback

- Before npm publish: do not push if any release gate or staged-content audit
  fails; repair and rerun.
- After git push but before npm publish: add a corrective commit; never rewrite
  shared history.
- After npm publish: deprecate the bad version with an actionable message and
  publish a corrected patch. Repair `latest` to the last known-good version when
  necessary and verify the dist-tag. Do not unpublish a public version unless
  npm policy and user approval explicitly require it.
