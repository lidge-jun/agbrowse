# agbrowse Docs Pages and Code-Mode Overhaul Plan

Created: 2026-06-11

## Goal

Deliver and deploy the agbrowse documentation and code-mode reliability overhaul:

- Fix every audited P0-P3 issue around `web-ai code`, `code-extract`, source-of-truth docs, release gates, README, and Pages docs.
- Build a full cli-jaw-style GitHub Pages developer documentation V1 with matching Korean pages.
- Verify locally, commit in logical units, push `main`, and confirm the live GitHub Pages deployment at `https://lidge-jun.github.io/agbrowse/`.

## Confirmed Requirements

- Documentation size: full cli-jaw-style developer documentation.
- Korean mode: V1 full parallel Korean documentation, not only a small landing-page translation.
- Completion target: actual deployment, not local-only docs.
- Existing uncommitted version bump from `0.1.8` to `0.1.9` is inspected and may be included with this release work.
- Current GitHub Pages configuration is workflow-backed and public.

## Scope

### Runtime and CLI Reliability

1. Restore `npm run test:release-gates` by refreshing `structure/str_func.md` counts after source changes.
2. Fix `web-ai code` / `web-ai code-extract` ChatGPT-only validation before vendor-specific routing and before avoidable provider/browser mutation.
3. Return structured CLI errors for:
   - non-ChatGPT `code` / `code-extract`
   - missing `--prompt` for `code`
   - incompatible `--multi-zip --output-zip`
   - `code-extract` navigation failures
4. Make code artifact scanning deterministic:
   - sort conversation messages by turn/create time instead of object insertion order
   - ignore code-command text as a source of artifact paths
   - still collect valid tool/output message ids for download URL minting
   - preserve multi-zip retrieval ordering by conversation recency
5. Extend focused tests for the above error and artifact-selection behavior.

#### Runtime Implementation Contract

The CLI preflight hook must be explicit, not implied by `code-mode.mjs` runtime guards:

- Add `validateCodeModeCliInput(command, input)` in `web-ai/cli.mjs`.
- Call it from `runWebAiCliInner` after `buildCliInput(command, values)` and before `enforceCliPolicy`, `ensureHeadedBrowserForWebAi`, `ensureProviderTab`, and vendor-specific dispatch.
- Throw `WebAiError` with these canonical codes:
  - `code-mode.vendor-unsupported` for `code` and `code-extract` when `--vendor` is not `chatgpt`.
  - `code-mode.prompt-missing` for `web-ai code` without a non-empty `--prompt`.
  - `code-mode.output-conflict` for `--multi-zip --output-zip`.
- Keep the lower-level `code-mode.mjs` ChatGPT guards as defensive module-boundary checks, but the CLI smoke contract must fail before browser/provider mutation.
- Include these codes in the human help failure catalog so JSON users can reason about retry behavior.

`code-extract` navigation must be wrapped at the call site:

- Catch `page.goto()` failures inside `extractCodeArtifacts`.
- Return a structured result with `errorCode: code-extract.navigation-failed`, `stage: code-extract`, the attempted URL, and the original error message.
- Do not let Playwright navigation errors bubble to `internal.unhandled`.

The artifact scan contract must be fixture-backed:

- Sort candidate messages by `message.create_time`, then `message.update_time`, then original mapping index as a deterministic tie-breaker.
- Treat assistant text, tool, and execution-output messages as valid artifact path sources.
- Ignore user-authored messages and `content_type: "code"` text as artifact path sources so prompts or shell snippets containing stale `/mnt/data/*.zip` strings cannot win.
- Still collect code/execution-output message ids as download candidates because ChatGPT may mint download URLs from those tool messages.
- For multi-zip retrieval, return distinct zip paths in deterministic conversation order after sorting.

Focused tests must include explicit `it(...)` coverage for:

- non-ChatGPT `code` and `code-extract` preflight with `AGBROWSE_WEB_AI_AUTO_START=0`;
- missing `--prompt`;
- `--multi-zip --output-zip`;
- `code-extract.navigation-failed`;
- stale user/code-command zip path ignored while the latest assistant artifact path wins.

### Source-of-Truth Documentation

1. Add missing `code-extract` coverage to `structure/commands.md`.
2. Add missing `claim-audit` coverage to `structure/commands.md`; it is already a public web-ai command and must not be hidden from the command SOT.
3. Expand `structure/check-doc-drift.sh` so these exact web-ai command tokens cannot silently drift again:
   - `code`
   - `code-extract`
   - `project-sources list/add`
   - `claim-audit`
4. Add or clarify `web-ai code-extract` in `structure/CAPABILITY_TRUTH_TABLE.md` as either a dedicated beta row or an explicit code-mode sub-capability with test evidence.
5. Update `structure/INDEX.md`, `structure/phase_status.md`, `structure/release_gates.md`, and `docs/production-readiness.md` where Pages-live, docs/dev, code-mode, or claim-audit surface claims change.
6. Refresh `structure/str_func.md` counts only after implementation settles, including the aggregate `docs/` row after the new docs/dev tree lands.

### README and Skill Docs

1. Update README Pages status from "ready, not live" to the verified live Pages URL.
2. Improve README top-level navigation for:
   - beginner quickstart
   - Web-AI workflow
   - code-mode generation and later extraction
   - Korean developer docs
3. Add `code-extract` and default save-path details to `skills/web-ai/SKILL.md` where command lists and operator guidance currently understate the surface.
4. Update root `agbrowse --help` Web AI summary in `skills/browser/browser.mjs` so first-level help exposes current high-value web-ai commands.
5. Update `package.json` `homepage` to the live Pages URL unless package metadata policy requires README-only homepage.

### GitHub Pages Developer Docs V1

Create a docs/dev tree modeled after cli-jaw's developer-docs shape, bounded to deployable V1:

- `/docs/dev/index.html`
- `/docs/dev/quickstart.html`
- `/docs/dev/quickstart-first-run.html`
- `/docs/dev/changelog.html`
- `/docs/dev/concepts/architecture.html`
- `/docs/dev/concepts/browser-runtime.html`
- `/docs/dev/concepts/web-ai-sessions.html`
- `/docs/dev/guides/web-ai.html`
- `/docs/dev/guides/code-mode.html`
- `/docs/dev/guides/adaptive-fetch.html`
- `/docs/dev/guides/source-audit.html`
- `/docs/dev/reference/cli.html`
- `/docs/dev/reference/config.html`
- `/docs/dev/reference/release-gates.html`
- matching `/docs/dev/ko/...` pages for Korean V1 parity
- shared `/docs/dev/_shell.css`
- shared `/docs/dev/_search.js`

The V1 style should be developer-tool dense, accessible, and static-site simple: no build pipeline, no runtime dependencies, no marketing-only hero as the primary experience.

#### Path and Link Contract

GitHub Pages uploads the repository `docs/` directory as the site root:

- repo `docs/index.html` deploys to `/agbrowse/`
- repo `docs/dev/index.html` deploys to `/agbrowse/dev/`
- repo `docs/dev/guides/code-mode.html` deploys to `/agbrowse/dev/guides/code-mode.html`
- repo `docs/dev/ko/index.html` deploys to `/agbrowse/dev/ko/`

Use relative links only. Each page depth must use the correct asset prefix:

- `docs/dev/*.html`: `_shell.css`, `_search.js`
- `docs/dev/guides/*.html`, `docs/dev/concepts/*.html`, `docs/dev/reference/*.html`: `../_shell.css`, `../_search.js`
- `docs/dev/ko/*.html`: `../_shell.css`, `../_search.js`
- `docs/dev/ko/guides/*.html`, `docs/dev/ko/concepts/*.html`, `docs/dev/ko/reference/*.html`: `../../_shell.css`, `../../_search.js`

Never use repository-relative `/docs/dev/...` links or root-relative `/agbrowse/...` links inside page bodies unless the Pages workflow validation explicitly supports that case.

#### Search Contract

V1 search must be static and dependency-free:

- define a small in-file search index in `_search.js`
- include title, language, section, path, and keywords for every EN/KO V1 page
- render a search input in the docs shell with keyboard focus styles
- filter by current language first while still allowing cross-language results through page titles
- show an empty state
- keep navigation usable with JavaScript disabled

#### Korean Parity Contract

Korean V1 parity means:

- every English V1 page has a Korean page at the matching `/ko/` path
- Korean pages use `html lang="ko"`
- English pages use `html lang="en"`
- each pair has a visible language switcher to its counterpart
- Korean pages use Korean nav, search labels, and page titles
- code examples remain command-accurate; prose is Korean, not machine-copied cli-jaw text
- Korean pages cover the same IA and core operator decisions, though prose may be more concise than English

#### Layout and Accessibility Contract

V1 docs shell must include:

- semantic landmarks: header, nav, main, footer
- skip link
- visible focus states
- desktop two-column docs layout with sidebar navigation and main content
- mobile single-column layout with top navigation that wraps cleanly at 360px width
- current-page state in nav
- horizontally scrollable code blocks
- readable tables on narrow screens
- no text overlap or clipped Hangul at 360px, 768px, 1024px, and desktop widths

#### Copy-Paste Guard

Use cli-jaw docs as structure inspiration only. Reuse shell/search mechanics only when they are generic. Do not copy cli-jaw page bodies, commands, product claims, employee/PABCD prose, old provider URLs, or branding.

Before delivery, grep for stale integration strings and resolve any unexpected hits:

- `cli-jaw`
- `jaw browser`
- `chat.openai.com`
- `telegram`
- `employees`
- `PABCD`
- repository paths that include `/docs/dev/` as deployed URLs

### Landing and Deployment

1. Revise `/docs/index.html` so the first-screen quickstart shows `agbrowse web-ai code --prompt ... --output-zip ...` before `code-extract`.
2. Link landing navigation to English and Korean developer docs.
3. Extend `.github/workflows/pages.yml` validation to require:
   - the 14 English V1 HTML pages
   - the 14 Korean V1 HTML pages
   - `_shell.css`
   - `_search.js`
   - local href/src targets for static files
   - valid `lang` attributes
   - EN/KO page pair links
   - landing quickstart with `web-ai code` appearing before `code-extract`
4. Verify locally with static file checks and browser screenshots for desktop/mobile where practical.
5. Push `main` and confirm Pages workflow success.

## Non-Goals

- Do not add a docs framework or bundler.
- Do not redesign provider automation outside audited code-mode and artifact retrieval issues.
- Do not claim provider UI stability beyond beta unless tests and docs explicitly support it.
- Do not publish to npm unless the user separately asks for npm publish; this goal covers GitHub push and Pages deployment.

## PABCD Execution

### P - Plan

- Save this plan in the separate devlog folder.
- Record current repo, Pages, and git state as goal evidence.

### A - Architecture and Audit

- Dispatch parallel read-only audits:
  - Docs: docs/dev IA, README, source-of-truth drift coverage.
  - Backend: CLI validation/error taxonomy and code artifact retrieval.
  - Frontend: static docs UI/UX, Korean parity, mobile/accessibility.
- Merge findings into the implementation order before editing.

### B - Build

1. Runtime patch and focused tests.
2. Source-of-truth docs and drift gate patch.
3. GitHub Pages docs/dev tree and Korean parity.
4. Landing page, README, help, skill docs.
5. Release count refresh.

Runtime validation must live in `runWebAiCliInner` after argument parsing and before `enforceCliPolicy`, `ensureHeadedBrowserForWebAi`, and `ensureProviderTab`, so fail-fast CLI errors remain browser-mutation-free where the command can be rejected from flags alone.

Build order dependency: `structure/commands.md` must gain missing public command rows before `structure/check-doc-drift.sh` starts enforcing those command tokens, and help/skill surfaces must land in the same source-of-truth slice as the runtime preflight changes.

Commit after each logical green slice where possible.

### C - Check

Minimum verification:

- `npm run typecheck`
- focused unit tests:
  - `test/unit/web-ai-code-artifact.test.mjs`
  - `test/unit/web-ai-code-mode.test.mjs`
- focused integration tests:
  - `test/integration/web-ai-cli-contract.test.mjs`
- `npm run test:release-gates`
- `node bin/agbrowse.mjs web-ai code --help`
- `node bin/agbrowse.mjs web-ai code-extract --help`
- non-ChatGPT vendor JSON-error smoke for `code` and `code-extract`
- missing prompt JSON-error smoke
- multi-zip/output-zip conflict JSON-error smoke
- Pages validation workflow equivalent checks
- static docs stale-string grep for cli-jaw copy-paste risks

### D - Deliver and Deploy

- Run final diff review.
- Commit remaining verified docs/build changes.
- Push `main`.
- Watch GitHub Pages workflow until it succeeds or fails with actionable evidence.
- Confirm the live Pages URL responds and contains the new developer docs and Korean entrypoint.

## Risks

- Live provider smoke tests can hang or mutate browser state. Prefer structured preflight smoke commands that fail before provider mutation.
- Full Korean parity can become too large if every reference is over-expanded. Keep V1 pages concise and navigable, with deeper pages as future backlog.
- Existing ahead commits and version bump must be preserved; do not rewrite history.

## Post-Delivery Evidence

Delivered commits:

- `0583e89 docs: plan docs pages overhaul`
- `e39a71a fix(web-ai): preflight code mode errors`
- `16e835a docs: add developer pages site`
- `e7329c8 docs: polish korean code mode guide`

Runtime anchors shipped:

- `web-ai/cli.mjs` calls `validateCodeModeCliInput(command, input)` before browser/provider setup.
- `web-ai/code-mode.mjs` wraps `page.goto()` failures as `code-extract.navigation-failed`.
- `web-ai/code-artifact.mjs` uses deterministic ordered conversation messages and ignores user/code-command text for zip path extraction.
- `test/integration/web-ai-cli-contract.test.mjs`, `test/unit/web-ai-code-mode.test.mjs`, and `test/unit/web-ai-code-artifact.test.mjs` cover the new contracts.

Final local verification passed:

- `npm run typecheck`
- focused Vitest: 3 files, 51 tests
- `npm run test:release-gates`: 144 drift checks and 60 count checks
- static Pages validation: 29 HTML files
- Playwright render validation
- JSON smoke for `code-mode.vendor-unsupported`, `code-mode.prompt-missing`, and `code-mode.output-conflict`

Deployment evidence:

- Pushed `main` to `e7329c8`.
- GitHub Pages run `27326155929` completed successfully.
- Live checks returned HTTP 200 for:
  - `https://lidge-jun.github.io/agbrowse/`
  - `https://lidge-jun.github.io/agbrowse/dev/index.html`
  - `https://lidge-jun.github.io/agbrowse/dev/ko/index.html`
