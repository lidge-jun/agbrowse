---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, cli-jaw, officecli, mirror]
---

# cli-jaw And OfficeCLI Mirror Plan

## Repositories

Primary mirror target:

```text
/Users/jun/Developer/new/700_projects/cli-jaw
```

Required nested OfficeCLI audit target:

```text
/Users/jun/Developer/new/700_projects/cli-jaw/officecli
```

Current observed state:

- `cli-jaw`: `master...origin/master [ahead 9]`
- `officecli` exists under the cli-jaw checkout and has its own structure docs,
  skills, schemas, tests, and AGENTS rules.

## cli-jaw Mirror Touch Points

MODIFY:

- `src/browser/adaptive-fetch/*.ts`
- `bin/commands/browser.ts`
- `src/routes/browser.ts`
- `tests/unit/browser-adaptive-fetch-*.test.ts`
- `README.md`
- `README.ko.md`
- `README.ja.md`
- `README.zh-CN.md`
- `structure/commands.md`
- `structure/str_func.md`
- `structure/CAPABILITY_TRUTH_TABLE.md`

Do not manually edit generated `dist/` files unless the cli-jaw build process
requires committed build output. Prefer source TypeScript plus the repo's normal
build.

## TypeScript Port Notes

Port from agbrowse JS to cli-jaw TS with type-safe result contracts:

- `contentTruncated?: boolean`
- `contentBytes?: number`
- `contentLimitBytes?: number`
- compact attempt/evidence shapes
- explicit session mode union: `none | isolated | existing | user | interactive`
- no implicit `any`

CLI and route JSON must share the same compaction boundary so:

- `cli-jaw browser fetch <url> --json` is valid JSON;
- `/api/browser/fetch` responses are valid JSON;
- long public endpoint responses do not break downstream agents.

## OfficeCLI Audit And Patch Scope

The mirror is not complete until the nested OfficeCLI checkout is checked. Jun
explicitly called this out.

READ before editing OfficeCLI:

- `/Users/jun/Developer/new/700_projects/cli-jaw/officecli/structure/AGENTS.md`
- `/Users/jun/Developer/new/700_projects/cli-jaw/officecli/SKILL.md`
- relevant `officecli/skills/*/SKILL.md` files

Likely MODIFY candidates:

- `officecli/SKILL.md`
- `officecli/skills/morph-ppt-3d/SKILL.md`
- `officecli/skills/officecli-academic-paper/SKILL.md`
- `officecli/skills/officecli-pitch-deck/SKILL.md`
- `officecli/skills/officecli-docx/SKILL.md`
- `officecli/structure/01-file-function-map.md`
- `officecli/structure/02-command-reference.md`

OfficeCLI patch intent:

- Audit skill guidance that currently tells agents to use raw `curl` or manual
  web retrieval for public assets or citations.
- Keep install commands that intentionally use `curl` for OfficeCLI installation
  unless they are unsafe or misleading.
- For research/source/model discovery guidance, prefer search -> `agbrowse`
  fetch/browser fetch -> cited direct asset download.
- Do not create a dependency from OfficeCLI runtime code to agbrowse. This is a
  skill/documentation guidance patch unless a concrete OfficeCLI runtime bug is
  found.
- Respect OfficeCLI same-package safety: do not run multiple `officecli`
  processes in parallel against the same document package.

## cli-jaw Verification

Expected commands:

```bash
npm run typecheck
npm run test -- --runInBand
npm run gate:all
bash structure/verify-counts.sh
bash structure/verify-counts.sh --fix
```

Use the actual package scripts if they differ. Do not invent passing status.

## OfficeCLI Verification

Only after reading OfficeCLI AGENTS:

```bash
dotnet build officecli.slnx
dotnet test tests/OfficeCli.Tests/OfficeCli.Tests.csproj --no-build
bash ../tests/smoke/test_officecli_integration.sh
```

If OfficeCLI verification is only documentation/skill guidance and no runtime
code changes occur, document the reduced verification set explicitly.

