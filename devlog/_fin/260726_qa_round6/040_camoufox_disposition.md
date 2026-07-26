# WP3 — Camoufox 레인: 검증 완료

직전 QA의 §7 이월 3번. Q6에서 필드명(`content` → `html`)은 고쳤지만 **레인이 실제로
증거를 만드는지는 미검증**으로 남아 있었다.

## 1. 결론

**동작한다.** 격리 venv에 camoufox를 설치하고 레인을 직접 호출해 확인했다.

```
$ node -e "fetchViaCamoufox('https://example.com', {timeoutMs:120000})"
ok: true
키: ok title html url
html 길이: 559
title: Example Domain
소요: 6104 ms
```

**Q6 수정이 실제로 효과가 있었다.** 필드명이 `content`였을 때는 `text`가 항상 `''`이
되어 후보가 버려졌는데, 이제 `html` 559자와 제목이 실제로 돌아온다.

### 1.1 파이프라인에 증거로 채택되는 것까지 확인했다

레인이 값을 돌려주는 것과 그 값이 파이프라인의 증거가 되는 것은 다른 주장이다.
뒤쪽을 따로 확인했다. `--browser required`로 전체 경로를 태우면 이렇게 된다.

```
$ const r = await runAdaptiveFetch({url:'https://example.com', browserMode:'required', trace:true})
r.attempts[1] = { source:"fetch", verdict:"weak_ok", reason:"camoufox-render",
                  evidence:[... ,"camoufox-render"] }
최종 evidence = ["score:26","source:fetch","text:142","density:0.25","title","camoufox-render"]
content 142자, title "Example Domain"
```

최종 결과의 본문과 제목이 이 레인에서 나왔다. 재현할 사람을 위해 좌표를 정확히
적는다. `attempts`는 `r.trace` 밑이 아니라 **결과 객체의 최상위**다. `trace:true`를
줘도 `r.trace`는 `undefined`이고 요약만 `r._traceSummary`에 담긴다.

뒤이은 `browser` 시도는 `browser_required`로 끝난다. reason은
`isolated browser page dependency is unavailable`이다 — `deps`를 주지 않고 부르면
`createIsolatedPage`가 없어 `browser-runtime.mjs:28`이 던진다. **그런데도 `ok:true`가
나오는 이유**는 camoufox 후보가 이미 `readerCandidates`에 들어가 있어
`index.mjs:451`의 `if (best)`가 그것을 집기 때문이다. 브라우저 레인이 아무것도
보태지 못한 상태에서 나온 결과이므로, 본문 142자가 camoufox에서만 나왔다는 것이
오히려 분명해진다.

리뷰어는 이 reason을 `browser session mode is none`(`browser-runtime.mjs:19-21`)으로
봤는데, 그건 리뷰어가 스니펫에 `browserSession:'none'`을 넣고 돌린 값이다. 나는 그
옵션 없이 불렀고 — `browserMode:'required'`면 `browserSession`은 `isolated`로
기본값이 잡힌다(`index.mjs:44`) — 위의 `:28` 분기로 갔다. 두 경로 모두
`browser_required`로 끝나고 결론은 같지만, 문서에 적히는 좌표는 실제로 실행한
쪽이어야 한다.

리뷰어가 이를 확인하고 판정을 GO로 바꿨다. 리뷰어의 말은 "내가 넘긴 파라미터를 내
관찰의 근거로 삼았고, 그것을 문서 탓으로 돌렸다"였다. §2와 같은 종류의 실수가
반대 방향으로 한 번 더 일어난 셈이고, 이번에는 실행이 갈랐다.

## 2. 여기까지 오는 데 근거를 두 번 틀렸다

이 문서는 세 판에 걸쳐 "미검증"을 방어했고, 방어 근거가 **두 번 연속 틀렸다.**

| 판 | 내가 든 근거 | 왜 틀렸나 |
|----|--------------|-----------|
| 1판 | 격리할 방법이 없다 — 사용자 시스템 Python을 건드려야 한다 | `detectPython`은 이름 `python3`를 `execFile`로 부른다(`camoufox-session.mjs:20-22`). PATH 해석이므로 venv면 충분하다 |
| 2판 | 전용 Firefox 빌드를 받아야 하는데 이 환경은 브라우저 아카이브 압축 해제가 정지한다(WP1) | camoufox는 `requests` + Python `zipfile`을 쓴다. WP1의 정지는 Playwright의 Node 추출기 고유 문제였고, 실제로 8초 만에 받아 풀렸다 |

책임의 소재를 정확히 적는다. 2판 근거는 **리뷰어가 먼저 제시한 추정**이고, 내가
그것을 확인 없이 인용해 문서에 근거로 올렸다. 잘못된 전제를 만든 쪽은 리뷰어이고,
검증 없이 그것을 문서의 결론 근거로 승격시킨 쪽은 나다. 반증도 리뷰어가 스스로
측정해 내놓았다. 리뷰어의 결정적 실험은 WP1에서 영구 정지했던 바로 그 91MB
`chrome-headless-shell` zip을 Python `zipfile`로 풀어본 것이다 — 0.3초에 끝났다.
같은 아카이브, 다른 추출기, 다른 결과다.

**남은 근거는 "범위 밖"뿐이었고, 그건 검증하면 사라지는 것이었다.** 그래서 검증했다.

## 3. 검증 절차

```
$ python3 -m venv /tmp/qa6-venv-XXXX     # 격리
$ source .../bin/activate && pip install camoufox
$ python3 -c "from camoufox.sync_api import Camoufox; print('import OK')"
import OK

$ python3 -m camoufox fetch               # 브라우저 빌드
Path: ~/Library/Caches/camoufox/browsers/official/152.0.4-beta.28-...
(8초, 완료)
```

`detectCamoufox`가 PATH의 `python3`를 찾으므로, venv가 활성화된 셸에서 레인을
호출하면 그 venv의 인터프리터가 잡힌다. 사용자 시스템 Python
(`/opt/homebrew/lib/python3.14`)에는 camoufox를 설치하지 않았다.

### 3.1 격리는 Python 패키지까지였고, 브라우저 빌드는 아니었다

처음에 이 절에 "사용자 환경을 건드리지 않았다"고 적었는데 **정확하지 않다.**
camoufox는 `platformdirs.user_cache_dir`로 캐시 경로를 잡기 때문에 브라우저 빌드가
venv가 아니라 사용자 홈으로 떨어진다.

```
$ du -sh ~/Library/Caches/camoufox
656M    /Users/jun/Library/Caches/camoufox
```

`browsers/`, `addons/`, `config.json`, `repo_cache.json`이 20:54(내 검증 시각)에
생성됐다. 시스템 Python은 깨끗하고(`ModuleNotFoundError: No module named 'camoufox'`)
9222의 사용자 Chrome도 건드리지 않았지만, 이 656MB는 내 검증이 남긴 것이다.

**남길지 지울지는 사용자 판단이다.** 남기면 다음 라운드에서 재설치 없이 이 레인을
다시 검증할 수 있고, 지우면 디스크 656MB가 돌아온다. 임의로 지우지 않았다.

## 4. 미설치 환경에서의 비용

"미검증"과 "위험"은 다르다. 이 레인이 지금 무엇을 하는지 쟀다.

```
$ node -e "fetchViaCamoufox('https://example.com',{timeoutMs:5000})"
결과: null (no-op)
소요: 49 ms
```

`detectCamoufox`가 `python3 -c "from camoufox.sync_api import Camoufox"`로 존재를
확인하고, 실패하면 `cachedAvailable = false`로 캐시한 뒤 `null`을 반환한다
(`camoufox-session.mjs:35-45`). 호출부는 `catch(() => null)`로 감싸고
`if (camoResult?.ok)`로 가드한다(`index.mjs:318-321`).

**이 측정은 camoufox가 없는 환경의 값이다.** 즉 일반 사용자가 겪는 비용이고, 위
§1의 6.1초는 설치된 환경에서 레인이 실제로 렌더링할 때의 값이다.

**캐시 범위를 정확히 적는다.** `cachedAvailable`은 모듈 수준 변수라 **프로세스
안에서만** 유효하다. CLI는 호출마다 새 프로세스이므로 `agbrowse fetch`를 열 번
실행하면 프로브도 열 번 일어난다. 처음에 "한 번의 프로브 이후 캐시"라고 적은 것은
한 프로세스 안에서 두 번 부른 측정을 일반화한 오류였다. 리뷰어가 PATH shim으로
실제 `python3` 호출을 세어 **매 실행마다 2회**(`--version`과 import 확인)임을
확인했다.

정확한 비용: **미설치 환경에서 프로세스당 프로브 2회, 약 40~50ms.** fetch 결과에는
아무 영향을 주지 않는다.

### 4.1 `--browser required`에서는 조건부가 아니라 상시 경로다

레인의 실행 여부는 `browserMode`에 달려 있고(`index.mjs:317`), 건너뛰는 것은
`never`뿐이다.

| 모드 | 프로브 | 근거 |
|------|--------|------|
| `never` | 0회 | `browserMode !== 'never'` 조건에서 차단 |
| `auto` | 2회 | 앞 레인이 `strong_ok`를 못 내면 진입 |
| `required` | 2회 | **항상** 진입 |

`required`가 중요하다. `index.mjs:93`과 `:99`가 public endpoint와 direct fetch를
건너뛰므로 `readerCandidates`에 `strong_ok`가 생길 수 없고, camoufox 레인은
조건부 폴백이 아니라 필연적으로 실행된다. 무해하다는 결론은 유지되지만("프로브 후
`null`, 호출부 이중 가드"), "가끔 타는 폴백"이라는 인상은 정확하지 않다.

## 5. 제거하지 않는 이유

| 근거 | 내용 |
|------|------|
| 문서상 약속 — **아직 남아 있다** | Q4가 지운 것은 다른 행이고, `README.md:246`이 여전히 `Camoufox stealth lane`을 기능 목록에 올려 둔다. 같은 README `:185`/`:367`은 stealth를 out of scope이자 forbidden으로 선언하므로 문서 내부가 상충한다. §6의 처분과 함께 정리해야 한다 |
| 무해함 | §4에서 측정. 미설치 시 프로세스당 프로브 2회(40~50ms) 후 no-op |
| **동작 확인됨** | §1에서 실증. `html` 559자와 제목을 반환하고, §1.1에서 파이프라인 증거로도 채택된다 |
| 제거는 되돌리기 어렵다 | 코드 92줄 + 테스트를 지우는 것은 이 QA의 권한 밖 제품 판단이다 |

처음에는 "동작한 적 없는 코드가 남는 것이 유지의 대가"라고 적었다. 검증 이후로는
그 문장이 성립하지 않는다. 대가는 선언되지 않은 선택적 의존성이 남는 것이고,
그건 §6에서 다룬다.

### 5.1 Q6 수정은 회귀 테스트로 고정되어 있지 않다

`index.mjs:329`의 `camoResult.html`은 살아 있고, `camoufox-session.mjs:50`의
typedef와 Python emitter의 `json.dumps({... "html": html ...})`까지 세 지점이
같은 필드명을 쓴다.

그런데 **이 수정을 지키는 테스트가 없다.** `browser-adaptive-fetch-camoufox.test.mjs`는
테스트가 1건뿐이고 aborted-signal 경로만 본다. 누가 `camoResult.content`로 되돌려도
게이트는 초록색이다. Q6이 고친 바로 그 결함이 무방비다.

이번 라운드에서 고치지 않는 이유는 스폰 없이 이 경로를 테스트하려면 주입 지점이
필요해 설계 변경이 되기 때문이다. 사용자가 "유지"를 택하면 이것이 다음 후속 작업의
근거가 된다.

## 6. 남는 것 — 사용자 판단이 필요한 지점

이 레인의 최종 처분(계속 유지 / 선택적 의존성으로 선언 / 제거)은 제품 결정이다.
판단에 필요한 사실은 이 문서에 다 있다.

- **동작한다.** §1과 §1.1에서 확인했다. 더 이상 "가능성"이 아니다.
- 설치하지 않으면 비용은 프로세스당 프로브 2회(40~50ms)다. `--browser required`에서는
  매번 탄다.
- `README.md:246`이 아직 이 레인을 기능으로 광고한다. 어떤 처분을 택하든 그 행을
  함께 정리해야 문서 내부의 상충이 해소된다.
- Q6 수정은 회귀 테스트가 없다(§5.1).
- 내 검증이 `~/Library/Caches/camoufox`에 656MB를 남겼다(§3.1). 남길지 지울지 결정이 필요하다.

검증 결과가 선택지의 무게를 바꾼다. **동작하는 기능을 제거하는 것**과 **동작하지
않는 코드를 치우는 것**은 다른 결정이다. 이제는 전자다.

남은 문제는 기능 자체가 아니라 **정책**이다. README `:185`/`:367`이 stealth를 out of
scope이자 forbidden으로 선언하는데 `:246`은 그것을 기능으로 광고한다. 레인이 실제로
동작하므로 이 상충은 문서 실수가 아니라 **제품이 무엇을 하기로 했는지의 문제**다.
그건 사용자가 결정할 일이다.
