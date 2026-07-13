# 90 — Comparison Close-out (G2 + G12 + G17)

Date: 2026-07-13
Status: audited (document-only, no code changes)
Sol explorers: Aquinas (G2+G17), Hubble (G12), reasoning_effort=high

## G2 — Transient-Bar Race Assessment

**Risk: LOW. Status: Documented, monitor.**

The race is structurally possible but narrowly conditioned. The stability timer can start prematurely if all activity signals (Stop button, progress bars, sidecar panels) are briefly absent while text exists. With `finished=true` (action bar present), the threshold drops to 1,000ms — short enough for a theoretical premature capture during thinking→streaming transitions.

Stability thresholds (`chatgpt.mjs:483`):
- finished=true: 1,000ms (any text length)
- finished=false: 8,000ms (<16 chars), 3,000ms (16-39), 2,000ms (40-499), 3,000ms (500+)

Key mitigations already in place:
- Exact text equality (not length) — `latest === stableText`
- G5 turn ordering check — `doesAssistantFollowUser` rejects stale historical text
- G3/G4 progress bar and sidecar detection — broader activity signal coverage
- Timer resets when streaming returns — `stableSince = 0` at `chatgpt.mjs:590`
- 500ms poll interval means text changes during streaming are almost always caught

The race requires: all activity signals absent AND text unchanged for 1s AND finished-action control present at the deciding sample AND the text is actually incomplete. This is uncommon during token streaming but more plausible around phase transitions.

**Potential hardening** (deferred): require `finished` to have been true for multiple consecutive samples (Oracle's barConfirmCycles approach), or add a minimum `stableMs` even when `finished=true` (Oracle's proofA approach). Not urgent given the mitigation stack.

## G12 — Filename Sanitization Comparison

**Status: GAPS identified. Two specific missing edge cases.**

Side-by-side comparison of `sanitizeDownloadFilename` (`chatgpt-files.mjs:226`) vs Oracle's `sanitizeArtifactFilename`:

| Edge case | agbrowse | Oracle | Gap? |
| --- | --- | --- | --- |
| Non-string input | Returns `''` | Not specified | agbrowse stronger |
| Null bytes | Removes after basename | Removes before path processing | Minor ordering diff |
| Backslashes | Splits on both `/` `\` | Converts `\` to `/` then `path.basename` | Equivalent |
| `.crdownload` suffix | **Preserved** | Removed | **Missing** |
| `"."` / `".."` | Returns `''` | Rejects | Equivalent |
| `" .. "` (whitespace-wrapped) | Returns `".."` (dot removal before trim) | Rejects | **Gap** |
| Leading dots | Strips all leading dots | Rejects final `.`/`..` | agbrowse stronger |
| Reserved chars `<>:"|?*` | Replaces with `_` | Delegated to fallback | Both handle |
| Trailing separator `"dir/"` | Returns `''` | Returns `"dir"` | Different behavior |

**Two actionable gaps**:
1. `.crdownload` suffix not removed — Chrome's partial download suffix should be stripped before saving
2. `" .. "` → `".."` — leading dot removal runs before trim, and the final check only rejects `"."` not `".."`

**Fix** (trivial, deferred): add `.replace(/\.crdownload$/i, '')` after basename extraction, and add `|| cleaned === '..'` to the final rejection check.

`sanitizeSegment` in `session-artifacts.mjs:30` is a separate helper for path segments (not filenames) — replaces periods with `_`, which is appropriate for directory names but overly aggressive for filenames.

## G17 — Download-Button Discovery Comparison

**Risk: MEDIUM (functional completeness). Security risk: LOW.**

agbrowse and Oracle use fundamentally different approaches:
- **agbrowse**: anchor-only harvesting (`a[href], a[download]`) + direct authenticated `fetch`
- **Oracle**: interactive button/anchor click expressions + browser-initiated downloads

| Capability | agbrowse | Oracle | Gap? |
| --- | --- | --- | --- |
| Exclude metadata-only DIVs | Covered (anchor-only selection) | Explicit filtering | Equivalent |
| Accept sandbox anchors | `sandbox:/mnt/data/...` normalization | Yes | Equivalent |
| Reject external links | Strict host+endpoint allowlisting | Origin-only filtering | **agbrowse stronger** |
| Re-click prevention | N/A (no clicks, direct fetch) | `data-oracle-download-clicked` marker | Different approach |
| Cross-call dedup | URL dedup within one call only | Marker persists across calls | **Missing** (minor) |
| Button-only download cards | **Not discovered** | Click expression covers buttons | **Missing** |
| Direct-link anchors | Covered via fetch | Covered via click | Equivalent |

agbrowse's approach is **simpler and safer** for URLs it can see — no browser-level click means no download-triggered side effects, and the endpoint allowlist is stricter than Oracle's origin-only check. The gap is **functional completeness**: ChatGPT DOM variants that expose only a button or interactive file card (no `<a>` element) will be silently missed.

**Recommendation**: monitor for ChatGPT DOM changes that move from anchor-based to button-only file downloads. If observed, add a button-click fallback path. Current anchor-based approach covers all known current DOM shapes.

## Source Anchors

| File | Lines | Finding |
| --- | --- | --- |
| `chatgpt.mjs` | 63-68 | Finished-action selectors |
| `chatgpt.mjs` | 483 | Stability thresholds |
| `chatgpt.mjs` | 590 | Timer reset on streaming return |
| `chatgpt-files.mjs` | 18, 77, 117, 129 | URL allowlisting (host+endpoint) |
| `chatgpt-files.mjs` | 142-189 | Assistant root + anchor discovery |
| `chatgpt-files.mjs` | 208 | Within-call URL dedup |
| `chatgpt-files.mjs` | 226 | `sanitizeDownloadFilename` full source |
| `chatgpt-files.mjs` | 302 | CDP expression execution |
| `chatgpt-files.mjs` | 346, 399 | Direct fetch (no clicks) |
| `session-artifacts.mjs` | 30 | `sanitizeSegment` (path segments) |

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
