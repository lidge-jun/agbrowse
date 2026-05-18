# Web-AI Skill Activation & Trigger Fix

Date: 2026-05-19 06:21 KST
Status: **IMPLEMENTED**

## Problem

When users say "GPT Pro로 리뷰해봐", "grok heavy로 검증해", "gemini deepthink으로 분석해", or "agbrowse로 요청해", the web-ai skill DOES NOT fire because:

1. **web-ai was not an active skill** — it was in `skills_ref/` (reference only), NOT in `skills/` (active). The LLM never sees inactive skills in the system prompt, so it has zero chance of routing to web-ai.
2. **browser skill had no disambiguation** — "chatgpt" appeared in neither browser NOR web-ai triggers, so the LLM might incorrectly route to browser or to nothing.
3. **No Korean triggers** — Korean phrases like "GPT한테", "AI 물어봐", "그록 헤비" had no trigger match anywhere.

## Architecture: Skill Clone Chain

```
~/.cli-jaw/skills_ref/     ← GLOBAL SOURCE OF TRUTH
    ↓ (clone on instance start)
~/.cli-jaw-3461/skills_ref/ ← INSTANCE REF COPY
    ↓ (cli-jaw skill install)
~/.cli-jaw-3461/skills/     ← INSTANCE ACTIVE COPY (injected into system prompt)
```

- Fixing only `~/.cli-jaw-3461/` → survives until instance restart
- Fixing only `~/.cli-jaw/skills_ref/` → survives new instances but not existing ones
- **Fixing all 3 layers** → permanent fix across all instances

## Root Cause Analysis

The skill system is **LLM-driven routing** — the LLM reads skill descriptions from the system prompt and decides which skill to invoke. The routing signal comes entirely from:
1. Whether the skill appears in the active skills list (injected into system prompt)
2. The `description:` field content, especially `Triggers:` keyword lists
3. `NOT for:` disambiguation lines

If a skill is in `skills_ref/` but not `skills/`, it is INVISIBLE to the LLM.

## Changes Made

### 1. Activated web-ai skill
```bash
cli-jaw skill install web-ai
# Copied from skills_ref/web-ai/ → skills/web-ai/
# Now appears in system prompt as active skill
```

### 2. Updated web-ai description (cli-jaw version)
**Before**:
```yaml
description: "Structured browser web-ai workflow for ChatGPT, Gemini, and Grok in cli-jaw."
```

**After**:
```yaml
description: >-
  Ask AI web UIs (ChatGPT, Gemini, Grok) via browser automation using agbrowse or cli-jaw browser web-ai.
  Model selection, effort control, session resume, file/context upload, polling, and response extraction.
  NOT for: generic page navigation or screenshots (use browser skill).
  Triggers: web-ai, agbrowse, ChatGPT, GPT, GPT Pro, GPT Thinking, GPT Instant, GPT Heavy,
  Gemini, Gemini Pro, Gemini Thinking, Gemini DeepThink, deep think, deepthink,
  Grok, Grok Heavy, Grok Expert, Grok Fast, grok-4.3,
  챗지피티, 제미나이, 그록, 딥씽크, GPT한테, AI한테, AI 물어봐, AI한테 물어봐,
  heavy 모드, thinking 모드, pro 모드, expert 모드, extended effort, reasoning effort,
  ask chatgpt, ask gemini, ask grok, query AI, AI 리뷰, AI 검증, AI 조사,
  GPT한테 리뷰, GPT로 검증, 그록한테 물어봐, 제미나이로 분석,
  ~한테 물어봐, ~한테 질문, ~에게 요청, ~로 물어봐, ~로 검증, ~로 분석,
  web-ai query, web-ai send, web-ai poll, --vendor, --model, --effort
```

### 3. Updated browser description (disambiguation)
**Before**:
```yaml
description: "Chrome browser control: open pages, take ref snapshots, click, type, screenshot. Requires cli-jaw server running."
```

**After**:
```yaml
description: >-
  Chrome browser control: open pages, take ref snapshots, click, type, screenshot.
  Requires cli-jaw server running.
  NOT for: sending prompts to AI providers like ChatGPT, Gemini, Grok (use web-ai skill instead).
  Triggers: browser, 브라우저, Chrome, 크롬, open page, navigate, snapshot,
  screenshot, 스크린샷, click element, type text, 웹페이지, page interaction,
  DOM, ref ID, 페이지 열기, 탭, tab, CDP, 브라우저 열기
```

### 4. Updated agbrowse web-ai description (same trigger keywords)
Synced identical trigger keywords to `agbrowse/skills/web-ai/SKILL.md`.

## Files Changed

### Instance files (`~/.cli-jaw-3461/` — current running instance)

| File | Change |
|------|--------|
| `~/.cli-jaw-3461/skills/web-ai/SKILL.md` | Active: description updated with triggers |
| `~/.cli-jaw-3461/skills/browser/SKILL.md` | Active: description updated with NOT-for + triggers |
| `~/.cli-jaw-3461/skills_ref/web-ai/SKILL.md` | Ref: synced to active |
| `~/.cli-jaw-3461/skills_ref/browser/SKILL.md` | Ref: synced to active |

### Global files (`~/.cli-jaw/` — cloned to new instances on startup)

| File | Change |
|------|--------|
| `~/.cli-jaw/skills_ref/web-ai/SKILL.md` | **ROOT FIX** — full triggers added to global ref |
| `~/.cli-jaw/skills_ref/browser/SKILL.md` | **ROOT FIX** — NOT-for + triggers added to global ref |
| `~/.cli-jaw/skills/web-ai/SKILL.md` | **NEW** — web-ai installed as global active skill |
| `~/.cli-jaw/skills/browser/SKILL.md` | Active: NOT-for + triggers added |

### External

| File | Change |
|------|--------|
| `agbrowse/skills/web-ai/SKILL.md` | description updated with triggers |

## Trigger Keyword Coverage

### Provider Names (EN + KR)
- ChatGPT, GPT, 챗지피티
- Gemini, 제미나이
- Grok, 그록

### Model Names
- GPT Pro, GPT Thinking, GPT Instant, GPT Heavy
- Gemini Pro, Gemini Thinking, Gemini DeepThink, deepthink, deep think, 딥씽크
- Grok Heavy, Grok Expert, Grok Fast, grok-4.3

### Mode/Effort Keywords
- heavy 모드, thinking 모드, pro 모드, expert 모드
- extended effort, reasoning effort

### Korean Action Patterns
- AI 물어봐, AI한테, AI한테 물어봐
- GPT한테 리뷰, GPT로 검증
- 그록한테 물어봐, 제미나이로 분석
- ~한테 물어봐, ~한테 질문, ~에게 요청
- ~로 물어봐, ~로 검증, ~로 분석
- AI 리뷰, AI 검증, AI 조사

### CLI Keywords
- web-ai, agbrowse
- web-ai query, web-ai send, web-ai poll
- --vendor, --model, --effort

## Disambiguation Rules

| User Phrase | Route | Reason |
|------------|-------|--------|
| "GPT Pro로 리뷰해" | **web-ai** | Sending prompt to AI provider |
| "grok heavy로 물어봐" | **web-ai** | Sending prompt to AI provider |
| "agbrowse로 요청해" | **web-ai** | "agbrowse" is a web-ai trigger |
| "chatgpt.com 열어" | **browser** | Just navigation, no prompt |
| "스크린샷 찍어" | **browser** or **screen-capture** | Not AI prompt |
| "브라우저 열어" | **browser** | Generic browser operation |

## Expected Routing Matrix (Verification Test Cases)

| # | User Input | Expected Skill | Pre-Fix | Post-Fix |
|---|-----------|---------------|---------|----------|
| 1 | "grok heavy로 물어봐" | web-ai | FAIL (no skill) | PASS |
| 2 | "GPT Pro한테 리뷰 받아" | web-ai | FAIL | PASS |
| 3 | "gemini deepthink으로 분석해" | web-ai | FAIL | PASS |
| 4 | "agbrowse로 chatgpt한테 요청해" | web-ai | FAIL | PASS |
| 5 | "AI한테 물어봐" | web-ai | FAIL | PASS |
| 6 | "extended effort으로 분석" | web-ai | FAIL | PASS |
| 7 | "chatgpt.com 열어봐" | browser | browser | browser (unchanged) |
| 8 | "스크린샷 찍어" | browser/screen-capture | browser | browser (unchanged) |
| 9 | "그록한테 검증시켜" | web-ai | FAIL | PASS |
| 10 | "제미나이 딥씽크로 분석" | web-ai | FAIL | PASS |

### 5. Synced skills_ref originals (root cause fix)

Active skills (`skills/`) are copies installed from `skills_ref/`. If `skills_ref/` has no triggers, reinstalling wipes the fix. Both originals updated to match active:

| File | Change |
|------|--------|
| `~/.cli-jaw/skills_ref/web-ai/SKILL.md` | description updated — full triggers + NOT-for |
| `~/.cli-jaw/skills_ref/browser/SKILL.md` | description updated — NOT-for + triggers |

**Verification**: `diff` between `skills_ref/` and `skills/` frontmatter returns empty (identical).

Now `cli-jaw skill install web-ai` or `cli-jaw skill install browser` will always include triggers.

## GPT Pro Verification (Extended Pro, 2026-05-19)

**Verdict: PASS**

GPT Pro reviewed the 3-layer architecture fix and confirmed:

> "The key improvement is that trigger keywords were added to skills_ref, the global source of truth, not only to the instance layer. Patching only instance ref was naturally fragile: any restart or reclone would regenerate from a triggerless global definition."

### Caveats raised:
1. **Stale instances**: Old instances may retain triggerless copies unless restart/reclone refreshes them — backfilled in this fix
2. **Manual multi-file drift**: 9 files is a maintenance smell — future trigger changes should ideally propagate from one canonical definition
3. **Trigger collision**: NOT-for disambiguation helps only if the LLM router interprets it — needs concrete prompt testing
4. **Normalization**: Case folding, whitespace, Korean spacing variants may not all match without normalization
5. **Restart regression**: Test fresh install, instance restart, CLI upgrade, config reset paths

### Recommended hardening:
> "Keep triggers canonical in skills_ref, generate lower layers from it, and add a regression test that proves triggers survive restart/reclone."

## Employee Verification Summary

| Employee | Scope | Verdict |
|----------|-------|---------|
| Frontend | 9-file trigger consistency audit | **PASS** (9/9) |
| GPT Pro (Extended) | Architecture + edge case review | **PASS** (with 5 caveats) |

## Remaining Work (doc 14 covers full scope)

## P0 BLOCKER: web-ai empty-shell false positive (promoted per GPT Pro R5)

> **Priority: P0** — GPT Pro R5 audit elevated this from "bug found" to runtime blocker. Web-ai may route correctly via triggers but still fail at runtime.

During GPT Pro verification, `cli-jaw browser web-ai query` repeatedly failed with:
```
❌ ChatGPT blocked by empty-shell: no composer and no turns
```

Despite `#prompt-textarea` being present and `body.innerText.length = 909`.

**Root cause**: `interstitial.ts:66` — `ensureProviderTab()` creates/navigates a new tab, and the interstitial check runs before React renders the composer. The `domcontentloaded` wait is insufficient for SPA rendering.

**File**: `cli-jaw/src/browser/web-ai/interstitial.ts:66`
**Workaround**: Used browser primitive commands (type + press Enter) instead of web-ai query.
**Fix**: Add `waitForSelector('#prompt-textarea', { timeout: 10_000 })` before running `detectInterstitial`, with exponential backoff. This must ship before any other web-ai feature work.

## Remaining Verification Gaps (GPT Pro R5)

The verification matrix above is labeled "Expected Routing Matrix" — it documents expected behavior but is NOT an executed regression log. Must run real tests:
- Fresh install (no prior skills state)
- Instance restart (skills reload)
- CLI upgrade (skills potentially reset)
- Config reset
- Korean spacing variants ("grok heavy" vs "grokheavy" vs "그록 헤비")
- Mixed-language provider aliases
- Browser vs web-ai disambiguation edge cases

This fix addresses the **P0 critical gap** (web-ai activation + browser disambiguation). Doc 14 has the full 30-skill audit with P1-P4 phases covering all remaining trigger gaps across diagram, imagegen, github, notion, telegram, memory, screen-capture, desktop-control, and all dev-* skills.
