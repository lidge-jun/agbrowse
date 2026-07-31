# 003 — 감사 3라운드 종합과 계획 재구성 (리서치)

WP1의 A 페이즈에서 독립 리뷰어(gpt-5.6-sol, high)가 3라운드 모두 FAIL을 냈다.
LOOP-REPAIR-01에 따라 감사 루프를 중단하고 P로 복귀해 계획을 재구성한 기록이다.

## 라운드별 블로커

| 라운드 | 블로커 | 핵심 지적 |
| --- | ---: | --- |
| R1 | 9 | probe가 family를 안 읽음(phantom 전제), MCP 오판, **recovery 경로 누락**, activity 경로 누락, 인용 오류 |
| R2 | 8 | **`isResponseFinished`·`doesAssistantFollowUser` 누락**, `unknown` strength가 완료 조건에서 위험, count 0이 baseline 오염, probe 자리표시자 |
| R3 | 9 | **diagnostics·copy fallback 경로 누락**, 프록시가 Locator를 못 덮음, 예산 0에도 evaluate 실행, warning 누락 반환 5곳 |

굵게 표시한 것이 매 라운드 반복된 유형이다: **#88 방어 범위를 열거로 확정하려는
시도가 매번 새 누락을 낳았다.**

## 근본 원인

세 라운드의 공통 실패는 계획의 세부가 아니라 **작업 단위 설정**이었다.

1라운드는 개별 읽기 함수를 열거해 감쌌다 → recovery를 놓쳤다.
2라운드는 열거를 넓혔다 → `isResponseFinished`, `doesAssistantFollowUser`를 놓쳤다.
3라운드는 열거를 버리고 단일 프록시로 갔다 → diagnostics·copy fallback 경로와
Locator API(`locator.all()`은 timeout을 받지 않는다)를 놓쳤다.

매번 "이번엔 전부 덮었다"고 판단했고 매번 틀렸다. 이유는 `pollWebAi`가
1000줄에 가까운 단일 함수이고, 그 안에서 페이지를 만지는 방식이 evaluate,
Locator, 외부 모듈 위임(`captureFailureDiagnostics`, `captureCopiedResponseText`)로
갈라져 있기 때문이다. 어떤 단일 기법도 이 셋을 한 번에 덮지 못한다.

즉 **#88은 하나의 work-phase에 담기는 크기가 아니다.** 이것이 3회 실패가
가르쳐준 것이고, 계획을 고칠 게 아니라 분할을 고쳐야 한다.

## 리뷰어가 확인해준 사실 (재사용 가능)

감사 과정에서 나온 검증된 사실은 다음 계획의 입력이다.

- Playwright `locator.all()`은 timeout 없는 `count()`를 호출한다
  (`node_modules/playwright-core/lib/client/locator.js:280`,
  `frame.js:213`). `isVisible({timeout})`의 timeout은 무시된다
  (`types/types.d.ts:14191`). → Locator 경로는 옵션으로 해결되지 않는다.
- `Promise.race`는 패배한 Playwright 요청을 취소하지 않는다. 긴 timeout에서
  매 tick 새 요청이 쌓일 수 있다. → 단일-flight latch가 필요하다.
- Proxy의 일반 메서드 `bind(target)` 처리는 건전하다. `url`, `innerText`,
  `waitForTimeout`은 target의 `_mainFrame`을 쓰므로 바인딩 문제가 없다.
- `countAssistantMessages` 호출부는 세 곳이 전부다
  (`web-ai/chatgpt.mjs:331`, `:1151`, `:1413`).
- `test/unit/web-ai-wrapperless-correlation.test.mjs:119-137`이 이 함수의 소스
  문자열을 검사한다 — 계약을 바꾸면 함께 갱신해야 한다.
- MCP 응답 코드 경로는 `response.result.structuredContent.code`
  (`web-ai/mcp-server.mjs:64`, `:404`).
- `model` 없는 `family + effort` probe는 tier 호환을 증명할 수 없다
  (`web-ai/chatgpt-model.mjs:460`, `:492`). `ok`로 승인하면 안 된다.

## 계획 재구성

#88을 하나의 WP로 밀어붙이는 대신, 진단이 끝난 범위부터 순서대로 닫는다.

| 기존 | 변경 후 |
| --- | --- |
| WP3 = #88 전체 방어 | WP3 = **#88 경계 인벤토리 문서화**(코드 변경 없음) |
| — | WP3 결과로 실제 구현 WP들을 goalplan에 append |

WP3를 조사 work-phase로 축소하는 이유: 세 라운드 모두 "덮어야 할 경계 목록"에서
실패했다. 그 목록을 확정하는 것 자체가 독립된 작업이고, 확정되기 전에는 어떤
구현 계획도 같은 실패를 반복한다. 목록이 근거와 함께 고정되면 그때 구현 WP를
append한다(LOOP-UNIT-CHAIN-01).

WP2(#87)는 영향을 받지 않는다. 리뷰어의 probe 지적(R3-B6)은 계약 하나를
`ok`에서 `warn`으로 낮추는 국소 수정이다.

## 이번 라운드에서 죽은 가설 (LOOP-PESSIMIST-01)

- "개별 읽기 함수를 감싸면 된다" — R1에서 사망.
- "page.evaluate를 한 곳에서 가로채면 전부 덮인다" — R3에서 사망. Locator와
  외부 모듈 위임이 남는다.
- "PR #89의 방어 아이디어를 dev 구조에 옮기면 된다" — PR은 구버전 리더 기준이고,
  dev의 정체 표면이 더 넓다. 이식이 아니라 재설계가 필요하다.

이 방향이 틀렸다는 것을 보여줄 증거: WP3 인벤토리가 `pollWebAi` 밖에서도
무방비 경로를 다수 찾아낸다면, 문제는 `pollWebAi`가 아니라 web-ai 전반의 페이지
접근 규약이고, 그때는 유닛 자체를 다시 잡아야 한다.

---

## 2차 감사 3라운드 (새 리뷰어) — 누적 6라운드

WP3 축소 후 새 리뷰어(REVIEW-DECORRELATE-01)에게 3라운드를 더 받았고 전부
FAIL이었다. 라운드마다 계획은 나아졌지만 같은 자리에서 걸렸다.

| 라운드 | 핵심 지적 |
| --- | --- |
| R1 | WP5가 #88 미구현 상태로 유닛을 닫는다(목표 하향), 전이적 위임(copy resolver→self-heal, finalize→archive) 누락, upload_reliability 선택적 인용 |
| R2 | `await`만 추적하면 Promise origin(`observeAssistantResponse`) 누락, 조건부 이관인데 명령은 무조건 이동 |
| R3 | 4종 규칙이 재귀 단계에 미적용, "순수 IO" 말단 분류가 무제한 CDP를 숨김, 범위 밖 예외로 여전히 하향 가능 |

### 위 예측이 적중했다

바로 위 문단에 적어둔 반증 조건 — "`pollWebAi` 밖에서도 무방비 경로를 다수
찾아낸다면 유닛을 다시 잡아야 한다" — 이 그대로 실현됐다.

확인된 무방비 경로:

| 경로 | 근거 |
| --- | --- |
| `collectImages` → `Network.getCookies` | `chatgpt-images.mjs:226` — CDP `send`, 타임아웃 없음 |
| 이미지 다운로드 `fetch` + `arrayBuffer()` | `chatgpt-images.mjs:241`, `:257` — AbortSignal 없음 |
| `readAssistantDownloadableFiles` | `chatgpt-files.mjs:321`, `:347` — CDP `Runtime.evaluate` |
| `finalizeProviderTab` → `poolTab` → lease overflow → `closeTab` | `tab-pool.mjs:51`(await 없는 반환), `tab-lease-store.mjs:391`, `:630`, `skills/browser/tab-manager.mjs:305` |

결정적 사실: **Playwright `CDPSession.send`에는 timeout 옵션이 없다**
(`node_modules/playwright-core/types/types.d.ts:15882`). `locator.all()`도
마찬가지다(`lib/client/locator.js:280`). 즉 "폴링 명령이 데드라인 안에
반환한다"를 보장하려면 web-ai의 **탭 수명주기와 아티팩트 다운로드까지** 손대야
한다.

### 결론: 유닛을 분할한다

이슈 #88은 "assistant DOM 읽기가 `--timeout`을 넘긴다"였다. 정체 경계를 정직하게
세면 이미지 다운로드·탭 lease·raw CDP까지 번지고, 그것은 한 유닛에 들어가지
않는다. 계획 문구를 또 보수하는 것은 같은 실패의 7라운드가 될 뿐이다.

**같은 goal 아래 연쇄 유닛으로 재구성한다(LOOP-UNIT-CHAIN-01).** 목표 축소가
아니다 — 총량은 같고 경계만 다시 긋는다.

| 유닛 | 범위 |
| --- | --- |
| 이 유닛 (`260731_pr89_issue_triage`) | #87 잔여 갭 2건 + devlog 정리 + #88 경계 인벤토리 |
| 후속 1 (`#88 DOM deadline 계약`) | assistant DOM read·activity·finished·ordering·recovery — 이슈 #88의 원래 범위 |
| 후속 2 (`artifact/finalizer hardening`) | 이미지·파일 다운로드, 탭 lease, CDP 경계 |

인벤토리(`021`)는 이 유닛에서 완성해 두 후속 유닛의 공통 입력이 된다. 조사가
낭비되지 않고, 후속 유닛은 확정된 목록에서 출발한다.

두 후속 유닛은 이 goal이 살아 있는 한 남는다. WP5가 이 유닛을 닫는 것은
"#88 완료"를 뜻하지 않고 "이 유닛의 범위 완료"를 뜻하며, 그 사실을 closeout에
명시한다 — 리뷰어 R1의 지적을 이 방식으로 해소한다.

### 두 번째로 죽은 가설

- "인벤토리를 완전하게 만들면 #88을 한 유닛에서 구현할 수 있다" — 6라운드에서
  사망. 완전한 인벤토리가 오히려 유닛이 너무 크다는 증거였다.
