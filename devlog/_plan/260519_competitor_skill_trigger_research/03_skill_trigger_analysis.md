# Skill Trigger System Analysis — Current State

## How cli-jaw Skill Triggers Work

The skill system is **LLM-driven, not code-driven**:

1. Active skills (30 total) are listed in the system prompt with `name` + `description` fields
2. The description field contains `Triggers:` keyword lists for semantic matching
3. The LLM reads these hints and autonomously decides which skill to invoke
4. Skills are invoked via the `Skill` tool using exact skill name

There is NO hardcoded pattern matcher. The LLM is the router.

## Current Trigger Coverage

### browser skill (active)
```yaml
name: browser
description: "Chrome browser control: open pages, take ref snapshots, click, type, screenshot. Requires cli-jaw server running."
```
**Triggers**: None listed. The description is generic CDP/page-control language.
**Problem**: No mention of web-ai, ChatGPT, Gemini, Grok, model names, AI providers, or reasoning modes.

### web-ai skill (in skills_ref, NOT active)
```yaml
name: web-ai
description: "Structured browser web-ai workflow for ChatGPT, Gemini, and Grok in cli-jaw."
```
**Triggers**: None listed. Description mentions ChatGPT/Gemini/Grok but no model names.
**Problem**: Not in active skills set (30) — only in skills_ref (reference). User must explicitly invoke or install.

### agbrowse's web-ai skill (bundled with agbrowse, not cli-jaw)
```yaml
name: web-ai
description: "Standalone agbrowse web-ai workflow for ChatGPT, Gemini, and Grok with structured prompt envelopes, file/context uploads, model selection, polling, and opt-in copy-markdown fallback."
```
**Triggers**: None listed. Description is feature-oriented but has no keyword triggers.

## The Trigger Gap

When a user says any of these, the LLM has NO skill trigger signal:

| User Intent | Example | Should Route To |
|-------------|---------|-----------------|
| Use Grok Heavy | "grok heavy로 물어봐" | web-ai (grok --model heavy) |
| Use Gemini DeepThink | "gemini deepthink으로 분석해" | web-ai (gemini --model deepthink) |
| Use ChatGPT Pro | "GPT Pro한테 리뷰 받아" | web-ai (chatgpt --model pro) |
| Use ChatGPT Thinking | "thinking 모드로 물어봐" | web-ai (chatgpt --model thinking) |
| Use Grok Expert | "grok expert로 검증해" | web-ai (grok --model expert) |
| Ask AI web UI | "chatgpt한테 물어봐" | web-ai |
| Extended effort | "extended effort으로 분석" | web-ai (--effort extended) |

Currently these might route to:
- `browser` skill (if "browser" is mentioned nearby)
- No skill at all (if the LLM doesn't associate "grok heavy" with any skill)
- Direct CLI assistance (LLM may try to help construct the command without invoking the skill)

## How Other Skills Handle Triggers (Best Practice Examples)

```yaml
# hwp skill — gold standard trigger list
description: "HWP/HWPX create, read, edit, review, template-fill, QA. Triggers: 한글, .hwp, .hwpx, HWP, HWPX, Korean documents, 한컴오피스, OWPML."

# lecture-stt — comprehensive bilingual triggers
description: "Transcribe audio lectures... Triggers: 강의 전사, STT, lecture transcription, 오디오 전사, 강의 녹음, audio to text, lecture notes, 음성 변환, 녹음 텍스트, 전사해줘, transcribe, whisper"

# dev-scaffolding — action-oriented triggers
description: "...Triggers: scaffold, new project, new feature, init project, audit structure, scaffolding, add module, project setup."
```

Pattern: `Triggers:` followed by comma-separated keywords in the description field, covering:
- English terms
- Korean terms (사용자 언어)
- Abbreviations and aliases
- File extensions
- Action verbs

## Current Model Alias Inventory (from agbrowse source)

### ChatGPT (chatgpt-model.mjs)
- Models: `instant`, `fast`, `thinking`, `think`, `pro`, `gpt-5.3`, `gpt-5.5-thinking`, `gpt-5.5-pro`
- Efforts: `light`, `low`, `standard`, `normal`, `regular`, `default`, `extended`, `high`, `heavy`

### Gemini (gemini-model.mjs)
- Models: `fast`, `flash`, `gemini-fast`, `thinking`, `think`, `gemini-thinking`, `pro`, `gemini-pro`, `3.1-pro`
- Deep Think: `deepthink`, `deep-think`, `deep_think`, `deep think`, `gemini-deepthink`, `gemini-deep-think`

### Grok (grok-model.mjs)
- Models: `auto`, `automatic`, `fast`, `quick`, `expert`, `thinking`, `think`, `grok-4.3`, `grok43`, `grok-43`, `beta`, `heavy`
