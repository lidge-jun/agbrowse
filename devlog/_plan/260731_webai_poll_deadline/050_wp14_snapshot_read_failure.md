# 050 — WP14 스냅샷 읽기 실패와 빈 페이지 구분 (B01, B02, B07)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP14
- 선행: 없음 — 예산 계약과 독립
- 대상: `021` 3절 표의 B01·B02·B07

## 결함

`021:248`이 B01을 "빈 읽기와 구별 불가"로 기록했다. 실제 코드가 그렇다.

```
chatgpt.mjs:1628  readAssistantSnapshots
    :1630  evaluate(...).catch(() => [])      ← 실패 → []
    :1635  Array.isArray 아니면 return []      ← 이상값 → []
    :1639  catch { return [] }                ← throw → []

chatgpt-response-dom.mjs:456  readTopLevelAssistantTextsFromLocators
    :458  locator.all().catch(() => [])
    :469  locator.evaluate(...).catch(() => '')
    :471  locator.innerText().catch(() => '')
    :477  return []
```

세 갈래가 전부 `[]`다. **정상적으로 비어 있는 페이지와 같은 값이다.**

### 왜 이게 지연이 아니라 오답인가

`[]`가 흘러가는 곳이 baseline이다.

```
readAssistantSnapshots  →  readAssistantMessages(:1617)
                        →  countAssistantMessages(:1583)
                        →  sendWebAi(:336)  assistantCount
                        →  saveBaseline(:337-343)
```

baseline의 `assistantCount`는 **위치 기반 슬라이스 기준점**이다. 폴 루프가
`wrapped.slice(baseline.assistantCount)`로 새 답변을 고른다.

읽기가 실패해 0이 저장되면, 대화에 이미 답변이 세 개 있어도 baseline은 0이다.
그러면 다음 폴이 **옛날 답변 세 개를 전부 새 후보로 재분류**한다.

정확히 쓴다. 1차 결함은 **후보 집합 오염**이지 "무조건 옛 답 반환"이 아니다.
WP10이 넣은 ordering gate(`:824`)가 새 user turn을 볼 수 있으면 보통
`'stale'`로 막는다. 오답까지 가는 잔여 경로는 둘이다.

| 경로 | 이유 |
| --- | --- |
| ordering이 `'unverifiable'` | user turn이 없는 DOM — 게이트가 통과시킨다 |
| output-image shortcut(`:743`) | ordering 게이트 **앞**에 있다 |

wrapperless는 여기 해당하지 않는다. baseline 슬라이스는
`wrapped.slice(baseline.assistantCount)`에만 걸리고(`:763`), wrapperless는
baseline과 무관하게 병합되며 producer가 최신 user turn 뒤의 DOM만 허용한다.
ordering 게이트를 건너뛰는 것은 맞지만 **baseline 0 때문에 옛 답이 들어오는
경로는 아니다.**

즉 이 교정은 "오답을 막는다"가 아니라 **"오염된 후보가 게이트에 도달하지 않게
한다"** 이다. 게이트가 마지막 방어선이 되는 상황 자체를 없앤다.

`countAssistantMessages`의 주석(`:1587-1591`)이 이미 이 위험을 안다 — "성공한
빈 읽기는 0을 반환한다. 거기서 legacy 리더로 폴백하면 user turn을 assistant로
세어 baseline이 하나 밀리고 다음 진짜 답변을 조용히 잃는다." **성공한 빈
읽기는 다뤘는데 실패한 읽기는 안 다뤘다.**

## 이미 옳은 것

`readAssistantSnapshotsSplit`(`:1653`)은 정확히 맞게 돼 있다.

```js
const failed = { ok: false, wrapped: [], wrapperless: [] };
```

주석도 명시적이다 — "`ok:false`는 획득이 **실패**했다는 뜻이다. 아무것도 찾지
못한 성공한 읽기와 구별된다."

**같은 계약을 fallback 경로에 맞추는 것이 이 work-phase의 전부다.** 새 설계가
아니라 이미 존재하는 설계를 나머지 절반에 적용한다.

## 처방

### B01 — `readAssistantSnapshots`

반환형을 `{ ok, snapshots }`로 바꾼다.

```
ok: true,  snapshots: [...]   읽었다 (비어 있을 수 있다)
ok: false, snapshots: []      읽지 못했다
```

`:1630`의 `.catch(() => [])`는 제거한다 — 첫 시도 실패는 두 번째 시도로
넘어가는 것이 의도이므로 `null` 센티널로 바꾸고, **둘 다 실패했을 때만**
`ok:false`다.

#### 진실표 — 두 시도의 합성

"실패"는 throw뿐 아니라 **배열이 아닌 값**도 포함한다. `:1635`가 지금
`!Array.isArray(...)`를 `[]`로 바꾸는데, `null`이나 객체가 돌아온 것은 읽기가
성공한 게 아니다.

| 1차 evaluate | 2차 evaluate | 결과 |
| --- | --- | --- |
| 성공, 비어 있지 않음 | (실행 안 함) | `ok:true, snapshots` |
| 성공, 빈 배열 | 성공 | 2차 결과 |
| 성공, 빈 배열 | 실패/malformed | `ok:true, []` — 1차가 읽었다 |
| 실패/malformed | 성공 | `ok:true` (기존 2단계 폴백 보존) |
| 실패/malformed | 실패/malformed | `ok:false` |

세 번째 행이 중요하다. 1차가 "읽었는데 비어 있다"를 확인했으면 2차 실패는
새 정보가 없다 — `ok:false`로 낮추면 정상적으로 빈 페이지가 실패로 둔갑한다.

### 소비자 둘 — `:759`도 바꿔야 한다

production 소비자는 하나가 아니다.

| 위치 | 맥락 |
| --- | --- |
| `:1618` `readAssistantMessages` | 아래 참조 |
| **`:759` 폴 루프의 split 폴백** | `(await readAssistantSnapshots(page)).map(...)` |

`:759`를 그대로 두면 구조체에 `.map`을 호출해 **런타임 오류**다. 그리고 이
자리가 정확히 결함이 드러나는 곳이다 — split이 실패해서 여기로 왔는데
fallback마저 실패하면, 지금은 `[]`가 되어 "후보 없음"으로 조용히 계속 폴한다.

```
ok:true  → snapshots.map(...)          기존
ok:false → 후보 없음 + stable 초기화 + 공통 pacing
```

`ok:false`에서 `continue`하지 않는다 — WP10에서 확인했듯 pacing을 건너뛰면
가상시계가 전진하지 않는다.

### B07 — `readTopLevelAssistantTextsFromLocators`

같은 형태로 `{ ok, texts }`. locator 접근이 전부 실패하면 `ok:false`다.

주의: 이 함수는 **셀렉터를 순회**하며 첫 성공에서 반환한다(`:476`). 어떤
셀렉터가 매치하지 않는 것은 실패가 아니다.

#### 진실표 — 셀렉터 순회

| 상황 | 결과 |
| --- | --- |
| 어떤 셀렉터가 텍스트를 얻음 | `ok:true, texts` |
| **모든** 셀렉터를 조사했고 전부 정상 빈 결과 | `ok:true, []` — 정상적으로 빈 페이지 |
| 일부 셀렉터의 `all()`이 실패 | **`ok:false`** |
| 매치된 node가 있는데 text read가 전부 실패 | **`ok:false`** |
| 모든 셀렉터에서 `locator.all()`이 throw | `ok:false` |

**셋째 행이 초판과 반대다.** 초판은 "하나라도 읽었으면 성공"이라고 썼는데
셀렉터의 성격을 잘못 봤다. 이들은 **대체 탐색 경로**다 — 셀렉터 A가 throw하고
B가 정상적으로 0개를 찾았다고 해서 페이지에 assistant가 없다는 증거가 아니다.
A에만 매치되는 답변을 못 읽었을 수 있고, 그러면 다시 baseline 0이다.

`ok:true, []`를 말하려면 **모든 탐색 경로를 실제로 조사했어야** 한다.

### `readAssistantMessages`(`:1617`) — 두 verdict의 합성

| snapshots | locators | 결과 |
| --- | --- | --- |
| `ok:true`, 내용 있음 | (호출 안 함) | 그 내용 |
| `ok:true`, 비어 있음 | `ok:true` | locator 결과 (기존 동작) |
| `ok:true`, 비어 있음 | `ok:false` | `ok:true, []` — snapshots가 읽었다 |
| `ok:false` | `ok:true` | locator 결과 |
| `ok:false` | `ok:false` | `ok:false` |

원칙 하나다. **어느 한 쪽이라도 실제로 읽었으면 성공이다.** 둘 다 못 읽었을
때만 실패다.

### B02 — `countAssistantMessages`

여기가 실제 판정 지점이다.

```
split.ok                    → wrapped.length            (기존)
!split.ok && legacy.ok      → legacy.length             (기존 폴백)
!split.ok && !legacy.ok     → null                      ← 신규
```

`null`은 "셀 수 없었다"이고 `0`과 다르다.

### 호출부 셋

| 위치 | 현재 | 처방 |
| --- | --- | --- |
| `:336` sendWebAi baseline | `assistantCount` 저장 | `null`이면 **typed throw** (아래) |
| `:1343` `deepResearchWebAi` | `envelopeSummary.assistantCount`로 저장 | `null`이면 **`createSession`과 lease 기록 전에** typed throw |
| `:1605` `waitForStableAssistantCount` | `.catch(() => 0)` | `null`은 "안정됨"으로 세지 않는다. 안정 카운트를 리셋하고 재시도 |

`:1343`은 "같은 규칙"으로 넘길 수 없다. 이 값은 `envelopeSummary`에 들어가고
나중에 `sessionToBaseline`이 읽는데, `null`을 저장하면 `Number(null) || 0`으로
**다시 거짓 baseline 0이 된다.** 게다가 순서가 중요하다 — `createSession`
(`:1345`)과 `recordActiveLease`(`:1352`) **앞에서** 중단해야 세션과 lease가
남지 않는다. Deep Research 내부에 별도 `baselineCount`가 있지만 그것과 이 값은
다른 것이다.

throw는 `WebAiError`로 하고 기존 taxonomy를 쓴다.

**`provider.commit-not-verified`는 쓰지 않는다.** 초판이 그렇게 적었는데
의미가 틀렸다 — 그 코드는 `commit-verify` 단계의 "prompt를 보냈는데 확인하지
못함"이다. baseline 실패는 prompt 제출 **전**이고 Deep Research에서는 세션 생성
전이다. 재사용하면 호출자가 **중복 전송 가능성이 있는 commit 실패**로 오해한다.
등록된 코드를 쓰는 것과 그 의미를 왜곡하는 것은 다른 문제다.

`snapshot.unavailable`을 쓴다. 이미 등록돼 있고(`cli.mjs:319`), 현재 용법도
`ax-snapshot.mjs:257`의 "스냅샷을 캡처할 수 없었다"라 이 경우와 정확히 같다.
`stage: 'baseline-snapshot'`, `retryHint: 're-snapshot'`으로 쓴다.

`retryHint`를 생략하면 기본값이 `'report'`가 되는데(`errors.mjs:73`) 이건
버그 신고를 뜻해서 틀리다. AX 쪽의 `'pin-playwright-or-add-cdp-fallback'`도
이 경계에는 맞지 않는다 — 여기서는 페이지를 다시 읽으면 된다. X8/X8b가 이
문자열을 직접 assert한다.

`:336`에서 throw하는 것이 과해 보일 수 있으나, 대안은 **틀린 baseline으로
세션을 시작하는 것**이다. 그 세션의 모든 폴이 오염된다. 기존
`provider.commit-not-verified`(`chatgpt-composer.mjs:137`)와 같은 판단이다 —
검증 못 한 상태로 진행하지 않는다.

`:1605`는 다르다. 안정화 대기는 재시도가 자연스럽고, 데드라인이 있다.

## 검증

| # | 시나리오 | 관측 |
| --- | --- | --- |
| X1 | 두 evaluate 모두 throw | `readAssistantSnapshots` → `ok:false` |
| X2 | 첫 evaluate 실패, 둘째 성공 | `ok:true` (기존 2단계 폴백 보존) |
| X2b | 첫 evaluate 성공·빈 배열, 둘째 실패 | `ok:true, []` — 1차가 읽었다 |
| X2c | 첫 malformed(`null`/객체), 둘째 성공 | `ok:true` — malformed는 실패한 시도다 |
| X2d | 두 시도 모두 malformed | `ok:false` |
| X3 | 성공했는데 결과가 빈 배열 | `ok:true, snapshots:[]` — 실패와 구별 |
| X4 | locator `all()`이 전부 throw | `readTopLevel…FromLocators` → `ok:false` |
| X4b | `all()`은 성공, 매치 node의 text read가 전부 실패 | **`ok:false`** — 감사가 짚은 구멍 |
| X5 | 셀렉터 하나만 주입, 정상 빈 결과 | `ok:true, texts:[]` (과잉 차단 방지) |
| X5b | 일부 셀렉터의 `all()` 실패 + 다른 셀렉터 정상 빈 결과 | **`ok:false`** — 조사 못 한 경로가 있다 |
| X5c | **모든** 셀렉터가 정상 빈 결과 | `ok:true, []` (과잉 차단 방지) |
| X6 | split 실패 + legacy 실패 | `countAssistantMessages` → `null` |
| X7 | split 실패 + legacy 성공 | 기존 폴백 유지 |
| X8 | X6 상태에서 send | throw: `snapshot.unavailable` / `stage:'baseline-snapshot'`, baseline 미저장 |
| X8b | X6 상태에서 `deepResearchWebAi` | 같은 `errorCode`·`stage`·`retryHint`, **세션·lease 미생성** |
| X9 | 정상 send | baseline 저장, 회귀 없음 |
| X10 | X6 상태에서 `waitForStableAssistantCount` | 안정으로 세지 않고 데드라인까지 재시도 |
| X11 | 폴 루프 `:759`, **이전 tick에서 `stableText`가 찬 뒤** split 실패 + fallback 실패 | 후보 없음 + **stable 초기화** + pacing 통과 |
| X12 | 폴 루프 `:759`, split 실패 + fallback 성공 | 기존 폴백 동작 유지 |
| X13 | wrapped 옛 답변 + ordering을 양쪽 `unverifiable`로 고정, baseline만 0 vs 정상 | 오염 쪽만 옛 답변을 후보로 넣는다 |

X2b·X3·X5·X5c·X7·X9·X12가 과잉 차단 방지다. **WP10~WP13에서 이 짝이 없으면
mutation이 GREEN으로 남는 일이 반복됐다.**

X13이 결함 자체의 회귀 테스트다. baseline만 다른 짝을 만들어 후보 집합이
갈리는 것을 public path에서 보인다 — ordering gate가 우연히 막아주는 것에
기대지 않는다.

### mutation proof

| mutation | RED |
| --- | --- |
| `readAssistantSnapshots`의 `ok:false`를 `ok:true`로 | X1 |
| malformed를 성공으로 취급 | X2d |
| `readTopLevel…FromLocators`의 `ok:false`를 `ok:true`로 | X4 |
| text read 전부 실패를 `ok:true`로 | X4b |
| `countAssistantMessages`의 `null` 분기 삭제 | X6 |
| `:336`의 throw 삭제 | X8 |
| `:1343`의 throw 삭제 | X8b |
| `:759`의 `ok:false` 분기 삭제 | X11 |

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `web-ai/chatgpt.mjs` | `readAssistantSnapshots`(`:1628`), `readAssistantMessages`(`:1617`), `countAssistantMessages`(`:1583`), 소비자 `:759`, 호출부 `:336`·`:1343`·`:1605` |
| `web-ai/chatgpt-response-dom.mjs` | `readTopLevelAssistantTextsFromLocators`(`:456`) |
| 테스트 | X1~X13 |

`readTopLevelAssistantTextsFromLocators`는 export이므로 다른 소비자를 먼저
전수 확인한다.

## 실행 결과 (2026-08-01)

커밋 다섯: `52ebed3`(소스), `6feddeb`(혼합 분기 테스트), `9635426`(부분 읽기
교정), `d86f394`(X10 falsifiable + 8초 단축), 문서.

### 감사가 잡은 것

처방 4라운드 + 구현 4라운드. 실제 결함 둘이 나왔다.

| # | 발견 |
| --- | --- |
| 1 | **소비자 `:759` 누락** — 구조체에 `.map`을 호출해 런타임 오류. 처방 단계에서 잡혔다 |
| 2 | **부분 읽기가 성공으로 반환** — node 둘 중 하나만 읽히면 `ok:true`에 텍스트 하나. baseline이 1이 되어 나머지 turn을 새 답으로 재유입한다. 0을 기록하는 것과 같은 오염인데 더 조용하다 |

2번이 이 유닛의 교훈을 다시 보여준다. "전부 실패"만 실패로 본 것이 틀렸다 —
positional count에서는 **덜 센 것도 틀린 것**이다.

### 테스트가 통과하는 이유가 틀렸던 것 셋

| 테스트 | 문제 |
| --- | --- |
| X11b(초판) | 첫 tick부터 실패해 `stableText`가 채워진 적이 없다. reset 세 줄을 지워도 GREEN. 내가 돌린 mutation은 pacing까지 함께 지워서 hang이 pacing 탓이었다 |
| X8/X8b(초판) | error shape만 검사. `saveBaseline` 뒤에 throw해도 통과했고, X8b는 `getTargetId`를 안 넣어 lease 경로가 비활성이라 "lease 없음"이 공허했다 |
| X10 | 아예 없었다. 반복 `null`을 stable로 세도 뒤이은 최종 count가 같은 error를 내므로 GREEN |

X10은 가상시계로 해결했다 — 가드가 있으면 8초 예산을 다 쓰고 없으면 2회 만에
반환한다. 부수적으로 X8이 8002ms → 3ms가 됐다.

### 내 fixture 버그

`waitForStableAssistantCount`가 카운터를 반복 호출하는데 절대 호출순서로
스크립팅해서 두 번째 라운드부터 desync됐다. parity로 바꿨다.

### 검증

```
npx vitest run test/unit test/integration
  Test Files 180 passed (180); Tests 2046 passed (2046)
npm run gate:all              All 17 gate(s) passed (exit 0)
bash structure/check-doc-drift.sh   164 passed
bash structure/verify-counts.sh      76 passed
```

mutation 6건 RED: `:336` throw, locator `ok:false`, 1차-성공-빈 규칙,
`:759` stable reset, 부분 읽기 폐기, null stable 가드.

## 이 work-phase가 닫는 것과 닫지 않는 것

닫는 것: **B01·B02·B07**의 실패/빈 구별. `021` 3절이 "빈 읽기와 구별 불가"로
지목한 셋이다.

닫지 않는 것:

- 이 경계들의 **데드라인**. 여전히 무한 대기 가능하고 그건 예산 계약이다.
- **B05** — `catch`가 `{finished:false}`를 주므로 완료 자격을 추가하지 않는다.
  `021:251`의 "안전한 방향" 판정에 동의한다.
- **B04 — "안전하다"는 내 판정을 철회한다.** 주 poll에서는
  `readActivityState`의 후속 DOM probe와 WP10의 `unknown`이 막지만,
  `anyStopButtonVisible`은 공유 producer이고 직접 소비자 셋이 그 `false`를
  완료 판정에 그대로 쓴다.

  | 소비자 | `false`의 결과 |
  | --- | --- |
  | `chatgpt-multi-turn.mjs:56` | stable text가 1.5초 뒤 완료될 수 있다 |
  | `chatgpt-deep-research.mjs:77` | 완료 조건 `!streaming`에 직접 들어간다 |
  | `chatgpt-work-picker.mjs:1024` | stop read 실패 중 Copy가 보이면 complete |

  boolean을 structured stop verdict로 바꿔 세 소비자까지 전파해야 닫힌다.
  이 work-phase 범위 밖이며 **OPEN 항목으로 등록한다.**
- G1·G2·G4.

**c7을 met으로 적지 않는다.** 담당 경계 15개 중 데드라인 인지는 여전히 0개다.
