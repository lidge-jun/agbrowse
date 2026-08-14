# 020 - Fix #88 pollWebAi timeout hang

## File Changes
- web-ai/chatgpt.mjs: wrap readAssistantMessages in AbortSignal.timeout
- web-ai/chatgpt-response-dom.mjs: add per-evaluate timeout
- test: regression test with never-resolving evaluate

## Accept: #88 closed, regression test passes
