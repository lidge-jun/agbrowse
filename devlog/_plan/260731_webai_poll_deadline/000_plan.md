# 260731 — web-ai 폴링 데드라인 계약 (이슈 #88)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- branch: `dev`
- class: C4 (런타임 계약 변경, 세션 상태와 탭 수명주기에 영향)
- 선행: `devlog/_fin/260731_pr89_issue_triage/021_stall_boundary_map.md`

## 문제

이슈 #88: `agbrowse web-ai` 폴링이 `--timeout`을 넘겨도 반환하지 않는다. 프로세스와
세션 락은 살아 있고 stderr 하트비트만 멎는다.

원인은 단일 버그가 아니다. `pollWebAi`가 데드라인을 루프 경계에서만 확인하는데,
그 안에서 호출하는 것들이 상한 없이 블로킹된다. 선행 유닛이 경계 표본 36개를
확인했고 그중 bounded인 것은 **하나도 없다**.

## 왜 열거가 아니라 계약인가

선행 유닛이 경계를 22개 → 34개로 두 번 세었고 두 번 다 감사에서 반증됐다.
이유는 `021` §0에 있다.

- 호출 그래프가 `web-ai/` 밖 `skills/browser/`의 탭 관리·CDP 연결·HTTP 폴링까지
  뻗는다.
- `deps.getPage`/`deps.getCdpSession`은 **주입 지점**이라 지금 구현을 다 세어도
  다음 구현에서 새 경계가 생긴다.
- Playwright의 `page.evaluate`·`locator.all()`·`CDPSession.send` 모두 timeout
  옵션이 없다.

따라서 이 유닛은 경계를 더 세지 않는다. **진입점에서 예산을 강제해 하위가 무엇을
하든 반환을 보장**한다.

## 계약 (021 §0)

세 요소를 모두 만족해야 "반환 보장"이라고 말할 수 있다.

1. **Sync isolation** — 동기 IO를 제거하거나 격리한다. 동기 구간이 event loop를
   막으면 타이머 자체가 안 돌아 나머지 둘의 전제가 무너진다.
2. **Late-side-effect fencing** — 데드라인 이후에는 session·artifact·tab 상태를
   바꾸지 않는다. `Promise.race`는 패배한 실행을 취소하지 않으므로, timeout을
   반환한 뒤에도 원래 실행이 살아서 부수효과를 일으킨다.
3. **Single-flight** — 패배한 작업이 누적돼 프로세스를 붙잡지 않는다.

수용 기준: **데드라인 이후 부수효과 없음**, **패배한 작업이 프로세스를 붙잡지
않음**.

## 모델 선택 (WP1이 결정)

| | in-process | 격리(worker/subprocess) |
| --- | --- | --- |
| sync isolation | 동기 IO를 하나씩 async로 옮기거나 제거 | 부모가 watchdog으로 종료 — 개별 수정 불필요 |
| fencing | 데드라인 이후 mutation을 게이트하는 코드 필요 | 자식 종료로 자동 |
| single-flight | 취소·drain 구현 필요 | 자식 종료로 자동 |
| 위험 | 놓친 동기 IO 하나가 계약을 깬다 | 프로세스 경계 도입, deps 직렬화, 디버깅 난이도 |
| 범위 | `web-ai/` + `skills/browser/` 다수 파일 | 진입점 + 워커 래퍼 |

**WP1이 두 모델을 비교해 하나를 고른다.** 이 선택이 이후 모든 work-phase를
규정하므로 첫 작업이다. 자매 유닛(`artifact/finalizer`)도 같은 모델을 써야 하니
결과를 양쪽에 기록한다.

### 착수 시점의 관측

선택을 미리 정하지 않되, 다음은 확인된 사실이다.

- `observeAssistantResponse`는 **이미 `AbortSignal`을 받는다**
  (`web-ai/chatgpt-response-observer.mjs:78-84`). in-process 취소의 선례가 있다.
- 진입점이 하나로 모인다. `runBoundCommand`(`web-ai/cli.mjs:1254`)가 세션 폴에서
  `withSessionCommandLock` → `withCommandSessionPage` → `withWebAiActiveCommand`
  3중 래퍼를 거쳐 `deps`를 조립한다(`:1259-1277`). 예산을 끼울 자리가 명확하다.
- 반대로 `withSessionCommandLock`(`web-ai/session-store.mjs:273`) 자체가 동기 락
  경로(B18/B19)를 쓴다. 예산 래퍼가 그 안쪽인지 바깥쪽인지가 설계 쟁점이다.

## 담당 경계 (021 7절 유닛 A)

B01~B09, B11, B12, B13, B26, B27, B29 — 15개.

답변 읽기와 완료 판정 경로다. 이 중 **fail-open 둘**이 특히 중요하다.

| 경계 | 현재 동작 | 위험 |
| --- | --- | --- |
| B03 `readActivityState` | catch → `{strength:'none'}` | `'none'`이 quiet으로 읽혀 완료 분기로 간다 — 정체가 조용한 완료로 위장 |
| B06 `doesAssistantFollowUser` | 비-`false` → `true` | 정체가 "순서 정상"으로 통과 |

둘 다 정체가 **지연이 아니라 틀린 결론**을 만든다. 예산 계약과 독립적으로 고쳐야
한다 — 예산을 씌워도 틀린 결론은 그대로다.

## work-phase

| WP | 내용 | 선행 |
| --- | --- | --- |
| WP1 | 예산 계약 모델 선택 (in-process vs 격리) + 프리미티브 설계 | — |
| WP2 | fake timer 하네스 — 시계와 타이머를 함께 주입 | WP1 |
| WP3 | 데드라인 안 읽기 경로 (B01, B02, B07) + `countAssistantMessages` 계약 | WP2 |
| WP4 | 완료 판정 경로 (B03, B04, B05, B06) — fail-open 교정 | WP3 |
| WP5 | 데드라인 후 경로 (B09, B11, B12, B13, B29) | WP4 |
| WP6 | B26 세션 락, B27 하트비트 | 자매 유닛의 sync-IO 처방 |
| WP7 | B08의 취소되지 않는 evaluate | WP1 |
| WP8 | warning 전파 + 활성화 관측 | 전부 |

분할은 의존 순서다(PHASE-SPLIT-01). WP1이 모델을 정해야 나머지가 설계되고,
WP2의 하네스 없이는 WP3 이후를 검증할 수 없다.

**WP6은 자매 유닛에 의존한다.** `artifact/finalizer` 유닛의 sync-IO 처방이 먼저
나와야 세션 락을 다룰 수 있다.

## 검증 시나리오 (021 6절, A·B 공통)

| # | 시나리오 | 증명 |
| --- | --- | --- |
| C1 | `deps.getPage`/`page.evaluate`가 영원히 pending | 데드라인 안에 반환 |
| C2 | 패배한 Promise가 나중에 resolve | session·finalizer·artifact 부수효과 없음 |
| C3 | 반복 timeout | pending 작업 누적 없음 |
| C4 | 동기 IO가 event loop 차단 | wall-time 상한 성립 (모델별 증명 방식이 다르다) |
| C5 | fail-open 여섯 각각 | sentinel을 정상 상태로 오독하지 않음 |

C5 중 B03·B06이 이 유닛 담당(WP4)이다. C1~C4는 **자매 유닛과 공동 게이트** —
어느 한쪽만으로는 met이 아니다.

## 테스트 하네스 제약 (021 6절)

`pollWebAi`를 실제 구동하는 하네스는 넷이다.

```
test/unit/web-ai-chatgpt-activity-poll.test.mjs      가상 시계 (유일)
test/unit/web-ai-provider-session.test.mjs
test/integration/web-ai-fake-chatgpt.test.mjs:97
test/integration/web-ai-golden-scenario.test.mjs:85
```

`activity-poll`은 `Date.now`를 mock하고 offset은 `page.waitForTimeout`에서만
전진한다. 실제 `setTimeout` 기반 예산과 섞으면 "두 번째 읽기는 남은 시간만
받는다"를 검증할 수 없다 — WP2가 이를 fake timer로 옮긴다.

`chatgpt.mjs` 소스 문자열을 읽는 테스트가 10개 있어(`021` 5절) 리팩터 시 함께
갱신해야 한다.

## 범위

IN: `web-ai/chatgpt.mjs` 폴링 경로, `web-ai/chatgpt-response-dom.mjs`,
`web-ai/chatgpt-response-observer.mjs`, `web-ai/cli.mjs` 진입점, 예산 프리미티브
신규 모듈, 관련 테스트.

OUT: 이미지·파일 다운로드, 탭 lease, CDP 취득 경로 — 자매 유닛
(`artifact/finalizer hardening`) 소유. devlog 정리. #87 관련 코드.

## 종료 판정

담당 경계 15개가 예산 계약 아래 데드라인을 인지하고, C5의 B03·B06이 fail-closed로
검증되면 이 유닛은 DONE이다. C1~C4는 자매 유닛 완료 후 공동 게이트로 확인한다.

**부분 완료를 DONE으로 적지 않는다.** 일부 경계만 덮으면 #88은 여전히 재현된다.
