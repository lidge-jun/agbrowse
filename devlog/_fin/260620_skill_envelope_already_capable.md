# Skill Envelope — already capable; reclassified to docs-only (closed 2026-06-20)

> Was `260619_skill_envelope_integration/` (a proposed code project). After verifying the code with the author, the conclusion is: **the capability already exists**. This is a discoverability/UX problem, not an architecture problem. Closed; the only action is a small `skills/web-ai/SKILL.md` + `agbrowse --help` upgrade (no `buildEnvelope` refactor).

## What already works today (verified)

| Need | Flag | Code | Trust |
|------|------|------|-------|
| Trusted operating instructions | `--system "..."` | `web-ai/question.mjs:145` → `[SYSTEM]` trusted section | ✅ honored |
| File attachment (dialog-free, native) | `--file <path>` (repeatable) | `cli.mjs:554` → `chatgpt.mjs:257` `attachLocalFilesLive()`; `attachmentPolicy:'upload'` `cli.mjs:645` | model sees it natively |

So **`--system "이 PDF에서 breaking change 추출" --file spec.pdf` already works** and the model sees the file as a real ChatGPT attachment. "Instruction + attachment" is not a missing feature.

## What the earlier devlog overstated (corrected)

- ❌ "upload 시 모델이 파일 존재를 모름" — wrong. `attachLocalFilesLive` uploads a native composer attachment; the model sees it. The envelope text merely lacks a manifest *line*.
- ⚠️ "개발자 지침 무시됨" — overstated. Only true if instructions go in `--context` (untrusted, `question.mjs:153`). The correct channel `--system` is trusted.

## Dropped code items (per author: "1,2,3,4는 딱히 필요가 없고")

1. **Persist skill/tool selection to `session.envelopeSummary`** — on resume, agbrowse reattaches to the live ChatGPT tab whose tool state already lives server-side; agbrowse doesn't re-apply tools on resume, so this would only be agbrowse-side bookkeeping. Not needed for correctness. (If resume-reporting ever matters: a ~5-line `updateSession` after `chatgpt.mjs:224`. Revisit only if asked.)
2. **`buildEnvelope` unification / `[DEVELOPER INSTRUCTIONS]` + `[ATTACHMENT MANIFEST]` sections** — convenience refactor; the `--system`/`--file` primitives already cover the real need.
3. **Split `--context` into trusted/untrusted** — `--system` already is the trusted channel; just document it. A footgun, not a gap.
4. **Attachment manifest text on upload** — model sees plain `--file` natively; only marginally useful for ZIP context-packs.

## The actual fix (docs-only — UX/discoverability)

`skills/web-ai/SKILL.md` documents `--file` and context-packs well but **never mentions `--system` as the trusted-instruction channel, nor that `--context` is untrusted data**. Add a short "where do my instructions go" subsection + an `agbrowse --help` clarification:

- Trusted operating instructions / skill guidance → `--system` (or the USER fields). **Not** `--context`.
- `--context` = untrusted reference *data* (treated as data-only; instructions inside are ignored by design).
- File for the model to read/analyze → `--file <path>` (native attachment; repeatable).
- Philosophy: if attachment intent is ambiguous, the agent can just **ask** rather than rely on envelope machinery.

This matches the gallery feedback (쿠마방와): "에이전트가 스킬 오해한 거 제대로 이해시키니 낫더라" — the win was clarifying the skill, not rebuilding the pipeline.

## Status

- [x] Investigated, capability confirmed present
- [x] Reclassified code project → docs-only, moved to `_fin`
- [ ] SKILL.md + `--help` wording upgrade (pending author go-ahead)

Sibling code work (genuinely real, devlogs in `devlog/_plan/260619_*`): timeout_adaptive_scaling, tab_parallel_stability, watch_notification_gaps.
