# Plan: Project Sources Hardening

**Status: draft** | **Priority: P1**

## Problem

`project-sources` exists in `web-ai/cli.mjs` and
`web-ai/chatgpt-project-sources.mjs`, but the surface is effectively hidden and
weakly verified.

Current shallow state:

- `COMMANDS` includes `project-sources`.
- The web-ai help command list omits `project-sources`.
- README and `skills/web-ai` do not document it.
- MCP does not expose a Project Sources tool.
- `BROWSER_REQUIRED_COMMANDS` excludes `project-sources`, so auto-start behavior
  does not match other provider-mutating commands.
- Upload success is inferred after fixed sleeps and `DOM.setFileInputFiles`;
  there is no post-upload source evidence check.

## Oracle Delta

Oracle exposes Project Sources in CLI and MCP. The intent is append-only,
non-destructive management of ChatGPT Project Sources:

- `project-sources list`
- `project-sources add`
- explicit project URL required;
- dry-run support;
- source list/readback checks;
- no delete/update in v1.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/cli.mjs` | MODIFY | Add help entry, browser-required routing, and clearer dry-run behavior. |
| `web-ai/chatgpt-project-sources.mjs` | MODIFY | Add settled readback, upload evidence, and safer navigation. |
| `web-ai/tool-schema.mjs` | MODIFY/DEFER | Decide whether MCP exposes Project Sources now or marks it deferred. |
| `web-ai/mcp-server.mjs` | MODIFY/DEFER | Wire MCP only if schema is approved. |
| `README.md` | MODIFY | Add CLI examples and append-only warning. |
| `skills/web-ai/SKILL.md` | MODIFY | Add agent workflow for list/add/dry-run. |
| `structure/CAPABILITY_TRUTH_TABLE.md` | MODIFY | Add support row or deferred row. |
| `test/unit/web-ai-project-sources.test.mjs` | NEW | URL/file validation and DOM extraction tests. |
| `test/integration/web-ai-cli-contract.test.mjs` | MODIFY | Assert help lists `project-sources`. |
| `test/integration/web-ai-mcp-server.test.mjs` | MODIFY | If MCP exposed, assert tool schema; otherwise assert deferred/absent. |

## Diff Plan

### `web-ai/cli.mjs`

- Add `project-sources` to the web-ai help `Commands:` block.
- Add `project-sources` to `BROWSER_REQUIRED_COMMANDS`.
- Keep subcommand parser local so `--file` stays repeatable only for this
  subcommand.
- Make `--dry-run` local-only when possible: validate URL and files without
  requiring CDP.

### `web-ai/chatgpt-project-sources.mjs`

Refactor into testable units:

```javascript
export function validateProjectSourcesUrl(url)
export function validateProjectSourceFiles(filePaths, { cwd, maxFileSize })
export function buildProjectSourcesListExpression()
export function buildProjectSourcesUploadEvidenceExpression(fileNames)
```

Runtime behavior:

- Navigate to the explicit project URL.
- Wait for the Sources area or Add Source affordance, not just a fixed sleep.
- On `list`, return settled source rows and warnings for empty/unknown DOM.
- On `add`, upload files and wait until the source list or upload surface
  exposes each uploaded file name or a count-based source indicator.
- Return `uploaded: false` with evidence when confirmation is missing.

### MCP decision

Two acceptable outcomes:

1. Expose a narrow `web_ai_project_sources` tool with `list|add`, `projectUrl`,
   `filePaths`, `dryRun`, and policy gates.
2. Keep MCP deferred and add a truth-table row saying Project Sources is
   CLI-only for now.

Do not leave the command hidden.

## Guardrails

- Append-only only. No delete, replace, or clear.
- Require explicit `--chatgpt-url`; never infer from active tab.
- Dry-run must not mutate Chrome.
- Do not reuse a warm conversation tab for project settings.
- Do not return success until upload evidence is observed.
- Do not upload paths that fail realpath, regular-file, or size checks.

## Test Plan

1. Help lists `project-sources`.
2. Dry-run validates files without calling CDP.
3. Missing project URL fails before browser mutation.
4. Invalid ChatGPT URL fails before browser mutation.
5. List expression extracts source rows from fixture DOM.
6. Add upload waits for source evidence before returning `uploaded: true`.
7. Upload evidence timeout returns structured warning/error.
8. MCP behavior is tested as exposed or explicitly deferred.

## Acceptance Criteria

- Users can discover `project-sources` from help, README, and skill docs.
- Dry-run is safe and browser-free.
- Real add/list behavior has DOM evidence tests.
- MCP stance is explicit, not accidental.
