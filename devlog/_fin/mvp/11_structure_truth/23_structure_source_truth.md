# Phase 22 — Structure source of truth

This is a focused repo-health slice requested after Phase 21 release gates:
mirror the `cli-jaw/structure` habit inside `agbrowse`, but keep it sized for
the standalone runtime.

## Changes

- Added `structure/` as an architecture source-of-truth folder.
- Added `structure/INDEX.md`, `str_func.md`, `commands.md`,
  `runtime_contracts.md`, and `release_gates.md`.
- Added `structure/check-doc-drift.sh` and `structure/verify-counts.sh` so docs
  are not only prose; they have executable drift and count gates.
- Added `structure/_legacy/.gitkeep` to follow workspace folder conventions.

## Why this matters

- The roadmap now has a stable place to map CLI, browser primitive, web-ai,
  MCP, eval, and release claims to concrete files.
- `cli-jaw` mirror work has a shared vocabulary for command surface and JSON
  compatibility instead of relying on README-only descriptions.
- Phase 21 release-gate claims can be audited from one document before public
  messaging changes.

## Verification

- `bash structure/check-doc-drift.sh`
- `bash structure/verify-counts.sh`
- `npm run test:unit`

## Follow-ups

- Wire `structure/check-doc-drift.sh` and `structure/verify-counts.sh` into
  release scripts.
- Add automated fixing for line counts once the structure docs begin drifting
  often.
