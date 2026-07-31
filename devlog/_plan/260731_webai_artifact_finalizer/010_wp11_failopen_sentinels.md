# 010 — WP11 fail-open 교정 처방 (B24, B25, B36, B23)

- unit: `devlog/_plan/260731_webai_artifact_finalizer/`
- work-phase: WP11 (계획 표의 WP7 fail-open 교정분을 예산 계약과 분리해 선행)
- 선행: 없음 — **예산 모델 A의 reversal gate G1~G4와 독립이다**
- 자매: `devlog/_plan/260731_webai_poll_deadline/020_wp10_failopen_sentinels.md`
  (같은 부류의 B03·B06을 먼저 닫았다)

## 왜 지금인가

자매 유닛 WP10이 B03·B06을 fail-closed로 바꿨다. 남은 넷은 같은 결함 유형이고
같은 이유로 예산 계약을 기다릴 필요가 없다. `021` §3이 여섯을 한 묶음으로
지목했고, 계획서 둘 다 "예산 계약과 독립적으로 고쳐야 한다"고 적었다.

WP10에서 배운 것을 그대로 적용한다.

1. sentinel과 정상값을 값 수준에서 분리한다. 이름만 바꾸면 소용없다.
2. 소비자별 해석을 **각각** 정한다. 열거값 추가만으로는 경로마다 반대로 갈린다.
3. 관측 실패를 warning으로 표면화한다. 조용히 진행하면 fail-open을 옮긴 것이다.
4. fixture가 실패 경로를 **모델링**하는지 확인한다. WP10에서 네 fixture가
   fail-open에 기대어 통과 중이었다.

## B24 — `getTargetId` 실패가 mismatch 검사를 통째로 건너뛴다

### 현재 계약

```
chatgpt.mjs:682  const currentTargetId = await deps.getTargetId?.().catch(() => null);
chatgpt.mjs:683  if (currentTargetId && currentTargetId !== session.targetId) { ... }
```

`null`이면 `if`가 통째로 거짓이 되어 **검사 자체가 사라진다.** 취득 실패와
"target이 같다"가 구분되지 않는다.

이 검사의 목적은 다른 대화의 답을 읽지 않는 것이다. CDP가 불안정할 때 —
즉 탭이 바뀌었을 가능성이 가장 높을 때 — 검사가 꺼진다.

`:641`의 세션 해석에도 같은 `.catch(() => null)`가 있다. 거기서는 null이
`findActiveSession`의 targetId 힌트를 지우는 것이라 성격이 다르다(아래 B23).

### 처방

판정을 세 상태로 모델링한다. **진단 원인이 아니라 identity 관점으로 나눈다.**

```
readTargetIdentity(deps, session)
  → { verdict: 'verified' | 'mismatch' | 'unknown', actualTargetId: string|null }
```

**verdict 문자열만 반환하면 안 된다.** `buildTargetMismatchResult`가
`actualTargetId`를 필수 증거로 받고(`session-target-guard.mjs:109-118`) 기존
테스트도 그 값을 구조적으로 assert한다. verdict만 넘기면 mismatch 결과를
재구성하려고 다시 probe해야 하고, 두 읽기 사이에 target이 바뀌는 race가 생긴다.
**한 번 읽어 둘 다 넘긴다.**

루프와 recovery는 같은 결과 객체를 쓰고, mismatch 반환에는
`mergeObservationWarnings(buildTargetMismatchResult(...), observations)`를
적용한다 — WP10에서 정한 envelope 규약 그대로다.

| 결과 | 판정 |
| --- | --- |
| 문자열 == `session.targetId` | `verified` |
| 문자열 != `session.targetId` | `mismatch` — 기존 반환 |
| `null`/`undefined` 반환 | `unknown` |
| throw | `unknown` |

**null도 `unknown`이다.** 초판은 이걸 정상 통과로 뒀는데 틀렸다. throw와 null은
진단 원인이 다를 뿐, "현재 탭이 session target과 같다"는 증거가 없다는 점에서
똑같다. `session?.targetId`가 있는 분기에 들어온 이상 identity는 검증돼야 한다.

### warning만으로는 부족하다

초판은 관측만 기록하고 완료 후보 자격은 그대로 뒀다. 그러면 **틀린 답이
`complete`로 나간다.**

`:681`의 `if (session?.targetId)` 분기에 들어가면 `else`의 conversation URL
mismatch 검사는 **실행되지 않는다.** 즉 target 검증이 꺼지면 그 tick에는
identity 확인이 하나도 없다. 그 상태로 안정화 조건이 채워지면 데드라인 전에
완료된다 — "데드라인까지 재시도"라는 초판 설명도 제어 흐름과 맞지 않았다.

따라서 `unknown`은 **WP10의 ordering `unknown`과 동일하게** 처리한다.

```js
const identity = await readTargetIdentity(deps, session);
if (identity.verdict === 'mismatch') {
    return mergeObservationWarnings(buildTargetMismatchResult({
        vendor, session, actualTargetId: identity.actualTargetId,
        port: deps.getPort?.() || 9222, url: page.url(), baseline,
    }), observations);
}
if (identity.verdict === 'unknown') observations.add('target-identity-unverified');
// 완료 판정 진입 조건에 (identity.verdict === 'verified') conjunct 추가.
// unknown이면 else 분기가 stable 상태를 초기화하고 pacing을 통과한다.
```

비교는 **반드시 `identity.verdict`로** 한다. 반환형이 구조체인데 문자열과
비교하면 모든 분기가 거짓이 되어 mismatch·unknown 처리가 사라지고 정상
완료까지 막힌다.

`continue`는 쓰지 않는다 — WP10에서 확인했듯 pacing을 건너뛰면 가상시계가
전진하지 않아 데드라인에 닿지 못한다.

### recovery도 같은 게이트를 지나야 한다

루프만 막으면 **박탈한 자격이 recovery에서 복원된다.** identity가 계속
unknown이면 루프는 데드라인까지 완료를 거부하지만, `:930`의 post-deadline
recovery가 같은 텍스트를 다시 읽어 `complete`로 돌려준다.

WP10에서 ordering으로 똑같은 일을 겪었다. 그때는 테스트를 쓰다 발견했고,
이번에는 감사가 처방 단계에서 잡았다. 같은 실수를 두 번 하지 않는다.

```
recovery 완료 직전:
  { verdict, actualTargetId } = readTargetIdentity(deps, session)
  'verified' → 기존 완료 경로
  'mismatch' → mergeObservationWarnings(buildTargetMismatchResult({..., actualTargetId}), observations)
  'unknown'  → target-identity-unverified 기록 후 deferred(session) / timeout
```

이 conjunct를 삭제하면 RED가 되는 mutation 테스트를 별도로 둔다(U1b).

회복되면 다음 tick에 완료되고, 회복되지 않으면 timeout이다. **틀린 답 대신
timeout**이라는 WP10의 원칙 그대로다.

## B25 — CDP 부재가 파일 수집을 조용히 건너뛴다

### 현재 계약

같은 `deps.getCdpSession`인데 소비자가 갈린다.

| 위치 | 부재 시 | 판정 |
| --- | --- | --- |
| 이미지 `:808-815` | `throw WebAiError('provider.image-output')` | **fail-closed** |
| 파일 `:849-861` | `if (fileCdp)` 거짓 → 조용히 통과 | **fail-open** |

파일 쪽은 성공 finalization을 그대로 진행한다. 사용자는 CSV/PDF가 딸린 답을
요청했는데 파일 없이 `complete`를 받는다.

### 처방

이미지처럼 throw로 올리지는 않는다. 두 요청의 성격이 다르다 —
`--output-image`는 **명시적 요청**이고, 첨부 파일 수집은 **암묵적 부가
수집**이다. 명시적 요청 실패는 실패지만, 부가 수집 실패까지 답 전체를
버리게 하면 과잉이다.

대신 `catch`가 이미 하고 있는 것을 부재에도 적용한다.

```js
const fileCdp = await deps.getCdpSession?.();
if (fileCdp) { /* 기존 */ }
else warnings.push('file-artifact-cdp-unavailable');
```

`:861`의 `file-artifact-capture-failed:<message>`와 같은 규약이고,
`chatgpt-files.mjs:402-446`의 `file-artifact-*` 계열에 붙는다.

**이건 fail-closed가 아니라 fail-visible이다.** 용어를 정확히 쓴다 — 답은
여전히 `complete`로 나가고, 달라지는 것은 무음이 사라진다는 것뿐이다.

부가 수집을 요청 실패로 승격하려면 "파일이 있었는지"를 알아야 하는데, CDP가
없으면 그것도 알 수 없다. 진짜 fail-closed를 원한다면 `requireFileArtifacts`
같은 **명시적 요청 계약**이 먼저 있어야 하고, 그때만 CDP 부재를 typed
failure로 올린다. 그건 이 유닛의 범위가 아니다.

따라서 종료 판정에서 B25는 "silent failure 제거"로만 기록하고, c8의
fail-closed 항목에서는 **열어 둔다.** U4도 warning 전달을 증명할 뿐이다.

## B36 — fetch 한 번 실패가 살아 있는 탭 전부를 죽인다

### 현재 계약

```
tab-manager.mjs:395-402  isTabAlive: catch → false
```

소비자들이 이 `false`를 "탭이 죽었다"로 읽는다. 아래는 lease store 안의
대표 셋이고, **전수는 일곱이다**(다음 절).

| 위치 | 동작 |
| --- | --- |
| `tab-lease-store.mjs:320` | pool-expired 판정 |
| `tab-lease-store.mjs:323-325` | `deadIds`에 추가 → 후보에서 제외 |
| `tab-lease-store.mjs:412` | `dead`에 추가 → **lease를 store에서 제거** |

`listTabs`는 `fetch('http://127.0.0.1:<port>/json/list')` 한 번이다
(`tab-manager.mjs:202-206`). 브라우저가 잠깐 바쁘거나 포트가 순간적으로
막히면 **모든 lease가 한꺼번에 dead로 판정된다.** 루프가 lease마다 돌지만
같은 fetch가 매번 실패하므로 피해는 전수다.

lease가 사라지면 실제 탭은 살아남는다 — 아무도 소유하지 않는 좀비 탭이 된다.

### 처방

"모른다"를 표현할 수 있게 한다.

```js
// tab-manager.mjs
export async function probeTabAlive(port, targetId)
  → 'alive' | 'gone' | 'unknown'
```

`isTabAlive`는 boolean 소비자를 위해 남기되 `probeTabAlive`로 구현한다
(`'alive'`만 true). **다만 wrapper를 남기는 것으로 끝나면 아무것도 고쳐지지
않는다** — boolean 소비자는 여전히 unknown을 "죽었다"로 읽는다. 소비자를
전부 바꿔야 한다.

### 소비자는 셋이 아니라 일곱이다

초판은 lease store 셋만 셌다. 감사가 전수를 세었고, **누락된 `:633`이 `021`과
`000_plan.md`가 B36으로 지목한 바로 그 경로**였다.

| # | 위치 | 현재 unknown 동작 | 처방 |
| --- | --- | --- | --- |
| 1 | `tab-lease-store.mjs:320` pool-expired | 닫지 않음 | 유지 — 모르는 탭을 닫으면 사용자 작업 파괴 |
| 2 | `tab-lease-store.mjs:323` 후보 선정 | dead 처리 후 제외 | 후보에서 제외하되 **`deadIds`에는 넣지 않는다** |
| 3 | `tab-lease-store.mjs:412` cleanup | **lease 제거** | 제거하지 않는다 |
| 4 | `tab-lease-store.mjs:633` close 실패 후 | **`closed.push()` → lease 제거** | **`failed.push()`** — close 실패로 간주하고 lease 유지 |
| 5 | `tab-recovery.mjs:49` reattach | `alive=false` → 새 탭 생성 | 새 탭을 만들지 않는다. typed unverified/deferred로 반환 |
| 6 | `tab-recovery.mjs:153` verifySessionTab | `needsRecovery: true` | `liveness: 'unknown'`을 결과에 보존한다 (아래) |
| 7 | `tab-monitor.mjs:46` health check | `tab:closed` emit | unknown은 closed/recovered 전이를 만들지 않는다 |

`:633`이 가장 중요하다. `closeTab`이 실패한 뒤 "그래도 탭이 살아 있나?"를 묻는
자리인데, fetch가 실패하면 `else closed.push(lease)`로 가서 **닫히지도 않은
탭의 lease를 지운다.** 좀비 탭이 만들어지는 정확한 지점이다.

5·6·7도 실제 피해가 있다. recovery가 unknown을 gone으로 읽으면 살아 있는 탭을
두고 **새 탭을 열어** session target을 재바인딩한다. monitor는 일시적 fetch
실패로 `tab:closed`를 방출한다.

`:323`과 `:412`가 같은 unknown을 반대로 처리하는 것은 의도다. 전자는 "이번엔
쓰지 말자", 후자는 "기록은 지우지 말자"다. 둘 다 보수적이다.

**pool 누적 우려**: unknown이 지속되는 동안 expired lease가 쌓일 수 있다. 한
번의 실패로 영구 누적되지는 않는다 — 다음 checkout/cleanup이 다시 probe한다.
지속적 unknown에 대한 bounded retry와 관측은 예산 WP의 몫이다.

### `verifySessionTab`의 unknown은 상위까지 전달해야 한다

소비자 6번은 `{valid, needsRecovery}` boolean 쌍만 반환한다. unknown을
`{valid:false, needsRecovery:false}`로 뭉개면 새 탭 생성은 막히지만 **상위가
오분류한다.**

`resolveSessionPage`(`tab-recovery.mjs:448-462`)를 보면:

| 경로 | `needsRecovery:false`일 때 | 문제 |
| --- | --- | --- |
| `allowNavigate: false` | `strategy: 'recovered'` | 복구한 적이 없는데 복구했다고 말한다 |
| `allowNavigate: true` | 일반 "recovery failed" throw | 원인이 사라진다 |

따라서 verdict를 결과에 실어 보낸다.

```js
// VerifyResult에 추가
{ valid, needsRecovery, liveness: 'alive'|'gone'|'unknown' }
```

`resolveSessionPage`는 `liveness === 'unknown'`을 **typed unverified**로
전달한다 — `strategy: 'recovered'`도 아니고 일반 실패도 아니다. 탭이 살아
있는지 확인할 수 없었다는 사실 그대로를 올린다.

"typed unverified"를 말로만 두면 구현자가 warning 하나 붙이고 충족했다고
주장할 수 있다. **필드를 정한다.**

현재 union은 `ResolveSessionPageOk | ResolveSessionPageMismatch`이고
(`tab-recovery.mjs:353`), 후자의 `strategy`는
`'existing-tab'|'new-tab'|'recovered'` 셋뿐이다(`:347`). 넷째를 추가한다.

```js
/**
 * @typedef {Object} ResolveSessionPageUnverified
 * @property {true} mismatch
 * @property {null} page
 * @property {string | null} targetId
 * @property {WebAiSession} session
 * @property {false} recovered
 * @property {'unverified'} strategy      // ← 넷째 값
 * @property {'unknown'} liveness
 * @property {string[]} warnings
 * @property {string | null} url
 * @property {string | null} conversationUrl
 */
```

union에 추가하고, `VerifyResult`에도 `liveness`를 넣는다
(`tab-recovery.mjs:136-140`).

U14는 `strategy === 'unverified'`와 `liveness === 'unknown'`을 직접 assert하고,
**`recoverSessionTab`이 호출되지 않았음**도 확인한다. warning 문자열만 보면
같은 함정에 다시 빠진다.

일회성 unknown으로 세션이 영영 복구 불능이 되지는 않는다. 다음 호출이 다시
probe한다. 문제는 그 사이의 결과가 **잘못 분류되는 것**이고, 그것만 고친다.
### 왜 재시도가 아닌가

`listTabs`에 재시도를 넣는 방법도 있지만 이 유닛에서는 하지 않는다. 재시도는
시간 예산을 소비하고 그건 예산 계약 WP의 소관이다. 지금은 **한 번 실패했을 때
파괴적으로 행동하지 않는 것**까지가 범위다.

## B23 — 세션 조회 실패가 legacy baseline으로 진행한다

### 현재 상태

`021:265`는 `chatgpt.mjs:597-601`(현재 `:639-644`)의 세션 해석이 비면 오래된
baseline으로 진행할 수 있다고 기록했다.

실제로 읽어보면 이 경로는 **이미 부분적으로 fail-closed다.**

```
:647-649  baseline = sessionToBaseline(session) || getBaseline(vendor, url) || getLatestBaseline(...)
:650-656  if (!baseline) throw WebAiError('baseline required')
```

세션이 없으면 URL 일치 baseline을 찾고, 그것도 없으면 throw한다. 위험한 것은
`getLatestBaseline(vendor, { sameHostUrl: url })` 한 갈래다 — 같은 호스트의
**가장 최근** baseline을 집어온다.

### 처방

`session-store`가 동기 IO라 조회 실패와 "세션 없음"을 지금 구조에서 구분할 수
없다. 그 구분은 자매 유닛 WP2(동기 IO 처방)의 소관이고 예산 모델에 묶여 있다.

따라서 **이 work-phase에서는 관측만 남긴다.**

`getLatestBaseline` 갈래로 진입했을 때 — 즉 세션도 URL 일치 baseline도 없어
같은 호스트의 최근 것을 빌려 썼을 때 — `baseline-inferred-from-host`를
기록한다. 사용자가 "왜 엉뚱한 답을 읽었는가"를 사후에 알 수 있다.

구현 순서 주의: observation ledger는 현재 baseline 선택(`:647-649`) **뒤에**
생성된다. ledger 선언을 baseline 해석 앞으로 옮기거나, 임시 변수에 담았다가
ledger 생성 후 병합해야 한다.

위험은 실재한다 — `session-store.mjs:101`이 read/parse 실패를 빈 store로
바꾸므로, store가 깨지면 세션이 사라지고 같은 호스트의 남의 baseline으로
진행할 수 있다.

**완전 교정이 아님을 명시한다.** c8의 B23 항목은 이 work-phase로 닫히지 않으며,
동기 IO 처방 뒤에 재방문한다.

## 검증

| # | 시나리오 | 관측 |
| --- | --- | --- |
| U1 | `getTargetId`가 throw | `unknown` → 루프 **완료 불가**, `target-identity-unverified` 기록 |
| U1b | identity가 계속 unknown인 채 데드라인 도달 | **recovery도 complete를 반환하지 않는다** — 루프의 거부가 복원되지 않는다 |
| U2 | `getTargetId`가 `null` 반환 | `unknown` → **완료 불가** (throw와 동일 취급) |
| U2b | `getTargetId`가 session target과 일치 | `verified` → 정상 완료 (과잉 차단 방지) |
| U3 | `getTargetId`가 다른 값 반환 | 기존 mismatch 반환 유지 |
| U3b | recovery 시점의 mismatch | `actualTargetId`가 실려 있고 기존 observation도 보존된다 |
| U4 | `getCdpSession` 부재 + 파일 수집 | `file-artifact-cdp-unavailable` 전달, 답은 정상 반환 (fail-visible 증명이지 fail-closed 아님) |
| U5 | `getCdpSession` 부재 + `outputImage` | 기존 throw 유지 (명시적 요청은 실패) |
| U6 | `listTabs` fetch가 throw | `probeTabAlive` → `'unknown'` (producer 단독 테스트) |
| U7 | verdict `unknown` 주입 + `cleanupLeasedTabs` | **lease가 제거되지 않는다** |
| U8 | verdict `unknown` 주입 + pool 후보 선정 | 후보로 쓰지 않고, 닫지도 않고, `deadIds`에도 안 넣는다 |
| U9 | verdict `gone` 주입 | 기존 제거 동작 유지 (과잉 차단 방지) |
| U11 | `closeTab` 실패 + verdict `unknown` (`:633`) | **`failed`로 분류돼 lease 유지** — B36의 원 경로 |
| U12 | recovery reattach + verdict `unknown` (`:49`) | 새 탭을 만들지 않는다 |
| U13 | monitor health check + verdict `unknown` (`:46`) | `tab:closed`를 방출하지 않는다 |
| U14 | `verifySessionTab` + verdict `unknown` (`:153`) | `strategy === 'unverified'` + `liveness === 'unknown'`, **`recoverSessionTab` 미호출** |
| U14b | `verifySessionTab` + verdict `gone` | 기존 recovery 시작 (과잉 차단 방지) |
| U10 | baseline이 `getLatestBaseline`에서 옴 | `baseline-inferred-from-host` 기록 |

U2b·U5·U9가 과잉 교정 방지다. WP10의 T5·T8·T12b와 같은 역할이다.

**producer와 소비자를 분리 주입한다.** U6만 실제 fetch 실패를 쓰고, U7·U8·U11~U14는
verdict를 직접 주입한다. 실제 fetch 실패를 공유하면 producer mutation 하나가
소비자 테스트까지 한꺼번에 RED로 만들어 "어느 것이 무엇을 보호하는지"가
사라진다.

### mutation proof

각각 되돌렸을 때 RED가 되어야 한다.

| # | mutation | RED가 될 테스트 |
| --- | --- | --- |
| 1 | 루프 완료 conjunct에서 `identity.verdict === 'verified'` 삭제 | U1·U2 |
| 1b | recovery의 identity conjunct 삭제 | U1b |
| 2 | B25의 `else warnings.push` 삭제 | U4 |
| 3 | `probeTabAlive`가 `'unknown'` 대신 `'gone'` 반환 | U6 (producer 단독) |
| 4 | `:412`의 unknown 가드 삭제 | U7 |
| 5 | `:633`의 unknown → `closed` 로 되돌리기 | U11 |
| 6 | `:49` recovery의 unknown 가드 삭제 | U12 |
| 7 | `:153`의 `liveness` 보존 삭제 (unknown → gone) | U14 |

**WP10에서 mutation 넷 중 하나가 GREEN으로 남았고 감사가 그것을 잡았다.**
테스트가 다른 조건 때문에 통과하고 있었다. 여기서는 각 테스트가 대상 조건
하나로만 갈리는지 먼저 확인한다. 구체적으로: 각 테스트를 짝으로 만들어
(대상 조건만 다른 두 케이스) 하나는 GREEN, 하나는 RED임을 보인다.

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `skills/browser/tab-manager.mjs` | `probeTabAlive` 신규 export, `isTabAlive`를 그 위에 재구현 |
| `web-ai/tab-lease-store.mjs` | `:320`, `:323`, `:412`, **`:633`** 네 소비자의 `'unknown'` 처리 |
| `web-ai/tab-recovery.mjs` | `:49`의 unknown이 새 탭을 만들지 않게, `:153` `VerifyResult`에 `liveness` 추가, `resolveSessionPage`(`:448-462`)가 unknown을 typed unverified로 전달 |
| `skills/browser/tab-monitor.mjs` | `:46`의 unknown이 상태 전이를 만들지 않게 |
| `web-ai/chatgpt.mjs` | B24 identity 3상태 + 루프 완료 conjunct(`:681-695`) + **recovery conjunct(`:930`)**, B25 부재 warning(`:849`), B23 관측(`:647-649`, ledger 선언 위치 조정) |
| `test/unit/tab-lifecycle.test.mjs` | U6~U9, U11~U14b |
| `test/unit/web-ai-chatgpt-activity-poll.test.mjs` | U1·U1b·U2·U2b·U3·U3b, U10 |
| `test/unit/web-ai-provider-session.test.mjs` | U4·U5 |

## 이 work-phase가 닫는 것과 닫지 않는 것

### 실행 결과 (2026-07-31)

커밋 여섯. 소스 셋, 테스트 셋이다.

| 커밋 | 내용 |
| --- | --- |
| `2cfb668` | 소스 교정 — 처방 본문 |
| `a64888d` | endpoint 판정 철회 + 상위 소비자 네 곳 |
| `3e45768` | `withSessionPage`, error code 등록, U8/U12 |
| `cb518dc` | public envelope 고정 (U14/U15/U12b) |
| `ae54efe` | 상위 정책 셋 (U16/U17) + U15b |
| `25f6985` | CLI mapper와 두 번째 guard |

#### 구현 중 철회한 판단

`ECONNREFUSED`·`ENOTFOUND`·"bad port"를 `gone`으로 분류하는 코드를 넣었다가
감사 지적으로 **되돌렸다.**

넣은 이유는 기존 lease 테스트 넷이 죽은 포트(65531, 111)를 가리키고 있었고,
아무것도 listen하지 않는 포트라면 탭도 없다고 봤기 때문이다. 하지만 그건
**이 유닛이 없애려는 바로 그 혼동**이다. 단일 fetch 실패는 endpoint가 그 순간
조용했다는 사실이지 target이 소멸했다는 증거가 아니고, `gone`의 소비자는
lease를 지우고 탭을 새로 연다. "bad port" 문자열 매칭은 Undici 구현 의존이라
더 나빴다.

테스트 넷은 `serveEmptyTabList()`로 고쳤다 — "탭이 없다"를 읽을 수 있는 빈
목록으로 직접 말한다. **테스트를 통과시키려고 production 의미를 바꾼 것이
애초의 잘못이었다.**

#### 감사가 잡은 것

구현 감사 6라운드, blocker 12건. WP10과 같은 종류가 반복됐다.

| # | 증상 |
| --- | --- |
| 1 | endpoint 부재를 target 소멸로 오판 (위) |
| 2 | `ResolveSessionPageUnverified`를 반환만 하고 **아무도 읽지 않음** — reattach는 새 탭을 열고, CLI는 navigate를 권하고, forceRecover는 generic throw, doctor는 recovery 권고 |
| 3 | `poll --session`의 실제 경로 `withSessionPage`가 누락 |
| 4 | `cdp.liveness-unverified`를 발명해놓고 taxonomy·README·SKILL·contract test 어디에도 등록 안 함 |
| 5 | `:633`, monitor, checkout, recovery 가드가 **삭제해도 GREEN** |
| 6 | U15가 첫 probe에서 끝나 두 번째 guard에 도달하지 않음 |
| 7 | "CLI mapper는 비-export라 테스트 불가"라는 내 주장이 틀림 — 기존 테스트가 이미 `runWebAiCli`로 도달 |

2번과 3번이 같은 교훈이다. **계약을 만들었다고 소비자가 쓰는 것은 아니다.**
`liveness`를 반환형에 넣고 끝냈다면 결함은 한 레이어 위에서 그대로였다.

5번은 WP10의 반복이다. 가드를 넣고 테스트를 붙였는데 그 테스트가 다른 조건
때문에 통과하고 있었다.

#### mutation proof

각각 되돌려 정확히 RED가 되는 것을 확인했다(복원 후 매번 diff 확인).

| mutation | RED |
| --- | --- |
| 루프 `identityOk` conjunct | U1·U2·U1b |
| recovery `identityOk` conjunct | U1b |
| `probeTabAlive` unknown → gone | U6·U7·U14 |
| lease cleanup(`:412`) 가드 | U7 |
| close 실패(`:633`) 가드 | U11 |
| monitor unknown early return | U13 |
| checkout(`:323`) 가드 | U8 |
| `recoverSessionTab` unknown 가드 | U12 |
| `resolveSessionPage` unverified 블록 | U14·U15 |
| `withSessionPage` 첫 guard | U15 |
| `withSessionPage` 두 번째 guard | page-death 테스트 |
| `recovery.strategy === 'unverified'`(forceRecover) | U15b |
| CLI mapper 분기 | CLI envelope 테스트 |

#### 검증

```
npx vitest run test/unit test/integration
  Test Files 179 passed (179); Tests 2003 passed (2003)
npm run gate:all              All 16 gate(s) passed (exit 0)
npm run typecheck             exit 0   (.mjs 미대상)
bash structure/check-doc-drift.sh   164 passed
bash structure/verify-counts.sh      76 passed
```

닫는 것: c8의 fail-open 중 **B24·B36**.

닫지 않는 것:

- **B25** — fail-visible까지다. 답은 여전히 `complete`로 나가므로 c8의
  fail-closed 항목에서는 **열어 둔다.** 진짜 fail-closed는 명시적
  `requireFileArtifacts` 계약이 생긴 뒤에 가능하다.
- **B23** — 동기 IO 처방(자매 WP2) 없이는 조회 실패와 부재를 구분할 수 없다.
  관측만 남긴다.
- c8의 나머지 — 배정 경계 21개의 예산 상한. G1~G4에 묶여 있다.

**이 work-phase만으로 c8을 met으로 적지 않는다.**
