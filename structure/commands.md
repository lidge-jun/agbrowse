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
| Navigate | `navigate`, `reload`, `resize`, `tabs`, `tab-switch`, `select-tab`, `tab-cleanup`, `scroll` | navigation, viewport, tab 관리 |
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

## 변경 기록

- 2026-05-05: root CLI, web-ai, MCP tool, provider alias, failure envelope, drift 검사 기준을 source-of-truth 문서로 추가했다.
