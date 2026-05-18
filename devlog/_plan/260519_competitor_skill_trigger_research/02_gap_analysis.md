# Gap Analysis — agbrowse Differentiation

## Capabilities That Are No Longer Unique

| Capability | Who Has It |
|------------|-----------|
| Multi-vendor AI web UI automation | 10x-chat (6 providers), Agentify (6), conduit-bridge (4), WebModel (10+) |
| Model/mode selection | 10x-chat, conduit-bridge, chatgpt-automation-mcp, ChatGPTAutomation |
| Session persistence | 10x-chat, Agentify, conduit-bridge, OpenClaw bridge |
| Context packaging | 10x-chat (bundle.md), Agentify (repo/file context) |
| MCP wrapping | Agentify, Proxima, chatgpt-automation-mcp, Playwright MCP, Hanzi Browse |
| OpenAI-compatible proxying | conduit-bridge, CatGPT-Gateway, openAdapter, Proxima, WebModel, Chat Relay |

## Gaps Where agbrowse STILL Differentiates

### 1. CDP-Attach-First + CLI-First
- WebModel and Agentify have CDP-adjacent functionality but are shaped as API/dashboard/MCP/desktop tools
- 10x-chat and conduit-bridge are CLI/API-oriented but Playwright/persistent-profile based (launch new browser contexts)
- **agbrowse uniquely**: attaches to already-running user Chrome, keeps browser state human-visible, exposes deterministic CLI
- **Why it matters**: no launch overhead, user stays logged in, human can see and intervene

### 2. Normalized Effort Control Across Providers
- Competitors expose model strings or provider-specific modes
- No public tool documents a unified abstraction like `--effort low/standard/extended/heavy` mapped across ChatGPT reasoning modes, Gemini Deep Think, and Grok Heavy
- conduit-bridge and 10x-chat are close but emphasize model names, not a normalized effort layer
- **agbrowse uniquely**: `--model pro --effort extended` works identically for ChatGPT

### 3. Robust Extraction Fallback Chain
- openAdapter converts Claude HTML to Markdown; 10x-chat stores response.md
- No public tool clearly documents: DOM extraction → provider copy button → copy-markdown fallback → clipboard verification
- **agbrowse uniquely**: `--allow-copy-markdown-fallback` with `capturedBy: dom-fallback/copy-button` evidence

### 4. Provider-Conversation Resume (not just profile persistence)
- Many tools persist browser profiles or stable tabs
- Fewer promise resuming a named prior conversation with original context bundle, transcript metadata, model/effort settings, and extraction state
- Agentify's stable tab keys and 10x-chat's session artifacts are closest
- **agbrowse uniquely**: `--session $SID` with tab rebinding, conversationUrl recovery, and session store

### 5. Context Packaging Optimized for Web UI Constraints
- 10x-chat and Agentify package files
- agbrowse differentiates with token/window budgeting, provider upload limits, paste-vs-file decisions, chunk manifests, reproducible prompt bundles, context-dry-run
- **agbrowse uniquely**: `context-dry-run --json` before mutation, `--context-transport upload/inline` choice

### 6. Prompt/Content Boundary Hardening
- Competitors don't emphasize treating web page text, provider output, and attached context as untrusted
- agbrowse's `policy/enforce.mjs` and untrusted-content handling is a meaningful security differentiator
- GPT Pro noted this as unique product/security positioning

### 7. Grok-Specific Depth
- Grok confirmed: "No widespread Grok-specific browser proxies found"
- grok-bridge (Safari/AppleScript) and grok-scraper (Playwright) exist but are narrow
- agbrowse has full Grok model selection (auto/fast/expert/grok-4.3/heavy) with dedicated selectors

## What agbrowse Should Learn From Competitors

| Competitor | Lesson |
|-----------|--------|
| 10x-chat | File/glob context with bundle.md artifacts is user-friendly; study their session artifact format |
| Agentify Desktop | MCP surface for coding agent integration is increasingly expected |
| conduit-bridge | OpenAI-compatible streaming proxy is a strong distribution channel |
| CatGPT-Gateway | Tool calling emulation via web UI is ambitious and in-demand |
| browser-use | Cloud stealth option and self-healing harness patterns |
| Playwright MCP | Accessibility-tree snapshots are more token-efficient than screenshots |
| HARPA AI | 100+ automation commands shows demand for page-aware AI orchestration |
| AIstudioProxyAPI | Camoufox anti-fingerprint technique for anti-bot sites |

## Competitive Positioning Statement

agbrowse should NOT claim the category is empty. The competitive wedge is:

> **CDP-native reliability + deterministic provider adapters + normalized effort/model controls + resumable sessions + context packaging + copy-markdown extraction** — in one CLI tool, for one user's existing browser.

The moat is not "multi-vendor" (others do that). The moat is "attaches to YOUR browser, controls EXACTLY the model/effort you specify, resumes YOUR conversation, extracts YOUR response reliably."
