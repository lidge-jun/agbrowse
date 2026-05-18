# Proposed Skill Trigger Metadata Enhancement

## Goal

Make the LLM reliably route model-specific keywords to the web-ai skill, so "grok heavy로 물어봐" triggers `web-ai` without the user needing to know the skill name.

## Approach: Two-Layer Trigger Strategy

### Layer 1: Activate web-ai skill in cli-jaw (from skills_ref → skills)

Currently web-ai is in `skills_ref` (reference, not auto-injected). It should be promoted to active skills so the LLM always sees it.

```bash
cli-jaw skill install web-ai
```

### Layer 2: Enhanced description with comprehensive trigger keywords

#### Proposed web-ai SKILL.md frontmatter (cli-jaw version)

```yaml
---
name: web-ai
description: >-
  Ask AI web UIs (ChatGPT, Gemini, Grok) via browser automation using agbrowse.
  Model selection, effort control, session resume, context packaging, and response extraction.
  Triggers: web-ai, ChatGPT, GPT Pro, GPT Thinking, GPT Instant, Gemini, Gemini Pro,
  Gemini Thinking, Gemini DeepThink, deep think, Grok, Grok Heavy, Grok Expert,
  grok-4.3, AI 물어봐, GPT한테, 제미나이, 그록, 딥씽크, heavy 모드, thinking 모드,
  pro 모드, expert 모드, effort, reasoning effort, extended, agbrowse, web-ai query,
  ask chatgpt, ask gemini, ask grok, AI provider, browser AI, --model, --vendor,
  --effort, deep research, 경쟁사 조사, AI 리뷰
metadata:
  openclaw:
    emoji: "🤖"
    requires:
      bins: ["agbrowse"]
      system: ["Google Chrome"]
---
```

#### Proposed browser SKILL.md frontmatter update

Add a disambiguation line so the LLM knows when to choose browser vs web-ai:

```yaml
---
name: browser
description: >-
  Chrome browser control: open pages, take ref snapshots, click, type, screenshot.
  Requires cli-jaw server running. For AI provider web UIs (ChatGPT, Gemini, Grok),
  use the web-ai skill instead.
---
```

## Trigger Keyword Matrix

| Category | English Keywords | Korean Keywords |
|----------|-----------------|-----------------|
| **Provider names** | ChatGPT, GPT, Gemini, Grok | 챗지피티, 제미나이, 그록 |
| **ChatGPT models** | Pro, Thinking, Instant, GPT Pro, GPT-5.5-Pro | 프로 모드 |
| **ChatGPT efforts** | light, standard, extended, heavy, reasoning effort | 라이트, 스탠다드, 익스텐디드, 헤비 |
| **Gemini models** | fast, thinking, pro, flash | 패스트, 씽킹, 프로 |
| **Gemini tools** | DeepThink, deep think, deep-think | 딥씽크, 딥 씽크 |
| **Grok models** | auto, fast, expert, heavy, grok-4.3, beta | 익스퍼트, 헤비, 패스트 |
| **Actions** | ask, query, review, analyze, research | 물어봐, 질문해, 분석해, 리뷰해, 조사해 |
| **Meta** | web-ai, agbrowse, --vendor, --model, --effort | AI 물어봐, AI한테, ~한테 물어봐 |

## Disambiguation Rules (for LLM routing)

The LLM system prompt should communicate these rules via the skill descriptions:

1. **"grok heavy"** → web-ai skill, not browser skill
2. **"gemini deepthink"** → web-ai skill
3. **"ChatGPT Pro로 리뷰"** → web-ai skill
4. **"open chatgpt.com"** → browser skill (just navigation, no prompt sending)
5. **"take a screenshot of Grok"** → browser skill (screenshot, not query)
6. **"browse to google.com"** → browser skill

**Rule of thumb**: If the intent involves SENDING A PROMPT to an AI provider → web-ai. If the intent involves NAVIGATING/INTERACTING with a web page → browser.

## Model Name → CLI Flag Mapping (for skill reference)

The web-ai skill content should include a quick-reference table:

| User Says | CLI Translation |
|-----------|----------------|
| "GPT Pro" | `--vendor chatgpt --model pro` |
| "GPT Thinking Heavy" | `--vendor chatgpt --model thinking --effort heavy` |
| "GPT Pro Extended" | `--vendor chatgpt --model pro --effort extended` |
| "Gemini DeepThink" | `--vendor gemini --model deepthink` |
| "Gemini Thinking" | `--vendor gemini --model thinking` |
| "Gemini Pro" | `--vendor gemini --model pro` |
| "Grok Heavy" | `--vendor grok --model heavy` |
| "Grok Expert" | `--vendor grok --model expert` |
| "Grok 4.3" | `--vendor grok --model grok-4.3` |
| "Grok Fast" | `--vendor grok --model fast` |

## Implementation Estimate

| Step | Effort | Impact |
|------|--------|--------|
| Install web-ai as active skill | 1 min | HIGH — LLM sees it in every prompt |
| Update web-ai description with triggers | 5 min | HIGH — keyword matching improves |
| Update browser description with disambiguation | 2 min | MEDIUM — prevents wrong routing |
| Add model→CLI mapping table to web-ai SKILL.md | 10 min | HIGH — LLM can construct correct commands |
| Update agbrowse bundled web-ai SKILL.md | 5 min | MEDIUM — consistency |
