# WP3 — Push, integration, npm release, and deployment proof

Depends on: WP2 DONE, clean scoped diff, current `origin/dev` re-fetched.

## Branch/integration facts to re-check

- `dev` is the development integration branch, but `scripts/release.sh` requires a clean `main` checkout.
- At discovery, `origin/dev=6cb5868` and `origin/main=fd12584`; npm latest is `0.1.19` while the dev checkout says `0.1.17`.
- Never bump/publish from stale dev. Fetch and compare merge-base/range before integration.

## Commit stack

1. `test(web-ai): capture the Chat Power picker contract` — fixture + RED-capable tests only.
2. `fix(web-ai): support the Chat Power picker shell` — selector + family enums/help wiring.
3. `docs(web-ai): document the current Chat picker contract` — skills/README/structure/static docs/devlog closeout.
4. Release commit produced by `scripts/release.sh` on `main` only.

## Remote workflow

1. Inspect each commit with `git show --stat --oneline` and verify no unrelated dirty path is included.
2. Fetch; rebase/merge only after comparing current remote tips. Push `dev` and verify remote SHA.
3. Confirm dev CI on exact SHA. If a job fails, inspect logs and repair latest HEAD; never blind rerun.
4. Create a fresh release worktree from current `origin/main`; never merge all of `dev` by default. Compute the picker prerequisite closure with `git log --reverse origin/main..origin/dev -- <picker paths>` and prove each prerequisite is required by applying the new scoped commits in a throwaway dry-run branch.
5. Cherry-pick only the audited picker prerequisite closure plus this unit's three scoped commits. Resolve only picker-owned `web-ai/cli.mjs` or generated `structure/str_func.md` conflicts. Explicitly leave `chatgpt-attachments.mjs`, `chatgpt-upload-surface.mjs`, their attachment test, and `gemini-live.mjs` out of the release integration; if a scoped commit cannot be separated from those conflicts, stop as UNSAFE and re-plan instead of merging the whole branch.
6. Rerun `git merge-tree` or an equivalent no-commit cherry-pick dry run and the full release gates on the resulting main tree.
7. Let `npm run release -- patch --publish` create the version/count commit, push main, dispatch `release.yml`, and watch it. Do not manually publish from the laptop.

## Release proof

- Exact `origin/main` SHA and GitHub Actions run URL/id.
- New version, package tarball identity, npm `latest` dist-tag, GitHub release tag/SHA.
- Clean temporary install with `npm install -g agbrowse@<version>` in an isolated prefix; verify binary path/version and a non-mutating status/help command.
- Smoke the released selector against ChatGPT when the agbrowse profile remains authenticated.
- Rollback: npm dist-tag can return to 0.1.19 and the new GitHub release can be marked superseded; package versions are immutable.

## Blockers

- Human login/CAPTCHA, Trusted Publishing/environment approval, non-fast-forward author changes that overlap this scope, or a registry outage after bounded retries.
