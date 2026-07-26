# WP4 — fetch · search · extract · research 실행 QA

이 계열은 대부분 브라우저 없이 돈다. `fetch`는 SSRF 방어로 `127.0.0.1`을 거부하므로
로컬 fixture 대신 `https://example.com`과 `--from-file` 오프라인 경로를 썼다.

WP2/WP3 규약 유지: 종료 코드는 파이프 없이 측정, A-gate 중 소스 미변경.

## 1. 새로 나온 결함

### Q11 — fetch 계열이 `ok:false`를 종료 코드로 옮기지 않는다 (높음)

처음에는 `fetch` 하나의 문제로 적고 "중"을 매겼다. A-gate에서 리뷰어가
**`search --verify`도 같다**고 지적했고, 재현해 보니 맞았다. Q8이 `evaluate`
하나가 아니라 계열이었던 것과 같은 구조다.

```
$ agbrowse fetch https://this-domain-does-not-exist-qa-12345.invalid --json --browser never
{ "ok": false, "verdict": "blocked", ... }        exit=0

$ agbrowse search --verify https://this-domain-does-not-exist-qa-12345.invalid --json
{ "ok": false, "verdict": "blocked", ... }        exit=0
```

`search` 파이프라인도 같다. 이쪽은 최상위 `ok` 키조차 없고
`evidenceStatus: "insufficient"`로 실패를 알리는데, 역시 exit 0이다.

```
$ echo '[]' | agbrowse search "nothing" --stdin-results --json
evidenceStatus: insufficient      exit=0
```

**결정적인 대조는 `extract`다.** 똑같이 죽은 도메인을 주면:

```
$ agbrowse extract https://...invalid --schema s.json --json
{ "verdict": "fetch_failed", "ok": false, ... }   exit=1
```

같은 네트워크 조건, 같은 저장소, 한 커맨드만 옳게 동작한다. 오프라인
`--from-file` 경로의 우연이 아니라는 뜻이기도 하다.

같은 `fetch` 안에서도 실패 종류에 따라 처리가 갈린다.

| 실패 | 종료 코드 | 출력 |
|------|-----------|------|
| SSRF 차단 (`http://127.0.0.1/`) | 1 | **평문** `❌ private or local host is not allowed` |
| DNS 실패 (`https://...invalid`) | **0** | JSON, `ok:false`, `verdict:"blocked"` |

SSRF가 exit 1인 것도 의도된 처리가 아니다. `safety.mjs:108`이 **throw**해서
`browser.mjs`의 최상위 catch에 걸릴 뿐이다. `runAdaptiveFetchCli`
(`adaptive-fetch/index.mjs:490-509`)는 결과를 출력하고 반환할 뿐
`result.ok`를 보지 않는다. 즉 어느 CLI도 `ok:false`를 종료 코드에 반영하지 않는다.

디스패치 층에서도 같다. `browser.mjs`는 `fetch`(:2427), `search`(:2366),
`extract`(:2369)의 반환값을 모두 버린다. `search.mjs:71`의 유일한
`process.exit(1)`은 질의 누락용이라 결과 실패와 무관하다.

`extract`가 홀로 옳은 이유는 스스로 종료 코드를 내기 때문이다:
`extract.mjs:540`의 `if (!body.ok) return io.exit(1)` 한 줄이다.

**심각도를 "높음"으로 올린다.** 처음에 "중"으로 본 것은 한 커맨드 문제로 봤기
때문이다. 계열 전체이고, 무엇보다 실패 방식이 조용하다. Q7은 파서가 요란하게
깨진다(`JSON.parse`가 던지고 스크립트가 멈추고 누군가 조사한다). Q11은 조용히
통과한다:

```
$ if agbrowse search --verify https://...invalid --json >/dev/null 2>&1; then
    echo "CHAIN CONTINUED"; fi
CHAIN CONTINUED
```

문서가 시키는 대로 `ok`를 읽는 호출자와 셸이 정반대 답을 얻는다. Q2의 무증상
오실행을 "높음"으로 본 것과 같은 이유다.

### Q12 — `research`가 `--json`에도 평문 오류를 낸다 (중하)

Q7과 같은 계열이고 범위만 다르다.

```
$ agbrowse research plan --json; echo $?
Usage: browser.mjs research plan --query <problem> [--max-queries N] [--json]
1

$ agbrowse research normalize-results --file /tmp/nope.json --json; echo $?
❌ ENOENT: no such file or directory, open '/tmp/nope.json'
1
```

종료 코드는 1로 옳다. 형식만 계약을 어긴다. Q7·Q11과 묶어 한 번에 다루는 것이
맞다.

## 2. 정상 확인 — 그리고 `extract`는 모범 사례다

`extract`는 이 저장소가 이미 옳은 답을 알고 있음을 보여준다. 성공이든 실패든
**같은 스키마**를 내고, 실패 종류를 verdict로 구분하며, 종료 코드도 일치한다.

| 입력 | verdict | ok | exit |
|------|---------|-----|------|
| 정상 table | `extracted` | true | 0 |
| 매핑 불가 (`--source jsonld`) | `no_mappable_structure` | false | 1 |
| 없는 파일 | `input_unreadable` | false | 1 |
| 깨진 스키마 | `schema_invalid` | false | 1 |

네 경우 모두 `schemaVersion: "agbrowse-extract-v1"`을 유지한다. Q7/Q11/Q12를 고칠 때
새 설계를 발명할 필요가 없다는 뜻이다 — **`extract`의 계약을 따라가면 된다.**

`extract`는 종료 코드까지 `ok`와 일치한다는 점이 핵심이다. 네 경우 모두
`schemaVersion: "agbrowse-extract-v1"`을 유지한다. 엄밀히는 키 집합이 완전히
같지는 않다 — `no_mappable_structure`에는 `structuresAvailable`이 더 붙는다.
진단 정보가 추가되는 것이고, 핵심 계약(`schemaVersion`/`ok`/`verdict`/`errors`/`data`)은
네 경우 모두에 있다.

`search --verify`는 **스키마만** 모범이다. 성공과 실패가 동일한 키 집합
(`schemaVersion url finalUrl verdict ok source title textExcerpt warnings chromeUsed`)을
쓰고 `verdict`만 `weak_ok` / `blocked`로 갈린다. 하지만 종료 코드는 실패에도 0이라
Q11에 포함된다. 스키마가 일관돼도 종료 코드가 어긋나면 계약은 반쪽이다.

### 2.1 나머지 실행 근거

| 명령 | 근거 |
|------|------|
| `fetch https://example.com --json --browser never` | `ok:true`, `verdict: weak_ok`, 20개 키 |
| `search --verify https://example.com --json` | `verdict: weak_ok`, `ok` 존재 |
| `search "example" --stdin-results --json` | `agbrowse-search-v1`, plan/enrichment/escalation 포함 |
| `research plan --query "테스트 질문" --json` | `research-plan-v1`, 제약 분해 |
| `extract --from-file --schema --json` | 위 표 4행 |
| `fetch --trace` / `--selector` | 정상 동작 |

### 2.2 `--max-bytes`는 결함이 아니다 (fail-closed)

```
$ agbrowse fetch https://example.com --json --browser never --max-bytes 500
verdict: blocked   contentBytes: 0   contentLimitBytes: 65536
```

`fetcher.mjs:67`의 `body-exceeds-max-bytes`로, 한도를 넘으면 잘라내는 대신
거부한다. 의도된 fail-closed다.

다만 두 가지는 적어 둔다. `contentLimitBytes`가 요청한 500이 아니라 기본값
65536을 보고하고, 요약만 보면 초과 거부와 진짜 차단이 구분되지 않는다
(둘 다 `No public endpoint, fetch, or metadata attempt produced readable content`).

## 3. Q8 계열 점검 결과

이 계열 커맨드는 `parseArgs`를 쓰므로 플래그 값이 위치 인자로 새지 않는다.
`collectPositionalArgs`의 호출자는 정확히 네 곳(`evaluate`/`type`/`wait-for-text`/`upload`)이고
이 계열은 포함되지 않는다.

처음에는 WP3 리뷰 결론을 인용만 하고 실행 검증을 하지 않았다. 리뷰어 지적대로
그건 부족했다. WP3의 `network` 결론을 이월한 것과는 다르다 — 그쪽은 **바뀌지 않은
코드에 대한 결론**이었고, 이쪽은 **다른 커맨드에 대한 주장**이다. 규칙으로 정리하면:
**바뀌지 않은 코드의 결론은 이월하고, 새 표면에 대한 주장은 다시 돌린다.**

실제로 확인했다: `research plan --query "hello" --max-queries 3` → `problem='hello'`,
오염 없음.

## 4. 미검증으로 남기는 것

| 항목 | 사유 |
|------|------|
| `fetch --browser required` / `--browser-session user\|interactive` | 사용자 프로파일 세션을 요구. 격리 규약과 충돌 |
| `extract --escalate-web-ai` | 로그인된 프로바이더 필요 |
| `search --deep` | 외부 검색 트래픽이 크고 결과가 시점 의존 |
| `fetch --allow-archive` / `--allow-third-party-reader` | 외부 서드파티 서비스 호출 |
| `research enrich-fetch` / `browse-plan` | 앞 단계 산출물 체인이 필요. WP5 이후 여력이 되면 |
