# WP10 — 후보 발견의 경계를 정하고, 같은 실수를 타입이 잡게 했다

WP9가 남긴 두 항목이다. 하나는 "Phase 1d를 끝까지 이을 것인가", 다른 하나는
"wrapper/raw 혼동을 세 번째로 반복하지 않을 방법".

## 1. Phase 1d는 발견까지만 한다 — 그게 맞다

WP9에서 이 레인을 살려 놓고 보니 발견한 URL을 `appendAttempt`만 하고 가져오지
않았다. 바로 위 주석은 "adding them to the reader candidate pool"이라고 약속했고,
같은 패턴인 Phase 1b는 실제로 가져와 후보로 넣는다(`:256`~`:273`). 그래서 미완성으로
분류했었다.

**이으려다 멈췄다. 제품 경계를 넘기 때문이다.**

README가 `agbrowse fetch`를 "adaptive URL fetch (`agbrowse fetch <url>`) as a URL
reader, **not search**"로 선언한다(`:244`). 발견한 링크를 따라가면 모든 fetch가
크롤이 된다. 그리고 SSRF 표면이 넓어진다 — 지금은 호출자가 준 URL 하나를
`validateFetchUrl`로 검증하는데, 발견 링크를 타면 원격 페이지가 지목한 주소로
요청이 나간다. 후보 검증 로직이 있긴 하지만(`parsePublicUrl`), 신뢰 경계가
"사용자가 준 것"에서 "페이지가 시킨 것"으로 이동하는 것 자체가 다른 결정이다.

후보에 실제로 작용하는 표면은 따로 있다. `agbrowse search`가 후보를 받아
`runAdaptiveFetch`를 각각 돌린다(`search.mjs:64`). Phase 1d의 역할은 **이 페이지가
무엇을 가리켰는지 기록하는 것**이다.

다만 정확히 적는다 — **현재 실제 소비자는 `--trace` 독자뿐이다.** `search-research`는
`candidate-discovery.mjs`를 import하지 않으므로 Phase 1d의 발견 결과가 search로
흘러가는 배선은 아직 없다. 리뷰어가 짚었다. 배선은 별개 후속이고, 이 레인이 발견을
기록하는 것 자체는 그와 무관하게 유효하다.

리뷰어가 근거를 하나 더 찾았다. CLI 헬프 텍스트가 사용자에게 직접 말한다 — "Read one
URL through a 6-phase adaptive escalation ladder. **Not generic search** — use search
tools to find URLs first." 즉 이 경계는 README 한 줄이 아니라 제품이 사용자에게 하는
약속이다.

SSRF 논거의 무게도 정확히 적는다. `parsePublicUrl`(`candidate-discovery.mjs:84` →
`safety.mjs:85-114`)은 스킴 화이트리스트, credential URL 거부, `isPrivateHostname`으로
localhost·`.local`·사설 IPv4/IPv6을 막는다. **그러니 "SSRF 취약점이 생긴다"고 하면
과장이다.** 남는 위험은 IP 리터럴 우회가 아니라 DNS rebinding, 리다이렉트 체인, 그리고
페이지 하나가 N개 요청을 유발하는 증폭이다. 후보 검증은 첫 관문만 막는다.

그래서 코드를 주석에 맞추는 대신 **주석을 코드에 맞췄다.** 왜 가져오지 않는지를
적었다. 잘못된 약속을 지우는 것도 수정이다.

### 1.1 `verdict: 'weak_ok'`는 거짓말이었다

발견 후보의 attempt가 `weak_ok`로 기록되고 있었다. 가져온 적도, 채점한 적도 없는
URL이다. `--trace`를 읽는 사람은 이 URL이 평가를 통과했다고 읽는다.

`discovered`로 바꿨다. 이 값은 `verdictFromScore`가 만들 수 있는 값이 아니므로
"채점되지 않음"이 트레이스에서 구분된다.

## 2. 타입이 세 번째를 막게 했다

이 라운드에서 wrapper/raw 혼동이 두 번 났고, 두 번 다 `tsc`를 그냥 통과했다.
`scoreReaderCandidate`의 반환 타입이 추론이라 `wrapper.text`가 `any`로 흘렀기
때문이다.

`content-scorer.mjs`에 명시적 typedef를 넣었다.

```js
/**
 * @typedef {{ candidate: any, score: number, verdict: string, markers: any[],
 *             textLength: number, density: number, evidence: string[] }} ScoredReaderCandidate
 */
```

`scoreReaderCandidate`와 `chooseBestReaderCandidate`에 `@returns`를 붙였다.

**실제로 잡는지 확인했다.** WP9가 고친 결함을 되돌리고 `tsc`를 돌렸다.

```
index.mjs(348,24): error TS2339: Property 'text' does not exist on type 'ScoredReaderCandidate'.
index.mjs(349,71): error TS2339: Property 'text' does not exist on type 'ScoredReaderCandidate'.
index.mjs(352,70): error TS2339: Property 'source' does not exist on type 'ScoredReaderCandidate'.
```

세 줄 전부 잡힌다. WP9의 결함이 이 typedef가 있었다면 커밋되지 못했다.

**막는 방향은 하나다.** 이 라운드의 두 결함이 서로 반대 방향이었는데, typedef는 그
중 하나만 잡는다.

| 결함 | 형태 | typedef가 잡나 |
|------|------|----------------|
| WP9 Phase 1d | `wrapper.text` — wrapper를 raw처럼 읽음 | **잡는다** |
| WP8 camoufox | `rawCandidate.verdict` — raw를 wrapper처럼 읽음 | 못 잡는다 |

뒤쪽이 안 잡히는 이유는 `scoreReaderCandidate(candidate: any)`와 typedef의
`candidate: any` 때문이다. 리뷰어가 실측했다 — `wrapper.candidate.존재하지않는필드`는
`tsc` 오류 0건이다.

`any`로 둔 것은 타협이다. raw 후보는 어댑터 여섯 개(`fromFetchResult`,
`fromBrowserResult`, `fromNetworkCandidate`, `fromUserSessionResult`,
`fromHumanResolvedResult`, `fromMetadataResult`)가 만들고 `challenge` 같은 필드가
나중에 동적으로 붙는다(`index.mjs:229`). 정확한 타입을 주려면 그 여섯을 먼저
통일해야 한다. `RawReaderCandidate` typedef가 남은 절반이고 후속 항목이다.

### 2.1 다만 이 방어는 아직 게이트에 걸려 있지 않다

정직하게 적는다. `adaptive-fetch/`는 `tsconfig.checkjs.json`의 `include`에 없다.
위 오류는 그 파일을 임시로 추가한 프로브 설정에서 나온 것이고, 기본
`npm run typecheck`(`allowJs: false`)는 `.mjs`를 아예 보지 않는다.

그래서 지금 typedef의 효력은 **에디터와 앞으로의 checkJs 확장**에 있다. 이 디렉터리를
`checkjs.json`에 넣으려면 기존 오류를 먼저 정리해야 한다 — 프로브로 재어 보니
`adaptive-fetch/` 전체 26건, `index.mjs`만 9건이고 대부분 `document`/`location` 같은
브라우저 전역(`browser-escalation.mjs`, `defuddle-extractor.mjs`)이라
`tsconfig.checkjs-dom.json` 쪽으로 갈라야 한다. 별개 작업이다.

그리고 더 중요한 사실 하나 — **`npm run typecheck:checkjs`는 지금도 109건 실패한다.**
리뷰어가 stash로 갈라 확인했고 내 변경 전후 모두 109라 pre-existing baseline이다.
즉 위의 `adaptive-fetch/` 26건은 초록색 게이트를 빨갛게 만드는 몫이 아니라, 이미
빨간 스크립트 위에 얹히는 몫이다. 다음 사람이 오해하지 않도록 적어 둔다.

**측정한 것만 적는다.** typedef는 오용을 잡을 수 있고, 지금 CI에서는 돌지 않는다.

## 3. 검증

테스트 2건을 추가했다(38 → 39건).

- `does not fetch the URLs it discovers` — 발견 URL이 실제 요청으로 나가지 않는지.
  주입한 `fetch`가 받은 URL 목록이 `['https://example.com/article']` 하나여야 한다.
- 기존 발견 테스트에 `verdict === 'discovered'` 단정을 더했다.

뮤테이션 2종 RED.

| Mutant | 결과 |
|--------|------|
| M-T `verdict`를 `weak_ok`로 되돌림 | 1 failed / 38 passed |
| M-U 발견 후보를 실제로 `fetchTextCandidate` (크롤 회귀) | 1 failed / 38 passed |

M-U가 이 WP의 핵심이다. 누가 "발견했으면 가져와야지"라고 생각해 이으면 게이트가
막는다. 경계를 문서가 아니라 테스트가 지킨다.

리뷰어가 M-V(`verdict`를 `strong_ok`로)도 추가해 RED를 확인했다. 즉 테스트가 특정
문자열이 아니라 "미채점 표식"을 지킨다.

### 3.1 `discovered` verdict가 다른 곳을 깨지 않는지 확인했다

리뷰어가 verdict를 열거형으로 다루는 곳을 전수 조사했다. `browse-escalation.mjs:4`의
`WEAK_VERDICTS`가 유일한 Set인데, 그것이 읽는 것은 **최종 결과의 verdict**이고
`discovered`는 attempt에만 붙는다. 발견이 일어난 실행에서 `result.verdict = weak_ok`,
`ok = true`로 정상이었다. `--json` 출력에서는 `_traceSummary`가 구조분해로 제거된다
(`:580`).

하나 남는 것: `summarizeAttempts`(`trace.mjs:35-41`)가 **마지막** attempt의 verdict를
읽는데, Phase 1d가 마지막이 되면 요약이 `last source=metadata verdict=discovered`가
된다. 최종 verdict는 `weak_ok`로 정상이고 `--trace` 없이는 노출되지 않지만, 요약문만
보는 사람에게는 결과가 미채점이라는 인상을 준다. 결함은 아니고 후속 관찰 대상이다.

## 4. 게이트

```
npm run test:integration → 22 files / 217 tests
npm run test:unit        → 156 files / 1683 tests
npm run test:e2e         → 1 file / 1 test
npm run typecheck        → 0
npm run docs:counts      → 76
npm run docs:drift       → 164
```

`npm run typecheck:checkjs`의 109건은 이 라운드 이전부터의 baseline이다(§2.1).

## 5. 이 라운드 밖으로 넘기는 것

WP8~WP10을 거치며 쌓인 후속 목록이다. 전부 리뷰어가 실측으로 확인했다.

1. **camoufox 레인의 오류 처리가 다른 레인과 다르다.** `.catch(() => null)`이
   프로그래밍 오류까지 삼킨다 — WP6이 다른 여섯 곳에서 없앤 바로 그 문제다. 그리고
   `index.mjs:370`이 `signal`을 넘기지 않아 `camoufox-session.mjs`의 abort 경로가
   프로덕션에서 도달 불가다. 유닛 테스트가 검증하는 경로를 실제 호출자가 못 탄다.
2. **`RawReaderCandidate` typedef** — §2의 나머지 절반. 어댑터 여섯 개를 통일해야 한다.
3. **`adaptive-fetch/`를 checkJs에 편입** — 27건 정리 + 브라우저 전역 파일을
   `checkjs-dom`으로 분리. 단 `typecheck:checkjs` 자체가 109건 baseline이라 그것이
   먼저다.
4. **`summarizeAttempts`의 `verdict=discovered` 노출**(§3.1).
5. **M-I `timeoutMs` 전달, M-L `camoResult.url` 무시** — WP8에서 살아남은 변이 둘.
6. **Phase 1d → search 배선** — 발견 결과를 search 파이프라인이 실제로 소비하게 할지
   (§1).
