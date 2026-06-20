# Plan: MCP Advanced Surface Contract

**Status: draft** | **Priority: P2** | **Depends: 11, 12, 13, 14, 17**

## Problem

Recent strict MCP validation is good, but it also makes hidden or partially
ported browser options impossible to call through MCP. That is acceptable only
if the unsupported fields are intentionally deferred and documented.

Current MCP schema supports:

- `provider` / `vendor`
- `model`
- `effort` / `reasoningEffort`
- `prompt`
- `system`
- `context`
- `filePath`
- `url`
- `inlineOnly`
- `timeout`
- `policy`

It does not support:

- `outputImage`
- `research` / `browserResearchMode`
- `followUps`
- `archive`
- `project_sources`
- upload cap fields
- context package fields
- browser bundle format fields

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/tool-schema.mjs` | MODIFY | Add only deliberately supported fields or explicit deferred metadata. |
| `web-ai/mcp-server.mjs` | MODIFY | Route approved fields into provider calls with policy checks. |
| `web-ai/browser-tool-schema.mjs` | MODIFY if needed | Keep browser tool freeze separate from web-ai tools. |
| `structure/commands.md` | MODIFY | Document compatibility aliases and advanced-field stance. |
| `structure/CAPABILITY_TRUTH_TABLE.md` | MODIFY | Add MCP support/deferred rows for advanced surfaces. |
| `test/unit/web-ai-tool-validation.test.mjs` | MODIFY | Assert accepted and rejected fields. |
| `test/unit/web-ai-tool-schema.test.mjs` | MODIFY | Assert schema shape. |
| `test/integration/web-ai-mcp-server.test.mjs` | MODIFY | Assert runtime routing or explicit rejection. |

## Diff Plan

### Classify fields before adding schema

| Field | Proposed stance | Reason |
| --- | --- | --- |
| `outputImage` | Defer or CLI-only until image public contract closes | Writes local files; needs policy. |
| `research` / `browserResearchMode` | Defer until Deep Research contract closes | Long-running browser mutation. |
| `followUps` | Defer until lifecycle closeout | Multi-turn finalization must be correct first. |
| `archive` | Defer until artifact-before-archive contract closes | Provider-side destructive-ish mutation. |
| `project_sources` | Separate tool or defer | Different workflow from prompt submission. |
| upload cap fields | Add after upload cap plan | Pure validation, lower risk. |
| context package fields | Consider CLI-only or add narrow MCP fields | Large file access and upload policy. |

### If a field is supported

- Add schema field.
- Add policy enforcement.
- Pass it to `sendByProvider` or specialized handler.
- Add tests for:
  - valid input accepted;
  - typo rejected;
  - policy blocks unsafe mutation;
  - field is preserved through runtime call.

### If a field is deferred

- Keep strict rejection.
- Document in `structure/commands.md`.
- Add tests that the rejection is intentional and stable.
- Update the relevant MCP tool `description` text so agents see the limitation
  before making a tool call. The description must explicitly list important
  CLI-only/deferred features such as image output, Deep Research, follow-ups,
  archive mutation, Project Sources, or upload caps when those features are not
  accepted by the MCP schema.
- Prefer wording like:

```text
Note: generated image output, Deep Research, multi-turn follow-ups, archive,
and Project Sources are CLI-only/deferred in MCP for this release.
```

This prevents strict validation from becoming an agent UX trap where a model
learns about a CLI feature from README/help and then repeatedly attempts an MCP
field that the schema rejects.

## Guardrails

- Do not weaken strict validation by adding `additionalProperties: true`.
- Do not add MCP fields that bypass CLI policy checks.
- Do not expose file-writing features without policy coverage.
- Do not expose archive/project-source mutation without explicit user policy.
- Do not let MCP claim broader support than CLI/help/skill docs.
- Do not rely on schema rejection alone for known CLI-only features; tool
  descriptions must say what is unavailable in MCP.

## Test Plan

1. Unknown field typo is rejected.
2. Documented compatibility aliases still pass.
3. Each supported advanced field has a routing test.
4. Each deferred advanced field has an intentional rejection test or truth-table row.
5. MCP tool descriptions mention high-value CLI-only/deferred features.
6. MCP tools/list schema matches source-of-truth docs.
7. Policy enforcement receives upload/file/write/archive intent where relevant.

## Acceptance Criteria

- MCP strict validation and feature parity no longer conflict.
- Supported fields are actually routed.
- Deferred fields are documented and tested as deferred.
- MCP docs match CLI support level.
