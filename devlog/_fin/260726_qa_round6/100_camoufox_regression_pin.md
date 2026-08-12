# WP8 — Q6 수정을 회귀 테스트로 고정했다

040 문서 §5.1이 남긴 항목이다. Q6은 camoufox 레인이 `camoResult.content`를 읽던
것을 `camoResult.html`로 고쳤는데, **그 수정을 지키는 테스트가 없었다.**

## 1. 무엇이 무방비였나

`camoufox-session.mjs`와 Python emitter는 `html`을 내보낸다. `content`를 읽으면
`text`가 항상 `''`이 되고, `index.mjs:390`의 `if (camoCandidate.text)`가 후보를
버린다. 즉 **camoufox가 설치돼 있어도 이 레인은 아무 증거도 만들지 못한다.** 겉으로는
아무 오류도 나지 않는다.

기존 테스트는 `browser-adaptive-fetch-camoufox.test.mjs` 1건뿐이고 aborted-signal
경로만 본다. 필드명을 되돌려도 게이트는 초록색이었다.

## 2. "설계 변경이 필요하다"는 진단이 틀렸다

040 §5.1에 이렇게 적었었다.

> 이번 라운드에서 고치지 않는 이유는 스폰 없이 이 경로를 테스트하려면 주입 지점이
> 필요해 설계 변경이 되기 때문이다.

**같은 파일에 주입 선례가 이미 있었다.**

```js
// index.mjs:126 — 원래부터 있던 것
const fetchImpl = deps.fetch || input.fetchImpl;
```

`deps.fetch` 하나로 fetch 레인 전체가 스폰 없이 테스트된다. camoufox 레인만 모듈
import를 직접 부르고 있었다. 그래서 필요한 것은 설계 변경이 아니라 한 줄이었다.

```js
const camoufoxImpl = deps.fetchViaCamoufox || fetchViaCamoufox;
```

이 라운드가 반복해서 확인한 규칙 그대로다 — **결함을 볼 때 저장소 안에 이미 옳게
하는 곳이 있는지 먼저 묻는다.** 이번에는 그걸 묻지 않아 "설계 변경"이라는 진단을
한 라운드 동안 이월 사유로 들고 있었다.

## 3. 테스트

처음에 2건을 추가했다(29 → 31건).

- `reads html from the camoufox lane and adopts it as evidence` — `html`을 주는
  가짜 레인으로 `--browser required` 전체 경로를 태우고, 최종 `evidence`에
  `camoufox-render`가 실리고 본문이 100자를 넘는지 본다.
- `drops the camoufox candidate when the render carries no text` — 빈 렌더가
  후보로 둔갑하지 않는지.

뮤테이션 3종이 RED다.

| Mutant | 결과 |
|--------|------|
| M10 `camoResult.html` → `camoResult.content` (**Q6 결함 복원**) | 1 failed / 30 passed |
| M11 `evidence`에 `camoufox-render` 태그 추가 제거 | 1 failed / 30 passed |
| M12 빈 텍스트 가드(`if (camoCandidate.text)`) 제거 | 1 failed / 30 passed |

M10이 이 WP의 목적이다. Q6이 고친 바로 그 결함을 되돌리면 이제 게이트가 빨갛다.

### 3.1 리뷰어가 살아남는 변이 6종을 찾았다

A-gate에서 리뷰어가 자체 뮤테이션 12종을 돌려 **내 테스트가 못 잡는 것 6종**을
보고했다. 그중 셋을 이번에 닫았다.

| 변이 | 리뷰어 측정 | 실제 손실 |
|------|------------|-----------|
| M-D `browserMode !== 'never'` 가드 제거 | **전체 1892건 GREEN** | `--browser never`인데 camoufox 스폰 |
| M-F `camoResult?.ok` → `camoResult` | 31 GREEN | 실패 렌더(차단 페이지)를 증거로 채택 |
| M-G `.catch(() => null)` 제거 | 31 GREEN | 레인 예외가 전체 fetch를 죽임 |

M-D가 가장 무겁다. 통합 209 + 유닛 1683, **1892건 전부가 초록인 채로** `--no-browser`
사용자가 매번 스폰 비용을 낸다. 040 §4가 측정한 "미설치 시 프로세스당 프로브 2회"
라는 비용 논증의 전제가 핀되어 있지 않았다 — 그리고 §3.2에서 드러나듯 그 전제는
핀만 없던 게 아니라 **깨져 있었다.**

테스트 4건을 더 넣었다(31 → 35건). `never` 모드 미스폰, `ok:false` 렌더 불채택,
레인 throw 시 생존, 그리고 아래 §3.2의 것.

### 3.2 테스트를 쓰다 결함이 나왔다 — `strong_ok` 가드가 죽어 있었다

리뷰어가 M-E("이미 강한 결과가 있어도 매번 스폰")도 살아남는다고 보고했다. 그걸
막는 테스트를 쓰다 **가드 자체가 동작하지 않는다**는 것을 발견했다.

```
$ 직접 fetch가 strong_ok(score:81, text:3374)를 만든 상태에서 auto 모드 실행
CAMO CALLED          ← 스폰됐다
verdict strong_ok
```

원인은 한 단어다.

```js
// 결함
if (!readerCandidates.some(c => c.verdict === 'strong_ok') && ...)
```

`verdict`는 **채점된** 후보에 붙는 필드다. `readerCandidates`에 들어가는 것은
`fromFetchResult`가 만든 raw 후보이고, 그 키 목록에 `verdict`가 아예 없다
(`source,label,finalUrl,title,text,contentType,status,ok,metadata,evidence,warnings,rawTextLength`).
즉 `c.verdict`는 항상 `undefined`이고 **이 가드는 처음부터 항상 참이었다.**

저장소가 이미 옳게 하는 곳이 바로 아래 두 군데 있었다 — `:427`과 `:454`가
`chooseBestReaderCandidate(...)`로 채점한 뒤 `best.verdict === 'strong_ok'`를 본다.
같은 방식으로 고쳤다.

```js
const bestBeforeCamoufox = chooseBestReaderCandidate(readerCandidates);
if (bestBeforeCamoufox?.verdict !== 'strong_ok' && options.browserMode !== 'never') {
```

뮤테이션 2종 RED: 결함을 그대로 복원(M-E2)해도, 가드를 통째로 지워도(M-E3) 1 failed다.

**이 라운드에서 세 번째다.** WP5도 WP6도, 그리고 여기서도 결함의 정답이 같은 파일
몇십 줄 아래에 이미 있었다.

#### 040의 비용 서술을 정정해야 한다

이 결함은 040 §4/§6의 비용 논증에 직접 걸린다. 그 문서는 "`--browser required`에서는
매번 탄다"고 적었는데 실제로는 **`never`를 제외한 모든 모드**에서 매번 탔다. 그리고
"미설치 시 40~50ms"만 적혀 있고 설치된 환경의 비용이 빠져 있었는데, 그게 §1이 측정한
**6.1초 × 매 fetch**였다.

040이 유지 처분을 저울질한 근거표의 "무해함" 항목이 여기 걸린다. 6.1초를 auto 모드
매 fetch마다 무는 것은 무해가 아니다. 040 §4에 머리말을, §6 목록에 단서를 달았다.

### 3.3 같은 실수의 네 번째 사례 — Phase 1d는 한 번도 실행된 적이 없다

리뷰어가 `chooseBestReaderCandidate`의 반환 형태를 조사하다 찾았다. `index.mjs:341`:

```js
const bestSoFar = chooseBestReaderCandidate(readerCandidates);
if (bestSoFar?.text) {
```

`bestSoFar`는 채점 래퍼다. 래퍼의 키는
`candidate,score,verdict,markers,textLength,density,evidence` — **`text`가 없다.**
본문은 `bestSoFar.candidate.text`에 있다. 실측했다.

```
wrapper keys: candidate,score,verdict,markers,textLength,density,evidence
best?.text = undefined
best.candidate.text len = 999
```

`verdict` 건과 정확히 대칭인데 방향이 반대다. camoufox 쪽은 가드가 **항상 참**이라
레인이 항상 돌았고, 이쪽은 조건이 **항상 거짓**이라 Phase 1d(203.7
candidate-discovery)가 **한 번도 실행되지 않는다.** `extractCandidateUrlsFromText`,
`rankDiscoveredCandidates`, alternate-URL 재fetch 블록 전체가 도달 불가다.

유닛 테스트는 두 함수를 직접 import해서 통과하므로 게이트가 초록이다. 레인이
파이프라인에서 절대 불리지 않는다는 사실은 아무도 보지 않는다. **WP6의 "안 돌려본
표면은 미검증"이 함수 단위가 아니라 파이프라인 단위로도 필요하다는 뜻이다.**

범위가 달라 다음 work-phase로 넘긴다.

### 3.4 남은 변이 3종은 후속으로 넘긴다

리뷰어가 보고한 M-I(`timeoutMs` 전달), M-L(`camoResult.url` 무시), 그리고 camoufox
레인만 `.catch(() => null)`로 프로그래밍 오류까지 삼키는 것(WP6이 다른 레인에서
없앤 바로 그 문제). 마지막 것은 `index.mjs:370`이 `signal`을 넘기지 않아
`camoufox-session.mjs`의 abort 경로가 프로덕션에서 도달 불가라는 사실과 묶여 있다 —
유닛 테스트가 검증하는 경로를 실제 호출자가 못 타는 상태다. 별개 work-phase가 맞다.

우선순위는 §3.3(Phase 1d)이 가장 높다. 기능 하나가 통째로 죽어 있다.

## 4. 주입이 실물 경로를 바꾸지 않는지 확인했다

가짜를 주입해 테스트가 통과하는 것과, 실물이 여전히 같은 길로 도는 것은 다른
주장이다. WP3에서 만든 venv를 PATH에 올려 실제 camoufox로 다시 돌렸다.

```
real camoufox: ok true
evidence ["score:26","source:fetch","text:142","density:0.25","title","camoufox-render"]
len 142
```

WP3의 측정값과 정확히 같다. `deps.fetchViaCamoufox`가 없으면 `fetchViaCamoufox`가
그대로 쓰인다.

## 5. 게이트

```
npm run test:integration → 22 files / 213 tests
npm run test:unit        → 156 files / 1683 tests
npm run test:e2e         → 1 file / 1 test
npm run typecheck        → 0
npm run docs:counts      → 76
npm run docs:drift       → 164
```
