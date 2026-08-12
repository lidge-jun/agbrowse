# WP1 — Chromium 리비전 불일치

직전 QA(`devlog/_fin/260726_agbrowse_qa`)의 §7 이월 1번. 그 문서는 후보 셋을
**전부 미검증**으로 남겼다. 이번에 하나씩 실제로 돌려 판정했다.

## 1. 문제

```
playwright-core@1.58.2 해석 → .../chromium-1208/...   (없음)
캐시 보유                   → chromium-1217, chromium-1228
                              chromium_headless_shell-1217, -1228

$ npm run test:integration        (오버라이드 없이)
exit 1 — 4 files failed, 15 tests never run
```

그 15개는 `page.evaluate` 트랜스포트 왕복 테스트다. "evaluate는 모듈 바인딩이
아니라 함수 본문만 직렬화한다"는 규칙을 지키라고 만든 것들이라, 하필 그 규칙의
집행기가 조용해져 있었다.

## 2. 왜 `playwright install`이 안 먹혔나

직전 라운드는 `npx playwright install chromium-headless-shell`이 no-op이라고만
기록했다. 이번에 원인을 찾았다.

```
$ npx playwright --version
Version 1.59.1                      ← 레포에 없는 버전을 npx가 받아서 씀
$ node -e "require('playwright-core/package.json').version"
1.58.2                              ← 실제 런타임

$ npx playwright install chromium --dry-run
Chrome for Testing 147.0.7727.15 (playwright chromium v1217)   ← 1217을 설치
$ node node_modules/playwright-core/cli.js install chromium --dry-run
Chrome for Testing 145.0.7632.6 (playwright chromium v1208)    ← 1208을 설치
```

`playwright-core`만 의존성이고 `playwright`는 없다. 그래서 `npx playwright`가
레지스트리에서 **다른 버전**을 받아 실행했고, 그게 1217을 설치했다. 캐시에 1217과
1228이 있는데 런타임은 1208을 찾는 상태가 이렇게 만들어졌다.

## 3. 후보 판정

| 후보 | 결과 |
|------|------|
| (a) 1208을 실제로 설치 | **실패** — 아래 §3.1 |
| (b) `playwright-core`를 캐시 보유 빌드 버전으로 | **채택** |
| (c) 게이트에서 `AGBROWSE_CHROMIUM_EXECUTABLE_PATH` 설정 | 미시도 (b로 해결) |

### 3.1 후보 (a)가 실패한 이유

로컬 `playwright-core` CLI로 받으면 1208을 받는 것은 맞다. 실제로 돌렸다.

```
$ node node_modules/playwright-core/cli.js install chromium chromium-headless-shell
```

`chromium-1208` 디렉터리는 생겼지만 27분을 기다려도
`chromium_headless_shell-1208`은 `ABOUT`과 `LICENSE.headless_shell` 두 파일에서
더 나아가지 않았다(정상본은 14개, 실행 파일 포함). 중단 후 미완성 잔재를 캐시 밖으로
옮겼고 **1217과 1228은 건드리지 않았다.**

처음에는 이것을 "다운로드가 진행되지 않는다"로 적었다. **그 진단은 틀렸다.**
A-gate에서 리뷰어가 격리 환경에서 재현해 보니 다운로드는 91.1MiB를 6.3MB/s로
100%까지 마치고, **그 뒤 압축 해제가 완전히 멈춘다.** CPU 0%, 열린 소켓 0개다.
zip 자체는 멀쩡하다 — 직접 받아 `unzip`으로 풀면 17개 파일이 1초 남짓에 나오고
실행 파일도 정상이다.

더 중요한 것은 범위다. 이건 1208만의 문제가 아니다. **1217을 빈 경로에 새로
받아도 똑같이 멈춘다.** 즉 진짜 사실은 "이 환경에서는 어떤 리비전도 새로 설치할
수 없다"이고, 캐시에 이미 있는 것만 쓸 수 있다. §5의 업그레이드 지침이 이 사실
위에 서야 한다.

`chromium-1228`의 headless shell을 1208 자리에 복사하는 방법도 있었지만 하지
않았다. 버전이 다른 바이너리를 그 자리에 두는 것은 캐시를 속이는 것이고, 나중에
원인 추적을 불가능하게 만든다.

### 3.2 후보 (b) — 채택

격리 디렉터리에서 먼저 확인했다.

```
$ npm i playwright-core@1.59.1   (임시 프로젝트)
1.59.1 해석: chromium-1217   exists: true
```

레포에 적용할 때 한 번 헛짚었다. `^1.59.1`로 넣었더니 **1.62.0**이 설치되고
`chromium-1234`를 찾아 다시 어긋났다. 캐시가 가진 것은 1217/1228이므로 범위
지정이 아니라 정확한 고정이 필요하다.

```
$ npm i playwright-core@1.59.1 --save-exact
package.json: 1.59.1
해석: chromium-1217 | exists: true
```

`--save-exact`를 쓴 이유는 정확히 해 둔다. lockfile이 커밋돼 있어서 `npm i`나
`npm ci`만 놓고 보면 캐럿이어도 1.59.1이 유지된다. 정확 고정이 실제로 값을 하는
경로는 **`npm update`**(캐럿은 1.62.0으로 올라가고 정확 고정은 머무른다)와
lockfile 없는 새 해석이다.

더 중요한 이유는 다른 데 있다. 캐시 제약이 이미 버전 선택을 묶고 있으므로,
정확 고정은 그 제약을 `package.json`에 정직하게 드러내는 표현이다.

## 4. 검증

**오버라이드 없이** 돌린 결과다.

```
$ npm run test:integration          (AGBROWSE_CHROMIUM_EXECUTABLE_PATH 없음)
 Test Files  22 passed (22)
      Tests  193 passed (193)
exit 0
```

15개가 실제로 실행됐는지 파일별로 확인했다. 이전에는 전부 skipped였다.

| 파일 | 이전 | 이후 |
|------|------|------|
| `activity-state-transport` | 8 skipped | **8 passed** |
| `composer-menu-transport` | 2 skipped | **2 passed** |
| `self-heal-smoke` | 4 skipped | **4 passed** |
| `post-action-smoke` | 1 skipped | **1 passed** |

나머지 게이트: `test:unit` 156 files / 1683 tests, `test:e2e` 1/1.

## 5. 남는 것

`playwright-core`를 1.59.1에 고정했으므로, 업그레이드하려면 **먼저 캐시에 그 버전이
요구하는 리비전이 있는지 확인해야 한다.** 없으면 지금은 받을 방법이 없다 —
§3.1에서 확인했듯 이 환경은 리비전을 새로 설치하지 못한다(압축 해제 단계에서 멈추며,
1208뿐 아니라 1217도 마찬가지다). 그 제약이 풀리기 전까지 버전 선택은 캐시가
가진 것(1217, 1228)에 묶인다.

받아야 할 상황이 오면 `npx playwright`가 아니라
`node node_modules/playwright-core/cli.js install`을 써야 한다. `playwright`
패키지가 의존성에 없어서 `npx`는 레지스트리에서 다른 버전을 받아 실행하고, 그게
이번 불일치를 만든 원인이다.

### 5.0 CI는 이 부류의 불일치를 잡지 못한다

`release.yml`에는 `playwright install`이 없다. 대신 러너의 시스템 Chrome을 찾아
`AGBROWSE_CHROMIUM_EXECUTABLE_PATH`로 넘긴다(`:70`). 즉 릴리스 CI는 이번 고정과
무관하게 **항상 오버라이드 경로로 동작한다.**

지금 깨지는 것은 아니다. `npm test`가 통합 스위트를 포함하고 오버라이드가 설정되니
통과한다. 다만 그래서 **CI 초록색은 리비전 정합성의 증거가 아니다.** 이번 부류의
불일치는 CI에서 절대 드러나지 않고 로컬에서만 보인다. 다음 사람이 초록색을 보고
안심하지 않도록 적어 둔다.

### 5.1 CI에 같은 안티패턴이 남아 있다

A-gate에서 리뷰어가 찾았다. `.github/workflows/contract-drift.yml`의 두 곳
(`:29`, `:47`)이 여전히 `npx playwright install chromium`을 쓴다. 문서가 방금
원인으로 지목한 바로 그 명령이다.

CI 러너는 캐시가 비어 있어 지금까지 우연히 동작했을 수 있지만, `npx`가 레포와
다른 `playwright` 버전을 받는 구조는 그대로다. 이건 WP1 범위 밖이라 여기서 고치지
않고 **다음 work-phase 후보로 올린다.**
