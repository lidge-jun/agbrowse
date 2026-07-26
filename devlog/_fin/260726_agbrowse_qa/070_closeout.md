# WP7 — QA 종료

## 1. 왜 이걸 했나

직전 라운드(Oracle chase 5)가 unit과 integration 스위트만으로 닫혔다. 그 뒤
WP10에서 통합 스위트가 세 라운드 내내 "번들 Chromium 없음"으로 단정된 채 한 번도
실행되지 않았고, 실제로 돌려보니 라운드 4부터 박혀 있던 크래시가 나왔다.

같은 구멍이 더 크게 남아 있었다. **`agbrowse` CLI를 사람이 쓰듯 실행해 본 기록이
없었다.** 테스트가 통과한다는 것과 도구가 손에서 동작한다는 것은 다른 명제다.

## 2. 결과

커맨드 표면을 실제로 두드려 **결함 14건**을 찾았고 **11건을 고쳤다.**

| ID | 결함 | 심각도 | 처분 |
|----|------|--------|------|
| Q1 | `status --json`이 JSON을 내지 않음 | 중 | 수정 `e0a0400` |
| Q2 | `evaluate`가 플래그를 표현식에 합쳐 무증상 오실행 | 높음 | 수정 `e0a0400` |
| Q3 | `claim-audit`이 FAIL인데 exit 0 | 높음 | 수정 `e0a0400` |
| Q4 | README가 동작한 적 없는 Camoufox 레인 광고 | 중 | 수정 `4a2fb87` |
| Q5 | 인자 누락이 `internal.unhandled` | 중하 | Q13에 흡수 |
| Q6 | Camoufox `content`/`html` 불일치 | 중 | 수정 `4a2fb87` (동작 미검증) |
| Q7 | 브라우저 커맨드 실패가 `--json` 무시 | 중 | 수정 `4a2fb87` |
| Q8 | 플래그 **값**이 위치 인자로 새는 커맨드 3종 | 높음 | 수정 `ad7f259`+`86bf3d5` |
| Q9 | `tab-cleanup` JSON이 `--dry-run` 유무로 공통 키 0개 | 중 | 수정 `4a2fb87` |
| Q10 | 트랜스포트 테스트가 skipped로 집계 | 중 | **부분** — 15개 미검증 |
| Q11 | fetch 계열이 `ok:false`를 종료 코드로 안 옮김 | 높음 | 수정 `4a2fb87` |
| Q12 | `research`가 `--json`에도 평문 | 중하 | 수정 `4a2fb87` |
| Q13 | 입력 오류에 틀린 errorCode | 중 | **부분** — `--file` 경로 잔여 |
| Q14 | `skills install` 실패가 `--json` 무시 | 중하 | 수정 `4a2fb87` |

### 2.1 가장 무거웠던 것

**Q2/Q8** — 플래그가 위치 인자를 오염시키는 계열. `evaluate "1+1" --port 9333`이
실제로는 `1+1 --port 9333`을 실행했고, `type e2 "hello" --port 9333`은 페이지에
`hello 9333`을 **에러 없이** 입력했다. 일부러 걸러내던 유일한 플래그가
`--unsafe-allow`, 즉 보안 게이트였다는 점이 이 결함의 성격을 말해준다.

**Q11** — 실패가 `&&` 체인을 조용히 통과. `ok` 필드와 셸이 정반대 답을 준다.

## 3. 검증 범위

`browser.mjs`의 모든 `case`가 검증표 또는 미검증표 중 하나에 귀속된다.

**미검증으로 남긴 것**(사유는 각 문서에):

- 로그인/과금 경로: `web-ai send`/`query`/`poll`/`watch`/`code`/`work`, `runway` 전체,
  `project-sources add`
- 상태 전제: `web-ai status`/`doctor`, `tab-cleanup --provider`, `tab-switch --force`
- 위험/범위 밖: `reset --force`, `evaluate --unsafe-allow`, `start --headed`
- 환경: 오버라이드 없는 Chromium 트랜스포트 테스트 15개 (Q10)

## 4. 이 QA가 반복해서 찾은 것

000_plan §5.2에 표로 정리했다. 요약하면 **결함 대부분이 "저장소 안에 이미 옳게
하는 곳이 있는데 형제 경로가 따르지 않은" 모양**이었다.

| 결함 | 이미 옳던 곳 |
|------|--------------|
| Q8 | WP1이 고친 `evaluate` |
| Q11 | `extract` (`ok`와 종료 코드 일치) |
| Q13 | `code-mode.prompt-missing` |
| Q1/Q7/Q12/Q14 | `doctor`, `extract`의 `--json` 처리 |

그래서 WP6의 수정은 전부 "새로 설계"가 아니라 "선례를 형제들로 확장"이었다.

단서: 이 표는 **이번 방법(플래그 변형·경계 탐색)이 잘 드러내는 모양**이다.
동시성이나 자원 고갈로 팠다면 다른 결함이 나왔을 것이다.

## 5. 스스로 걸린 함정

리뷰어와 매 단계 2~4라운드를 돌았고, 블로커는 대부분 코드가 아니라 **내 증거표**에서
나왔다. 남겨둘 가치가 있는 것들:

- **WP2**: "결함이 아니다"라고 철회한 항목이 재현 불가였다. 원인은 `--submit`이
  아니라 fixture 서버가 죽어 탭이 에러 페이지에 있던 것. 재현 안 되는 관찰로
  결함을 주장하는 것과 철회하는 것은 같은 잘못이고, 후자가 눈에 덜 띈다.
- **WP3**: A-gate가 트리를 읽는 중에 소스를 고쳤다. 리뷰어는 순간 상태와 실제
  상태를 구분할 수 없다. → **감사 중에는 소스를 건드리지 않는다.**
- **WP3**: Q8 첫 수정이 값-소비 플래그 allowlist라 fail-open이었다. 목록에 없는
  플래그는 계속 샜다. 집합을 뒤집어 fail-closed로 바꿨다.
- **WP5**: Q13을 "errorCode 어휘가 없어서"로 진단했는데, `code-mode.prompt-missing`이
  이미 옳게 동작하고 있었다. 없는 설계 공백을 상상한 것.
- **WP6**: 컨텍스트 가드를 손으로 다시 써서 `--context-file`을 깨뜨렸다. 정본이
  같은 파일 380줄 위에 있었다. **결함 패턴을 문서화하면서 같은 패턴의 결함을
  만들었다.**
- 테스트를 두 번 잘못 썼다. `--` 이스케이프 테스트는 인자를 한 덩어리로 인용해
  뮤턴트에서도 통과했고, Q11 테스트는 던지는 경로를 쳐서 수정이 아니라 예외
  처리기를 검증했다.
- **WP1**: `network` 행이 세 라운드 연속 틀렸다. 두 번째 판에서는 **그 행을 고치는
  수정 자체가 또 틀렸다.** 결국 수치를 손보는 대신 메커니즘을 규명하고
  `--live-only`로 변동 요인을 제거해야 끝났다.
- **WP4**: WP3의 결론을 인용만 하고 새 표면에서 다시 돌리지 않았다. 규칙으로
  정리하면 — **바뀌지 않은 코드의 결론은 이월하고, 새 표면에 대한 주장은 다시
  돌린다.**
- **WP7**: 라운드 6 이월 항목에 검증하지 않은 해결책을 확정처럼 적었다. 마지막
  문서에서까지 같은 실패를 했다.

리뷰어도 한 번 자기 실행이 만든 디렉터리를 보고 결함을 오탐했다. 하네스 오염은
감사하는 쪽도 예외가 아니다.

### 5.1 잘못된 계약을 검증하던 테스트 두 개

수정 중 기존 테스트 2건이 걸렸는데, 둘 다 **결함을 계약으로 고정**하고 있었다.

- `web-ai-question.test.mjs`: 프롬프트 누락과 예산 초과가 **같은 errorCode를
  쓴다는 것**을 검증. 제목부터 `throws WebAiError with context.over-budget for
  empty prompt and oversize prompt`였다.
- `research-cli.test.mjs`: `--json`을 주면서 **stderr 평문**을 기대.

테스트가 수정을 막을 때 던질 질문은 "이게 의도된 동작을 검증하는가, 현재 동작을
검증하는가"다. 둘 다 후자였다.

## 6. 게이트

오버라이드 있음(`AGBROWSE_CHROMIUM_EXECUTABLE_PATH`를 chromium-1228로):

```
npm run test:unit         → 156 files / 1683 tests passed
npm run test:integration   → 22 files / 193 tests passed
npm run test:e2e           → 1 file / 1 test passed
npm run docs:drift         → 164 passed
npm run docs:counts        → 76 passed
```

오버라이드 없음:

```
npm run test:integration   → exit 1, 4 files failed, 15 tests never run
```

**두 번째 결과를 숨기지 않는다.** 이 유닛의 출발점이 "안 돌아간 표면은 통과가
아니라 미검증"이므로, 그 15개는 미검증이다.

## 7. 라운드 6 이월

1. **Chromium 리비전 불일치** — 확인된 사실만 적는다.

   ```
   playwright-core@1.58.2 해석 →  .../chromium-1208/...        (캐시에 없음)
   캐시 실제 보유            →  chromium-1217, chromium-1228
                                chromium_headless_shell-1217, -1228
   npx playwright install chromium-headless-shell → 1208을 받아오지 않음
   ```

   해결 후보는 셋인데 **어느 것도 검증하지 않았다.**

   - 1.58.2가 원하는 1208 빌드를 실제로 설치
   - `playwright-core`를 캐시에 있는 빌드를 쓰는 버전으로 맞춤
   - 게이트 스크립트에서 `AGBROWSE_CHROMIUM_EXECUTABLE_PATH`를 설정

   처음에는 "버전 핀으로 해결된다"고 단정해 적었다가 A-gate에서 잡혔다. 검증하지
   않은 해결책을 확정처럼 쓰는 것은 이 유닛이 없애려던 바로 그 실패다.
   `test:integration`을 기본 게이트에 넣는 것은 이 항목이 해결된 뒤의 일이다.
2. **Q13 잔여** — `web-ai context-dry-run --prompt hi --file <path>`가 여전히
   `internal.unhandled`로 죽는다. 가드 메시지가 `--file`을 안내하므로 특히 나쁘다.
3. **Q6 동작 확인** — 필드명은 맞췄지만 Camoufox 레인이 실제로 증거를 만드는지는
   확인 못 했다. `camoufox`는 선언되지 않은 선택적 Python 의존성이다.
4. **다른 결함 모양** — §4 단서대로, 동시성·자원 고갈·깨진 프로바이더 DOM 방향은
   이번에 건드리지 않았다.

## 8. 커밋

| 커밋 | 내용 |
|------|------|
| `e0a0400` | Q1/Q2/Q3 수정 + 회귀 스위트 신설 |
| `bafcb7c` | WP2 QA 문서 |
| `ad7f259` | Q8 수정 (첫 시도, 불완전) |
| `86bf3d5` | Q8 재수정 — 플래그 파서를 fail-closed로 |
| `f0f1dfc` | WP3 QA 문서 |
| `5c14fe0` | WP4 QA 문서 |
| `e62e94d` | WP5 QA 문서 |
| `4a2fb87` | Q4/Q6/Q7/Q9/Q11/Q12/Q14 수정, Q10/Q13 부분 |

## 9. 푸시

```
$ git push origin dev
To https://github.com/lidge-jun/agbrowse.git
   abb2bcb..68a2b10  dev -> dev

$ git fetch origin dev && git rev-parse dev
68a2b109ea1aa156d43400a309b7c367bc1e0f94
$ git rev-parse origin/dev
68a2b109ea1aa156d43400a309b7c367bc1e0f94
```

9개 커밋, `abb2bcb..68a2b10`. `dev`만, force-push 없음, PR 없음. `68a2b10`은 이
close-out 커밋 자신이므로 위 블록은 푸시 증거를 담은 후속 커밋에 실린다 — 커밋은
자기 다음 커밋의 SHA를 담을 수 없다.
