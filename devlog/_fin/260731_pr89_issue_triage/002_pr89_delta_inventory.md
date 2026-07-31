# 002 — PR #89 원본 대조 원장 (리서치)

PR #89의 변경분을 `dev` 현재 소스와 대조한 조사 결과다. 판정만 담고 구현 diff는
`010`에 있다(LEXICO-SPLIT-01).

- 조사 시각: 2026-07-31
- PR head: `4ada9cb`, base `main`, 저장소 `hanbinnoh/agbrowse` 포크
- 소스 대조 기준: `dev` @ `c7e87c1` (이후 커밋은 이 유닛의 devlog 문서만 바꿨으므로 코드 대조 결과는 유효)
- 계획 문서 기준: 이 유닛의 최신 커밋

## 커밋

`gh pr view 89 --json commits` 기준 현재 커밋은 두 개다.

| OID | 제목 | 대상 |
| --- | --- | --- |
| `d5d9475` | `fix(web-ai): carry --family through the CLI and MCP send paths (#87)` | 이슈 #87 |
| `4ada9cb` | `fix(web-ai): bound assistant DOM reads by the polling deadline (#88)` | 이슈 #88 |

PR 본문은 초기 커밋 해시(`a2dc3e1`, `79db5d1`)를 언급하지만, `main` @ v0.1.19 위로
리베이스되며 재작성됐다. 대조는 현재 OID 기준으로 한다.

## 변경 파일 (13개)

```
structure/str_func.md
test/integration/web-ai-cli-contract.test.mjs
test/unit/web-ai-assistant-read-deadline.test.mjs      (신규)
test/unit/web-ai-chatgpt-family-wiring.test.mjs        (신규)
test/unit/web-ai-chatgpt-model.test.mjs
test/unit/web-ai-provider-session.test.mjs
test/unit/web-ai-tool-schema.test.mjs
web-ai/chatgpt-model.mjs
web-ai/chatgpt-response-dom.mjs
web-ai/chatgpt-response-observer.mjs
web-ai/chatgpt.mjs
web-ai/cli.mjs
web-ai/mcp-server.mjs
```

## 이슈 #87 — `dev` 판정: 부분 충족

`dev`는 `f8e8b9b`("feat(web-ai): reach GPT-5.6 Sol from the CLI and allow
current-model effort override", 2026-07-24)로 독립 구현을 이미 갖고 있다.

충족된 것:

| 이슈 #87의 요구 | `dev` 근거 |
| --- | --- |
| CLI 파서가 `family`를 선언 | `web-ai/cli.mjs:615` |
| 정규화 입력이 family를 운반 | `web-ai/cli.mjs:761` |
| 미지원 alias fail-closed (브라우저 mutation 전) | `web-ai/cli.mjs:1692-1701` |
| `selectChatGptModel`에 family 도달 | `web-ai/chatgpt.mjs:325-328` |
| selector가 family를 선택·검증 | `web-ai/chatgpt-model.mjs:400-409`, `:449-458`, `:525-552` |
| `web-ai help`가 `--family` 문서화 | `web-ai/cli.mjs:128-132` |

미충족 갭 2건:

**갭 A — capability probe가 family를 아예 읽지 않는다.**
`chatGptModelCapabilityProbe`(`web-ai/chatgpt-model.mjs:1725-1759`)는 `options.effort`와
`options.reasoningEffort`만 해석한다. `options.family` 참조가 함수 본문에 없다.
`web-ai/chatgpt.mjs:120`이 family를 넘기지 않는 것은 표면 증상이고, 넘겨도 probe는
무시한다. 따라서 호출부 1줄 수정으로는 아무것도 바뀌지 않는다 — probe 함수 자체를
고쳐야 한다.

이슈 #87 본문이 "성공한 render나 tier capability probe가 요청한 family가 선택됐다는
증거가 아니다"라고 지적한 부분이 정확히 여기다.

**갭 B — MCP 경로에 family runtime 검증이 없다.**
`web-ai/tool-schema.mjs:55`가 `family` enum을 광고한다. `web-ai/mcp-server.mjs`의
`web_ai_submit_prompt` 핸들러는 `...args` 스프레드로 `sendByProvider`를 호출하므로
(`:214-220`) 값 자체는 흘러간다. 즉 "MCP에서 family가 전혀 도달하지 않는다"는
판정은 틀렸다.

실제 갭은 좁다. 스키마 enum이 `validateWebAiToolInput`(`web-ai/tool-schema.mjs:200-205`,
호출은 `web-ai/mcp-server.mjs:153`)에서 잘못된 alias를 이미 거부하므로 invalid-alias
분기는 handler에 도달하지 않는다. 그러나 **스키마상 유효한 family를 Gemini/Grok에
보내는 조합**은 아무 곳에서도 막히지 않는다. CLI는 `rejectFutureScope`가 이 조합을
거부하지만(`web-ai/cli.mjs:1692`), MCP에는 대응 검증이 없어 family가 조용히
무시된다 — 이슈 #87이 지적한 무음 드롭과 같은 형태다.

## 이슈 #88 — `dev` 판정: 미충족

`dev`에 어떤 형태의 read budget 방어도 없다. `rg`로 확인:
`withAssistantReadTimeout`, `resolveAssistantReadBudgetMs`,
`assistant-dom-read-timeout` 모두 0건.

한도 없는 `page.evaluate` await 지점(모두 `pollWebAi` 데드라인 안에서 호출됨):

| 위치 | 함수 | poll 경로 |
| --- | --- | --- |
| `web-ai/chatgpt.mjs:1461` | `readAssistantSnapshotsSplit` | 루프 본문 `:655` |
| `web-ai/chatgpt.mjs:1436` | `readAssistantSnapshots` | split 실패 시 fallback |
| `web-ai/chatgpt.mjs:1425` | `readAssistantMessages` | `countAssistantMessages` 경유 |
| `web-ai/chatgpt.mjs:1027-1043` | `readActivityState` | 루프 본문 `:674` |
| `web-ai/chatgpt-response-observer.mjs:98-113` | `recoverAssistantResponse` | 루프 종료 후 `:865` |

마지막 항목이 특히 중요하다. 루프가 데드라인에 걸려 빠져나와도 recovery가 다시
무한 대기하므로, 루프만 방어하면 명령은 여전히 반환되지 않는다.

## PR 패치를 그대로 못 쓰는 이유

`4ada9cb`는 `readAssistantMessages`가 `page.evaluate(readTopLevelAssistantTexts, …)`를
직접 호출하던 구버전을 전제하고, `readAssistantTextsAfterIndex`라는 trimmed 읽기를
도입한다. `dev`는 이미 `readAssistantSnapshotSources`(`web-ai/chatgpt-response-dom.mjs:297`)
기반 분할 리더로 리팩터되어 wrapped/wrapperless를 한 번의 evaluate로 읽고 도큐먼트
순서로 correlate한다. PR의 hunk는 컨텍스트가 맞지 않고, trimmed 읽기는 이 좌표계를
깨뜨린다.

채택: 읽기마다 남은 예산으로 race, timeout을 streaming과 구분해 보고, 정체 중에도
하트비트 유지, recovery 읽기의 짧은 예산.
버리지 않고 확장: PR이 다루지 않은 `readActivityState`도 같이 방어한다.
버림: trimmed 읽기, 구버전 함수 시그니처.
