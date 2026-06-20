# 260611 Web-AI Skill + cli-jaw Mirror Plan

## Objective

Reset the active jaw project root to agbrowse, then bring the recent web-ai work back into the agent-facing surfaces without making false parity claims:

- Document the implemented agbrowse surfaces: ChatGPT code mode, multi-zip retrieval, repeatable mixed `--file` uploads, and the simplified ChatGPT Intelligence model picker.
- Mirror only the bounded simplified ChatGPT model-picker runtime fix into cli-jaw, because cli-jaw still contains live web-ai model-selection code.
- Keep ChatGPT code-mode and multi-attachment runtime ownership in agbrowse for now; do not claim cli-jaw command parity for surfaces that are not implemented there.

## Evidence

- Active jaw project root was reset to `/Users/jun/Developer/new/700_projects/agbrowse`.
- Recent agbrowse commits already implemented the runtime work:
  - `fix(web-ai): support simplified ChatGPT model picker`
  - `feat(web-ai): multi + mixed-type prompt attachments`
  - `feat(web-ai): code mode --multi-zip`
  - `feat(web-ai): code command`
- `/Users/jun/Developer/new/700_projects/agbrowse/skills/web-ai/SKILL.md` predates those changes and does not describe the new command surface.
- `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/chatgpt-model.ts` exists and is still imported by cli-jaw web-ai modules, but lacks agbrowse's simplified Intelligence menu support.
- `/Users/jun/Developer/new/700_projects/cli-jaw/devlog/_fin/browser_web_ai_migrated_to_agbrowse/README.md` establishes that agbrowse owns web-ai evolution and cli-jaw mirrors stabilized pieces.

## Scope

### agbrowse

Patch:

- `/Users/jun/Developer/new/700_projects/agbrowse/skills/web-ai/SKILL.md`
- `/Users/jun/Developer/new/700_projects/agbrowse/devlog/00_index.md`
- `/Users/jun/Developer/new/700_projects/agbrowse/structure/CAPABILITY_TRUTH_TABLE.md`

Expected content changes:

- Add `agbrowse web-ai code` to the web-ai skill command list.
- Document single-zip and `--multi-zip --output-dir` code-mode usage as ChatGPT-only beta automation.
- Document repeatable mixed `--file <path>` uploads for explicit user-provided files, while preserving the existing warning that project source context should use context packaging instead.
- Document the simplified ChatGPT Intelligence mapping:
  - `instant` / `thinking --effort light` -> `Instant`
  - `thinking --effort standard` -> `Medium`
  - `thinking --effort extended` -> `High`
  - `thinking --effort heavy` -> `Extra High`
  - `pro --effort standard` -> `Pro Standard`
  - `pro --effort extended` -> `Pro Extended`
- Update stale devlog index wording that still says code-mode implementation has not started.
- Update capability truth table wording so code-mode is clearly agbrowse beta, with no cli-jaw parity claim.

### cli-jaw

Patch:

- `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/chatgpt-model.ts`
- `/Users/jun/Developer/new/700_projects/cli-jaw/tests/unit/browser-web-ai-composer.test.ts`
- `/Users/jun/Developer/new/700_projects/cli-jaw/bin/commands/browser-web-ai.ts`
- `/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref/web-ai/SKILL.md`

Expected content changes:

- Hand-translate the agbrowse simplified Intelligence menu logic into TypeScript.
- Do not copy JSDoc casts directly; use `ChatGptModelChoice` and `ChatGptEffortChoice`.
- Preserve existing public exports and call signatures.
- Add focused unit coverage for the simplified Intelligence menu selecting `Medium`, `High`, `Extra High`, and `Pro Extended`.
- Port the fake-page test fixture support needed for the simplified menu; the current cli-jaw `createFakeModelPage` does not yet expose agbrowse's `simplifiedIntelligenceMenu` / simplified row behavior.
- Update help/skill text to explain the current ChatGPT Intelligence mapping.
- Mention that code mode, multi-zip retrieval, and repeatable mixed file uploads are agbrowse-owned surfaces for now, not cli-jaw browser command parity.

### cli-jaw-skills

`/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref` is a submodule that points at `/Users/jun/Developer/new/700_projects/cli-jaw-skills`. Patching `/Users/jun/Developer/new/700_projects/cli-jaw/skills_ref/web-ai/SKILL.md` therefore also changes the cli-jaw-skills working tree. Do not create a new surface there without a real installed-skill source.

## Out of Scope

- No `git push`.
- No cli-jaw implementation of `web-ai code`, `--multi-zip`, `--output-dir`, or `filePaths[]`.
- No production/ready claim for code mode beyond the existing agbrowse beta status.
- No destructive git cleanup of unrelated dirty files.

## Verification

Run focused gates:

- agbrowse:
  - `npm --prefix /Users/jun/Developer/new/700_projects/agbrowse test -- --run test/unit/web-ai-chatgpt-model.test.mjs`
  - `npm --prefix /Users/jun/Developer/new/700_projects/agbrowse run typecheck`
  - applicable docs drift/count gates if exposed by package scripts.
- cli-jaw:
  - `npm --prefix /Users/jun/Developer/new/700_projects/cli-jaw test -- tests/unit/browser-web-ai-composer.test.ts tests/unit/browser-web-ai-cli-contract.test.ts tests/unit/web-ai-skill-policy.test.ts`
  - `npm --prefix /Users/jun/Developer/new/700_projects/cli-jaw run typecheck`
- Docs:
  - `bash /Users/jun/Developer/new/700_projects/agbrowse/structure/check-doc-drift.sh`
  - `npm --prefix /Users/jun/Developer/new/700_projects/cli-jaw run gate:truth-table-fresh` if the cli-jaw truth table surface is touched.

Commit locally in small atomic units per repository. Do not push.
