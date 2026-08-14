# 000 — strict-start-parser: Plan

## Objective

Fix the silent-ignore bug where agbrowse start --profile default passes without
error because the start command parseArgs uses strict: false. Users think they are
connecting to their real Chrome profile but agbrowse always uses its managed
profile at BROWSER_AGENT_HOME/browser-profile.

Evidence: ChatGPT Pro analysis (conversation 6a7f0d58) plus codebase verification
at skills/browser/browser.mjs:2473-2493 confirming strict: false.

## Loop-spec

- Loop archetype: verifier-defined (pass/fail)
- Trigger: agbrowse start --profile default silently ignores --profile
- Goal: Unknown/unsupported flags on start produce a clear error
- Non-goals: Changing strict mode on OTHER commands; implementing connect command
- Verifier: npx vitest run test/integration/cli-lifecycle.test.mjs (exit 0)
- Stop condition: Tests pass, typecheck passes, manual CLI test confirms rejection
- Write scope: skills/browser/browser.mjs, test/integration/cli-lifecycle.test.mjs
- Out-of-scope: Other parseArgs sites (17 total all strict: false), README.md

## Work-phase map

Single PABCD cycle (C2):

| WP | Doc | Slice | Depends on |
|----|-----|-------|------------|
| 1  | 010 | strict parseArgs for start plus tests | none |

## Accept criteria

1. agbrowse start --profile default exits non-zero with error mentioning profile
2. agbrowse start --headde exits non-zero (typo rejection)
3. agbrowse start --headed still works (no regression)
4. Regression tests added to cli-lifecycle.test.mjs
5. npx vitest run test/integration/cli-lifecycle.test.mjs passes
6. Typecheck passes
