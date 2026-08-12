# 020 — Release train: dev push -> main merge -> preview publish -> latest publish

> DIFFLEVEL-ROADMAP-01: command-level precision below. v4: conflict inventory
> refreshed at wp3-P after the wp2 commits landed on dev (3 new conflict
> files, all theirs/dev). v3 folded A-round-2 fixes.
> User authorization: "dev 푸시후 main preview 머지후 npm 배포까지 완료" —
> dev push, main merge, preview publish, latest publish are all explicitly
> approved for this unit.

## Loop-spec

- Loop archetype: spec-satisfaction repair (CI + npm registry define done)
- Goal: npm `agbrowse@0.1.23` (latest) AND `0.1.23-preview.<ts>` (preview)
  both live, published from merged main via release.yml OIDC, both
  install-verified with grep-asserted clean output
- Stop condition: BOTH release runs green AND BOTH registry smokes pass —
  a green preview alone is never "done"
- Non-goals: force-push, tag deletion, PR ceremony (release.sh pushes main
  directly — established repo path), touching unrelated dirty files
- Bounds: wall-clock ~2h; max two release.yml dispatches per stage; two CI
  failures on new causes -> NEEDS_HUMAN

## Preconditions (verify fresh at B start)

- wp2 done: dev HEAD contains the 010 fix; local gates green.
- `gh auth status` exit 0 (verified at P: logged in as lidge-jun).
- main worktree: the previous picker-release worktree
  (`/private/tmp/agbrowse-picker-release.Vq4gR0`) went stale between audit
  rounds — `git worktree list` marks it prunable (directory lost its .git
  link). At B: run `git worktree list`; if a live `main` worktree exists and
  is clean + at `origin/main`, reuse it. Otherwise `git worktree prune`
  (drops administrative entries for vanished worktrees only) and create a
  fresh one: `git worktree add /private/tmp/agbrowse-rel-$(date +%s) main`,
  then verify `git -C <wt> rev-parse HEAD` ==
  `git ls-remote origin refs/heads/main | cut -f1`. Any live but DIRTY main
  worktree -> STOP -> NEEDS_HUMAN (never clean someone else's checkout).

## Steps (in order)

### 1. Push dev

```
git push origin dev
[ "$(git ls-remote origin refs/heads/dev | cut -f1)" = "$(git rev-parse dev)" ] || exit 1
```

### 2. Merge dev into main (in the main worktree)

```
git -C <main-wt> merge --no-ff origin/dev
```

**Full conflict inventory** (v4 refresh: `git merge-tree --write-tree
--messages origin/main dev` after the wp2 commits — 13 files; package.json
and docs/migration/module-graph.json auto-merge):

| File | Hunks | Class | Resolution |
| --- | ---: | --- | --- |
| README.md | 2 | parallel-divergent (main's top "Current ChatGPT picker contract" block is duplicated by dev's canonical Model-aliases section) | theirs (dev), both hunks |
| scripts/postinstall.mjs | — | dev-superset: main-side changes (Yes/No selector + agent-deferral, b33ae32 lineage) are the exact base dev's wp2 refactor rewrote; verified by `git diff $(merge-base) origin/main` | theirs (dev) |
| test/integration/bin-shim-contract.test.mjs | — | dev-superset: dev contains main's frozen-manifest entries + relative-imports test AND the new no-lifecycle-scripts test | theirs (dev) |
| test/unit/star-prompt-confirm.test.mjs | add/add | equivalent-then-extended: `git diff origin/main dev~5` is EMPTY (byte-identical); dev adds the new describes on top | theirs (dev) |
| test/fixtures/provider-dom/chatgpt-gpt56-chat.html | 1 | dev-superset (whitespace-only conflict) | theirs (dev) |
| test/unit/chatgpt-attachments.test.mjs | 1 | dev-superset | theirs (dev) |
| web-ai/chatgpt-attachments.mjs | 7 | parallel-divergent; main's timeout threading is preserved through dev's `budgets.handoffMs` | theirs (dev), all hunks |
| web-ai/chatgpt-upload-surface.mjs | 11 | parallel-divergent; main behavior is a subset of dev's size-aware/CDP upload path | theirs (dev), all hunks |
| web-ai/chatgpt.mjs | 1 | dev-superset (analyst verified: no main-added nonblank line absent from dev) | theirs (dev) |
| web-ai/cli.mjs | 1 | dev-superset | theirs (dev) |
| web-ai/gemini-live.mjs | 2 | dev-superset | theirs (dev) |
| package-lock.json | 1 | generated | do NOT side-pick: `git checkout --theirs package-lock.json` then `npm install --package-lock-only`, verify `npm ci` exit 0 |
| structure/str_func.md | 5 | generated | regenerate: `npm run fix:counts`, verify `npm run docs:counts` exit 0 |

Execution (order matters — regenerate BEFORE staging; v2 staged too early
and would have omitted the regenerated files from the merge commit):

```
git -C <wt> checkout --theirs README.md test/fixtures/provider-dom/chatgpt-gpt56-chat.html \
  test/unit/chatgpt-attachments.test.mjs web-ai/chatgpt-attachments.mjs \
  web-ai/chatgpt-upload-surface.mjs web-ai/chatgpt.mjs web-ai/cli.mjs web-ai/gemini-live.mjs \
  package-lock.json structure/str_func.md \
  scripts/postinstall.mjs test/integration/bin-shim-contract.test.mjs \
  test/unit/star-prompt-confirm.test.mjs
( cd <wt> && npm install --package-lock-only && npm run fix:counts )
# verify merged package.json: version == 0.1.22 AND no postinstall hook (hard checks)
[ "$(node -p "require('<wt>/package.json').version")" = "0.1.22" ] \
  || { echo "merged version mismatch"; exit 1; }
[ "$(node -p "require('<wt>/package.json').scripts.postinstall")" = "undefined" ] \
  || { echo "postinstall hook survived the merge"; exit 1; }
git -C <wt> add -A
[ -z "$(git -C <wt> ls-files -u)" ] || exit 1                  # no unmerged entries
git -C <wt> diff --cached --check || exit 1
git -C <wt> commit -m "merge: dev into main for v0.1.23 (install-UX fix)"
[ -z "$(git -C <wt> status --porcelain)" ] || exit 1           # clean tree post-commit
```

**Any conflicted file not in the table above -> STOP, do not resolve,
report.** No blanket side-picking beyond the table.

### 3. Local preflight on merged main (before any push/dispatch)

All commands run INSIDE the worktree (`npx --prefix` does not chdir — vitest
would otherwise test the dev checkout; verified at audit):

```
( cd <wt> && npm ci && npm run typecheck && npm test && \
  npm run test:release-gates && npm run gate:all )
# focused conflict-resolution proofs (from the analyst inventory):
( cd <wt> && npx vitest run test/unit/web-ai-chatgpt-model.test.mjs \
    test/unit/chatgpt-attachments.test.mjs test/unit/chatgpt-upload-surface.test.mjs \
    test/unit/web-ai-gemini-contract.test.mjs test/integration/web-ai-cli-contract.test.mjs )
```

All exit 0. Do not push a merge that fails preflight.

### 4. Preview publish (canary, dist-tag `preview`)

```
cd <wt> && npm run release:preview -- --publish
```

Computes `0.1.23-preview.<ts>`, bumps, pushes main, dispatches release.yml
(tag=preview, dry-run=false), watches. Must conclude success INCLUDING the
post-publish registry smoke.

Executable verification:

```
PV=$(npm view agbrowse@preview version)   # expect 0.1.23-preview.<ts>
P=$(mktemp -d)
OUT=$(npm install -g "agbrowse@$PV" --prefix "$P" 2>&1); RC=$?
[ $RC -eq 0 ] || { echo "preview install failed"; exit 1; }
printf '%s' "$OUT" | grep -qiE 'allow-scripts|install-scripts|install scripts not yet covered' \
  && { echo "FAIL: script warning present"; printf '%s\n' "$OUT"; exit 1; }
AGBROWSE_UPDATE_CHECK=0 "$P/bin/agbrowse" --help >/dev/null || exit 1
echo "preview-ok $PV"
```

### 5. Latest publish

```
cd <wt> && npm run release -- --publish
```

`npm version patch` on `0.1.23-preview.<ts>` -> `0.1.23` (verified at audit:
npm strips the prerelease on patch). Pushes main; dispatches release.yml
(tag=latest). Must conclude success including registry smoke.

Executable verification:

```
[ "$(npm view agbrowse version)" = "0.1.23" ] || exit 1
npm view agbrowse dist-tags --json   # latest=0.1.23, preview=0.1.23-preview.<ts>
L=$(mktemp -d)
OUT=$(npm install -g agbrowse@0.1.23 --prefix "$L" 2>&1); RC=$?
[ $RC -eq 0 ] || { echo "latest install failed"; exit 1; }
printf '%s' "$OUT" | grep -qiE 'allow-scripts|install-scripts|install scripts not yet covered' \
  && { echo "FAIL: script warning present"; printf '%s\n' "$OUT"; exit 1; }
AGBROWSE_UPDATE_CHECK=0 "$L/bin/agbrowse" --help >/dev/null || exit 1
gh release view v0.1.23 --json tagName,isLatest
echo "latest-ok 0.1.23"
```

### 6. Back-merge main into dev, push dev

```
git merge origin/main        # in the dev checkout; release bumps land on dev
npm test                     # sanity
git push origin dev
[ "$(git ls-remote origin refs/heads/dev | cut -f1)" = "$(git rev-parse dev)" ] || exit 1
```

## Accept criteria (goalplan C3/C4)

- c1: ls-remote SHA equality after every push (dev, main).
- c2: BOTH release.yml runs green via `gh run watch --exit-status`.
- c3: dist-tags show latest=0.1.23 + the preview version.
- c4: BOTH clean-prefix installs grep-clean and `--help` exit 0.
- c5: GitHub releases v0.1.23-preview.<ts> (prerelease) and v0.1.23 (latest)
  exist.

## Failure handling

- release.sh refuses (dirty/branch/tag-exists): fix cause, re-run; never
  bypass with manual `npm publish`.
- Preview CI red: read failing step; fix on dev; re-merge; re-run preview.
  Two reds on new causes -> NEEDS_HUMAN.
- Registry smoke red after publish: workflow retries 30x internally; if still
  red, report — do NOT unpublish without user approval.
