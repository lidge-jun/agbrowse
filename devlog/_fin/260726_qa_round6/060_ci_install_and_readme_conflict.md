# WP3b — CI의 브라우저 설치 단계와 README의 stealth 자기모순

WP1이 진단한 안티패턴의 잔재와, WP3의 검증 결과가 드러낸 문서 상충을 함께 닫는다.

## 1. `npx playwright install chromium` — 지웠다

`.github/workflows/contract-drift.yml`의 두 잡(`:29`, `:47`)이 이 명령을 돌리고
있었다. WP1이 로컬에서 정확히 이 패턴 때문에 깨진 것을 진단했다 — `npx`는 저장소가
고정한 `playwright-core`와 **무관한** 버전을 받아오고, 그 버전이 부르는 chromium
리비전은 런타임이 해석하는 리비전과 다르다.

### 1.1 먼저 물었다: 이 잡들이 브라우저를 쓰기는 하는가

안 쓴다. 네 명령의 의존 관계를 따라갔다.

| 명령 | 실체 | 브라우저 |
|------|------|----------|
| `test:contract-drift` | `web-ai-contract-audit.test.mjs` | 안 씀. 파일 주석이 스스로 "이 유닛 테스트는 라이브러리 shape과 오류 처리만 확인한다"고 적어 둔다 |
| `test:eval` | `web-ai-eval*.test.mjs` + `dom-scrubber` | 안 씀. 6개 파일 어디에도 playwright import 없음 |
| `test:eval-fixtures` | `scripts/run-web-ai-eval.mjs` | 안 씀. `web-ai/eval-runner.mjs`까지 따라가도 브라우저 참조가 없다 |
| `eval:web-ai:fixtures` | 같은 스크립트 + 병렬 설정 | 안 씀 |

전부 기록된 fixture로 도는 것들이다. 실측으로 확인했다 — `PLAYWRIGHT_BROWSERS_PATH`를
빈 디렉터리로 돌려 브라우저를 못 찾게 만든 뒤 네 명령을 모두 실행했다.

```
EXIT_CONTRACT=0   Tests 1 passed (1)
EXIT_EVAL=0       Tests 32 passed (32)
EXIT_FX=0         "regressions": []
EXIT_PFX=0        "regressions": []
```

즉 이 단계는 실패를 막아 주는 안전장치가 아니라, **아무도 쓰지 않는 브라우저를 받아
CI 시간만 쓰면서 리비전 불일치의 씨앗을 심는 단계**였다. 로컬 core CLI로 바꾸는
것보다 지우는 것이 맞다. 지운 자리에 왜 없는지 주석을 남겼다.

YAML 파싱으로 두 잡의 스텝 목록이 의도대로 남았는지 확인했다.

```
fixture-drift ['actions/checkout@v4', 'actions/setup-node@v4', 'npm ci',
               'npm run test:contract-drift', 'npm run test:eval',
               'npm run test:eval-fixtures', 'npm run eval:web-ai:fixtures']
live-drift    ['actions/checkout@v4', 'actions/setup-node@v4', 'npm ci',
               'npm run test:contract-drift', 'curl -X POST ...']
```

### 1.2 CI 초록색이 리비전 정렬의 증거가 아니라는 점은 그대로다

`release.yml:70`이 항상 `AGBROWSE_CHROMIUM_EXECUTABLE_PATH`를 설정한다. WP1이
고친 불일치는 그 오버라이드에 가려져 CI에서는 보이지 않았다. 이번 변경은 그 사실을
바꾸지 않는다 — 다만 잘못된 브라우저를 받아오는 경로 하나가 사라졌다.

### 1.3 `live-drift` 잡은 이름이 약속하는 일을 하지 않는다

설치 단계를 지우다 확인한 것이다. `AGBROWSE_DRIFT_MODE`는 `node_modules`와
`devlog`를 빼면 **저장소 코드에서 읽히는 곳이 0건**이다. 그리고 이 잡이 돌리는
`test:contract-drift`는 테스트가 1건이고 내용은 export 존재 확인뿐이다.
`contract-audit.mjs`도 `process.env`를 읽지 않는다.

정리하면 `live-drift`는 주간 스케줄로 러너를 띄워 `npm ci` 후 `fixture-drift`와
**같은 명령**을 돌리고, env는 무시되고, `continue-on-error: true`라 실패해도
통과하며, 그래서 `if: failure()` 알림은 발동하지 않는다. "라이브 프로바이더 드리프트를
감시한다"는 인상만 남는다.

이번 WP 범위 밖이라 손대지 않고 후속 work-phase로 남긴다(wp7). 선택지는 셋이다 —
실제 live 모드를 구현하거나, 잡을 제거하거나, 최소한 실패가 보이게 고치는 것.

## 2. README의 stealth 자기모순 — 용어를 갈랐다

`:246`이 `Camoufox stealth lane`을 기능으로 광고하는데 `:185`는 stealth를 out of
scope로, `:367`은 forbidden으로 선언한다. WP3에서 이 레인이 **실제로 동작함**을
확인했으므로 문서 오타로 지울 수 없다. 동작하는 기능을 광고에서만 빼면 오히려 문서가
거짓말을 한다.

진짜 문제는 한 단어가 두 가지를 가리킨다는 것이었다.

- `:185`/`:367`이 금지하는 stealth: **봇 검사를 뚫는 것.** CAPTCHA 자동 해결,
  credential stuffing.
- `:246`이 가리키던 stealth: **지문을 평범하게 만드는 것.** 자동화 티가 나는 요청을
  보통 브라우저 읽기처럼 보이게 하는 것.

뒤쪽은 이미 203.1 TLS impersonation이 하고 있고 README가 아무 문제 없이 싣고 있다.
같은 일을 하는 203.3만 `stealth`라는 단어를 달고 있어 모순처럼 보였을 뿐이다.

세 곳을 고쳤다.

1. `:246` — `Camoufox stealth lane` → `Camoufox hardened-fingerprint render`.
2. 203.x 표에 `203.3 Camoufox render` 행을 추가했다. 원래 203.3만 표에서 빠져
   있었다. 별도 `camoufox` Python 설치가 필요하고 없으면 no-op이라는 것도 적었다 —
   WP3이 측정한 사실이다.
3. `:367` 아래에 용어 구분을 명시했다. 브라우저급 헤더와 하드닝된 지문(203.1,
   203.3)은 챌린지를 풀지 않으며, 실제로 챌린지하는 페이지는 여전히
   `--browser-session user|interactive`가 필요하거나 막힌 채로 남는다.

제거/유지 판단을 사용자에게 넘기지 않고 여기서 닫은 이유는, 검증 결과가 선택지를
하나로 좁혔기 때문이다. 동작하고, 무해하고(미설치 시 프로세스당 40~50ms), 이미
README에 실린 203.1과 같은 부류다. 남는 것은 표기 문제였고 그건 QA 범위 안이다.
선택적 의존성 선언 여부는 040 문서 §6에 그대로 남는다.

리뷰어가 이 판단을 검증하며 근거를 하나 더 보탰다. 레인이 실제로 하는 일은
`camoufox-session.mjs:66-76`에 다 드러난다 — `goto` 후 `content()`를 읽는 것이
전부이고 챌린지 감지·대기·클릭·해결 시도가 없다. 챌린지 페이지를 만나면 챌린지
페이지의 HTML을 그대로 가져온다. upstream camoufox의 자기 설명도 지문 생성·주입이지
bypass가 아니다. 그래서 "챌린지를 풀지 않는다"는 말장난이 아니라 코드가 뒷받침하는
사실이다.

`index.mjs:320`의 코드 주석도 `stealth-browser fallback`에서
`hardened-fingerprint render`로 맞췄다. README에서 용어를 갈랐으면 코드도 같은
말을 해야 한다.

## 3. 게이트

```
npm run docs:counts  → 76 PASS
npm run docs:drift   → 164 PASS
```
