---
created: 2026-05-05
tags: [agbrowse, cli, web-ai, command-surface]
aliases: [agbrowse commands, agbrowse CLI 표면, web-ai commands]
---

# agbrowse Command Surface

`agbrowse`의 command surface는 두 층으로 나뉜다. root command는 Chrome과 일반 브라우저 primitive를 다룬다. `web-ai` subcommand는 ChatGPT, Gemini, Grok 웹 UI를 provider workflow로 다룬다. 이 구분을 유지해야 agent가 관찰, 행동, 검증 순서를 잃지 않는다.

명령어를 사용할 때 기본 루프는 항상 같다. 먼저 `status`, `tabs`, `snapshot`으로 현재 상태를 본다. 그 다음 `click`, `type`, `press`, `web-ai send`처럼 필요한 최소 mutation만 실행한다. 마지막으로 다시 `snapshot`, `poll`, `console`, `network`, `trace`로 결과를 확인한다.

새 command를 추가할 때는 help text만 바꾸지 않는다. parser, README, skill docs, test, structure 문서를 같이 맞춘다. `cli-jaw` mirror가 필요한 경우에는 root CLI 이름보다 결과 JSON shape와 failure envelope를 우선 맞춘다.

---

## Root CLI Commands

| 그룹 | 명령 | 역할 |
| --- | --- | --- |
| Skill installation | `skills`, `skills list`, `skills get`, `skills path`, `skills install`, `install-skills` | bundled agent skill 조회와 설치 |
| Lifecycle | `start`, `stop`, `status`, `reset` | Chrome CDP lifecycle |
| Observe | `snapshot`, `screenshot`, `text`, `get-dom` | DOM/ref/text/screenshot 관찰 |
| Act | `click`, `type`, `press`, `hover`, `select`, `check`, `uncheck`, `drag`, `mouse-click`, `move-mouse`, `mouse-down`, `mouse-up` | ref 기반 또는 coordinate 기반 mutation |
| Navigate | `navigate`, `reload`, `resize`, `tabs`, `tab-switch`, `select-tab`, `new-tab`, `tab-close`, `tab-cleanup`, `scroll` | navigation, viewport, tab 관리 (multi-tab create/close 포함) |
| Wait | `wait`, `wait-for-selector`, `wait-for-text`, `wait-for` | time, selector, text, legacy ref wait |
| Diagnostics | `console`, `network`, `evaluate` | console/network capture와 explicit unsafe JS evaluation |
| Web AI | `web-ai` | provider workflow subcommand |

## Web-AI Commands

| 명령 | Browser 필요 | 역할 |
| --- | ---: | --- |
| `render` | No | prompt envelope만 렌더링 |
| `status` | Yes | active provider tab과 composer 상태 확인 |
| `send` | Yes | prompt 제출 후 `sessionId` 반환 |
| `poll` | Yes | session 또는 latest baseline completion 대기 |
| `query` | Yes | `send`와 `poll`을 한 번에 실행 |
| `stop` | Yes | active provider tab에 Escape 전송 |
| `watch` | Yes | persisted session을 terminal 상태까지 감시 |
| `snapshot` | Yes | active provider tab의 compact accessibility snapshot 출력 |
| `observe-bundle` | Yes | URL/title/viewport/DPR/refs/boxes/screenshot/text를 묶은 ObservationBundleV1 출력 (G06) |
| `observe-actions` | Yes | snapshot을 캡처해 instruction-aware ActionCandidate 랭킹 반환 (G02) |
| `sessions list` | No | persisted session 목록 |
| `sessions show` | No | session 상세 |
| `sessions resume` | Yes | session poll resume |
| `sessions reattach` | Yes | session과 tab 다시 연결 |
| `sessions prune` | No | 오래된 session 정리 |
| `context-dry-run` | No | context package 생성 결과 미리보기 |
| `context-render` | No | prompt와 context package 전체 렌더링 |
| `mcp-server` | No at startup | stdio JSON-RPC MCP bridge 실행 |
| `eval` | No | offline provider DOM fixture eval 실행 |
| `doctor` | Yes | provider diagnostics와 semantic target 후보 출력 |

## Provider Alias

| Provider | Model alias | 비고 |
| --- | --- | --- |
| ChatGPT | `instant`, `thinking`, `pro` | `--effort`는 `--model`과 함께 사용 |
| Gemini | `fast`, `thinking`, `pro`, `deepthink` | `deepthink`는 tool alias로 취급 |
| Grok | `auto`, `fast`, `expert`, `thinking`, `heavy` | source-audit 연구 흐름은 `expert`나 `heavy`를 우선 사용 |

## Failure Envelope

JSON 모드에서는 실패가 parseable envelope로 나온다. 이 shape는 MCP와 cli-jaw mirror에서 가장 중요한 호환 표면이다.

```json
{
  "ok": false,
  "status": "error",
  "error": {
    "name": "WebAiError",
    "errorCode": "provider.composer-not-visible",
    "stage": "composer",
    "message": "composer is not visible",
    "retryHint": "run-status-or-login",
    "mutationAllowed": false,
    "selectorsTried": [],
    "evidence": {}
  }
}
```

## Drift 검사 기준

`structure/check-doc-drift.sh`는 이 문서에 아래 command token이 남아 있는지 검사한다.

| 표면 | 기준 |
| --- | --- |
| Root CLI | `skills/browser/browser.mjs` help에 공개된 command token |
| Web-AI | `web-ai/cli.mjs`의 `COMMANDS` set과 `sessions` subcommand |
| Package | `package.json`의 `files`에 `structure/` 포함 |
| README | `README.md`에 `structure/INDEX.md` 안내 포함 |

## MCP Tools

| Tool | 역할 |
| --- | --- |
| `browser_snapshot` | active tab의 compact accessibility snapshot과 `@eN` refs 반환 |
| `browser_click_ref` | latest generic browser snapshot ref 클릭 |
| `web_ai_snapshot` | compact accessibility snapshot과 `@eN` refs 반환 |
| `web_ai_click_ref` | latest snapshot ref 클릭 |
| `web_ai_submit_prompt` | provider web UI에 prompt 제출 |
| `web_ai_wait_response` | provider response completion 대기 |
| `web_ai_copy_markdown` | 마지막 response를 markdown/text로 capture |
| `web_ai_doctor` | provider diagnostics와 repair packet 반환 |
| `web_ai_session_resume` | stored session poll resume |

## MCP-ready vs CLI-ready Matrix (G04)

`browser_*` MCP tools 외의 기능은 항상 CLI를 통해 노출된다. MCP에서는 의도적으로 좁힌 surface만 등록한다. 등록되지 않은 tool은 `tools/call` 시 deterministic `capability.unsupported` envelope를 반환하므로 probe-safe하다. 자세한 deferral 사유는 [`structure/mcp_scope.md`](mcp_scope.md) 참고.

| Capability | MCP | CLI | Notes |
| --- | --- | --- | --- |
| Snapshot active tab | `browser_snapshot` ✅ | `agbrowse snapshot --interactive` ✅ | parity |
| Click snapshot ref | `browser_click_ref` ✅ | `agbrowse click <ref>` ✅ | parity |
| Type into ref | ❌ deferred | `agbrowse type <ref> --text "..."` ✅ | MCP planned, CLI today |
| Navigate URL | ❌ deferred | `agbrowse navigate <url>` ✅ | MCP duplicate adds attack surface; defer |
| History back/forward/reload | ❌ deferred | `agbrowse back` / `forward` / `reload` ✅ | CLI today |
| Wait for ref/text | ❌ deferred | `agbrowse wait-for <ref-or-text>` ✅ | MCP wait policy not finalized |
| Screenshot | ❌ deferred | `agbrowse screenshot --out <path>` ✅ | MCP planned with policy gating |
| Extract visible text | ❌ deferred | covered by `browser_snapshot` interactive output | use snapshot ref text |

## ObservationBundleV1 Schema (G06)

`agbrowse observe-bundle [--screenshot] [--boxes] [--json] [--max-text-chars N]`은 한 번의 호출로 URL, title, viewport, DPR, snapshot refs, optional bounding boxes, optional screenshot path, body innerText 요약을 단일 record로 묶는다. Vercel agent-browser/Playwright MCP `browser_observe`/VisualWebArena 류 multimodal 벤치가 요구하는 reproducible observation step을 만족시킨다.

```json
{
  "schemaVersion": "observation-bundle-v1",
  "url": "https://example.com/",
  "title": "Example",
  "viewport": { "width": 1280, "height": 800 },
  "dpr": 2,
  "capturedAt": "2026-05-06T13:00:00.000Z",
  "refs": [
    { "ref": "@e1", "role": "button", "name": "Sign in", "depth": 2,
      "box": { "x": 100, "y": 400, "width": 80, "height": 32 } }
  ],
  "screenshot": "/tmp/screenshot.png",
  "textSummary": "Sign in to Example...",
  "stats": { "refCount": 1, "boxCount": 1, "textChars": 23, "hasScreenshot": true }
}
```

`screenshot`/`boxes`는 명시적 flag로만 캡처되어 token/IO 비용을 통제한다. Box 캡처 실패는 best-effort로 swallowed된다 (해당 ref만 `box` 필드 없음). `textSummary`는 기본 2000자, `--max-text-chars`로 조정 가능. Pure builder는 `web-ai/observation-bundle.mjs`이며 이미 캡처된 입력만 받기 때문에 오프라인 fixture 테스트가 가능하다 (`gate:observation-bundle-fixtures`).

## ActionCandidate Schema (G02)

`agbrowse observe-actions <instruction> [--json] [--top-n N] [--include-disabled]`은 현재 active tab의 snapshot을 캡처하고 instruction과의 token overlap·role bucket·risk heuristic을 합쳐 ranked `ActionCandidate[]`를 반환한다. 외부 Vercel agent-browser/Browserbase의 `observeActions` 류 API와 같은 위치를 차지한다.

```json
{
  "snapshotId": "snap-abc123",
  "url": "https://example.com/login",
  "instruction": "click sign in",
  "candidates": [
    {
      "ref": "@e5",
      "role": "button",
      "name": "Sign in",
      "action": "click",
      "method": "browser_click_ref",
      "args": { "snapshotId": "snap-abc123", "ref": "@e5" },
      "confidence": 0.86,
      "signals": ["role-bucket:click", "instruction-overlap:sign,in"],
      "riskFlags": []
    }
  ]
}
```

`method`는 항상 frozen MCP surface의 tool 이름 또는 CLI primitive (`type`/`select`/`check`)이다. `confidence`는 `[0,1]` 범위, `riskFlags`는 `destructive`, `crossOrigin`, `requiresAuth`, `fileUpload` 중 부분집합이다. Disabled 후보는 기본적으로 제외하고, `--include-disabled` 또는 `includeDisabled: true`로만 노출된다. snapshot은 `interactive` 모드로 캡처되어 token budget을 절약한다.

## 변경 기록

- 2026-05-06: G06 — `agbrowse observe-bundle`과 ObservationBundleV1 스키마를 추가했다. URL/title/viewport/DPR/refs/boxes/screenshot/text를 한 번에 묶어 multimodal benchmark step 재현성을 확보한다 (`gate:observation-bundle-fixtures`).
- 2026-05-06: G02 — `agbrowse observe-actions <instruction>` CLI 추가. Pure `buildObserveActions(snapshot, instruction, opts)` API가 ranked `ActionCandidate[]`를 반환한다 (`gate:observe-actions-fixtures`).
- 2026-05-06: G04 — MCP-ready vs CLI-ready matrix와 deferred-tool envelope 동작을 commands.md에 명시했다 (`structure/mcp_scope.md` 결정 기록과 `gate:mcp-deferred-metadata` 게이트 동기).
- 2026-05-06: Phase 9.1 multi-tab의 `new-tab`, `tab-close` 명령을 root command 표에 추가해 README와 일치시켰다.
- 2026-05-05: root CLI, web-ai, MCP tool, provider alias, failure envelope, drift 검사 기준을 source-of-truth 문서로 추가했다.
