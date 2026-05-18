# Media Service Deep-Dive: Pika Labs & ElevenLabs

Sources: GitHub research, fal.ai docs, service pricing pages (May 19, 2026)

## Comparison Table

| Dimension | Pika Labs (Video) | ElevenLabs (Voice/TTS) |
|-----------|-------------------|----------------------|
| **Official API** | Limited — fal.ai hosts Pika 2.2 only | Full REST API + Python/TS SDKs |
| **Web-only features** | Pikaffects, lip sync (Pikaformance), sound FX, Pika 2.5 | Near-complete API parity |
| **CDP Value** | **HIGH** | **LOW** |
| **MCP Server** | None | Official: elevenlabs/elevenlabs-mcp |
| **Browser automation** | None found | Not needed |
| **Third-party API** | fal.ai (Pika 2.2 endpoints) | N/A — own infrastructure |
| **ToS on automation** | Standard "don't interfere" (no explicit bot ban) | Affiliate terms prohibit bots; API use sanctioned |

## Pika Labs — HIGH CDP Value

### Why CDP Matters

Pika's fal.ai integration only exposes **Pika 2.2** endpoints:
- `fal-ai/pika/v2.2/text-to-video`
- `fal-ai/pika/v2.2/image-to-video`
- `fal-ai/pika/v2.2/pikaframes`

**Web-exclusive features (no API path):**
- Pika 2.5 (latest model — NOT on fal.ai)
- Pikaffects (visual effects)
- Pikaformance (lip sync)
- Sound FX generation
- Advanced editing tools

### Pricing

| Tier | Cost | Credits/mo | Per 10s 1080p clip |
|------|------|-----------|-------------------|
| Free | $0 | 80 | ~80 credits |
| Standard | $10/mo | 700 | ~8 clips |
| Pro | $35/mo | 2,300 | ~28 clips |
| Fancy | $95/mo | 6,000 | ~75 clips |
| fal.ai API | Pay-per-use | — | $0.20-0.40/video |

### CDP Automation Workflow

```
1. Navigate to pika.art, auth (cookie/session)
2. Select model (2.5 vs 2.2)
3. Upload reference image (optional)
4. Enter prompt, set duration/ratio
5. Submit → wait for queue + generation (30s-3min)
6. Poll for completion (DOM state or progress bar)
7. Download MP4 artifact
```

### Risk Assessment

- **ToS**: Moderate risk. No explicit bot prohibition found, but standard "don't interfere with service" clauses
- **Detection**: Unknown — Pika likely has basic bot detection
- **Stability**: Web UI may change without notice

## ElevenLabs — LOW CDP Value, Use API/MCP Instead

### Why CDP Is Unnecessary

ElevenLabs has near-complete API coverage:
- Text-to-speech (29+ languages, 100+ voices)
- Speech-to-text
- Voice cloning
- Sound effects generation
- Voice design
- Conversational agents

### Official MCP Server

`elevenlabs/elevenlabs-mcp` — covers TTS, voice clone, transcription. Multiple community forks with enhanced features.

### Pricing

| Tier | Cost | Credits/mo |
|------|------|-----------|
| Free | $0 | 10,000 |
| Starter | $5/mo | starter allotment |
| Creator | $11/mo | creator allotment |
| Pro | $99/mo | 100 credits |
| Scale | $330/mo | 660 credits |

API prices recently cut ~55%.

### Recommendation

Use official MCP server + API directly. Browser automation adds complexity with zero feature unlock.

## Updated Media Service Priority Matrix

Incorporating all research (docs 06, 07, 08, 12):

| Priority | Service | CDP Value | API Status | Recommended Path |
|----------|---------|-----------|-----------|-----------------|
| **1** | Midjourney | VERY HIGH | NO API (enterprise only) | CDP (Discord web or midjourney.com) |
| **2** | Suno | VERY HIGH | NO API | CDP (suno.com) |
| **3** | Pika 2.5 | HIGH | Only 2.2 on fal.ai | CDP for 2.5 + web features |
| **4** | Udio | HIGH | NO API | CDP (udio.com) |
| **5** | Runway | MEDIUM | Full official API | API-first, CDP for web-only features |
| **6** | Lovable | MEDIUM | URL API only | CDP for full workflow |
| **7** | bolt.new | HIGH | NO API | CDP (or target bolt.diy) |
| **8** | Replit Agent | HIGH | NO API | CDP (complex SPA) |
| **9** | ElevenLabs | LOW | Full API + MCP | API/MCP only, skip CDP |
| **10** | v0.dev | LOW | Full SDK | SDK only, skip CDP |
