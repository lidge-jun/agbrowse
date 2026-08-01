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
| 2 | `sessionId`·`targetId`·conversation ID 비교 | **미측정** | URL과 title만 비교했다. **title은 G4.2가 말하는 식별자가 아니다** |
| 3 | waiter를 reload **전에** arm | **미충족** | 코드 순서만 앞섰다. 이미 loaded인 페이지에서 `waitForLoadState('load')`는 reload 전에 settle한다 — 실측 `waiterSettledBeforeReload: true` |
| 4 | reload+navigation 데드라인 | **부분** | 603ms `TIMED_OUT`은 재현되지만 `Promise.race`는 **반환만** 제한한다. 내부 CDP command와 navigation은 취소되지 않는다 |
| 5 | `loaderId` racing navigation fail-closed | **통과** (재측정 후) | 아래 참조 |
| 6 | 실제 ChatGPT generation 중 reload | **측정 불가** | 아래 참조 |
| 7 | pending callback·CDP·lock delta 0 | **미측정** | evaluate rejection과 Node handle delta만 봤다. **CDP request·CDP session·command lock·store lock은 하나도 세지 않았다** |
| 8 | 중복 send·baseline shift 없음 | **미측정** | `window.__marker` 소실은 실행 컨텍스트 교체를 보일 뿐이다. send 횟수도 저장된 baseline도 관측하지 않았다 |

**여덟 중 하나 통과.** G4는 여전히 미통과이고, 그 이유가 처음 적은 것보다
훨씬 넓다.

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

`011`의 기준은 "여덟 조건 전부"다. **하나만 통과했다.**

`c7`은 그대로 열려 있고, 열린 이유는 처음 적은 것보다 넓다. 다만 **아무것도
모르던 상태에서 무엇을 재야 하는지 아는 상태로는 옮겼다.**

남은 측정을 다음 work-phase가 하려면 이만큼이 필요하다.

- **1번**: validator를 부르는 것만으로는 부족하다. 조건 문언이 "root/null이면
  reload **금지**"이므로 **집행**까지 봐야 한다 — 실제 진입점에서
  `extractDurableConversationId`를 태우고, root/null 입력에서 `Page.reload`
  호출 0회·request 0·loader 변화 0을, valid `/c/<id>`에서 정확히 1회를 관측한다.
  생산 reload 경로가 아직 없으므로 하네스로는 prototype feasibility까지만
  기록할 수 있다
- **2번**: 실제 세션 store의 `sessionId`·`targetId`와 durable conversation ID를
  reload 전후로 비교. title은 관계없다
- **3번**: `waitForNavigation`처럼 **새 navigation에 결속된** waiter를 써야
  한다. `waitForLoadState`는 이미 loaded면 즉시 settle한다
- **4번**: 반환 제한이 아니라 **취소**. 예산 초과 시 진행 중인 navigation을
  실제로 멈추는지
- **7번**: CDP request/session counter, command lock, store lock 파일을 전후로
  센다. handle delta는 이것들을 대신하지 못한다
- **8번**: `submitPrompt` 호출 횟수와 저장된 baseline의 `assistantCount`를
  전후로 비교

## 이 사이클에서 반복된 실수

대리 지표를 쟀다. title로 식별자를, handle delta로 CDP·lock 잔존을, 실행 컨텍스트
교체로 중복 send를 대신했다. 셋 다 "관측했다"는 느낌은 주지만 조건이 묻는 것에
답하지 않는다.

이 세션에서 같은 종류의 실수를 여러 번 했다.

- **WP16** — `skipFinalize: true` 하네스가 세션 쓰기 경로를 통째로 건너뛰는데도
  "fencing 충족"으로 읽었다
- **WP20** — `F13`을 순차 호출로 써서 인터리브를 재현하지 못했고, `F14`는 조건부
  단언이라 조건이 안 서면 아무것도 검사하지 않았다. 둘 다 mutation에서 통과했다
- **WP21** — 정규식 comment stripper가 문자열 안의 `"//"`를 주석으로 오인해
  살아 있는 코드를 지웠다

**GREEN을 근거로 쓰지 않는다는 규칙이 측정에도 그대로 적용된다.**

## 하네스

`agb-g4-probe.spike.mjs`, `agb-g4b-probe.spike.mjs`, `agb-g4c-probe.spike.mjs`,
`agb-g4d-probe.spike.mjs`. 커밋하지 않는다 — 일회성 측정 도구이고, 결과는 위
표가 전부다. 다음 사이클은 이것들을 재사용하지 말고 조건이 요구하는 것을 직접
재는 편이 낫다.
