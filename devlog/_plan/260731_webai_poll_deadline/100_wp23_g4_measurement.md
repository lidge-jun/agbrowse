# 100 — WP23 G4 실측

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP23 (측정 전용, 소스 변경 없음)
- 대상: `011_model_decision.md`가 정한 reversal gate **G4**의 여덟 조건

## 왜 지금인가

G4는 이 유닛에서 **한 번도 측정되지 않았다.** `070`·`060`·`050`이 모두
"G2·G4 미측정"으로 남겨 뒀고, `c7`이 열려 있는 이유 중 하나다.

G4가 통과해야 `Page.reload`를 취소 primitive로 쓸 수 있고, 그게 있어야
single-flight를 닫을 수 있다. 순서상 여기가 먼저다.

## 결과

처음 이 표를 "일곱 통과, 하나 불가"로 적었다. **감사가 여섯 개를 뒤집었다.**
대부분은 조건이 요구하는 것 대신 **대리 지표**를 쟀기 때문이다. 아래가 교정된
표다.

| # | 조건 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | durable `/c/<id>` 전제 | **부분** | 하네스 안의 자체 regex로 세 리터럴만 분류했다. 실제 `conversation-url.mjs`의 validator를 부르지도, reload를 차단하지도 않았다 |
| 2 | `sessionId`·`targetId`·conversation ID 비교 | **미충족** | 하네스가 합성 레코드를 썼다 — reload를 지워도 통과한다 |
| 3 | waiter를 reload **전에** arm | **통과** (`g4f` 기준) | 아래 참조 |
| 4 | reload+navigation 데드라인 | **미충족** | `Promise.race`는 취소하지 않는다. 후보 primitive만 확인 — 아래 참조 |
| 5 | `loaderId` racing navigation fail-closed | **통과** (재측정 후) | 아래 참조 |
| 6 | 실제 ChatGPT generation 중 reload | **측정 불가** | 아래 참조 |
| 7 | pending callback·CDP·lock delta 0 | **미충족** | Playwright callback 미계측, CDP session은 수동 카운터, command lock 미실행 |
| 8 | 중복 send·baseline shift 없음 | **미충족** | 상수를 쟀다 — reload를 지워도 같은 값이 나온다 |

**여덟 중 둘 통과(3·5), 하나 부분(1), 넷 미충족(2·4·7·8), 하나 측정 불가(6).**

WP24를 처음 "다섯 통과"로 적었다. **감사가 다시 뒤집었고, ablation으로
확인했다** — `Page.reload` 호출을 **지운 채로** 하네스를 돌려도 조건 2와 8이
그대로 통과한다.

```
reload 삭제 후:  g4_2 allPreserved = true
                 g4_8 duplicateSend = false, baselineShifted = false
```

reload와 무관한 상수를 재고 있었다는 뜻이다. WP23에서 대리 지표를 쟀고, WP24는
**실제 API를 쓰되 reload와 인과적으로 연결하지 않은 fixture**를 썼다. 형태만
바뀌고 같은 실수를 반복했다.

### WP24 재측정 — 2·3·7·8 통과

**2번 — 미충족.** 실제 store API를 쓴 것은 맞지만 **fixture가 브라우저와 연결돼
있지 않았다.** 브라우저는 로컬 `/c/abc123`을 reload하는데 store에는 합성
`target-g4`와 별개의 ChatGPT URL을 넣었다. 같은 target이라는 증거가 없다.

ablation이 결정적이다 — reload를 지워도 세 값이 그대로 보존된다. 조건이 묻는
"reload 전후"를 재지 않았다.

제대로 재려면 실제 `targetId`를 CDP에서 얻고, page URL·store `conversationUrl`·
session을 **하나의 fixture로 결속**해야 한다.

**3번 — 통과.** `waitForLoadState`와 `waitForNavigation`을 갈랐다.

```
waitForLoadState   reload 시점에 이미 settle (1ms)      ← 기다린 적 없음
waitForNavigation  reload 시점에 pending, 36ms에 settle  ← 실제로 기다림
```

조건이 요구하는 "reload 전에 arm"은 **새 navigation에 결속된 waiter**를 뜻한다.
`waitForLoadState`로는 코드 순서를 아무리 앞세워도 충족되지 않는다.

근거는 `g4f`다. 통제된 페이지에서 유일한 navigation이 그 reload였고, waiter가
reload **이후에** 성공적으로 settle했다. pending이라는 사실만으로는 부족하고
"다른 navigation이 아니라 이 reload가 settle시켰다"까지 필요하다.

`g4e`의 3번 계측은 버그였다. reload 전 상태를 저장한 변수를 성공 settlement가
덮어써서 최종 출력이 `false`로 나온다. 조건 3의 근거는 `g4f`뿐이다.

**7번 — 미충족.** 조건 문언을 전부 덮지 못한다.

- pending Playwright callback을 **만들지도 세지도 않았다**
- `pendingCdp`는 하네스가 스스로 만든 요청 하나만 추적한다
- `cdpSessions`는 registry 조회가 아니라 손으로 세는 정수다
- store lock은 reload 전에 이미 끝났고, command lock은 실행조차 안 했다

감사가 제시한 계측 지점: `page._connection._callbacks.size`, mainFrame의
`navigated`/`loadstate` listener delta, `_connection._objects`의 CDPSession 수,
그리고 실제 store/command lock 경로.

**8번 — 미충족.** 상수를 쟀다.

서버는 `/send` 요청을 세지만 **페이지에 `/send`를 부르는 코드가 없고** 생산
`submitPrompt`도 실행하지 않는다. baseline도 3으로 미리 저장한 뒤 그것을 바꿀
코드가 없다. `0`과 `3→3`은 예상된 상수이고, ablation에서 reload를 지워도 같다.

### 4번 — 미충족, 다만 후보 primitive는 있다

WP23에서 "부분"으로 뒀는데, 재측정으로 미충족이 확정됐다.

```
예산 300ms → BUDGET_HIT at 302ms
그 뒤 2.5초 대기 → frameNavigated 1회, url = .../c/slow
navigationActuallyCancelled: false
```

**호출자는 302ms에 돌아왔지만 navigation은 그대로 완료됐다.** 조건 4가 요구하는
"reload와 다음 navigation 자체를 deadline으로 제한"은 취소를 뜻하는데,
`Promise.race`는 기다리기를 그만둘 뿐이다.

WP16이 "반환 보장 ≠ 정지 보장"으로 배운 것과 같은 형태이고, 이번에는 그것이
**측정으로 확정**됐다.

#### 취소 primitive는 존재한다

"구조적으로 충족 불가"라고 적을 뻔했다. 재보니 아니다.

```
대조군 (취소 없음):  url = .../c/slow          ← navigation이 착지
Page.stopLoading:    url = .../c/home 그대로   ← 착지하지 않음
                     navigate 결과 = net::ERR_ABORTED
```

대조군이 실제로 착지했으므로 이 관측은 유효하다 — 서버가 충분히 느리지 않아서
아무 일도 안 일어난 경우가 아니다.

다만 **이것으로 조건 4가 통과는 아니다.** 두 실험 모두 `Page.reload`가 아니라
`Page.navigate`를 취소했고, 실제 deadline wrapper는 `stopLoading`을 부르지도
않는다.

정확히 말하면 이렇다.

- `Page.stopLoading`이 느린 navigation을 취소한다 — **관측됨**
- 그것이 `Page.reload`에도 적용된다 — **미확인** (loader 변화 대조군 필요)
- deadline wrapper가 그것을 호출한다 — **미구현**

"조건 4는 충족 가능하다"고 적을 뻔했는데 그건 추론이다. 지금 말할 수 있는 것은
후보 primitive가 존재한다는 것까지다.

### 5번은 재측정해서 통과했다

처음엔 URL을 옮겨 loaderId가 바뀌는 것만 봤다. 그건 "loaderId가 존재한다"는
확인이지 fail-closed 증명이 아니다. 감사가 지적한 대로 **stale loaderId를 실제로
넘겨봐야** 한다.

```
stale loaderId  → REJECTED (Protocol error), 네트워크 request 증가 0
fresh loaderId  → ACCEPTED,                  네트워크 request 증가 1
```

거부되면서 navigation도 일으키지 않는다. 이게 fail-closed다. **primitive는
로컬에서 측정 가능했고, 내 첫 하네스가 그 시험을 하지 않았을 뿐이다.**

## 하네스가 세 번 틀렸다

첫 측정에서 `titlePreserved: true`가 나왔다. **의미 없는 통과였다.**
`data:` URL을 썼는데 거기엔 title이 없어서 `""`와 `""`를 비교하고 있었다.

실제 서버로 바꾸니 `false`가 나왔다.

```
before: "conversation abc123"
after:  "Loading http://127.0.0.1:63783/c/abc123"
```

세 번째 하네스로 원인을 갈랐다.

```
atLoadState:            "Loading …"
afterDomContentLoaded:  "Loading …"
afterTitleSettled:      "conversation abc123"
```

여기서 "reload가 식별자를 보존한다"고 결론냈는데 **그것도 과했다.** 이 하네스가
보인 것은 로컬 정적 페이지의 title이 나중에 돌아온다는 것뿐이다. `sessionId`나
`targetId`는 건드리지도 않았다.

원인 진단도 틀렸다. "`load`로는 부족하고 title settle까지 기다려야 한다"고
적었는데, 감사가 반증했다. `waitForNavigation({waitUntil:'load'})`를 reload
**전에** arm하면 `load` 시점에 원래 title이 그대로 있다.

```
titleBefore:             "conversation abc123"
titleAfterBoundWaiter:   "conversation abc123"   ← 보존됨
```

문제는 `load`라는 이벤트가 아니라 **waiter가 새 navigation에 결속되지 않은
것**이었다. `waitForLoadState`는 이미 loaded인 상태에 즉시 settle하므로 애초에
reload를 기다린 적이 없다. 조건 3이 미충족인 것과 같은 뿌리다.

## 4번도 처음엔 무의미했다

`data:` URL의 reload가 1ms에 끝나서 600ms 예산을 시험하지 못했다. "bounded:
true"였지만 예산이 작동한 게 아니라 **애초에 도달하지 않은 것**이다.

3초 지연 서버로 바꿔서 603ms에 `TIMED_OUT`을 받았다. 다만 그것으로도 조건 4는
충족되지 않는다. `Promise.race`는 **호출자에게 반환**하는 시점만 제한하고, 그
아래의 CDP command와 navigation은 계속 진행한다. 조건 4가 요구하는 "reload와
다음 navigation 자체를 deadline으로 제한"은 취소까지 포함한다 — WP16에서 배운
"반환 보장 ≠ 정지 보장"과 정확히 같은 구분이다.

## 6번을 측정하지 못하는 이유

> 실제 ChatGPT에서 generation 진행 중 reload 후 같은 user turn의 응답이
> 계속되거나 복구되는지

로그인된 세션과 **진행 중인 generation**이 동시에 필요하다. 로컬 하네스로는
만들 수 없고, 이 세션의 범위(원격 상태 변경 금지)를 벗어난다.

`011`이 "6번이 가장 불확실하다"고 적어둔 그대로다. OpenAI 문서는 대화가 계정에
저장된다고 하지만 **진행 중 generation이 reload 뒤에도 계속된다는 보장은
없다.** 문서로는 답이 안 나온다.

이건 사용자가 실제 계정으로 한 번 돌려봐야 하는 항목이다.

## G4의 현재 상태

`011`의 기준은 "여덟 조건 전부"다. **둘 통과했다**(3·5).

`c7`은 그대로 열려 있고, 열린 이유는 처음 적은 것보다 넓다. 다만 **아무것도
모르던 상태에서 무엇을 재야 하는지 아는 상태로는 옮겼다.**

남은 측정을 다음 work-phase가 하려면 이만큼이 필요하다.

- **1번**: validator를 부르는 것만으로는 부족하다. 조건 문언이 "root/null이면
  reload **금지**"이므로 **집행**까지 봐야 한다 — 실제 진입점에서
  `extractDurableConversationId`를 태우고, root/null 입력에서 `Page.reload`
  호출 0회·request 0·loader 변화 0을, valid `/c/<id>`에서 정확히 1회를 관측한다.
  생산 reload 경로가 아직 없으므로 하네스로는 prototype feasibility까지만
  기록할 수 있다
- **2번**: 실제 `targetId`를 CDP에서 얻고 page URL·store `conversationUrl`·
  session을 **하나의 fixture로 결속**한 뒤 reload 전후를 비교한다. 결속하지
  않으면 reload를 지워도 통과한다(이번에 그랬다)
- **4번**: primitive(`Page.stopLoading`)가 `Page.navigate`를 취소하는 것은
  확인했다. 남은 것 둘 — `Page.reload`에도 적용되는지(loader 변화 대조군),
  그리고 deadline wrapper가 실제로 그것을 호출하는지
- **7번**: `page._connection._callbacks.size`, mainFrame의 listener delta,
  `_connection._objects`의 CDPSession 수, 실제 store/command lock 경로.
  하네스가 스스로 만든 요청 하나를 세는 것으로는 안 된다
- **8번**: `submitPrompt` 호출을 spy하고 **같은 session**의 저장 baseline을
  전후 비교한다. 서버 요청 카운터는 페이지가 그 엔드포인트를 부르지 않으면
  0으로 고정된 상수다

3·5만 측정 완료다.

## 이 사이클에서 반복된 실수

**두 번 같은 함정에 빠졌다.**

WP23은 대리 지표를 쟀다 — title로 식별자를, handle delta로 CDP·lock 잔존을,
실행 컨텍스트 교체로 중복 send를 대신했다.

WP24는 그걸 고친다며 **실제 API를 불렀지만 fixture를 reload와 연결하지
않았다.** 형태만 바뀌었지 결과는 같다. 감사가 ablation을 제안했고, reload를
지우고 돌려보니 조건 2와 8이 그대로 통과했다.

**측정 하네스에도 mutation이 필요하다.** 코드에는 "이 가드를 지우면 RED가
되는가"를 매번 확인했으면서, 측정에는 "이 동작을 지워도 같은 숫자가 나오는가"를
묻지 않았다. 같은 규칙인데 한쪽에만 적용하고 있었다.

이 세션에서 같은 종류의 실수를 여러 번 했다.

- **WP16** — `skipFinalize: true` 하네스가 세션 쓰기 경로를 통째로 건너뛰는데도
  "fencing 충족"으로 읽었다
- **WP20** — `F13`을 순차 호출로 써서 인터리브를 재현하지 못했고, `F14`는 조건부
  단언이라 조건이 안 서면 아무것도 검사하지 않았다. 둘 다 mutation에서 통과했다
- **WP21** — 정규식 comment stripper가 문자열 안의 `"//"`를 주석으로 오인해
  살아 있는 코드를 지웠다

**GREEN을 근거로 쓰지 않는다는 규칙이 측정에도 그대로 적용된다.**

## 하네스

WP23: `agb-g4-probe.spike.mjs`, `agb-g4b`, `agb-g4c`, `agb-g4d`.
WP24: `agb-g4e`(조건 2·4·7·8 — **결과 무효**), `agb-g4f`(조건 3, 유효),
`agb-g4g`(취소 primitive, 유효), `agb-g4e-ablation`(reload 제거 대조).

커밋하지 않는다 — 일회성 측정 도구이고, 결과는 위 표가 전부다.

WP23의 것들과 `agb-g4e`는 재사용하지 마라. 전자는 대리 지표를, 후자는 reload와
연결되지 않은 fixture를 재는 형태라 그대로 돌리면 같은 오판이 나온다. `g4f`와
`g4g`는 유효하다.

새 하네스를 쓸 때는 **먼저 ablation부터** 돌려라 — 측정 대상 동작을 지웠을 때도
같은 결과가 나오면 그 하네스는 아무것도 재지 않는다.
