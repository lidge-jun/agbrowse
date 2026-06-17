---
name: vision-click
description: "Vision-based coordinate click: screenshot → Codex CLI (NDJSON) → DPR correction → mouse click. Codex CLI only. Triggers: vision click, 비전 클릭, coordinate click, 좌표 클릭, screenshot click, non-DOM click, agbrowse-vision-click. NOT for: regular DOM clicks (use browser skill), desktop app clicks (use desktop-control)."
---

# Vision Click (Codex CLI)

Click non-DOM elements by screenshot analysis using Codex CLI.

## Quick Start

```bash
agbrowse-vision-click "Submit button"
agbrowse-vision-click "Play icon" --double
agbrowse-vision-click "first search result row" --prepare-stable --region left-panel --verify-before-click
```

## Prerequisites

- **agbrowse** running Chrome (`agbrowse start`)
- **Codex CLI** installed (`npm install -g @openai/codex`)

## When to Use

Use when `agbrowse snapshot` returns **NO ref** for target:
- Canvas elements, cross-origin iframes, Shadow DOM
- Dynamically rendered content (WebGL, SVG)
- Elements behind overlays or custom web components

> **Always try `snapshot --interactive` first.** Only fall back to vision-click if no usable ref exists.

## Pipeline

```
1. agbrowse snapshot --interactive  → Check if target has a ref ID
2. If ref exists → agbrowse click <ref>  (normal path, preferred)
3. If NO ref → vision-click fallback:
   a. agbrowse screenshot --json     → { path, dpr, viewport }
   b. optional stable viewport / clip   → more deterministic framing
   c. codex exec -i <path> --json       → NDJSON events → vision bbox candidate
   d. optional verify crop              → second-pass confirmation near center
   e. DPR correction + clip origin      → CSS pixels
   f. agbrowse mouse-click <x> <y>   → click
   g. agbrowse snapshot              → verify
```

## How It Works

`codex exec --json` emits NDJSON (newline-delimited JSON) events:

```jsonl
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"type":"agent_message","text":"{\"found\":true,\"bbox\":{\"x\":500,\"y\":70,\"width\":44,\"height\":24},\"point\":{\"x\":522,\"y\":82},\"confidence\":0.88,\"description\":\"search button\"}"}}
{"type":"turn.completed","usage":{"input_tokens":16964,"output_tokens":542}}
```

The vision candidate JSON is extracted from the `item.completed` event's `item.text` field. Legacy `{found,x,y}` point-only JSON is still parsed, but it is marked lower confidence and must be verified before click.

## Examples

```bash
# Basic click
agbrowse-vision-click "Login button"

# Double-click
agbrowse-vision-click "Canvas play icon" --double

# Custom CDP port
agbrowse-vision-click "Submit" --port 9333

# Custom browser script path
agbrowse-vision-click "Menu" --browser-script /path/to/browser.mjs

# Accuracy-first mode for dense UIs
agbrowse-vision-click "first search result row" --prepare-stable --region left-panel --verify-before-click

# Reconcile a vision bbox against refs from observe-bundle
agbrowse observe-bundle --screenshot --boxes --json > /tmp/bundle.json
agbrowse-vision-click "Submit button" --bundle /tmp/bundle.json --verify-before-click

# Manual clip when you know the rough area
agbrowse-vision-click "zoom button" --clip 980 120 220 220
```

## Accuracy Tips

- Start with `--prepare-stable` to normalize the viewport before capture.
- Use `--region left-panel` for search result panels and `--region center-map` for map canvas targets.
- Use `--verify-before-click` on dense UIs where a wrong click is expensive.
- If you already know the rough target area, `--clip x y w h` is more reliable than full-screen analysis.
- Candidates below confidence `0.75` fail closed unless verification is explicitly requested.
- Prefer `agbrowse click <ref>` whenever `snapshot --interactive` exposes a usable ref; coordinate click remains the last fallback.

## Environment Variables

| Variable           | Default                  | Description          |
| ------------------ | ------------------------ | -------------------- |
| `BROWSER_SCRIPT`   | `../browser/browser.mjs` | Path to browser.mjs  |
| `CDP_PORT`         | `9222`                   | Chrome CDP port      |

## DPR (Device Pixel Ratio) Correction

Retina displays (DPR=2) produce screenshots at 2x resolution.
Codex returns coordinates in image pixel space.
`vision-click` auto-divides by DPR before passing to `mouse-click`.

```
raw: (600, 200)  DPR=2  →  css: (300, 100)  →  mouse-click 300 100
```

## Limitations

- Requires codex CLI (GPT vision) — no other providers
- Latency: 3-10 seconds per call (model inference)
- English target descriptions work best; Korean can fail on some elements
- Complex dense UIs may need `--region`, `--clip`, or `--verify-before-click`
