# Architecture Decision: Runway Integration vs Separation

## The Question

Should Runway ML (and other media services) be:
- **A)** A new vendor inside agbrowse (`--vendor runway`)
- **B)** A separate project (e.g. `agbrowse-media` or `agmedia`)

## Analysis

### Current agbrowse Shape

```
User → agbrowse web-ai query --vendor chatgpt --model pro --prompt "..."
     → send text prompt → poll for text response → extract markdown
     → return: { answerText, sessionId, conversationUrl }
```

### Runway Shape

```
User → agbrowse ??? --vendor runway --prompt "a cat walking" --output video.mp4
     → submit prompt + optional image → wait 30s-3min (queue-based) → download MP4
     → return: { outputFile, jobId, duration, resolution }
```

### Key Differences

| Dimension | Chat (current) | Media (proposed) |
|-----------|---------------|-----------------|
| **Input** | Text prompt (+ optional file) | Text prompt + image/video seed |
| **Output** | Text/markdown | Binary file (MP4/MP3/PNG) |
| **Wait time** | 10s–20min (streaming partial) | 30s–10min (no streaming, queue-based) |
| **Polling** | DOM text mutation | DOM state change + network sniff for artifact URL |
| **Extraction** | DOM text / copy-markdown | Download URL → file download |
| **Session resume** | Re-enter conversation | Re-check job status |
| **Model selection** | Dropdown/pill in UI | Model/style in UI |
| **Error modes** | Rate limit, content policy | Queue full, credit exhaustion, CAPTCHA |

### Shared Infrastructure (argument for A)

| Component | Reusable? |
|-----------|-----------|
| Chrome CDP connection | YES — identical |
| Tab pool & lifecycle | YES — identical |
| Session store | PARTIAL — different fields but same pattern |
| Login persistence (Chrome profile) | YES — identical |
| Tab recovery | YES — identical |
| File upload | YES — identical primitives |
| Screenshot/snapshot | YES — identical |

### Different Abstractions (argument for B)

| Component | Different? |
|-----------|-----------|
| Response extraction | YES — binary download vs text scrape |
| Polling semantics | YES — job queue vs streaming text |
| Output format | YES — file path vs markdown string |
| Model selection UI | YES — different UI patterns per service |
| Progress tracking | YES — % progress vs token count |
| Batch operations | YES — generate N variations vs follow-up turns |

## GPT Pro Architecture Analysis (Full)

GPT Pro independently reached a similar conclusion but pushed further on abstraction boundaries.

### Core Insight: "The boundary should not be vendor. The boundary should be generation mode."

Two distinct domain contracts proposed:

```typescript
// 1. Text/chat generation (ChatGPT, Gemini, Grok)
interface TextProvider {
  submitMessage(input: TextPromptInput): Promise<TextRunHandle>;
  waitForResponse(handle: TextRunHandle): Promise<TextResult>;
}

// 2. Media generation (Runway, Midjourney, Suno, Udio)
interface MediaProvider {
  submitJob(input: MediaJobInput): Promise<MediaJobHandle>;
  getJobStatus(handle: MediaJobHandle): Promise<MediaJobStatus>;
  downloadOutputs(handle: MediaJobHandle, outputSpec: OutputSpec): Promise<MediaResult>;
  cancelJob?(handle: MediaJobHandle): Promise<void>;
}
```

### Shared BrowserPlatform Layer

```typescript
interface BrowserPlatform {
  getSession(provider: string): Promise<Session>;
  acquireTab(provider: string): Promise<Tab>;
  uploadFile(tab: Tab, path: string): Promise<void>;
  waitForDomState(tab: Tab, spec: WaitSpec): Promise<void>;
  click(tab: Tab, selector: SelectorSpec): Promise<void>;
  download(tab: Tab, spec: DownloadSpec): Promise<DownloadedFile>;
  recoverTab(tab: Tab): Promise<Tab>;
}
```

### Why NOT `--vendor runway`

GPT Pro explicitly warns against overloading web-ai:

> "Putting Runway into the existing web-ai pattern creates short-term speed and long-term drag. You will start with special cases: `if vendor == runway: output is file`, `if vendor == runway: wait longer`, `if vendor == runway: poll queue`... Those exceptions will become the real abstraction."

### Runway: API-First, CDP-Second

For Runway specifically, GPT Pro recommends dual providers:
- `RunwayApiMediaProvider` — when user has `RUNWAYML_API_SECRET`
- `RunwayWebMediaProvider` — CDP fallback for web-only workflows

Runway's official API covers: image-to-video, text-to-video, task management, uploads, organization/usage. Output URLs are **ephemeral** — must download immediately.

### Provider Capability Metadata

```typescript
type ProviderCapabilities = {
  supportsApi: boolean;
  supportsCdp: boolean;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsAudio: boolean;
  supportsResume: boolean;
  requiresLogin: boolean;
  automationAllowed: boolean | "unknown";
  tosStatus: "allowed" | "restricted" | "prohibited" | "unknown";
};
```

### ToS Compliance Gate (UPDATED per GPT Pro R5 audit)

> **`automationAllowed` and `tosStatus` must be hard gates, not just metadata.**

- Providers with `tosStatus: "prohibited"` must require explicit CLI consent (`--accept-tos-risk`) before any automation
- Do NOT frame mitigation as "reduces detection" — that is evasion, not compliance
- Add to MediaJobStatus: credit preflight, CAPTCHA/manual-intervention states, artifact URL expiry handling, multi-output downloads, crash-resume, and content-policy refusal states

**Midjourney**: `tosStatus: "prohibited"` — terms explicitly prohibit automated tools
**Udio**: `tosStatus: "unknown"` — no public API, no explicit prohibition found
**Suno**: `tosStatus: "unknown"` — no official automation policy
**Runway**: `tosStatus: "allowed"` — has official API + MCP server
**Pika**: `tosStatus: "unknown"` — fal.ai API exists for 2.2, web-only for 2.5
**ElevenLabs**: `tosStatus: "allowed"` — official API + MCP

## Recommendation: **Hybrid — Integrate with Separate Command Namespace**

Neither pure integration nor pure separation. Instead:

### Proposed Architecture (Refined with GPT Pro input)

```
# Layer 1: Shared BrowserPlatform (CDP attach, tab pool, session, login, recovery, download)

# Layer 2a: Chat domain
agbrowse chat --vendor chatgpt --model pro --prompt "..."
agbrowse chat --vendor gemini --model thinking --prompt "..."
agbrowse chat --vendor grok --model expert --prompt "..."

# Layer 2b: Media domain
agbrowse media video --vendor runway --prompt "..." --duration 5 --output video.mp4
agbrowse media image --vendor midjourney --prompt "..." --output image.png
agbrowse media audio --vendor suno --prompt "..." --output song.mp3

# Layer 2c: Job management (cross-domain)
agbrowse jobs list
agbrowse jobs watch $JOB_ID
agbrowse jobs download $JOB_ID --output ./
```

### Why Hybrid

1. **Same binary, same Chrome, same profile** — no reason to force users to install a separate tool
2. **Different command namespace** (`media` vs `web-ai`) — clearly signals different workflow shape
3. **Shared low-level CDP** — tab pool, session store, login, recovery are all reused
4. **Separate high-level abstraction** — `media generate` returns `{ outputFile, jobId }` not `{ answerText, sessionId }`
5. **Incremental adoption** — add `--vendor runway` first, then midjourney, suno etc.

### Implementation Order (by CDP value)

| Priority | Service | CDP Value | Why First |
|----------|---------|-----------|-----------|
| 1 | **Midjourney** | VERY HIGH | No API at all, highest demand |
| 2 | **Suno** | HIGH | No API, existing reverse-eng wrappers break often |
| 3 | **Runway** | MEDIUM | API exists but web UI has exclusive features |
| 4 | **Pika** | MEDIUM | Limited API |
| 5 | **bolt.new** | HIGH | But different category (code gen, not media) |

### Decision Framework for Future Services

Add to agbrowse when:
- The service has a web UI that accepts prompts
- CDP browser automation adds value (no API, or web-only features)
- The workflow shape is: submit → wait → extract artifact
- The service is popular enough that users would want CLI access

Keep separate when:
- The service requires fundamentally different runtime (e.g., Discord bot, not Chrome)
- The workflow shape is radically different (e.g., real-time collaboration, not async generation)
- The service is niche enough that bundling would bloat the package

### Concrete CLI Design

```bash
# Generate video with Runway
agbrowse media generate \
  --vendor runway \
  --prompt "A cat walking through a neon city" \
  --seed-image ./cat.png \
  --output ./cat-walking.mp4 \
  --json

# Generate image with Midjourney
agbrowse media generate \
  --vendor midjourney \
  --prompt "cyberpunk samurai, detailed, 4k" \
  --output ./samurai.png \
  --json

# Generate music with Suno
agbrowse media generate \
  --vendor suno \
  --prompt "upbeat electronic track about coding" \
  --output ./coding-song.mp3 \
  --json

# Check status of running job
agbrowse media status --session $JOB_ID --json

# Poll for completion
agbrowse media poll --session $JOB_ID --timeout 300 --json
```

Output envelope:
```json
{
  "ok": true,
  "vendor": "runway",
  "status": "complete",
  "sessionId": "...",
  "outputFile": "/absolute/path/to/video.mp4",
  "outputUrl": "https://...",
  "metadata": {
    "duration": "5s",
    "resolution": "1280x720",
    "model": "gen-4",
    "credits_used": 50
  }
}
```
