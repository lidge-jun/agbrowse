# Proposal — Oracle opt-in ZIP browser bundle transport

Status: external upstream proposal draft. This document does not authorize
local agbrowse implementation.

Date: 2026-05-13

Local repo: `/Users/jun/Developer/new/700_projects/agbrowse`

Oracle reference repo: `/tmp/agbrowse-oracle-reference`

Reference point:

- Oracle main: `a1dbb13328dc75ef46a8b869618b4d5a8985c722`
- Oracle package version observed after pull: `0.11.1`
- Relevant current Oracle direction:
  - Browser bundle file support exists as a text prompt bundle.
  - Open PR #193 discusses browser max-file-size caps and skill ZIP guidance.

This proposal is intentionally separate from the local agbrowse guardrail plan
in `devlog/_fin/260513_oracle_followup_guardrails_diff_plan.md`.

## Part 1 — Easy Explanation

Oracle already has a browser bundle mode that turns several local files into
one text bundle for ChatGPT/Claude/Gemini browser submission. That is useful,
but it flattens the project context into text. For larger source reviews, a
real ZIP can preserve paths, folder shape, manifest metadata, and excluded-file
information more naturally.

agbrowse already has a stronger local reference for this idea: context pack
generation under `web-ai/context-pack/`. That design can produce a structured
package instead of only pasting text.

The upstream proposal should not ask Oracle to replace its current text bundle.
It should ask for an opt-in ZIP transport:

```text
--browser-bundle-format text   # default, current behavior
--browser-bundle-format zip    # proposed opt-in
```

or, if Oracle prefers a narrower flag:

```text
--browser-bundle-files zip
```

The key safety rule is that ZIP must be optional. Browser AI attachment
handling changes often, and ChatGPT ZIP parsing should not be treated as a
guaranteed API contract. Text bundle remains the default.

## Part 2 — Proposal-Level Precision

### Current Oracle capability to reference

Oracle has browser bundle file handling around:

```text
src/browser/prompt.ts
```

The current direction packages selected files into a text-oriented browser
prompt bundle. It is a good default because it is transparent and easy for the
model to read.

Open PR #193 is relevant because it touches:

- Browser file size caps.
- Skill ZIP guidance.
- Safer attachment assumptions.

The ZIP proposal should build on that safety direction rather than bypass it.

### agbrowse reference capability

agbrowse has local context package generation around:

```text
web-ai/context-pack/builder.mjs
```

The useful idea to port conceptually is not an exact file copy. It is the
package shape:

```text
CONTEXT_PACKAGE.md
manifest.json
files/<safe relative path>
excluded-files.json
```

Why this shape matters:

- `CONTEXT_PACKAGE.md` gives the model a human-readable entrypoint.
- `manifest.json` gives deterministic metadata: file count, byte count, root,
  filters, generated time, and included paths.
- `files/` preserves relative project layout.
- `excluded-files.json` makes omissions auditable.

### Proposed upstream behavior

Add an opt-in bundle format:

```bash
oracle --browser --browser-bundle-files src/**/*.ts --browser-bundle-format zip
```

Expected behavior:

1. Collect files using Oracle's existing browser bundle file selection rules.
2. Apply existing size limits before creating the ZIP.
3. Write a temporary ZIP package.
4. Attach the ZIP through the same browser attachment path used for other
   files.
5. Include a concise prompt line telling the model to inspect the attached ZIP
   package and start with `CONTEXT_PACKAGE.md`.
6. Clean up the temporary ZIP after the browser submission finishes, unless a
   debug or dry-run mode requests retention.

Default behavior must remain unchanged:

```bash
oracle --browser --browser-bundle-files src/**/*.ts
```

still means the current text bundle.

### CLI option names

Preferred:

```text
--browser-bundle-format <text|zip>
```

Reasons:

- It separates file selection from transport format.
- It leaves room for future formats without overloading one option.
- It keeps text as the clear default.

Alternative:

```text
--browser-bundle-files <paths...>
--browser-bundle-files-mode <text|zip>
```

Less preferred because "files mode" is less direct than "format".

Avoid:

```text
--zip
```

Reason: too broad. Oracle has many possible file and browser operations; a
global-sounding `--zip` flag becomes ambiguous.

### ZIP layout

Recommended archive layout:

```text
oracle-context-package/
  CONTEXT_PACKAGE.md
  manifest.json
  excluded-files.json
  files/
    src/
      example.ts
    README.md
```

`CONTEXT_PACKAGE.md` should include:

```md
# Context Package

Start here. This archive contains source files selected for this browser
consultation.

## Instructions

- Use `manifest.json` for the file list and metadata.
- Read files under `files/` using their relative paths.
- Treat omitted files listed in `excluded-files.json` as intentionally excluded.
```

`manifest.json` should include:

```json
{
  "schemaVersion": 1,
  "generatedBy": "oracle",
  "bundleFormat": "zip",
  "rootLabel": "project",
  "fileCount": 0,
  "totalBytes": 0,
  "files": [
    {
      "path": "src/example.ts",
      "bytes": 1234,
      "sha256": "..."
    }
  ]
}
```

`excluded-files.json` should include:

```json
{
  "schemaVersion": 1,
  "excluded": [
    {
      "path": "node_modules/example.js",
      "reason": "ignored"
    }
  ]
}
```

### Safety guardrails

The upstream proposal should include these as non-negotiable requirements:

1. No absolute paths inside the ZIP.
2. No `..` path traversal entries.
3. No symlink traversal.
4. Existing browser max-file-size checks apply before ZIP creation.
5. Existing total bundle size checks apply before ZIP creation.
6. Binary files are excluded unless Oracle already allows them as direct
   attachments.
7. `.env`, secrets, tokens, private keys, and ignored paths remain excluded by
   existing selection rules.
8. Dry-run output shows:
   - bundle format,
   - file count,
   - total uncompressed size,
   - ZIP path or planned temp path,
   - top-level manifest preview.
9. Temporary ZIP cleanup happens after send.
10. Text bundle remains the default.

### Known limitation to state honestly

Do not claim that ChatGPT, Claude, Gemini, or any browser AI will always parse
ZIP archives reliably.

Correct wording:

```text
ZIP transport is an opt-in convenience for providers and plans that currently
support archive attachments. Text bundle remains the default because it is more
transparent and less dependent on provider attachment behavior.
```

Incorrect wording:

```text
ZIP upload guarantees the model can inspect all files.
```

## Suggested Oracle issue body

```md
# Proposal: opt-in ZIP format for browser bundle files

Oracle's current browser bundle file support is useful because it gives the
browser model one consolidated text context. I think there is a complementary
opt-in mode worth considering: generate a structured ZIP context package and
attach that ZIP instead of flattening everything into a text bundle.

Proposed CLI shape:

```bash
oracle --browser --browser-bundle-files "src/**/*.ts" --browser-bundle-format zip
```

Default behavior would stay as-is:

```bash
oracle --browser --browser-bundle-files "src/**/*.ts"
```

That should continue to produce the current text bundle.

Suggested ZIP layout:

```text
CONTEXT_PACKAGE.md
manifest.json
excluded-files.json
files/<safe relative path>
```

Why this might be useful:

- Preserves relative paths and folder shape.
- Gives the model a stable `CONTEXT_PACKAGE.md` entrypoint.
- Keeps manifest metadata machine-readable.
- Makes excluded files explicit.
- Avoids very large flattened prompt text when the provider supports archive
  attachments.

Safety constraints I would keep:

- ZIP mode is opt-in only; text remains default.
- Apply max-file-size and total-size checks before zipping.
- No absolute paths, `..`, or symlink traversal in archive entries.
- Keep existing ignore/secret exclusions.
- Binary files are not added unless already allowed as direct attachments.
- Dry-run prints file count, uncompressed size, ZIP size/path, and manifest
  preview.
- Do not present ZIP as guaranteed provider behavior; it depends on browser AI
  attachment support.

This could fit well with the current browser max-file-size and skill ZIP
guidance work without changing the default path for users who prefer explicit
text bundles.
```

## Possible Oracle implementation map

This is a proposal map, not a confirmed Oracle code plan. Verify actual file
names before editing upstream.

### MODIFY `src/browser/prompt.ts`

Add support for choosing between text and ZIP bundle prompt behavior.

Expected additions:

- Bundle format enum: `text | zip`.
- Prompt wording for ZIP attachment:

```text
I attached a ZIP context package. Start with CONTEXT_PACKAGE.md, then inspect
manifest.json and files/ as needed.
```

- Preserve current text bundle behavior as default.

### MODIFY `src/cli/browserConfig.ts` or actual browser option parser

Add CLI parsing:

```text
--browser-bundle-format <text|zip>
```

Validation:

- Missing value: fail fast.
- Unknown value: fail fast with accepted values.
- Default: `text`.

### ADD `src/browser/zipBundle.ts`

Possible responsibilities:

- Accept selected bundle files from existing selector.
- Validate safe relative paths.
- Build temp directory.
- Write `CONTEXT_PACKAGE.md`.
- Write `manifest.json`.
- Write `excluded-files.json`.
- Copy included files into `files/`.
- Create ZIP.
- Return `{ zipPath, fileCount, totalBytes, cleanup }`.

Keep this file small. If it grows past the local style limit, split path
sanitization and manifest building into separate modules.

### MODIFY `src/cli/dryRun.ts`

Dry-run should expose the selected transport:

```text
Browser bundle format: zip
Files: 42
Uncompressed bytes: 180234
Estimated ZIP path: /tmp/oracle-context-...
```

Do not create a permanent ZIP in dry-run unless Oracle already treats dry-run
as artifact-producing.

### MODIFY `src/mcp/tools/consult.ts`

If MCP consult can trigger browser bundle files, expose the same bundle format
option there.

Guardrail:

- MCP input schema must reject unknown `browserBundleFormat` values.
- MCP docs must make text the default.

### MODIFY tests

Likely test files:

```text
tests/browser/prompt.test.ts
tests/cli/dryRun.test.ts
tests/mcp/consult.test.ts
```

Test cases:

1. Default bundle format is text.
2. ZIP format changes prompt wording but does not change file selection.
3. ZIP layout contains `CONTEXT_PACKAGE.md`, `manifest.json`,
   `excluded-files.json`, and `files/`.
4. Absolute input paths become safe relative archive entries.
5. `..` traversal is rejected.
6. Symlink escape is rejected.
7. Existing max-file-size failures happen before ZIP creation.
8. Dry-run reports ZIP metadata.
9. MCP consult rejects unknown bundle format.

### MODIFY docs

Likely docs:

```text
README.md
docs/browser-mode.md
skills/oracle/SKILL.md
CHANGELOG.md
```

Doc wording must be conservative:

- "Opt-in ZIP transport."
- "Text remains default."
- "Provider archive handling may vary."
- "Use dry-run to inspect package size and included files."

## Validation if Oracle implementation happens

Run focused tests:

```bash
pnpm exec vitest run tests/browser/prompt.test.ts tests/cli/dryRun.test.ts tests/mcp/consult.test.ts
```

Run project checks:

```bash
pnpm run check
pnpm run build
git diff --check
```

If Oracle uses a different package manager command, inspect `package.json` and
use the repo-defined equivalent. Do not invent commands.

## Recommendation

Submit this first as an Oracle issue or discussion, not a direct PR.

Reason:

- ZIP browser attachment behavior is provider-dependent.
- Oracle maintainers may prefer the current text-first philosophy.
- PR #193 already touches adjacent file-size and ZIP guidance, so maintainers
  should decide whether ZIP bundle transport belongs in core, docs, or a
  separate extension path.

The clean ask:

```text
Would you accept an opt-in `--browser-bundle-format zip` mode that preserves
the current text bundle default and applies the same file-size/ignore/secret
guards before creating a structured ZIP context package?
```
