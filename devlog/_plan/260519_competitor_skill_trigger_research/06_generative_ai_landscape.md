# Generative AI Services — Browser Automation Landscape

Source: Grok Expert (May 18, 2026), session 01KRYDW0N53PFSC5SVKAZR3P64 (polled after orphan recovery)

## Executive Summary

CDP browser automation is **highly practical** for services WITHOUT APIs (Midjourney, Suno, Udio) and for full end-to-end workflows. Most services now have APIs for core generation, but **web UIs frequently offer exclusive features** (iteration tools, visual previews, advanced editing, faster rollouts).

### CDP Value Tiers

| Tier | Services | Why |
|------|----------|-----|
| **HIGH** (no API / web-first) | Midjourney, Suno, Udio, bolt.new | No official API; browser is the only path |
| **MEDIUM** (API incomplete) | Pika, Luma, Beautiful.ai, Tome, v0.dev, Replit Agent | APIs exist but web UI has exclusive features |
| **LOW** (full API) | Runway, Kling, Leonardo, ElevenLabs, HeyGen, Synthesia, D-ID | API covers most needs; CDP only for UI-specific polish |

## Service-by-Service Analysis

### 1. Video Generation (prompt → MP4, 30s–3min)

| Service | API Status | Web-Only Features | CDP Value | Gen Time |
|---------|-----------|-------------------|-----------|----------|
| **Runway ML** | Full API (Gen-3/4) | Real-time previews, Agent iteration | LOW | 30s–3min |
| **Pika Labs** | Limited (fal.ai only) | Effects, web-primary | MEDIUM | seconds–min |
| **Luma Dream Machine** | Official API | Agent/voice prompts | MEDIUM | 60–180s |
| **Kling AI** | Official API | Full web UI | LOW | ~3min |
| **Google Veo** | Via Vertex AI/Gemini API | Creative tools in Studio | MEDIUM | varies |
| **OpenAI Sora** | API until Sep 2026 | **DISCONTINUED** web Apr 2026 | DEAD | n/a |
| **Hailuo (Minimax)** | API-limited pattern | Kling-like | HIGH if API-limited | varies |

### 2. Image Generation (prompt → PNG/JPG, seconds–90s)

| Service | API Status | Web-Only Features | CDP Value |
|---------|-----------|-------------------|-----------|
| **Midjourney** | NO public API (enterprise only) | Variations/remix UI | **VERY HIGH** |
| **Ideogram** | Official API | Batch UI optimizations | LOW |
| **Leonardo AI** | Full API | Visual editor | LOW |
| **Flux/Freepik** | Official API | Full Flux context UI | LOW-MEDIUM |

### 3. Music Generation (prompt → MP3/WAV, 20s–3min)

| Service | API Status | Web-Only Features | CDP Value |
|---------|-----------|-------------------|-----------|
| **Suno** | NO official API | Everything is web-only | **VERY HIGH** |
| **Udio** | NO official API | Cookie-based reverse eng. common | **VERY HIGH** |

### 4. Voice/TTS (prompt → MP3/WAV, seconds)

| Service | API Status | Web-Only Features | CDP Value |
|---------|-----------|-------------------|-----------|
| **ElevenLabs** | Robust API | Advanced voice design/cloning | LOW |
| **Play.ht** | Official API/REST | Batch studio workflows | LOW-MEDIUM |

### 5. Code Generation Web UIs (prompt → code/apps)

| Service | API Status | Web-Only Features | CDP Value |
|---------|-----------|-------------------|-----------|
| **v0.dev** | Platform API beta | Full preview/export | MEDIUM |
| **bolt.new** | NO public API | Full-stack edit/run/deploy | **HIGH** |
| **Replit Agent** | Partial APIs | Agent web-centric | MEDIUM |

### 6. Presentation/Docs (prompt → PDF/decks)

| Service | API Status | CDP Value |
|---------|-----------|-----------|
| **Gamma.app** | Official API | LOW |
| **Beautiful.ai** | Limited/not prominent | MEDIUM |
| **Tome** | Unclear/limited | MEDIUM |

### 7. Avatar/Video (prompt → MP4 talking heads)

| Service | API Status | CDP Value |
|---------|-----------|-----------|
| **HeyGen** | Official API | LOW (unless enterprise web-only) |
| **Synthesia** | Official API | LOW |
| **D-ID** | Official API | LOW |

## Architectural Pattern for Media Services

Current agbrowse text pattern: `send prompt → poll for text → extract markdown`

**Proposed media pattern** (from Grok):
1. **Submit** — DOM click/fill or network intercept
2. **Poll** — Three strategies:
   - DOM mutation observer for "complete" UI state
   - Network sniffing (WebSocket/XHR for job ID + artifact URL)
   - Periodic screenshot/hash check on preview area
3. **Extract** — Get src/href → CDP download (or base64 if inline) → return local file path/URL
4. **Extras** — Queue monitoring, credit check pre-submit, error/retry on CAPTCHA/queue, media format handlers (MP4/MP3/image)

## Priority Targets for agbrowse Expansion

### Tier 1: Highest CDP value (no API)
1. **Midjourney** — most demanded, heavy existing automation scene
2. **Suno** — music gen, no API, web-only
3. **Udio** — music gen, no API, web-only

### Tier 2: High CDP value (web-first)
4. **bolt.new** — code gen, no API, browser-native
5. **Pika Labs** — video, limited API

### Tier 3: Medium CDP value (API exists but web has extras)
6. **Runway ML** — video, full API but web has iteration tools
7. **Luma Dream Machine** — video
8. **v0.dev** — code gen
