# 040 — WP13 유입 방지 게이트 (G3)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP13
- 선행: 없음 — G1·G2·G4와 독립
- 대상: `011_model_decision.md`의 reversal gate **G3**

## G3가 요구하는 것

> 새 동기 IO 또는 무제한 CDP 호출이 유입될 때 **실제로 실패하는** 검사가 있다.
> 문서상 규칙만으로는 불충분.

마지막 문장이 핵심이다. 이 유닛은 이미 경계 열거를 두 번 시도했다가 두 번 다
반증됐다(`021` §0). 열거가 스냅샷인 이유는 `deps.*`가 주입 지점이라 다음
구현에서 새 경계가 생기기 때문이다.

게이트는 그 문제를 다르게 다룬다. **지금 있는 것을 세지 않고, 늘어나는 것을
막는다.** 새 경계가 무엇일지 몰라도 유입은 잡힌다.

## 왜 예산 계약보다 먼저인가

G3는 예산 primitive를 필요로 하지 않는다. "이 수치를 넘지 마라"는 검사는
in-process/worker/subprocess 어느 모델에서도 그대로 유효하다.

오히려 순서가 반대여야 한다. 예산 계약을 구현하는 동안 새 동기 IO가 들어오면
계약이 조용히 깨진다. **게이트가 먼저 있어야 그 작업이 안전하다.**

## 실측 baseline (2026-07-31)

초판은 **173**이라고 적었고 틀렸다. 두 가지를 놓쳤다.

1. 줄 수를 셌다. 한 줄에 호출이 둘인 곳이 있다 — occurrence를 세야 한다.
2. primitive를 손으로 열거했는데 `cpSync`, `lstatSync`, `readlinkSync`,
   `realpathSync`, `rmdirSync`, `symlinkSync`가 빠졌다.

**손으로 만든 목록은 유지되지 않는다.** 이 유닛이 경계 열거로 두 번 실패한
것과 같은 실수다. 규칙으로 바꾼다.

```
대상 = /\b[A-Za-z_][A-Za-z0-9_]*Sync\s*\(/   +   Atomics.wait(
```

접미사 규칙이라 `node:fs`·`child_process`의 sync API가 전부 걸리고, 앞으로
추가되는 것도 자동으로 걸린다. 지금 0건인 `execFileSync`·`fsyncSync`도 유입
시점에 잡힌다.

실측:

```
*Sync( occurrence                    183
  existsSync 37 / readFileSync 33 / writeFileSync 31 / mkdirSync 25
  unlinkSync 10 / rmSync 10 / openSync 7 / closeSync 7 / spawnSync 5
  renameSync 5 / statSync 4 / 나머지 각 1
Atomics.wait                           1
────────────────────────────────────────
합계                                  184

CDP command literal send              54
전체 .send(                            57   (ws/child/process 3건 포함)
```

`readFileSync`가 33인 것은 `claim-audit.mjs:134`의 `fs.readFileSync(` 때문이다
— 네임스페이스 접근이라 첫 집계에서 빠졌다. 이 파일은 CLI에서 호출되므로
제외 근거가 없다. manifest에 포함한다.

**두 번 세고 두 번 틀렸다.** 그래서 숫자를 문서에 박지 않는다.

```
scripts/blocking-io-baseline.json     커밋되는 manifest
node scripts/blocking-io-gate.mjs --write-baseline    갱신 (명시적 실행만)
```

**불변식: 정상 게이트는 manifest를 읽기만 한다.** 실행 중 현재 소스에서 상한을
생성하면 게이트는 영원히 통과한다 — 그건 게이트가 아니다. 쓰기는
`--write-baseline`을 사람이 직접 칠 때만 일어나고, 그 diff가 리뷰 지점이 된다.

W1은 **실제 트리 vs 커밋된 manifest**를 비교한다.

`inflateRawSync` 1건도 포함된다 — 접미사 규칙이 자동으로 잡고, 이벤트 루프를
막는다는 점에서 대상이 맞다.

CDP는 `.send('Domain.method'` 리터럴 형태로 센다. 변수명(`cdp`, `session`,
`client`)에 의존하면 rename으로 우회되고, 전체 `.send(`는 `ws.send`,
`child.send`, `process.send` 3건을 잘못 잡는다.

## 처방 — ratchet

`scripts/release-gates.mjs`에 게이트 하나를 추가한다. 기존
`eval-adapters-no-score-claims`와 같은 형태다(`:519-559`).

```
gate:no-new-blocking-io
  web-ai/** 와 skills/browser/** 의 동기 IO 호출 수를 센다.
  파일별 상한 테이블을 초과하면 FAIL.
  총계가 baseline을 초과해도 FAIL.
```

**상한은 현재 수치다.** 줄이는 것은 언제나 통과하고, 늘리는 것만 실패한다.

### 왜 총계만이 아니라 파일별인가

총계만 보면 한 파일에서 줄이고 다른 파일에서 늘리는 것이 상쇄된다. 락 경로에
동기 IO가 하나 더 생기는 것이 정확히 우리가 막으려는 것인데, 다른 파일의
정리로 가려진다.

### 상한을 줄였을 때

게이트가 "상한보다 적다"를 발견하면 **PASS하되 detail에 새 수치를 적는다.**
자동으로 조이지 않는다 — 테이블 갱신은 사람이 커밋해야 이력이 남는다.

### 신규 파일

**baseline에 없는 파일은 상한 0이다.** 게이트가 manifest를 순회하면 새 파일이
통째로 빠지므로, 실제 트리를 순회하고 manifest를 조회하는 방향이어야 한다.

### 무엇을 세지 않는가

- `test/**` — 픽스처는 동기 IO를 자유롭게 써야 한다
- `scripts/**` — 빌드/게이트 도구는 런타임 경로가 아니다
- 주석과 문자열 안의 이름 — 정규식이 호출 형태만 잡는다

마지막 항목은 완벽하지 않다. `// readFileSync(` 같은 주석은 오탐이다. 정확한
파싱 대신 **오탐이 있어도 상한이 고정되면 동작한다** — 지금 세어 고정한
숫자에 그 오탐이 이미 포함돼 있다.

`fs.promises.readFile`이 통과하는 것은 **의도한 동작이다.** 이벤트 루프를 막지
않으므로 sync-isolation ratchet의 대상이 아니다. 그 호출의 데드라인은 예산
계약이 담당한다.

### 이 게이트가 막지 못하는 것

정직하게 적는다. 정규식 카운터는 다음을 통과시킨다.

| 우회 | 예 |
| --- | --- |
| alias import | `import { readFileSync as read } from 'node:fs'` |
| namespace/computed | `fs[name](path)` |
| re-export | `export { readFileSync as read } from 'node:fs'` |
| 기존 wrapper 재사용 | 새 경로에서 `withStoreLock`을 호출 — primitive 총계는 그대로 |

현재 트리에 alias·computed·re-export는 **0건**이다(확인함). 그래서 지금은
이론적 구멍이지만, 구멍인 것은 사실이다.

네 가지를 한다.

1. computed 형태(`fs[...]` 등)를 발견하면 **fail-closed** — 셀 수 없으므로
   통과시키지 않는다.
2. **원래 binding 이름이 `Sync`로 끝나는** alias import와 re-export를
   fail-closed. `node:*` 전체가 대상이다 — `node:fs`/`child_process`로 한정하면
   `import { inflateRawSync as inflate } from 'node:zlib'`가 통과하는데, 게이트
   본체는 `inflateRawSync`를 대상으로 선언했으므로 모순이다.
   `export { readFileSync as read } from 'node:fs'`도 같은 규칙으로 막는다.
3. **비리터럴 CDP send** — `cdp.send(method)`, `cdp['send'](…)`,
   `cdp.send.bind(cdp)` — 도 fail-closed. 리터럴만 세면 변수로 우회된다.
4. **local alias** — `const read = readFileSync;`. import에 `as`가 없고 호출부에
   `readFileSync(`도 없어 앞의 규칙 셋을 전부 빠져나간다. sync binding을
   **값으로 참조**하는 것 자체를 잡는다.

비리터럴 send 허용 목록은 **receiver 이름이 아니라 파일 경로와 개수로**
고정한다. `ws`라는 이름만 허용하면 CDP 세션을 `ws`로 명명해 우회된다.

**"alias 0건"은 sync binding에 한정된 말이다.** 현재 트리에 async alias는
이미 있고 전부 정당하다.

```
node:fs        promises as fs
node:child_process  execFile as execFileCallback
node:timers/promises  setTimeout as sleep
node:path      resolve as resolvePath
```

이들을 막으면 W1이 즉시 실패한다. 규칙은 **원래 이름의 `Sync` 접미사**를 보는
것이지 alias 자체가 아니다.

같은 이유로 CDP는 전체 `.send(` 57건이 아니라 리터럴 54건을 세되, 비리터럴
`.send(`는 기존 3건(`ws`/`child`/`process`)만 허용 목록에 두고 새로운 것은
실패시킨다. 동적 CDP는 현재 0건이라 지금 잠그는 비용이 없다.

**wrapper 재사용은 막지 못한다.** 그건 호출부 manifest가 필요하고 이 게이트의
범위가 아니다. 따라서 이 work-phase는 **열거하고 검증한 ingress 형태만**
닫는다 — 아래 종료 판정 참조.

## CDP 쪽

`CDPSession.send` 54콜도 같은 방식으로 상한을 건다. Playwright가 이 API에
timeout 옵션을 주지 않으므로(`types.d.ts:15872-15885`) 호출이 늘어나는 것은
곧 무제한 대기 지점이 늘어나는 것이다.

## 검증

### 테스트 seam — 소스 트리를 건드리지 않는다

`release-gates.mjs`는 `GATES`를 export하지 않고 import 시 `main()`이 즉시
실행돼 `process.exit`한다. 그리고 **테스트가 실제 소스를 수정하면 사용자의
dirty 작업을 훼손한다.**

순수 evaluator를 분리한다.

```js
evaluateBlockingIoGate({ sources, baseline })
  → { ok, detail }
```

`sources`는 `Map<relativePath, sourceText>`다. production adapter만 실제
`web-ai/`·`skills/browser/`를 읽고, 테스트는 in-memory map을 넣는다. 파일
하나 만들지 않는다.

| # | 시나리오 | 관측 |
| --- | --- | --- |
| W1 | 실제 트리 (production adapter) | PASS |
| W2 | 기존 파일에 `readFileSync(` 하나 추가 | **FAIL**, 파일명과 수치 지목 |
| W2b | **신규 파일**에 blocking 호출 | **FAIL** (manifest 밖 = 상한 0) |
| W3 | A에서 하나 빼고 B에서 하나 더함 (총계 동일) | **FAIL** — B가 상한 초과 |
| W4 | 하나 제거 | PASS + detail에 새 수치 |
| W5 | `.send('Domain.method'` 추가 | **FAIL** |
| W6 | `test/` 경로 | 범위 밖 |
| W7 | `fs[name](path)` computed | **FAIL** (fail-closed) |
| W8 | `import { readFileSync as read } from 'node:fs'` | **FAIL** |
| W8b | `export { readFileSync as read } from 'node:fs'` | **FAIL** (re-export) |
| W8c | `import { inflateRawSync as inflate } from 'node:zlib'` | **FAIL** (node:* 전체) |
| W8d | `import { promises as fs } from 'node:fs'` | PASS — 원래 이름에 `Sync` 없음 |
| W5b | `cdp.send(method)` 비리터럴 | **FAIL** |
| W5c | `ws.send(payload)` (manifest에 등재된 파일·개수) | PASS |
| W5d | `cdp['send'](…)` / `cdp.send.bind(cdp)` | **FAIL** |
| W8e | `const read = readFileSync;` local alias | **FAIL** |
| W9 | `fs.promises.readFile` 추가 | PASS (의도) |

W3 fixture는 `A=1, B=0, total=1` baseline에 `A=0, B=1`을 넣으면 된다 — 총계는
같고 B가 상한 0을 넘는다.

W2b·W5b·W5d·W7·W8·W8b·W8c·W8e가 감사가 찾은 우회다. W4·W6·W8d·W5c·W9는 과잉 차단
방지다 — 특히 W8d와 W5c는 현재 트리에 실재하므로 여기서 틀리면 W1이 깨진다.

### mutation proof

게이트를 `return { ok: true }`로 바꾸면 W2·W2b·W3·W5·W5b·W5d·W7·W8·W8b·W8c·
W8e가 RED가 되어야 한다.

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `scripts/blocking-io-gate.mjs` | 순수 evaluator + `--write-baseline` (신규) |
| `scripts/blocking-io-baseline.json` | 커밋되는 manifest (생성물) |
| `scripts/release-gates.mjs` | `no-new-blocking-io` 게이트가 evaluator를 호출 |
| `package.json` | `gate:no-new-blocking-io` 스크립트 |
| `test/unit/web-ai-blocking-io-gate.test.mjs` | W1~W9 |

게이트 수가 16 → 17로 바뀌므로 그 숫자를 인용하는 문서도 함께 본다.

## 실행 결과 (2026-07-31)

커밋 넷: `3a48e34`(게이트+manifest+테스트), `7062f48`(참조 카운팅+walker),
`04d98b1`(Atomics/CDP 참조), `12b0e50`(문구 정정).

### baseline이 세 번 바뀌었다

```
173  손으로 만든 primitive 목록, 줄 수 기준        ← 틀림
183  Sync 접미사 규칙, glob이 서브디렉터리 누락    ← 틀림
184  전체 트리, 호출 카운팅                        ← 맞음
286  참조 카운팅 (import 포함), 최종
```

**숫자를 손으로 옮기는 것을 그만두는 게 답이었다.** `--write-baseline`이
생성하고 커밋한다.

### 감사가 우회를 세 라운드에 걸쳐 찾았다

| 라운드 | 우회 |
| --- | --- |
| 1 | alias import, computed member, re-export, wrapper 재사용 |
| 2 | `const read = readFileSync`, `cdp.send.bind(cdp)`, `cdp['send'](…)` |
| 3 | `readFileSync?.(p)`, `(readFileSync)(p)`, `(fs)['readFileSync'](p)`, `const read = fs.readFileSync` |
| 4 | `Atomics['wait'](…)`, `Atomics.wait?.(…)`, `.send.call(…)`, `Reflect.apply(cdp.send, …)` |

3라운드에서 **호출 문법을 세는 것을 포기하고 참조를 세는 것으로 바꿨다.**
`readFileSync?.(p)`는 난독화가 아니라 평범한 JavaScript다 — 문법 변형을
정규식으로 쫓아가는 것은 이길 수 없는 싸움이었다.

4라운드는 같은 교훈의 반복이었다. `*Sync`만 참조로 바꾸고 `Atomics`와
`.send`는 호출 형태로 남겨뒀더니 동일한 우회가 그대로 통했다.

### 닫지 못한 것을 게이트가 스스로 말한다

```
readFile\u0053ync(p)              실제로 실행된다. 텍스트로는 안 보인다
disk['readFile' + 'Sync'](p)      상수 접기 + 데이터흐름이 필요하다
```

파서로도 두 번째는 부족하다. 게이트 설명을 `G3 partial`로 낮추고 모듈 헤더에
두 형태를 적었다. **PASS 한 줄이 실제보다 강한 보장으로 읽히면 안 된다.**

### 오탐은 의도한 것이다

참조를 세므로 주석의 `readFileSync`나 무관한 `normalizeSync` 함수 정의도
RED가 된다. 호출만 세던 판본이 실제 유입을 놓쳤으므로, 이름을 바꾸거나
manifest를 리뷰된 커밋으로 갱신하는 비용이 더 싸다.

### 검증

```
npx vitest run test/unit test/integration
  Test Files 180 passed (180); Tests 2027 passed (2027)
npm run gate:all              All 17 gate(s) passed (exit 0)
  gate:no-new-blocking-io — blocking IO 286/286, CDP 54/54
bash structure/check-doc-drift.sh   164 passed
bash structure/verify-counts.sh      76 passed
```

mutation: evaluator를 `return {ok:true}`로 무력화하면 실패를 주장하는 테스트가
전부 RED.

## 이 work-phase가 닫는 것과 닫지 않는 것

닫는 것: 새 `*Sync(` 호출, `Atomics.wait`, CDP command의 유입이 실제로
FAIL한다. **검증된 문법 형태**는 W2·W2b·W3·W5·W5b·W5d·W7·W8·W8b·W8c·W8e다.

**"문법 우회가 불가능하다"고 적지 않는다.** 정규식/참조 스캐너는 그걸 보장할
수 없고, 이 처방은 실제로 두 번 뚫렸다 — 감사가 `const read = readFileSync`와
`cdp.send.bind(cdp)`를 찾았다. 다음에 또 나올 형태가 있다고 가정한다.

기록은 **`G3 partial — enumerated ingress forms closed`** 다. 새 형태가
발견되면 W 목록에 추가하고 manifest를 조인다.

닫지 않는 것:

- **기존 184콜 + CDP 54콜** — 게이트는 유입만 막는다. 제거는 G1의 일이다.
- **wrapper 재사용 경유 유입** — 새 코드가 기존 blocking wrapper를 호출하면
  primitive 총계가 늘지 않아 통과한다. 호출부 manifest가 필요하고 이
  work-phase의 범위가 아니다.
- G1·G2·G4. 후보 A는 여전히 조건부다.
- c7/c8의 예산 상한.

**G3를 met으로 적지 않는다.** wrapper 경유 유입과 미발견 문법 형태가 남는다.
