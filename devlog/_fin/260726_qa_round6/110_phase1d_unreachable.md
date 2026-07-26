# WP9 — 후보 발견 단계가 한 번도 실행된 적이 없다

WP8의 A-gate에서 리뷰어가 찾았다. WP8이 고친 `strong_ok` 가드와 **정확히 같은
실수인데 방향이 반대**다.

## 1. 두 형태

`chooseBestReaderCandidate`는 채점 래퍼를 돌려준다.

```
wrapper keys: candidate,score,verdict,markers,textLength,density,evidence
```

본문은 `wrapper.candidate.text`에 있고, `verdict`는 래퍼에만 있다. 두 결함이 이
구분을 서로 반대로 놓쳤다.

| 위치 | 잘못 읽은 것 | 결과 |
|------|--------------|------|
| camoufox 가드 (WP8) | raw 후보에서 `verdict` | 항상 `undefined` → 조건 **항상 참** → 레인이 매번 실행 |
| Phase 1d (WP9) | 래퍼에서 `text` | 항상 `undefined` → 조건 **항상 거짓** → 레인이 **전혀** 실행 안 됨 |

실측:

```
best?.text            = undefined
best.candidate.text   = 999자
```

즉 `extractCandidateUrlsFromText`, `rankDiscoveredCandidates`, alternate-URL
블록 전체가 도달 불가였다. 203.7 candidate-discovery는 구현된 적은 있지만 파이프라인
에서 **한 번도 돌지 않았다.**

## 2. 왜 게이트가 못 잡았나

`browser-adaptive-fetch-candidate-discovery.test.mjs`가 두 함수를 **직접 import해서**
테스트한다. 함수는 잘 동작한다. 그 함수를 부르는 조건이 죽어 있다는 사실은 아무도
보지 않는다.

**"안 돌려본 표면은 미검증"이 함수 단위가 아니라 파이프라인 단위로도 필요하다.**
이 라운드가 세운 규칙의 확장이다. 유닛 테스트가 초록인 것과 그 코드가 제품에서
실행되는 것은 다른 명제다.

## 3. 죽은 코드 안에 두 번째 결함이 있었다

조건을 고치자마자 터졌다.

```
TypeError: ranked.slice is not a function or its return value is not iterable
 ❯ runAdaptiveFetch skills/browser/adaptive-fetch/index.mjs:355:48
```

`rankDiscoveredCandidates`는 배열이 아니라 `{ candidates, lanes, rejected }`를
반환한다(`candidate-discovery.mjs:76`). 호출부가 `ranked.slice(0, 3)`을 하고 있었다.

**아무도 이 줄을 실행해 본 적이 없어서 몰랐다.** 도달 불가 코드는 조용히 썩는다 —
타입 오류가 아니라 런타임에서만 터지는 형태로.

## 4. 수정

```js
const bestSoFar = chooseBestReaderCandidate(readerCandidates)?.candidate;
...
for (const candidate of (ranked.candidates || []).slice(0, 3)) {
```

`?.candidate` 언랩은 같은 파일 `resultFromReaderCandidate`(`:641`)가 이미 하는
방식이다 — `const candidate = scored.candidate`. 이 라운드에서 네 번째로 정답이
같은 파일 안에 있었다.

## 5. 검증

수정 후 실제로 실행된다.

```
validation | weak_ok | url-valid                              | https://example.com/article
fetch      | weak_ok | score:41                               | https://example.com/article
metadata   | weak_ok | candidate-discovered:package           | https://github.com/openai/codex
metadata   | weak_ok | candidate-discovered:academic          | https://arxiv.org/abs/2401.00001
metadata   | weak_ok | candidate-discovered:fetch             | https://random-blog.example.net/post
```

레인 분류까지 살아 있다. 파이프라인 레벨 테스트 3건을 추가했다(35 → 38건).

- `records alternate URLs discovered in the fetched body` — 발견 자체. 수정 전 RED
  (`expected 0 to be greater than 0`).
- `classifies discovered candidates into lanes` — `package`/`academic` 분류가
  실제로 실린다.
- `does not rediscover the URL it is already fetching` — 자기 자신을 후보로 다시
  잡지 않는다.

### 5.1 지금 상태의 한계 — 발견까지만 한다

살려 놓고 보니 이 레인은 **발견해서 trace에 기록하는 것까지만** 한다. 루프 안은
`fetchedUrls.add`와 `appendAttempt` 두 줄이고 `fetchTextCandidate` 호출도,
`readerCandidates.push`도 없다. 즉 최종 verdict나 content를 바꾸지 않는다.

**의도가 아니라 미완성이다.** 근거는 바로 위 주석이다 — "adding them to the reader
candidate pool"이라고 적혀 있는데 풀에 넣는 코드가 없다. 같은 "발견 후 활용" 패턴인
Phase 1b(feed·oEmbed)는 발견한 URL을 실제로 `fetchTextCandidate`로 가져와 후보로
넣는다(`:256`~`:273`). 1d만 발견에서 멈춘다.

그리고 `appendAttempt`가 `verdict: 'weak_ok'`를 하드코딩한다. 가져와서 채점한 적이
없는데 통과한 것처럼 적히므로, `--trace` 출력을 읽는 사람이 이 URL이 평가를
거쳤다고 오해할 수 있다. 재fetch를 붙이거나 verdict를 중립값으로 바꾸는 것 중
하나가 필요하다. 후속 항목이다.

뮤테이션 4종이 RED다.

| Mutant | 결과 |
|--------|------|
| M-P `?.candidate` 제거 (**원래 결함 복원**) | 2 failed / 36 passed |
| M-Q `ranked.candidates` → `ranked` (**두 번째 결함 복원**) | 3 failed / 35 passed |
| M-R `fetchedUrls` 중복 가드 제거 | 1 failed / 37 passed |
| M-S 레인을 항상 `unknown`으로 | 1 failed / 37 passed |

## 6. 통합 스위트 한 번의 실패를 추적했다

수정 직후 통합 실행에서 `1 failed | 215 passed`가 한 번 나왔다. 실패 파일을 특정하기
전에 재실행하니 통과해서, 플레이크인지 내 변경 탓인지 갈랐다.

```
내 변경 stash 후:  213 passed          (기존 상태 정상)
변경 복원 후 ×8:   216 passed × 8      (전부 통과)
```

여덟 번 연속 통과했고(리뷰어가 6회 더 돌려 합계 14회) 재현되지 않는다. 실패 로그를
잡아두지 못한 것이 이 조사의 한계다 — **재현 안 되는 관찰은 결함 주장도, 무해 판정도
근거가 약하다.** 직전 라운드 070 §5가 같은 함정을 기록했다.

### 6.1 통계 말고 구조로 배제한다

"14회 통과"만으로는 부족하다. 1/14 빈도의 플레이크는 그 정도를 흔히 뚫는다. 대신
데이터 흐름이 통계와 무관하게 답을 준다. 리뷰어가 `fetchedUrls`의 전 사용처를 뽑았다.

```
생성 :155 | 추가 :181(Phase 0+1) | 읽기 :232 :235(feed·oEmbed) | 추가 :273(Phase 1b)
          | 추가 :361 :362(Phase 1d)  ← 마지막 사용처
```

**Phase 1d가 마지막 사용처다.** `:232`/`:235`의 읽기는 그보다 위에서 이미 끝났고,
아래쪽 레인(camoufox, ytdlp, 브라우저, 유저세션, human-loop)은 `fetchedUrls`를 아예
보지 않는다. 스코프도 `runAdaptiveFetch` 지역 변수라 호출 간 공유가 없다. 즉
Phase 1d가 Set에 무엇을 넣든 읽는 쪽이 없다.

타이밍도 아니다. 이 레인은 네트워크를 타지 않는다 — 새 테스트 경로에서 주입되지 않은
실제 `fetch` 호출 0회이고, `rankDiscoveredCandidates` → `parsePublicUrl` →
`validateFetchUrl`은 `new URL` + 정규식 + `net.isIP`뿐이라 DNS도 건드리지 않는다.

유력한 실제 원인은 따로 있다. `cli-lifecycle.test.mjs`가 `getAvailablePort()`로
포트를 잡은 뒤 **실제 헤드리스 Chrome을 spawn**하는데, 포트 할당이
`listen(0)` → `close()` → 재사용이라 전형적인 TOCTOU 경쟁이다. 그 사이 머신의 다른
프로세스가 포트를 집으면 실패한다. `fileParallelism: false`는 이 경쟁과 무관하다 —
상대가 같은 스위트가 아니라 머신의 다른 프로세스이기 때문이다.

다음 라운드가 같은 증상을 보면 실패 파일명부터 잡고 이 절을 참조한다.

## 7. 게이트

```
npm run test:integration → 22 files / 216 tests  (×8 연속)
npm run test:unit        → 156 files / 1683 tests
npm run typecheck        → 0
npm run docs:counts      → 76
npm run docs:drift       → 164
```

## 8. 후속으로 넘기는 것

1. **Phase 1d를 끝까지 잇는다.** 발견한 후보를 실제로 가져와 reader 풀에 넣거나,
   못 할 이유를 문서에 적는다. 주석이 약속한 동작과 코드가 어긋난 상태를 남기지
   않는다. `verdict: 'weak_ok'` 하드코딩도 같이 처리한다(§5.1).
2. **`scoreReaderCandidate`의 반환 typedef를 명시한다.** 이 라운드에서 wrapper/raw
   혼동이 두 번 났다. 지금은 반환 타입이 추론되어 `wrapper.text` 접근이 `tsc`를
   그냥 통과한다. 명시적 typedef가 세 번째를 막는 실질적 방어다. 리뷰어가 전수
   조사해 현재 세 번째 사례는 없음을 확인했다 — wrapper 변수 10개 전부에서 raw
   필드 접근을 grep했고 `bestSoFar` 두 곳만 걸렸으며 그건 이 WP가 고쳤다.
