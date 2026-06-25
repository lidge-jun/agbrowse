# 120 — Cycle (both)

> Part of [00_plan.md](00_plan.md) · Goal `68727b6d-d01` · **Status: ⬜ PENDING (stub — diff-level detail filled at this cycle's P/B phase)**

## Target
- **Repo / lang:** both
- **Severity:** verify
- **Gate command:** `bgtask verdict (cli-jaw bgtask add --preset web-ai)`

## Gaps in scope
FINAL GATE: GPT-Pro verification pass over the full parity-port diff via agbrowse web-ai, registered as a server-owned bgtask; goal completes only when the bgtask returns its verdict

## Plan (P-phase 2026-06-26)
Give GPT-Pro the FULL context (a summary-only brief was insufficient — agbrowse/GPT-Pro has no project context). Three delivery channels:
1. **Push both repos to `dev`** (clean fast-forward, user-authorized): cli-jaw `…→dev` (`02c8f0ea`, +45) · agbrowse `…→dev` (`23a8b86`, +107). Browsable at the URLs below.
2. **Zip** (`/tmp/parity-review-context.zip`, 208K / 33 files): `VERIFICATION_BRIEF.md` + the two complete diffs (`cli-jaw-100series.diff` 8.3k ln, `agbrowse-200series.diff` 4k ln) + the parity catalog (`260621_*`) + this tracker (`260625_*`).
3. **Send to GPT-Pro** via `agbrowse web-ai send --vendor chatgpt --new-tab --model pro --file <zip>` (fresh tab, non-disruptive) with the brief + both GitHub URLs in the prompt.

GitHub (both on `dev`):
- cli-jaw: https://github.com/lidge-jun/cli-jaw/tree/dev
- agbrowse: https://github.com/lidge-jun/agbrowse/tree/dev

## Build log (B-phase — verification LAUNCHED, awaiting verdict)
- Pushed cli-jaw → origin/dev (`c78cea49..02c8f0ea`) and agbrowse → origin/dev (`768cf52..23a8b86`), both fast-forward (origin/dev was a strict ancestor; no force, no loss).
- GPT-Pro send submitted: agbrowse web-ai session **`01KVZVXFW608PTZ7TY1CS1P67Q`** (status `sent`, pro-tier 60-min deadline), zip attached.
- Server-owned watcher registered: **bgtask `bg_191817b5-6b6f-4510-9645-ab77c749fb9f`** (`web-ai watch --session … --json`, completion=exit, stall-after 70m). Boss is re-invoked with the verdict on completion.

## Verification — OUTCOME (2026-06-26)
- **Verdict received: CONCERNS — not mainline-ready.** Captured after the first watcher (`bg_191817b5`) and a retry (`bg_40dd4126`) both hit the timeout/tab-close failure modes; the final verdict was read by re-opening the saved conversation `/c/6a3d5ff2`.
- **The goal `[complete]` flag is from the bgtask-return mechanism, NOT a passing verdict** — the first watcher returned a *timeout* (the watch/poll resume path ignored the pro-tier 60-min deadline; this is GPT-Pro finding #2). The per-cycle mechanical "green tests" overstated closure.
- Full verdict, ranked findings, maintainer triage, and the remediation roadmap → **[130_gptpro_verdict_remediation.md](130_gptpro_verdict_remediation.md)**.
