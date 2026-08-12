# agbrowse 0.1.17 release evidence

Date: 2026-07-11
Release branch: `codex/release-0.1.17`
Base: `origin/dev` at `55e0dec`

## Scope proof

- The release tree was reconstructed from `origin/dev` with the committed
  product diff applied using `:(exclude).codexclaw`, then overlaid from
  `002_release_paths.txt`.
- `git diff --name-only origin/dev` contains zero `.codexclaw/` paths.
- The final staging manifest contains 176 explicit leaf paths and exactly
  matches `git diff --cached --name-only`; unstaged release diff is empty.
- The original dirty `dev` worktree and its local orchestration evidence were
  not rewritten or deleted.
- `cli-jaw` was not modified.

## Verification

| Check | Result |
| --- | --- |
| Fresh install | `npm ci` completed; 160 packages installed |
| Typecheck | `npm run typecheck` exit 0 |
| Full suite | 161 files passed, 2 skipped; 1,434 tests passed, 12 skipped; 0 failures |
| GPT-5.6 fixture eval | 2/2 fixtures passed; known fixture pass rate 1.0 |
| Named release gates | 16/16 passed |
| Structure drift/counts | 164 drift checks + 76 count checks passed after final count sync |
| npm audit | exit 0 at `--audit-level=high`; one low-severity esbuild advisory remains |
| Bin smoke | `agbrowse --help` and `agbrowse-vision-click --help` passed |
| Diff whitespace | `git diff --check` exit 0 |
| Package dry-run | pre-evidence snapshot: version 0.1.17; 713 files; 1,825,268 bytes packed; 5,825,118 bytes unpacked |

## Package-content proof

The pre-evidence `npm pack --dry-run --json` artifact reported:

- `.codexclaw/`: 0 files
- `devlog/context/redesign-candidates/`: 0 files
- `skills/search/references/`: 4 files
- `skills/browser/extract.mjs`: present
- package version: `0.1.17`

The package size fell from the pre-fix 4,303,241 bytes to 1,825,268 bytes after
adding `!devlog/context/redesign-candidates/**` to the package allowlist.

## Repair history

1. A-gate round 1 found seven release-plan blockers: branch/OIDC mismatch,
   ambiguous range, package leakage, staging ambiguity, auth-boundary mismatch,
   historical orchestration state, and weak post-publish proof. All were folded
   back; round 3 returned PASS.
2. The first local full-suite run produced 1,428 passes and three failures.
   Two were environment-only Playwright headless-shell misses; rerunning against
   the installed Google Chrome executable passed 5/5 browser tests. The third
   was a stale frozen `package.json#files` expectation; the contract test was
   updated and passed.
3. Fresh C review rejected the unpushed local `.codexclaw` history. The release
   tree was reconstructed from `origin/dev` without that diff; zero
   `.codexclaw` paths remain in the release delta.
4. `gate:no-cloud-claims` found one inherited README phrase, "Camoufox stealth
   lane". It was corrected to an alternate browser-rendering description;
   the rerun passed all 16 named gates.

## Remaining risk

- ChatGPT, Gemini, Grok, and Work automation depend on live provider DOM/account
  state and remain beta.
- The npm audit reports one low-severity Windows-only esbuild dev-server
  advisory. The high-severity release threshold passes; no dependency version
  was changed inside this release.
- npm publication still depends on GitHub Actions trusted publishing/OIDC.
  Post-publish evidence must include workflow success, `latest=0.1.17`, and a
  fresh registry install using prefix-local binaries.
