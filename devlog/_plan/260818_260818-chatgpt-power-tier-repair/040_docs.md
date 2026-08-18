# 040 — WP4: docs / SKILL / SOT sync

> Expanded after audit round 1: a second surface was emitting the old semantics.

- `web-ai/tab-inspect.mjs` (audit finding, NOW IN SCOPE): its `openPicker` query matches
  only `composer-intelligence-picker-content`, not the Power shell root, so it yields
  `familyLabel:null` on the live shell; and its `verified` has no effort axis. Align it
  with the WP2 contract so `web-ai status` and `selectChatGptModel` cannot disagree.
- `web-ai/tool-schema.mjs` (audit finding): effort enum still advertises
  `heavy/extended/low`; document in the tool description that non-thinking efforts are
  rejected and that `verified:false` means NOT applied.
- `skills/web-ai/SKILL.md`: Chat tier selection is slider-driven; effort is verified on
  its own axis; `verified:false` now means the tier was NOT applied.
- `docs/guides/web-ai.*` + ko mirror; `docs/changelog.*`; `structure/*.md` counts.

## Verification (C)

- `node bin/agbrowse.mjs web-ai claim-audit --json` → `ok:true`
- structure/SOT gate in `npm test` → exit 0

