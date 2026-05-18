# Skill Trigger Reinforcement Plan — Full 30-Skill Audit

Date: 2026-05-19
Scope: All 30 active cli-jaw skills + web-ai (inactive, must activate)

## Problem Statement

The LLM routes user intent to skills via `Triggers:` keywords in the skill description. **21 of 30 active skills have NO explicit triggers** — they rely on description text alone, which is a weak signal. Result: skills don't fire for natural user phrases, especially Korean phrases, abbreviations, and action verbs.

## Failure Taxonomy

| ID | Failure Mode | Example | Count |
|----|-------------|---------|-------|
| F1 | **Missing skill** — skill not active, LLM has no target | "grok heavy로 물어봐" → no web-ai skill visible | 1 (web-ai) |
| F2 | **No triggers** — description lacks `Triggers:` keyword list | "다이어그램 그려줘" → diagram has no triggers | 13 skills |
| F3 | **Description-only** — trigger intent embedded in prose, not keyword list | imagegen: "Use when the user asks to generate..." but no `Triggers:` | 7 skills |
| F4 | **Korean gap** — English triggers present, Korean equivalents missing | "엑셀 만들어줘" works, "스프레드시트 분석" doesn't trigger xlsx | Most skills |
| F5 | **Disambiguation gap** — overlapping skills, no routing rule | pdf vs pdf-vision: when to use which? | 4 pairs |
| F6 | **Action verb gap** — skill lists nouns but not action verbs | "프레젠테이션 만들어" triggers, "발표자료 정리해" doesn't | Most skills |
| F7 | **System prompt override** — triggers live in system prompt body, not skill description | diagram: system prompt has "다이어그램 / 시각화" but skill description has nothing | 1 skill |
| F8 | **Abbreviation/alias gap** — formal names present, informal aliases missing | "ppt 만들어" vs "PowerPoint" | Several skills |
| F9 | **Negative routing gap** — no "don't use X" / opt-out handling | "don't use web-ai, just open the page" | All skills |
| F10 | **Multi-skill composition** — user wants 2+ skills in one request | "PPT 만들고 텔레그램으로 보내줘" → pptx + telegram-send | Cross-skill |
| F11 | **Stale model alias drift** — model alias changes upstream without trigger update | Provider renames "Heavy" to "Max" | web-ai |
| F12 | **Canonical trigger drift** — triggers diverge across SKILL.md copies (active vs skills_ref) | Active copy updated, skills_ref copy stale | All skills |
| F13 | **Typo/romanization variants** — user typos or romanization not covered | "gemeni" (typo), "jeomini" (romanization) | Provider skills |
| F14 | **Prompt injection in provider text** — untrusted content triggers wrong skill | Page text contains "make a diagram" → diagram fires | All skills |

## Severity Rating

- **CRITICAL**: User intent silently dropped (no skill fires, LLM handles raw)
- **HIGH**: Wrong skill fires (browser instead of web-ai)
- **MEDIUM**: Skill fires inconsistently (works in English, fails in Korean)
- **LOW**: Skill fires but with delay (LLM hesitates, asks clarification)

---

## Full Skill Audit

### Tier 1: CRITICAL — Must Fix Now

#### 1. web-ai (NOT ACTIVE — F1)
**Status**: In `skills_ref` only. The single biggest trigger failure.
**Current**: `description: "Structured browser web-ai workflow for ChatGPT, Gemini, and Grok in cli-jaw."`
**Impact**: Every "grok heavy", "GPT Pro", "gemini deepthink", "AI한테 물어봐" falls through.
**Fix**:
```yaml
description: >-
  Ask AI web UIs (ChatGPT, Gemini, Grok) via browser automation using agbrowse.
  Model selection, effort control, session resume, file upload, and response extraction.
  Triggers: web-ai, ChatGPT, GPT, GPT Pro, GPT Thinking, GPT Instant, Gemini,
  Gemini Pro, Gemini Thinking, Gemini DeepThink, deep think, Grok, Grok Heavy,
  Grok Expert, grok-4.3, AI 물어봐, GPT한테, 제미나이, 그록, 딥씽크, 챗지피티,
  heavy 모드, thinking 모드, pro 모드, expert 모드, extended effort, agbrowse,
  ask chatgpt, ask gemini, ask grok, AI한테 물어봐, AI 리뷰, ~한테 질문
```
**Action**: `cli-jaw skill install web-ai` + update description

#### 2. browser (F2, F5 — disambiguation needed)
**Status**: Active, NO triggers.
**Current**: `"Chrome browser control: open pages, take ref snapshots, click, type, screenshot."`
**Impact**: Over-captures AI queries (user says "chatgpt" → browser fires instead of web-ai). Under-captures for Korean phrases.
**Fix**:
```yaml
description: >-
  Chrome browser control: open pages, take ref snapshots, click, type, screenshot.
  Requires cli-jaw server running. For AI provider web UIs (ChatGPT, Gemini, Grok),
  use the web-ai skill instead.
  Triggers: browser, 브라우저, Chrome, 크롬, open page, navigate, snapshot,
  screenshot, 스크린샷, click element, type text, 웹페이지, page interaction,
  DOM, ref ID, 페이지 열기, 탭, tab
```

#### 3. diagram (F2, F7 — system prompt has triggers but skill doesn't)
**Status**: Active, NO triggers in skill. System prompt body has "diagram / chart / graph / visualize / SVG / mermaid / 다이어그램 / 시각화" — but this is fragile.
**Current**: `"SVG diagrams, charts, and interactive visualizations for chat UI"`
**Fix**:
```yaml
description: >-
  SVG diagrams, charts, and interactive visualizations for chat UI.
  Triggers: diagram, chart, graph, visualize, SVG, mermaid, 다이어그램, 시각화,
  flowchart, 플로우차트, 순서도, architecture diagram, 아키텍처, ER diagram,
  pie chart, bar chart, 차트, 그래프, 도식, 도표, 관계도, sequence diagram,
  시퀀스, class diagram, Gantt, 간트, timeline, 타임라인, mindmap, 마인드맵
```

#### 4. imagegen (F3 — description-only, no Triggers keyword)
**Status**: Active, description has examples but no `Triggers:` keyword.
**Current**: Long description with "generate image, edit/inpaint/mask..." embedded.
**Fix**:
```yaml
description: >-
  Generate or edit images via OpenAI Image API. Run bundled CLI (scripts/image_gen.py).
  Requires OPENAI_API_KEY.
  Triggers: generate image, 이미지 생성, image gen, edit image, 이미지 편집,
  inpaint, mask, background removal, 배경 제거, transparent background, 투명 배경,
  product shot, concept art, 컨셉 아트, cover image, 커버 이미지, batch variants,
  이미지 만들어, 그림 그려, illustration, 일러스트, DALL-E, dalle
```

### Tier 2: HIGH — Frequent User Paths

#### 5. github (F2, F6)
**Current**: Description lists features but no `Triggers:`.
**Fix**:
```yaml
Triggers: github, gh, issue, PR, pull request, CI, 이슈, 풀리퀘, yeet,
commit push, code review, 코드리뷰, CI run, actions, release, 릴리즈,
check status, PR comment, merge, 머지, gh api
```

#### 6. notion (F2, F4)
**Current**: `"Notion API for creating and managing pages, databases, and blocks."`
**Fix**:
```yaml
Triggers: Notion, 노션, Notion page, Notion database, 노션 페이지, 노션 DB,
create page, 페이지 만들기, database query, block, 블록, Notion API,
노션에 기록, 노션에 정리, 노션 업데이트
```

#### 7. telegram-send (F2, F4)
**Current**: `"Send voice/photos/documents (and optional text notices) to Telegram."`
**Fix**:
```yaml
Triggers: telegram, 텔레그램, send telegram, 텔레그램 보내, voice message,
음성 메시지, send photo, 사진 보내, send document, 파일 보내, 텔레그램 전송
```

#### 8. memory (F2, F4)
**Current**: `"Persistent long-term memory across sessions."`
**Fix**:
```yaml
Triggers: memory, 메모리, remember, 기억, recall, 기억나, save memory,
기억해, forget, 잊어, search memory, 메모리 검색, 기억 저장
```

#### 9. screen-capture (F2, F4)
**Current**: Description-focused, no triggers.
**Fix**:
```yaml
Triggers: screenshot, 스크린샷, screen capture, 화면 캡처, webcam, 웹캠,
camera, 카메라, screen recording, 화면 녹화, window capture, 창 캡처,
screengrab, 캡처해, 찍어
```

#### 10. desktop-control (F2)
**Current**: Technical description, no triggers.
**Fix**:
```yaml
Triggers: desktop control, 데스크톱, computer use, 컴퓨터 유즈, $computer-use,
click app, 앱 클릭, Finder, System Settings, 시스템 설정, macOS UI,
accessibility, 접근성, 앱 조작, desktop automation
```

### Tier 3: MEDIUM — Role-Injected Skills (dev-*)

These are typically auto-injected by the orchestrator, not user-triggered. But adding basic triggers prevents F4 (Korean gap) when users invoke them directly.

#### 11. dev (F2)
```yaml
Triggers: dev, development, 개발, coding standards, 코딩 규칙, code quality
```

#### 12. dev-backend (F2, F4)
```yaml
Triggers: backend, 백엔드, API, server, 서버, database, DB, 데이터베이스,
REST, GraphQL, authentication, 인증, middleware, 미들웨어
```

#### 13. dev-frontend (F2, F4)
```yaml
Triggers: frontend, 프론트엔드, UI, UX, CSS, React, component, 컴포넌트,
layout, 레이아웃, responsive, 반응형, styling, 스타일링
```

#### 14. dev-data (F2, F4)
```yaml
Triggers: data, 데이터, pipeline, ETL, ELT, SQL, query optimization,
데이터 파이프라인, 데이터 분석, data quality, 데이터 품질
```

#### 15. dev-testing (F2, F4)
```yaml
Triggers: test, 테스트, TDD, unit test, e2e, integration test, coverage,
커버리지, Playwright, 테스트 작성, 테스트 실행
```

#### 16. dev-debugging (F2, F4)
```yaml
Triggers: debug, 디버그, 디버깅, error, 에러, bug, 버그, root cause,
원인 분석, stack trace, 스택 트레이스, 왜 안돼, 안되는데
```

#### 17. dev-security (F2, F4)
```yaml
Triggers: security, 보안, auth, 인증, validation, 검증, secrets, XSS, CSRF,
SQL injection, OWASP, 취약점, vulnerability, 보안 리뷰
```

#### 18. dev-code-reviewer (F2, F4)
```yaml
Triggers: code review, 코드 리뷰, review, 리뷰, PR review, 코드 검토,
antipattern, 안티패턴, quality check, 품질 검사
```

#### 19. dev-scaffolding (GOOD — already has triggers)
**Status**: ✅ Has triggers. Consider adding Korean: `프로젝트 생성, 스캐폴딩, 모듈 추가, 프로젝트 초기화`

#### 20. dev-pabcd (F2)
```yaml
Triggers: PABCD, orchestrate, 오케스트레이트, 지휘 모드, plan audit build check done
```

### Tier 4: LOW — Document Skills (already decent)

#### 21. hwp (GOOD ✅)
Already has both English and Korean triggers.

#### 22. docx (GOOD but F4)
Has triggers but missing Korean: `워드, 문서, 보고서, 메모, 편지, 템플릿, .docx`

#### 23. xlsx (GOOD but F4)
Has triggers but missing Korean: `엑셀, 스프레드시트, 재무 모델, 데이터 분석, 피벗, 차트`

#### 24. pptx (GOOD but F4, F8)
Has triggers but missing Korean + aliases: `PPT, ppt, 피피티, 프레젠테이션, 슬라이드, 발표자료, 덱`

#### 25. pdf (F3 — description only)
```yaml
Triggers: PDF, pdf, .pdf, PDF 만들기, PDF 읽기, PDF 편집, 피디에프, create PDF,
read PDF, edit PDF, DOCX to PDF, convert to PDF, 변환
```

#### 26. pdf-vision (GOOD ✅)
Has Korean triggers already.

#### 27. video (GOOD but F4)
Missing Korean: `영상, 비디오, 애니메이션, 렌더링, 슬라이드 영상`

#### 28. lecture-stt (GOOD ✅)
Comprehensive bilingual triggers.

#### 29. k-thread-gen (OK — Korean-native)
Has Korean trigger phrases in body.

#### 30. vision-click (F2)
```yaml
Triggers: vision click, 비전 클릭, coordinate click, 좌표 클릭, screenshot click
```

#### 31. openai-docs (F3 — description-only)
```yaml
Triggers: OpenAI, OpenAI API, Codex, Responses API, Chat Completions,
Agents SDK, Apps SDK, Realtime API, 오픈AI, OpenAI 문서, model capabilities
```

---

## Cross-Skill Disambiguation Rules

These should be embedded in the AFFECTED skill descriptions to prevent wrong routing.

| Ambiguous Phrase | WRONG Route | CORRECT Route | Rule |
|-----------------|-------------|---------------|------|
| "chatgpt한테 물어봐" | browser | **web-ai** | Sending a prompt to AI → web-ai |
| "chatgpt 열어" | web-ai | **browser** | Just navigating → browser |
| "PDF 분석해줘" (with embedding) | pdf | **pdf-vision** | RAG/embedding/search → pdf-vision |
| "PDF 만들어" | pdf-vision | **pdf** | Create/edit → pdf |
| "이미지 생성" (OpenAI API) | diagram | **imagegen** | Image generation via API → imagegen |
| "아키텍처 다이어그램" | imagegen | **diagram** | Visual diagram → diagram |
| "스크린샷 찍어" (macOS) | browser | **screen-capture** | System-level capture → screen-capture |
| "페이지 스크린샷" (web) | screen-capture | **browser** | Web page capture → browser screenshot |
| "코드 리뷰해줘" | dev-testing | **dev-code-reviewer** | Review → dev-code-reviewer |
| "데스크톱 앱 조작" | browser | **desktop-control** | Native app → desktop-control |
| "Notion에 기록" | memory | **notion** | Notion-specific → notion |
| "기억해" | notion | **memory** | Persistent memory → memory |

### Disambiguation Injection Template

Add to EACH affected skill's description:

```
NOT for: <what the OTHER skill handles>. Use <other-skill> instead.
```

Example for browser:
```
NOT for: sending prompts to AI providers (use web-ai).
NOT for: system-level screen capture (use screen-capture).
```

Example for pdf:
```
NOT for: RAG, embedding search, or OCR extraction (use pdf-vision).
```

---

## Korean Trigger Dictionary

Universal action verbs that should be appended to relevant skills:

| Korean | English | Applicable Skills |
|--------|---------|-------------------|
| 만들어 / 생성 | create | docx, xlsx, pptx, hwp, pdf, imagegen, diagram, video |
| 읽어 / 열어 | read/open | docx, xlsx, pptx, hwp, pdf, browser |
| 편집해 / 수정해 | edit | docx, xlsx, pptx, hwp, pdf |
| 분석해 | analyze | xlsx, pdf-vision, dev-data |
| 보내 / 전송해 | send | telegram-send |
| 물어봐 / 질문해 | ask | web-ai |
| 기억해 / 저장해 | remember/save | memory |
| 리뷰해 / 검토해 | review | dev-code-reviewer, github |
| 디버그해 / 고쳐 | debug/fix | dev-debugging |
| 테스트해 | test | dev-testing |
| 그려 / 시각화해 | draw/visualize | diagram |
| 캡처해 / 찍어 | capture | screen-capture, browser |
| 녹음 / 전사해 | record/transcribe | lecture-stt |
| 발표자료 | presentation | pptx |
| 보고서 | report | docx |

---

## Implementation Plan

### Phase 1: Critical (P0) — 30 min
1. `cli-jaw skill install web-ai`
2. Update web-ai SKILL.md description with full trigger keyword list
3. Update browser SKILL.md with disambiguation + triggers
4. Update diagram SKILL.md with triggers (removes system-prompt dependency)
5. Update imagegen SKILL.md with explicit `Triggers:` keyword list

### Phase 2: High-Traffic (P1) — 45 min
6. Add triggers to: github, notion, telegram-send, memory, screen-capture, desktop-control
7. Add Korean triggers to existing good skills: docx, xlsx, pptx, video
8. Add disambiguation lines to: pdf, pdf-vision, browser, screen-capture

### Phase 3: Dev Skills (P2) — 30 min
9. Add basic triggers to all dev-* skills (11 skills)
10. Add Korean variants for common dev action verbs
11. Add Korean to dev-scaffolding

### Phase 4: Validation (P3) — 20 min
12. Run test matrix: 30 Korean phrases × expected skill routing
13. Run test matrix: 15 disambiguation phrases × expected routing
14. Document any remaining edge cases

### Phase 5: Sync (P4) — 15 min
15. Sync web-ai triggers between cli-jaw and agbrowse versions
16. Update agbrowse bundled skill metadata
17. Commit and push

---

## Effort Summary

| Phase | Skills | Time | Impact |
|-------|--------|------|--------|
| P0 | 4 skills (web-ai, browser, diagram, imagegen) | 30 min | Fixes 60%+ of misroutes |
| P1 | 10 skills | 45 min | Covers all high-traffic user paths |
| P2 | 11 skills | 30 min | Completes dev skill coverage |
| P3 | Validation | 20 min | Confidence gate |
| P4 | Sync | 15 min | Consistency across projects |
| **Total** | **31 skills** | **~2.5 hrs** | **All 30 active + 1 newly activated** |

## Metrics

**Before**: 7 of 30 skills (23%) have explicit trigger keywords
**After**: 31 of 31 skills (100%) will have explicit trigger keywords + Korean variants + disambiguation rules

Expected improvement:
- Korean phrase routing: ~30% → ~90% accuracy
- Cross-skill disambiguation: ad-hoc → rule-based
- web-ai routing: 0% (not active) → 95%+
