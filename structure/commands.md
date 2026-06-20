---
created: 2026-05-05
tags: [agbrowse, cli, web-ai, command-surface]
aliases: [agbrowse commands, agbrowse CLI 표면, web-ai commands]
---

# agbrowse Command Surface

`agbrowse`의 command surface는 세 층으로 나뉜다. root command는 Chrome과 일반 브라우저 primitive를 다룬다. `web-ai` subcommand는 ChatGPT, Gemini, Grok 웹 UI를 provider workflow로 다룬다. `runway` subcommand는 Runway Apps/Custom media task-runner surface를 read-only preflight로 다룬다. 이 구분을 유지해야 agent가 관찰, 행동, 검증 순서를 잃지 않는다.

명령어를 사용할 때 기본 루프는 항상 같다. 먼저 `status`, `tabs`, `snapshot`으로 현재 상태를 본다. 그 다음 `click`, `type`, `press`, `web-ai send`처럼 필요한 최소 mutation만 실행한다. 마지막으로 다시 `snapshot`, `poll`, `console`, `network`, `trace`로 결과를 확인한다.

새 command를 추가할 때는 help text만 바꾸지 않는다. parser, README, skill docs, test, structure 문서를 같이 맞춘다. `cli-jaw` mirror가 필요한 경우에는 root CLI 이름보다 결과 JSON shape와 failure envelope를 우선 맞춘다.

---

## Root CLI Commands

| 그룹 | 명령 | 역할 |
| --- | --- | --- |
| Skill installation | `skills`, `skills list`, `skills get`, `skills path`, `skills install`, `install-skills` | bundled agent skill 조회와 설치 |
| Lifecycle | `start`, `stop`, `status`, `reset` | Chrome CDP lifecycle |
| Observe | `snapshot`, `screenshot`, `text`, `get-dom` | DOM/ref/text/screenshot 관찰 |
| URL read | `fetch` | candidate URL을 public endpoint, HTTP fetch, metadata, optional reader, browser render/network 후보로 읽음. Generic search 아님 |
| Research | `research`, `research plan`, `research normalize-results`, `research enrich-fetch`, `research browse-plan` | Korean/source-sensitive search plan 생성, provider search result URL-candidate 정규화, 원문 fetch evidence enrichment, browse escalation planning |
| Act | `click`, `type`, `press`, `hover`, `select`, `check`, `uncheck`, `drag`, `mouse-click`, `move-mouse`, `mouse-down`, `mouse-up` | ref 기반 또는 coordinate 기반 mutation |
| Navigate | `navigate`, `reload`, `resize`, `tabs`, `active-tab`, `tab-switch`, `select-tab`, `new-tab`, `tab-close`, `tab-cleanup`, `scroll` | navigation, viewport, active target 조회, tab 관리 (multi-tab create/close 포함) |
| Wait | `wait`, `wait-for-selector`, `wait-for-text`, `wait-for` | time, selector, text, legacy ref wait |
| Diagnostics | `console`, `network`, `evaluate` | console/network capture와 page JS evaluation |
| Web AI | `web-ai` | provider workflow subcommand |
| Runway | `runway` | Runway Apps/Custom selector contract, current-tab status, read-only preflight |

## Runway Commands

`agbrowse runway`는 Runway를 `web-ai`처럼 prompt-response provider로
취급하지 않는다. Apps/Custom/tools를 media task-runner surface로 보고,
selector/status/preflight와 queue/completion poll을 제공한다.

| 명령 | Browser 필요 | 역할 |
| --- | ---: | --- |
| `selectors` | No | 2026-05-21 selector capture 기반 static selector contract 출력 |
| `status` | Yes | 현재 Runway tab의 surface, quota hint, selector presence를 읽음 |
| `open` | Yes | Apps/Custom URL로 navigation 후 status inspect |
| `preflight` | Yes | `open` + `status` alias. Generation submit 없음 |
| `poll` | Yes | 현재 Runway tab의 active queue, right-rail `%` progress, queue gate toast, output count를 최대 `--timeout`까지 읽음 |

Safety contract:

- `Generate`, `Run all`, payment, destructive, submit-like controls는 클릭하지 않는다.
- 모델 smoke runner는 submit 후 `poll --timeout 600000 --interval 5000 --queue-limit 2`를 기본값으로 삼는다.
- `poll`은 `In queue`, `Generating`, `Processing`, `loading animation`, 오른쪽 rail의 `18 50%` 같은 percentage label을 active generation signal로 본다.
- Runway Unlimited smoke에서 active queue cap은 2개로 취급한다. 두 작업이 진행 중이면 `queue.full=true`일 수 있지만 `state=active`, `terminal=false`로 계속 poll한다.
- 세 번째 제출에서 Runway가 `You're on a roll` / `Please wait for your last generation` / `Credits Mode` gate를 보여줄 때만 `queue_full`/`queue-gate` terminal signal로 기록한다.
- 첫 구현 focus는 `apps`, `custom-tools`다.
- `agent`, `recents`, `workflow`, `characters`는 surface-only로 유지한다.

## Research Commands

`agbrowse research`는 검색 API 클라이언트가 아니라, 한국어 외부 정보
검색을 더 작은 URL 후보 탐색 문제로 바꾸는 offline planning surface다.
검색 결과 snippet을 정답으로 보지 않고, fetch/browser 검증으로 넘길 수
있는 candidate URL envelope를 만든다.

| 명령 | Browser 필요 | 역할 |
| --- | ---: | --- |
| `plan --query <problem> [--max-queries N] [--json]` | No | 한국어 문제를 constraints, source hints, 1-3 focused queries, route URLs, fetch/browse policy로 분해 |
| `normalize-results --file <json> [--backend name] [--query query] [--json]` | No | Exa/Tavily/Perplexity/Brave/browser SERP형 rows를 `search-results-v1` URL candidates로 정규화 |
| `enrich-fetch --plan <json> --results <json> [--browser never\|auto\|required] [--max-results N] [--json]` | No by default | `search-results-v1` URL candidates를 adaptive fetch로 읽고 `research-fetch-enrichment-v1` ledger evidence로 보강 |
| `browse-plan --plan <json> --enrichment <json> [--max-actions N] [--json]` | No | `research-fetch-enrichment-v1`의 pending/weak candidates를 reasoned browser command plan으로 변환 |

Safety contract:

- `plan`과 `normalize-results`는 live search, fetch, browse를 실행하지 않는다.
- `enrich-fetch`는 live search를 실행하지 않고, 입력된 URL candidates만 fetch한다.
- `browse-plan`은 Chrome을 실행하거나 browser state를 mutate하지 않고,
  `agbrowse new-tab`, `snapshot`, `text`, `get-dom`, `network`, `scroll` command
  strings만 출력한다.
- Snippet/content fields는 diagnostics이고 final evidence가 아니다.
- `enrich-fetch`는 검색 query의 `constraintIds`를 증거로 승격하지 않는다.
  Ledger support는 fetched original-page text/title에서만 계산한다.
- Invalid/non-http URL rows는 `dropped`로 남겨야 하며 evidence로 승격하지 않는다.
- Fetch enrichment와 browse escalation은 P3/P4 command surface에서 별도
  reason과 함께 실행한다.

## Adaptive Fetch

`agbrowse fetch <url>`은 검색기가 아니라 URL reader다. Search tool이나
사용자가 이미 준 candidate URL 하나를 읽어서 JSON/human evidence를 반환한다.

| 옵션 | 역할 |
| --- | --- |
| `--json` | parseable result envelope 출력 |
| `--trace` | validation/public endpoint/fetch/reader/browser/network attempt 포함 |
| `--browser auto|never|required` | browser escalation policy |
| `--no-browser` | `--browser never` alias |
| `--browser-session none|isolated|existing|user|interactive` | browser session/cookie boundary |
| `--identity auto|minimal|chrome` | request identity headers |
| `--max-bytes N` | per-attempt response size limit |
| `--timeout-ms N` | per-attempt timeout |
| `--selector CSS` | browser text extraction selector |
| `--allow-third-party-reader` | Jina Reader 류 public reader를 명시 opt-in |
| `--no-public-endpoints` | known public endpoint resolver skip |
| `--allow-archive` | accepted but deferred; warning only |

`--json` 출력은 stdout-safe compaction boundary를 지난다. 큰 public endpoint
본문이 선택되면 `content`만 `contentLimitBytes`까지 줄이고,
`contentBytes`/`contentTruncated`로 원본 크기와 truncation 여부를 기록한다.
이는 output envelope 보호용이며, `--max-bytes`의 per-attempt read limit과
구분한다.

기본값은 non-browser fetch를 먼저 시도하고, 강한 결과가 없을 때만 browser
escalation을 고려한다. `existing` session과 third-party reader는 모두 명시
opt-in이다. `user` session은 사용자의 인증된 브라우저 세션을 명시적으로
사용하고, `interactive`는 human-in-the-loop challenge resolution을 추가한다.
`--identity chrome`과 `auto`는 동일하게 브라우저급 HTTP 헤더(User-Agent,
Sec-Fetch-*, Accept-Language 등)를 보내고, `minimal`은 Accept 헤더만 보낸다. CAPTCHA/login/paywall marker가 있어도 public endpoint, metadata,
non-browser, isolated browser, network candidate를 계속 시도할 수 있지만,
automated challenge solving, stealth, private credential 사용은 금지한다.

현재 known public endpoint resolver는 GitHub, Reddit, Hacker News, Wikipedia,
npm, PyPI, arXiv, Bluesky, Mastodon-compatible statuses, Stack Exchange,
dev.to, DOI/CrossRef, OpenLibrary, Wayback CDX, YouTube oEmbed, X/Twitter oEmbed, HN Algolia, V2EX, Lobsters, generic oEmbed discovery를 포함한다.

## Web-AI Commands

| 명령 | Browser 필요 | 역할 |
| --- | ---: | --- |
| `render` | No | prompt envelope만 렌더링 |
| `status` | Yes | active provider tab과 composer 상태 확인 |
| `send` | Yes | prompt 제출 후 `sessionId` 반환 |
| `poll` | Yes | session 또는 latest baseline completion 대기 |
| `query` | Yes | `send`와 `poll`을 한 번에 실행 |
| `code` | Yes | ChatGPT 전용. saved GPT dev-agent context zip을 첫 첨부로 자동 업로드 → strict code-mode 계약 prompt 전송 → 생성된 `/mnt/data/result.zip`을 버튼 없이 in-page presigned fetch로 회수·검증. 새 code artifact는 `PLAN.md` 또는 `00_plan.md`를 포함해야 한다. `--prompt` 빌드 명세, `--output-zip` 저장 경로, `--model thinking` 권장 |
| `code-extract` | Yes | ChatGPT 전용. 기존 ChatGPT conversation에서 새 prompt 없이 `/mnt/data/*.zip` artifact를 재회수한다. `--url`, `--conversation`, `--session`, 또는 현재 ChatGPT conversation tab을 selector로 쓰며, single zip은 `--output-zip`, multi zip은 `--multi-zip --output-dir`를 사용한다. |
| `stop` | Yes | active provider tab에 Escape 전송 |
| `watch` | Yes | persisted session을 terminal 상태까지 감시 |
| `snapshot` | Yes | active provider tab의 compact accessibility snapshot 출력 |
| `project-sources list/add` | list/add Yes, add `--dry-run` No | ChatGPT Project Sources append-only 관리. 명시적 `--chatgpt-url` 필요 |
| `observe-bundle` | Yes | URL/title/viewport/DPR/refs/boxes/screenshot/text를 묶은 ObservationBundleV1 출력 (G06) |
| `observe-actions` | Yes | snapshot을 캡처해 instruction-aware ActionCandidate 랭킹 반환 (G02) |
| `upload <ref> <file...>` | Yes | file input ref에 file을 set (Playwright `setInputFiles`, G03) |
| `sessions list` | No | persisted session 목록 |
| `sessions show` | No | session 상세. URL, model selection evidence, structured warnings, artifact descriptors를 human output에 표시 |
| `sessions resume` | Yes | 저장된 session target을 resolve/recover한 뒤 provider poll resume |
| `sessions reattach` | Yes | 저장된 targetId 기반으로 session과 tab 다시 연결; active tab을 truth로 쓰지 않음 |
| `sessions doctor` | Yes | session target/lock/active command/recovery recommendation 진단 |
| `sessions prune` | No | 오래된 session 정리 |
| `context-dry-run` | No | context package 생성 결과 미리보기 |
| `context-render` | No | prompt와 context package 전체 렌더링 |
| `mcp-server` | No at startup | stdio JSON-RPC MCP bridge 실행 |
| `eval` | No | offline provider DOM fixture eval 실행 |
| `doctor` | Yes | provider diagnostics와 semantic target 후보 출력 |
| `claim-audit` | No | repo docs의 hosted/cloud/stealth 등 금지 claim을 검사한다. release gate `gate:no-cloud-claims`와 같은 claim-audit 모듈을 사용하며 `--json`을 지원한다. |

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
| `web_ai_wait_response` | stored session response 대기; 긴 실행은 recoverable timeout으로 재시도 가능 |
| `web_ai_copy_markdown` | 마지막 response를 markdown/text로 capture |
| `web_ai_doctor` | provider diagnostics와 repair packet 반환 |
| `web_ai_session_resume` | stored session poll resume; session-bound recovery 경로 사용 |

`web_ai_*` 입력은 strict schema로 검증한다. Runtime에서 쓰는 호환 alias
(`vendor`, `policy`, submit의 `filePath`/`reasoningEffort` 등)만 명시적으로
허용하고, 오탈자/미등록 top-level field는 command 실행 전에 fail-fast한다.
Submit MCP는 `maxUploadFileSize`만 live upload cap으로 허용한다. Generated
image output, Deep Research, batch follow-ups, archive mutation, Project
Sources, context package fields는 이 release에서 CLI-only/deferred이며 MCP
tool description에도 그 제한을 명시한다.

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

`agbrowse observe-bundle [--screenshot] [--boxes] [--json] [--max-text-chars N]`은 한 번의 호출로 observation id, target id, URL, title, viewport, DPR, snapshot refs, optional bounding boxes, optional screenshot path, body innerText 요약을 단일 record로 묶는다. Vercel agent-browser/Playwright MCP `browser_observe`/VisualWebArena 류 multimodal 벤치가 요구하는 reproducible observation step을 만족시킨다. Browser action routing은 ref-first, coordinate-last 정책을 따른다. Vision coordinate fallback은 bbox/confidence candidate와 clip/DPR basis를 보존하고, confidence가 낮거나 point-only인 결과는 verification 없이 바로 클릭하지 않는다.

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

- 2026-05-14: `sessions show` human output이 ChatGPT model selection evidence와 structured warning을 표시하도록 command 계약을 갱신했다.
- 2026-05-27: Runway `poll` 계약을 live smoke 결과에 맞춰 갱신했다. Right-rail `%` progress는 active signal이고, `queue_full` terminal은 explicit queue gate에 한정한다.
- 2026-05-06: G03 — `agbrowse upload <ref> <file...>` CLI 추가. `web-ai/action-breadth.mjs`가 22개 local-CDP primitive (click/type/press/hover/select/check/uncheck/upload/drag/mouse-click/move-mouse/scroll/wait-for/wait-for-selector/wait-for-text/wait/navigate/reload/screenshot/snapshot/evaluate/text)를 카테고리화하고, `gate:browser-primitives-complete`가 모든 primitive에 CLI 핸들러가 wired되어 있는지를 검증한다.
- 2026-05-06: G06 — `agbrowse observe-bundle`과 ObservationBundleV1 스키마를 추가했다. URL/title/viewport/DPR/refs/boxes/screenshot/text를 한 번에 묶어 multimodal benchmark step 재현성을 확보한다 (`gate:observation-bundle-fixtures`).
- 2026-05-06: G02 — `agbrowse observe-actions <instruction>` CLI 추가. Pure `buildObserveActions(snapshot, instruction, opts)` API가 ranked `ActionCandidate[]`를 반환한다 (`gate:observe-actions-fixtures`).
- 2026-05-06: G04 — MCP-ready vs CLI-ready matrix와 deferred-tool envelope 동작을 commands.md에 명시했다 (`structure/mcp_scope.md` 결정 기록과 `gate:mcp-deferred-metadata` 게이트 동기).
- 2026-05-13: Oracle follow-up guardrail — `web_ai_*` MCP 입력을 strict schema로 고정하고 documented compatibility alias만 허용하도록 명시했다.
- 2026-05-13: Oracle parity closeout — `project-sources`, generated images, batch follow-ups, Deep Research, live upload cap, and MCP deferred advanced fields를 CLI/help/docs 계약에 맞췄다.
- 2026-05-06: Phase 9.1 multi-tab의 `new-tab`, `tab-close` 명령을 root command 표에 추가해 README와 일치시켰다.
- 2026-05-05: root CLI, web-ai, MCP tool, provider alias, failure envelope, drift 검사 기준을 source-of-truth 문서로 추가했다.
