# WP3 — Push, integration, npm release, and deployment proof

Depends on: WP2 DONE, clean scoped diff, current `origin/dev` re-fetched.

## P stale check at WP3 entry

- Fresh fetch: `origin/dev=6cb58681771e273221a3b65089a3cf3a433890bf`, unchanged from discovery; local `dev=7b1f1cce185999cc8b50c5a4dfadc06be8c3e38b` is a four-commit fast-forward.
- `origin/main=fd125841b46441cf59adf74ff61cdd68827220d7`; main/dev remain diverged, so the bounded cherry-pick worktree path remains mandatory.
- All 17 release gates, 2,202 tests, release doc/count gates, and pack dry-run passed at `7b1f1cc`.
- The final independent verdict is `PASS-for-push / PARTIAL-live`; `NEEDS_HUMAN_LOGIN` is not a code gate failure but remains open and must appear in release proof.
- At this P revision, this `030` plan carries the audit amendments and must be committed before P→A. After that commit, the only tracked dirty paths must be the pre-existing `.codexclaw` state.

## Branch/integration facts to re-check

- `dev` is the development integration branch, but `scripts/release.sh` requires a clean `main` checkout.
- At discovery, `origin/dev=6cb5868` and `origin/main=fd12584`; npm latest is `0.1.19` while the dev checkout says `0.1.17`.
- Never bump/publish from stale dev. Fetch and compare merge-base/range before integration.

## Commit stack

Push the full dev fast-forward stack, including process commits `8970ca2`, `1c11ef6`, `771eee3`, and this final plan amendment; verify the exact count with `git rev-list --count origin/dev..HEAD` immediately before push. The bounded main release integration contains the runtime/test commit pair plus a scoped docs replacement:

1. `ea3eb34171714285efa9887ab2b81e85dcaeda93` — RED fixture/tests.
2. `a2171c32a3b79ee072cfb75ccfc95e32aa13d56e` — selector/schema/help implementation.
3. `7b1f1cce185999cc8b50c5a4dfadc06be8c3e38b` — source for a scoped docs/eval/count replacement; exclude its `devlog/_plan/260808_chatgpt_power_picker/{010,020,021}*` paths because their creation commit remains dev-only.

`8970ca2` and this WP3 plan commit remain dev-only process evidence. The release script creates the final version/count commit on `main`.

Candidate prerequisite closure, frozen before the dry run:

1. `4786d544f0eff06e198e4e7015f860b54b1c7c06` — base GPT-5.6 Chat/Work picker contract.
2. `f8e8b9b6751d2b19b3840455d2fbdad641448256` — Chat family/tier selector.
3. `4dad538dd62a83b1fb656d8040cf0a2b243bdbf2` — Work/unresolved surface guard.
4. `edce15e0be045f23a476d9712a08dce793c5e6c1` — canonical locale projections used by the selector.
5. `76e4793b1aba51f6966b9569ca8d25cafd010fae` — family-aware probe/MCP contract.

`661e625` was removed from the closure after the dry run: it changes Work normalization wiring but not `chatgpt-model.mjs`, and its `chatgpt.mjs` conflict proved it is adjacent rather than required by this picker repair.

The prerequisite path set is a coverage aid, not a closure algorithm; `web-ai/cli.mjs` and docs are shared surfaces and therefore return unrelated commits. The frozen SHA list above is authoritative and the dry-run cherry-pick is the executable dependency proof. Coverage paths include:

```text
web-ai/chatgpt-model.mjs
web-ai/product-surfaces.mjs
web-ai/chatgpt.mjs
web-ai/cli.mjs
web-ai/tool-schema.mjs
test/unit/web-ai-chatgpt-model.test.mjs
test/unit/web-ai-product-surfaces.test.mjs
test/unit/web-ai-tool-schema.test.mjs
test/integration/web-ai-mcp-server.test.mjs
test/fixtures/provider-dom/chatgpt-gpt56-chat.html
test/fixtures/provider-dom/chatgpt-gpt56-work.html
```

## Remote workflow

1. Inspect each commit with `git show --stat --oneline` and verify no unrelated dirty path is included.
2. Fetch; rebase/merge only after comparing current remote tips. Push `dev` and verify remote SHA.
3. No workflow is reachable from a plain `dev` push: `contract-drift` is PR/schedule-only, Pages is main-only, and `release.yml` dispatches main. Therefore verify `origin/dev` equals the locally gated exact SHA, retain the terminal 2,202-test/17-gate evidence for that SHA, and use the integrated-main release workflow as the remote CI proof. Do not claim a nonexistent dev-push CI run.
4. Create a fresh release worktree from current `origin/main`; never merge all of `dev` by default. Use the path log only to inspect surrounding history, then prove the frozen closure by applying the nine entries below in order on a throwaway detached branch.
5. Cherry-pick only `4786d54` normally. The full `f8e8b9b` dry run conflicts in the older broad CLI integration test, so apply the next two source prerequisites as source/test scoped replacements and regenerate counts after the stack:

```bash
git diff f8e8b9b^ f8e8b9b -- \
  web-ai/chatgpt-model.mjs web-ai/chatgpt.mjs web-ai/cli.mjs \
  test/unit/web-ai-chatgpt-model.test.mjs | git apply --index -3
git commit -C f8e8b9b6751d2b19b3840455d2fbdad641448256

git diff 4dad538^ 4dad538 -- \
  web-ai/chatgpt-model.mjs web-ai/product-surfaces.mjs \
  test/unit/web-ai-work-conversation-probe.test.mjs | git apply --index -3
git commit -C 4dad538dd62a83b1fb656d8040cf0a2b243bdbf2

git diff edce15e^ edce15e -- \
  web-ai/chatgpt-model.mjs test/unit/web-ai-chatgpt-locale.test.mjs | \
  git apply --index -3
git commit -C edce15e0be045f23a476d9712a08dce793c5e6c1
```

No generated `structure/str_func.md`, old CLI integration test, or unrelated docs are imported by those replacements; current docs arrive in the scoped `7b1f1cc` replacement and `npm run fix:counts` regenerates counts. If any scoped patch conflicts, stop and inspect rather than broadening it.

Apply `76e4793` as a scoped replacement:

```bash
git cherry-pick --no-commit 76e4793b1aba51f6966b9569ca8d25cafd010fae
git restore --staged --worktree --source=HEAD -- \
  .codexclaw/goalplans/agbrowse-dev-pr-89-87-88-devlog-pabcd-wp1-docs-o/goalplan.json \
  .codexclaw/goalplans/agbrowse-dev-pr-89-87-88-devlog-pabcd-wp1-docs-o/ledger.jsonl
git commit -C 76e4793b1aba51f6966b9569ca8d25cafd010fae
test -z "$(git diff-tree --no-commit-id --name-only -r HEAD | grep '^.codexclaw/' || true)"
```

Then cherry-pick `ea3eb34` and `a2171c3`. Apply `7b1f1cc` as a scoped replacement that never introduces the dev-only plan unit:

```bash
git diff 7b1f1cc^ 7b1f1cc -- \
  README.md docs/dev/guides/web-ai.html docs/dev/ko/guides/web-ai.html \
  docs/dev/reference/cli.html docs/dev/ko/reference/cli.html \
  skills/web-ai/SKILL.md structure/commands.md structure/str_func.md \
  test/fixtures/provider-dom/chatgpt-gpt56-eval.json | git apply --index -3
git commit -C 7b1f1cce185999cc8b50c5a4dfadc06be8c3e38b
test -z "$(git diff-tree --no-commit-id --name-only -r HEAD | grep '^devlog/' || true)"
```

Do not resolve a scoped-patch conflict by hand; stop and narrow or drop the candidate. Explicitly leave `chatgpt-attachments.mjs`, `chatgpt-upload-surface.mjs`, their attachment test, and `gemini-live.mjs` out of the release integration. Never merge the whole branch.
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
