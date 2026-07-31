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
