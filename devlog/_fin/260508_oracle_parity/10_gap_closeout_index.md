# Plan: Oracle Parity Gap Closeout Index

**Status: draft** | **Created: 2026-05-13** | **Reference: oracle origin/main 1828e2b**

## Problem

The first Oracle parity pass left several surfaces in a misleading middle
state: modules and hidden parser flags exist, but public CLI help, skill docs,
MCP schema, lifecycle finalization, failure contracts, and tests do not yet
match the behavior implied by Oracle parity.

This index tracks the follow-up plans that convert those shallow ports into
explicit, testable agbrowse capabilities, or else mark them as intentionally
deferred.

## Investigation Baseline

- Oracle upstream fetched on 2026-05-13: `origin/main` moved to `1828e2b`.
- New upstream deltas after the earlier reference pull:
  - `1828e2b` broadens current ChatGPT attachment-chip detection.
  - `d9439dd` honors configured file-size caps in normal browser runs.
- agbrowse currently has plan/implementation fragments for images, artifacts,
  multi-turn, Deep Research, Project Sources, archive, and upload handling.
- The missing work is mostly around contracts: discoverability, validation,
  session lifecycle, tests, and source-of-truth docs.

## Follow-Up Plan Files

| Order | Plan | Primary outcome |
| --- | --- | --- |
| 11 | [11_generated_images_public_contract](11_generated_images_public_contract.md) | Make generated image output a real public CLI contract or explicitly defer it. |
| 12 | [12_project_sources_hardening](12_project_sources_hardening.md) | Turn hidden Project Sources code into a verified command surface. |
| 13 | [13_multi_turn_lifecycle](13_multi_turn_lifecycle.md) | Close follow-up session lifecycle, finalization, artifacts, and docs. |
| 14 | [14_deep_research_contract](14_deep_research_contract.md) | Decide whether Deep Research is supported or explicitly experimental/deferred. |
| 15 | [15_artifacts_archive_contract](15_artifacts_archive_contract.md) | Enforce artifact-before-archive and expose artifact metadata. |
| 16 | [16_attachment_chip_hardening](16_attachment_chip_hardening.md) | Port current Oracle attachment-chip robustness where appropriate. |
| 17 | [17_upload_size_cap](17_upload_size_cap.md) | Distinguish context budget from normal upload file-size caps. |
| 18 | [18_mcp_advanced_surface](18_mcp_advanced_surface.md) | Align MCP strict validation with the intentionally supported advanced web-ai surface. |

## Recommended Rollout Order

1. `12_project_sources_hardening` because this is the most misleading surface:
   the command exists, but help/docs/tests/MCP and upload verification do not.
2. `15_artifacts_archive_contract` because images, Deep Research, multi-turn,
   and archive all depend on artifact semantics.
3. `11_generated_images_public_contract` because `--output-image` is hidden
   while code exists and can silently fail; generated-image output depends on
   the artifact contract for implicit session saves.
4. `13_multi_turn_lifecycle` because follow-ups currently bypass finalization.
5. `14_deep_research_contract` because it needs artifacts and lifecycle clarity.
6. `16_attachment_chip_hardening` because Oracle upstream changed again in #192.
7. `17_upload_size_cap` because Oracle upstream changed again in #193.
8. `18_mcp_advanced_surface` after CLI semantics are settled, so strict MCP
   schemas expose only deliberate fields.

## Global Acceptance Criteria

- Every public flag or command appears in `agbrowse web-ai --help`, README, and
  the relevant bundled skill.
- Every hidden/experimental flag is explicitly documented as experimental or
  removed from parser reachability.
- Every non-trivial browser feature has at least one unit or integration test
  that exercises the behavior, not just a source-string assertion.
- `structure/CAPABILITY_TRUTH_TABLE.md` reflects the final support level:
  ready, beta, experimental, or deferred.
- MCP strict schemas reject unknown fields while allowing only fields that are
  intentionally supported through MCP.
- Archive never destroys the only recoverable user conversation before required
  local artifacts are saved or deliberately skipped.

## Verification Commands

```bash
npm test -- test/unit/chatgpt-attachments.test.mjs
npm test -- test/unit/web-ai-chatgpt-archive.test.mjs
npm test -- test/integration/web-ai-cli-contract.test.mjs
npm test -- test/integration/web-ai-mcp-server.test.mjs
npm test -- test/unit/web-ai-tool-validation.test.mjs
npm run typecheck
git diff --check
```
