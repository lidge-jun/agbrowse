#  skills/browser/skill-install.mjsP25 

VERDICT-B per-file ts-check on 279-line skill-install module. Pure leaf (only node:util, node:fs, node:path imports).

## Changes
- Add `// @ts-check`
- Typedefs: ParsedInstallHelp, ParsedInstallOptions, InstallBundledSkillsOptions, InstalledSkillEntry, InstallBundledSkillsResult, BundledSkillEntry, RunSkillsCliResult.
- JSDoc on 8 exports.
- `Readonly<Record<string,string>>` for SKILL_DESCRIPTIONS to allow `string` index lookup.
- `/** @type {InstalledSkillEntry[]} */` annotation on `installed = []` to keep literal types.
- Comment-only casts `/** @type {string} */ (options.sourceRoot)` where the runtime forwards the optional but the callee requires string.

## Runtime invariants
- No `Boolean(...)` wrappers added.
- No new `?.` introduced.
- `installed = []` array literal unchanged at runtime.
- Append-only tsconfig.checkjs.json entry: `skills/browser/skill-install.mjs`.
