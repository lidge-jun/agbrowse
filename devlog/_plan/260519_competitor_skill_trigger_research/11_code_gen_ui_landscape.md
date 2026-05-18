# Code Generation Web UI — Browser Automation Landscape

Sources: GitHub research, web search (May 19, 2026)

## Comparison Table

| Feature | v0.dev (Vercel) | Replit Agent | Lovable | bolt.new |
|---------|----------------|-------------|---------|----------|
| **Public API** | YES — Platform API (beta) | NO | Partial ("Build with URL" only) | NO |
| **SDK/CLI** | YES — `v0-sdk` (TypeScript) | NO | NO | NO |
| **MCP Server** | YES — official Vercel MCP (OAuth) | Community (NOVA-3951/Replit-MCP) | YES — official `mcp.lovable.dev` (preview) | Consumes MCP only |
| **Existing automation** | None (SDK sufficient) | None | YES — `lovable-automation` (Playwright) | None |
| **CDP needed?** | NO — SDK covers full workflow | YES — no API at all | MOSTLY — URL API too limited | YES — no API at all |
| **OSS clone** | No | No | No | YES — bolt.diy (MIT, 19+ LLMs) |

## CDP Value Assessment

| Service | CDP Value | Reason |
|---------|-----------|--------|
| **bolt.new** | HIGH | Zero API, zero CLI, zero automation. Greenfield. |
| **Replit Agent** | HIGH | Zero Agent API. Complex SPA (terminal + editor + preview). |
| **Lovable** | MEDIUM | URL API limited; `lovable-automation` proves CDP feasibility |
| **v0.dev** | LOW | Official SDK covers prompt → code → deploy entirely |

## Common Workflow Pattern

All code-gen UIs follow the same core loop:

```
1. Auth → login/session inject
2. Prompt → locate textarea, submit text
3. Wait → LLM streams code (DOM mutations / WebSocket)
4. Preview → live render in iframe/WebContainer
5. Iterate → user sends follow-up prompts
6. Export → download ZIP / deploy to hosting
```

For CDP automation, steps 3-4 are the hardest:
- Streaming detection requires DOM mutation observer or network idle detection
- Preview iframes (especially WebContainer in bolt.new) are separate execution contexts
- File tree extraction in Replit requires navigating a complex SPA

## Per-Service Detail

### v0.dev — SDK Available, CDP Unnecessary

The `v0-sdk` exposes:
- `POST /v1/chats` — create generation
- `POST /v1/chats/{chatId}/messages` — iterate
- Project and deployment endpoints

Complete prompt-to-deploy pipeline without browser. **Skip for CDP automation.**

### Replit Agent — Highest CDP Complexity

No API for Agent invocations. Community forum explicitly requests "Create App from Prompt" API — nothing exists. Agent workflow:
1. Login (Google/GitHub OAuth in browser)
2. Navigate to Agent
3. Inject prompt into chat
4. Poll for completion (Agent scaffolds in workspace)
5. Extract code from workspace file tree (complex SPA with terminal, editor, preview panes)

**Hardest target.** Complex workspace SPA, potential bot detection.

### Lovable — CDP Feasible, Reference Exists

"Build with URL" API creates shareable link but no streaming output or code extraction. `lovable-automation` GitHub repo proves CDP feasibility using Playwright:
- Headless auth and remix flows
- Warns about fragile selectors and account restrictions

Official MCP server (research preview) may close the gap eventually.

### bolt.new — Pure CDP, Target bolt.diy Instead

No API, no CLI, no automation projects exist. WebContainer iframe adds complexity. **Recommend targeting bolt.diy** (self-hosted OSS clone) — no auth walls, could add HTTP API wrapper around Remix server.

## Recommendation for agbrowse

### Priority Order

1. **Skip v0.dev** — SDK sufficient, no CDP value
2. **bolt.new/bolt.diy** — highest opportunity (no competitors), recommend bolt.diy as target
3. **Lovable** — proven feasibility, medium difficulty
4. **Replit Agent** — highest complexity, defer unless high user demand

### Implementation Notes

- Code-gen UIs produce **code artifacts** (ZIP/repo), not text or media — a third output type alongside chat text and media files
- Workflow is **iterative** (multi-turn conversation with live preview), unlike one-shot media generation
- Could share session/tab infrastructure with chat providers but needs its own extraction logic

### Proposed CLI Shape

```bash
agbrowse codegen --vendor bolt --prompt "Build a todo app with React" --output ./todo-app/
agbrowse codegen --vendor lovable --prompt "Create a landing page" --output ./landing/
agbrowse codegen --vendor replit --prompt "Python Flask API with auth" --output ./flask-api/
```

Or under the existing command namespace:
```bash
agbrowse web-ai query --vendor bolt --prompt "Build a todo app" --output ./todo-app/ --json
```

The output would be a directory/ZIP rather than text or media file.
