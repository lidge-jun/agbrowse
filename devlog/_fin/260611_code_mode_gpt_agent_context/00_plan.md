---
created: 2026-06-11
status: planning
tags: [web-ai, code-mode, chatgpt, cli-jaw-mirror, context-package]
---

# Code Mode GPT Dev-Agent Context + cli-jaw Independent Mirror

## Part 1 — Easy Explanation

ChatGPT code mode should no longer rely on an unavailable visible todo tool. Instead, every code-mode run will send a small saved ZIP context first, telling ChatGPT how to behave like one serial Linux-sandbox developer agent, then require the generated project zip to include `PLAN.md` or `00_plan.md`. `turn_plan.update_turn_plan` becomes optional: use it if available, but never pretend it exists. The same runtime surface will be implemented in cli-jaw instead of only documenting agbrowse commands. Both repos will document and test the contract.

## Confirmed Requirements

- Automatic first attachment: a saved ZIP built from dev-skill and AGENTS-derived guidance, tuned for the GPT/ChatGPT sandbox instead of raw file dumping.
- Plan artifact: generated project zips pass if they contain either `PLAN.md` or `00_plan.md`.
- Todo behavior: ask ChatGPT to use `turn_plan.update_turn_plan` when available, but live web-ai testing on 2026-06-11 returned `NO_TURN_PLAN_TOOL`, so it must not be a hard requirement.
- Environment: prompt assumes ChatGPT code tools run in a Linux sandbox under `/mnt/data`.
- Output shape remains hybrid:
  - `DOWNLOAD: [name.zip](sandbox:/mnt/data/name.zip)`
  - `MACHINE: /mnt/data/name.zip`
- cli-jaw scope: independent runtime mirror, not only docs/help and not a thin agbrowse wrapper.
- Git policy: local commits are allowed; no push in this goal unless the user explicitly asks in the same turn.

## Current Signals Read

- agbrowse:
  - `web-ai/code-mode-prompt.mjs`
  - `web-ai/code-mode.mjs`
  - `web-ai/code-artifact.mjs`
  - `web-ai/context-pack/*`
  - `web-ai/cli.mjs`
  - `test/unit/web-ai-code-mode-prompt.test.mjs`
  - `test/unit/web-ai-code-mode.test.mjs`
  - `README.md`
  - `skills/web-ai/SKILL.md`
  - `structure/INDEX.md`
  - `structure/str_func.md`
- cli-jaw:
  - `/Users/jun/Developer/new/700_projects/cli-jaw/AGENTS.md`
  - `/Users/jun/Developer/new/700_projects/cli-jaw/structure/INDEX.md`
  - `/Users/jun/Developer/new/700_projects/cli-jaw/bin/commands/browser-web-ai.ts`
  - `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/context-pack/*`
  - `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/chatgpt.ts`
  - `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-*.test.ts`
  - `/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref/web-ai/SKILL.md`

## Compact Tree

```text
agbrowse/
├── web-ai/
│   ├── code-mode.mjs
│   ├── code-mode-prompt.mjs
│   ├── code-artifact.mjs
│   └── code-dev-context.mjs              NEW
├── skills/web-ai/
│   ├── SKILL.md
│   └── modules/
│       ├── gpt-dev-agent-context.md      NEW
│       └── gpt-dev-agent-context.zip     NEW generated/saved bundle
├── test/unit/
│   ├── web-ai-code-mode-prompt.test.mjs
│   ├── web-ai-code-mode.test.mjs
│   └── web-ai-code-dev-context.test.mjs  NEW
└── devlog/_fin/260611_code_mode_gpt_agent_context/
    └── 00_plan.md

cli-jaw/
├── bin/commands/browser-web-ai.ts
├── src/routes/browser.ts
├── src/browser/web-ai/
│   ├── code-mode.ts                      NEW
│   ├── code-mode-prompt.ts               NEW
│   ├── code-artifact.ts                  NEW
│   ├── code-dev-context.ts               NEW
│   ├── code-dev-context-template.ts       NEW packaged fallback content
│   └── context-pack/*
├── skills_ref/web-ai/
│   ├── SKILL.md
│   └── modules/
│       ├── gpt-dev-agent-context.md      NEW
│       └── gpt-dev-agent-context.zip     NEW generated/saved bundle
└── tests/unit/
    ├── browser-web-ai-code-mode.test.ts           NEW
    ├── browser-web-ai-code-mode-prompt.test.ts    NEW
    ├── browser-web-ai-code-artifact.test.ts       NEW if needed
    ├── browser-web-ai-code-dev-context.test.ts    NEW
    ├── browser-web-ai-code-route.test.ts          NEW
    └── browser-web-ai-multi-upload.test.ts        NEW or MODIFY existing attachment test
```

## Part 2 — Diff-Level Plan

### A. agbrowse Runtime

#### NEW `web-ai/code-dev-context.mjs`

Responsibilities:
- Resolve `skills/web-ai/modules/gpt-dev-agent-context.md`.
- Build or ensure a saved `skills/web-ai/modules/gpt-dev-agent-context.zip`.
- Validate the zip contains:
  - `GPT_DEV_AGENT_CONTEXT.md`
  - `MANIFEST.json`
- Return an attachment descriptor compatible with existing `input.filePaths`.
- Keep this module pure Node/ESM and independent of browser/CDP.

Planned exports:

```js
export const GPT_DEV_AGENT_CONTEXT_BASENAME = 'gpt-dev-agent-context.zip';
export function resolveCodeDevContextPaths(options = {}) {}
export async function ensureCodeDevContextZip(options = {}) {}
export async function readCodeDevContextManifest(zipPath) {}
```

Path resolution rule:
- Resolve checked-in skill module assets relative to this module/package location, not `process.cwd()`.
- In agbrowse ESM, derive the package root from `import.meta.url` by walking from `web-ai/code-dev-context.mjs` to the repository/package root, then append `skills/web-ai/modules/`.
- Accept an explicit `packageRoot` override for tests.
- Tests must call the resolver from a temporary non-repo cwd to prove global/package usage does not depend on caller cwd.

#### MODIFY `web-ai/code-mode-prompt.mjs`

Before:
- Exports `PLAN_TOOL_REQUIREMENT`.
- Exports `TODO_TOOL_REQUIREMENT` as a hard requirement.
- Requires exactly one visible todo item in progress.
- Does not require `PLAN.md`/`00_plan.md` inside generated artifacts.

After:
- Replace hard todo with a soft planning/todo contract:
  - use plan tool if available;
  - use `turn_plan.update_turn_plan` only if available;
  - if unavailable, do not pretend;
  - always write `/mnt/data/workdir/PLAN.md` or `/mnt/data/workdir/00_plan.md`.
- Require the plan markdown to include:
  - Linux sandbox assumptions;
  - 5-10 step checklist;
  - implementation plan;
  - verification commands;
  - packaging rules.
- Single zip contract must verify that the zip contains `PLAN.md` or `00_plan.md`.
- Multi zip contract must require each named zip to include `PLAN.md` or `00_plan.md`, unless a zip is a non-code companion artifact. Default code artifacts must include it.
- Keep the final `DOWNLOAD:`/`MACHINE:` two-line shape.

#### MODIFY `web-ai/code-mode.mjs`

Before:
- Builds `contractPrompt`.
- Calls `queryWebAi(..., { ...input, prompt: contractPrompt, inlineOnly: true })`.

After:
- Call `ensureCodeDevContextZip`.
- Prepend the saved context zip path to `filePaths`.
- Send code mode with upload policy instead of forced `inlineOnly`.
- Preserve caller-provided files after the auto context zip.
- Preserve strict vendor guard for ChatGPT.
- Add result metadata:
  - `codeContextZip`
  - `codeContextAttached: true`
  - warnings if context zip was regenerated.

#### MODIFY `web-ai/code-artifact.mjs`

Before:
- Validates EOCD/zip integrity and writes local zip.

After:
- Add zip entry inspection for `PLAN.md` or `00_plan.md`.
- Single zip retrieval should fail or warn with `code-mode:plan-artifact-missing` depending on strictness.
- For first implementation, fail closed for `web-ai code`, but allow `code-extract` to report warning when re-extracting old conversations created before this contract.

#### MODIFY `web-ai/cli.mjs`

Before:
- Help describes code mode but not automatic context zip.
- `code` accepts `--output-zip`, `--multi-zip`, `--output-dir`.

After:
- Help documents automatic first attachment.
- Add optional introspection flags only if needed:
  - `--no-code-context` is not planned for MVP because user asked automatic always-on.
  - `--code-context-zip <path>` may be deferred unless tests show need.
- Ensure `code` command output includes context zip metadata in JSON.

### B. agbrowse Skill Module

#### NEW `skills/web-ai/modules/gpt-dev-agent-context.md`

Create the new directory `skills/web-ai/modules/`.

Complete content intent:
- Title: `GPT Dev-Agent Context for ChatGPT Code Mode`.
- Sections:
  - Operating model: one serial developer agent, no parallel invisible agents.
  - Environment: Linux sandbox, `/mnt/data/workdir`, `/mnt/data/*.zip`.
  - Planning: create `PLAN.md` or `00_plan.md`; include 5-10 checklist items.
  - Todo tool: use `turn_plan.update_turn_plan` only if available; never fabricate tool usage.
  - Implementation discipline: source first, verify, package, no build/cache artifacts.
  - Testing discipline: run local commands available in sandbox; record skipped commands with reason.
  - Artifact rules: include plan file, README, manifests, no `node_modules`, no `.git`, no caches.
  - Final answer contract: `DOWNLOAD:` and `MACHINE:`.

#### NEW `skills/web-ai/modules/gpt-dev-agent-context.zip`

Generated/saved artifact containing:
- `GPT_DEV_AGENT_CONTEXT.md`
- `MANIFEST.json`

The zip is checked in only if repository policy allows small generated reference bundles in skill modules. If this is rejected by audit, replace with deterministic on-demand generation plus a committed manifest text file. Current user requirement explicitly asks to store the zip.

#### MODIFY `skills/web-ai/SKILL.md`

Before:
- Says code mode uses plan tool and `turn_plan.update_turn_plan`.

After:
- Documents automatic context zip.
- Documents `PLAN.md`/`00_plan.md` compliance.
- Documents live finding that ChatGPT web may not expose `turn_plan`; agents must not treat missing tool as failure if plan markdown exists.

### C. agbrowse Tests

#### NEW `test/unit/web-ai-code-dev-context.test.mjs`

Assertions:
- `ensureCodeDevContextZip` creates a valid zip.
- Manifest and markdown entries are present.
- Bundle text mentions Linux sandbox, `PLAN.md`, `00_plan.md`, `turn_plan.update_turn_plan`, and artifact exclusions.
- Resolver works when the current process cwd is a temporary directory outside the repo.
- `npm pack --dry-run --json` includes `skills/web-ai/modules/gpt-dev-agent-context.md` and `skills/web-ai/modules/gpt-dev-agent-context.zip`.

#### MODIFY `test/unit/web-ai-code-mode-prompt.test.mjs`

Before:
- Asserts prompt contains hard `TODO_TOOL_REQUIREMENT`.

After:
- Asserts prompt contains soft turn_plan language.
- Asserts prompt requires `PLAN.md` or `00_plan.md`.
- Asserts prompt forbids pretending a missing tool exists.

#### MODIFY `test/unit/web-ai-code-mode.test.mjs`

Add:
- code mode prepends context zip to `filePaths`.
- caller-provided file paths remain after context zip.
- code mode no longer forces `inlineOnly: true` when context zip is attached.
- retrieved artifact without plan file fails for new `code` runs.

#### MODIFY `test/unit/web-ai-code-artifact.test.mjs`

Add:
- zip with `PLAN.md` passes.
- zip with `00_plan.md` passes.
- zip with neither fails/warns depending on code vs extract mode.

### D. agbrowse Docs / Structure

#### MODIFY `README.md`

Update ChatGPT Code Mode section:
- automatic `gpt-dev-agent-context.zip`;
- plan file requirement;
- soft turn_plan behavior;
- local verification commands.

#### MODIFY `structure/commands.md`

Document `web-ai code` automatic context attachment and JSON fields.

#### MODIFY `structure/str_func.md`

Update line/file counts after adding modules.

#### MODIFY `structure/CAPABILITY_TRUTH_TABLE.md`

Clarify code-mode beta includes automatic GPT dev-agent context and plan artifact validation.

#### MODIFY `devlog/00_index.md`

Link this plan and summarize the new code-mode contract.

### E. cli-jaw Independent Runtime Mirror

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/code-mode-prompt.ts`

TypeScript port of agbrowse code prompt contract. Use strict-compatible exported functions and types.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/code-dev-context.ts`

TypeScript port of the saved context zip resolver/builder. It must support three resolution tiers:

1. Installed runtime skill module:
   - `$JAW_HOME/skills/web-ai/modules/gpt-dev-agent-context.md`
   - `$JAW_HOME/skills/web-ai/modules/gpt-dev-agent-context.zip`
2. Source checkout canonical skill module:
   - `skills_ref/web-ai/modules/gpt-dev-agent-context.md`
   - `skills_ref/web-ai/modules/gpt-dev-agent-context.zip`
3. Packaged fallback:
   - generated deterministically from `src/browser/web-ai/code-dev-context-template.ts`, which compiles into `dist/` and is therefore included in the npm package.

Path resolution rule:
- Resolve from the compiled/source module location or an explicit package root, not caller cwd.
- For source tests, support an explicit `packageRoot` override.
- For runtime, prefer installed `$JAW_HOME/skills/...` when present, then source `skills_ref/...`, then packaged fallback.
- Because cli-jaw npm `files` does not include `skills_ref/`, packaged runtime correctness must not depend on `skills_ref/`.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/code-dev-context-template.ts`

Packaged fallback content module:
- Exports the same GPT dev-agent context markdown as a string constant.
- Exports manifest metadata.
- Used only when no installed or source saved skill ZIP is available.
- Lets packaged cli-jaw generate the automatic first attachment deterministically without shipping `skills_ref/`.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/code-artifact.ts`

TypeScript port of ChatGPT artifact retrieval if no compatible module exists. Keep isolated from CLI parsing. Use existing browser/web-ai request abstractions where possible.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/code-mode.ts`

Orchestrates:
- prompt build;
- automatic context zip first upload;
- ChatGPT query/send/poll path;
- conversation id resolution;
- artifact retrieval;
- plan file validation.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/types.ts`

Before:
- `QuestionEnvelopeInput` and related command input shapes carry singular `filePath`.

After:
- Add optional `filePaths?: string[]` while preserving `filePath?: string` for backward compatibility.
- `filePaths` takes precedence when present.
- Keep JSON-compatible route payloads.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/question.ts`

Before:
- Envelope normalization is singular-file aware.

After:
- Preserve normalized `filePaths` in the envelope/input result without rendering file contents into the prompt.
- Keep existing source-audit and context-package semantics unchanged.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/chatgpt.ts`

Before:
- Upload path is singular.
- It rejects context package plus `--file`.

After:
- Normalize `filePaths` from `input.filePaths` or legacy `input.filePath`.
- Upload every path in order.
- Preserve the context-package plus explicit `--file` rejection for normal `send/query`.
- Allow code mode to provide the automatic context zip plus caller files through `filePaths` because that is not the legacy context-package transport.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/bin/commands/browser-web-ai.ts`

Before:
- `WEB_AI_COMMANDS` lacks `code` and `code-extract`.
- Help says code mode is standalone agbrowse.

After:
- Add `code` and `code-extract`.
- Add parse options:
  - `--output-zip`
  - `--output-dir`
  - `--multi-zip`
  - `--conversation`
- Route through the existing CLI-to-server browser API by posting to `/web-ai/code` and `/web-ai/code-extract`; do not bypass the HTTP browser API unless a later audit proves the command is intentionally local-only.
- Update help text to remove “standalone agbrowse only” claim.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/src/routes/browser.ts`

Before:
- The browser route exposes existing web-ai commands but no `code` or `code-extract` endpoint.

After:
- Add POST handlers for `/api/browser/web-ai/code` and `/api/browser/web-ai/code-extract` matching the CLI path convention.
- The route resolves the active provider page/session using the same dependency factory used by `send/query/poll`.
- The route calls new `codeWebAi` / `extractCodeArtifacts` functions.
- The route response remains JSON and preserves existing error envelope behavior.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref/web-ai/modules/gpt-dev-agent-context.md`

Create the new directory `/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref/web-ai/modules/`.

Same semantic content as agbrowse, adjusted for cli-jaw wording.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref/web-ai/modules/gpt-dev-agent-context.zip`

Saved bundle for cli-jaw.

Packaging note:
- This saved skill ZIP is canonical for source checkout and installed skills.
- It is not sufficient for npm package runtime because cli-jaw currently excludes `skills_ref/` from `package.json files`.
- Packaged runtime must use the compiled fallback template if installed skill assets are unavailable.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref/web-ai/SKILL.md`

Document independent code mode, automatic context zip, and plan artifact contract.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/README.md`

Only if command/help surface documentation currently mentions browser web-ai surfaces; otherwise skip.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/structure/commands.md`

Add code/code-extract command documentation.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/structure/CAPABILITY_TRUTH_TABLE.md`

Move code-mode mirror from agbrowse-only to cli-jaw beta if implementation and tests pass.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/structure/str_func.md`

Update line counts using `bash structure/verify-counts.sh --fix` or manual minimal edit if the script supports it.

### F. cli-jaw Tests

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-mode-prompt.test.ts`

Mirror prompt assertions from agbrowse.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-dev-context.test.ts`

Zip bundle validation:
- saved markdown and zip entries exist;
- manifest is readable;
- resolver works when the current process cwd is a temporary directory outside the repo;
- source checkout resolves `skills_ref/web-ai/modules/...`;
- installed-skill override resolves `$JAW_HOME/skills/web-ai/modules/...` when provided by a temp fake JAW_HOME;
- packaged fallback works when neither installed skill nor `skills_ref` exists;
- package dry-run verifies compiled fallback code is present in `dist/` / packed artifact rather than assuming `skills_ref/` ships.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-mode.test.ts`

Orchestrator test with fake query service:
- auto context zip first in `filePaths`;
- caller files preserved after it;
- ChatGPT-only guard;
- output path/multi-zip handling.

#### NEW `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-route.test.ts`

Assert:
- `/api/browser/web-ai/code` route is registered and calls the code-mode service.
- `/api/browser/web-ai/code-extract` route is registered and calls extraction service.
- Errors use the existing browser web-ai error envelope.

#### NEW or MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-multi-upload.test.ts`

Assert:
- `filePaths[]` takes precedence over legacy `filePath`.
- upload order is preserved.
- normal context package plus explicit `--file` remains rejected.
- code-mode-provided automatic context zip plus caller files is accepted.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-cli-contract.test.ts`

Assert help/command parser includes `code`, `code-extract`, output zip flags, and no longer labels code mode agbrowse-only.

#### MODIFY `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/web-ai-skill-policy.test.ts`

Assert skill mentions automatic context zip and `PLAN.md`/`00_plan.md`.

## Risk Controls

- Do not push in this goal unless explicitly asked in the same turn.
- Avoid raw dev-skill dump in the zip; compress to a stable guide because current dev SKILL sources are about 223KB and AGENTS about 49KB before compression.
- Keep generated zip small and deterministic.
- Keep code-mode ChatGPT-only.
- Do not delete existing exports.
- Preserve existing context package behavior for normal `send/query`.
- `code-extract` should remain able to retrieve old conversations that lack plan files, but should warn about legacy artifacts.

## Verification Plan

### agbrowse

```bash
npm test -- --run \
  test/unit/web-ai-code-mode-prompt.test.mjs \
  test/unit/web-ai-code-mode.test.mjs \
  test/unit/web-ai-code-artifact.test.mjs \
  test/unit/web-ai-code-dev-context.test.mjs
npm run typecheck
npm run test:release-gates
npm pack --dry-run --json
git diff --check
```

Live smoke after unit gates:

```bash
node skills/browser/browser.mjs web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Create a tiny Node.js CLI that prints hello and include a README." \
  --output-zip /tmp/agbrowse-code-context-smoke/result.zip \
  --json
unzip -l /tmp/agbrowse-code-context-smoke/result.zip
```

Expected live smoke evidence:
- local zip exists and passes `unzip -t`;
- zip contains `PLAN.md` or `00_plan.md`;
- zip contains no forbidden cache/build dependency directories;
- JSON reports `codeContextAttached: true`.

### cli-jaw

```bash
npm --prefix /Users/jun/Developer/new/700_projects/cli-jaw test -- \
  /Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-mode-prompt.test.ts \
  /Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-mode.test.ts \
  /Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-dev-context.test.ts \
  /Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-code-route.test.ts \
  /Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-multi-upload.test.ts \
  /Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-cli-contract.test.ts \
  /Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/web-ai-skill-policy.test.ts
npm --prefix /Users/jun/Developer/new/700_projects/cli-jaw run typecheck
npm --prefix /Users/jun/Developer/new/700_projects/cli-jaw run build
npm --prefix /Users/jun/Developer/new/700_projects/cli-jaw pack --dry-run --json
bash /Users/jun/Developer/new/700_projects/cli-jaw/structure/verify-counts.sh
git -C /Users/jun/Developer/new/700_projects/cli-jaw diff --check
```

cli-jaw `npm pack --dry-run --json` pass condition:
- run only after `npm run build`, because cli-jaw packages compiled `dist/` rather than raw `src/`;
- do not require `skills_ref/web-ai/modules/...` in the packed artifact unless `package.json files` is explicitly changed to include it;
- do require the compiled packaged fallback module under `dist/browser/web-ai/` so code mode can still generate the automatic context ZIP after install.

Optional cli-jaw live smoke only after unit/typecheck pass:

```bash
cli-jaw browser web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Create a tiny Python hello script and README." \
  --output-zip /tmp/cli-jaw-code-context-smoke/result.zip \
  --json
unzip -l /tmp/cli-jaw-code-context-smoke/result.zip
```

## Commit Plan

1. agbrowse runtime + tests.
2. agbrowse docs/skill/structure counts.
3. cli-jaw runtime + tests.
4. cli-jaw docs/skills_ref/structure counts.
5. cli-jaw-skills submodule commit if `skills_ref` changes are backed by the submodule working tree.

No push unless explicitly requested after local verification.
