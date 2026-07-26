# 260726 agbrowse 자체 QA

Date: 2026-07-26
Branch: `dev` (라운드 5 close-out + WP10 이후, `abb2bcb`)
선행 유닛: `devlog/_fin/260726_oracle_chase4/`

## 1. 왜 이 유닛이 필요한가

WP10에서 나온 결론이 이 유닛의 전제다. 라운드 3-5는 Playwright 통합 스위트를
"번들 Chromium 없음"으로 단정하고 세 라운드 내내 한 번도 돌리지 않았다. 실제로는
잘 돌아갔고, 그 안에 라운드 4부터 박혀 있던 크래시가 들어 있었다.

같은 구멍이 더 크게 남아 있다. 라운드 5 close-out이 근거로 삼은 것은 unit과
integration 스위트뿐이고, **`agbrowse` CLI를 사람이 쓰듯 실행해 본 기록은 없다.**
테스트가 통과한다는 것과 도구가 손에서 동작한다는 것은 다른 명제다.

그래서 이 유닛은 커맨드 표면을 실제로 두드린다. 자동화 테스트가 아니라 실행이
1차 증거다.

## 2. 실행 규약

사용자의 상시 브라우저와 데이터를 절대 건드리지 않는 것이 최우선이다.

| 항목 | 규약 | 이유 |
|------|------|------|
| HOME | `BROWSER_AGENT_HOME=$(mktemp -d /tmp/agbqa-XXXX)` | `~/.browser-agent`의 프로파일·세션·스크린샷 보호 |
| CDP 포트 | `--port 9333` 고정 | 사용자가 쓰는 기본 `9222`와 분리 |
| 페이지 | `test/fixtures/site` 로컬 서버 우선 | 외부 의존 없이 재현 가능 |
| 외부 URL | `https://example.com`만 | 안정적이고 부하가 없는 표준 예제 도메인 |
| 모드 | `start --headless` | 사용자 화면을 뺏지 않음 |

검증 중 사용자 소유로 보이는 Chrome이 `9222`에 떠 있는 것을 확인했고, 종료하거나
프로파일을 만지지 않았다. QA는 전부 별도 포트/HOME에서 수행했다.

## 3. 실행하지 않는 표면 (미검증으로 명시)

"돌리지 않았다"를 "통과"로 적지 않는 것이 이 유닛의 존재 이유이므로, 아래는
미검증으로 남기고 그 사유를 함께 적는다.

| 표면 | 사유 |
|------|------|
| `web-ai send` / `query` / `poll` / `watch` / `code` / `code-extract` / `stop` / `snapshot` | 로그인된 프로바이더 세션 필요. 실제 프롬프트가 사용자 계정에서 소비된다 |
| `web-ai work send` | 위와 같음. 추가로 Work 과금 표면 |
| `web-ai status` / `doctor` | 활성 프로바이더 탭 전제. 로컬 fixture로는 의미 있는 판정이 안 나옴 |
| `runway` 전체 (Level 0 포함) | Level 0도 로그인된 Runway 탭을 전제한다 |
| `web-ai project-sources add` | 사용자 ChatGPT 프로젝트를 변형 |
| `web-ai mcp-server` | 장기 실행 stdio 브리지. 별도 하네스 필요 → WP5에서 판단 |
| `reset --force` | 프로파일 삭제. 격리 HOME에서도 실익 대비 위험이 큼 |
| `check` / `uncheck` | 기본 fixture에 체크박스가 없음. 임시 fixture로 검증 가능 → WP2 |
| `agbrowse-vision-click` | 별도 bin. 화면 좌표 기반이라 headless 검증 가치가 낮음 → WP2에서 판단 |

이 표는 A-gate 1차에서 한 번 깨졌다. 처음 판에는 21개 커맨드가 이 표에도, 검증
표에도 없었다. 리뷰어 지적대로 그 침묵은 라운드 3-5 패턴의 축소판이라, 전부
실행해 [010_findings.md](010_findings.md)에 채웠다.

## 4. 작업 단계

```
WP1 (이 문서) 표면 인벤토리 + 실행 규약 + 예비 실행
  ├─ WP2  A/B/C  생명주기 · 관찰 · 상호작용
  ├─ WP3  D/E/F  네비게이션 · 탭 · wait · 진단
  ├─ WP4  G      fetch / extract / search / research
  ├─ WP5  H/I/J  web-ai 무로그인 표면 · skills · JSON 계약
  ├─ WP6         결함 수정 (회귀 테스트 + 뮤테이션 RED 필수)
  └─ WP7         QA 리포트 · 전체 게이트 · dev 푸시
```

### 4.1 WP1 범위 정정 — Q1/Q2/Q3 수정이 여기서 끝났다

원래 WP1은 문서 전용이었다. 실제로는 A-gate 왕복 중에 Q1·Q2·Q3 수정과 회귀
테스트까지 이 단계에서 끝났고, 리뷰어가 "문서는 docs-only라는데 트리에는 54줄이
들어와 있다"고 정확히 지적했다. 문서를 트리에 맞춰 정정한다.

이 단계에서 실제로 바뀐 것:

| 파일 | 내용 |
|------|------|
| `skills/browser/browser.mjs` | Q1 `status --json` 분기, Q2 `collectEvaluateExpression()` 신설 + 호출부 교체, Q3 `web-ai` 결과의 `ok:false` → `exit 1` |
| `test/integration/cli-contract-regressions.test.mjs` | 신규 7케이스 회귀 스위트 |
| `structure/str_func.md` | 위 변경에 따른 카운트 동기화 |

WP6에 남는 것은 Q4(README 행 삭제)와 Q6(Camoufox `content`/`html` 불일치), 그리고
Q5(인자 누락의 `internal.unhandled` 오분류)다.

범위가 흘러넘친 것 자체는 좋은 일이 아니다. 다만 Q2는 임의 JS 실행 커맨드가
플래그를 삼키는 문제라 "다음 단계에서 고치겠다"고 미루고 트리에 그대로 둔 채
핸드오프하는 편이 더 나빴다.

## 5. WP1 예비 실행에서 이미 나온 결함

표면 인벤토리를 만들면서 규약을 시험하는 것만으로 세 건이 나왔다. 상세는
[010_findings.md](010_findings.md).

| ID | 요약 | 심각도 | 상태 |
|----|------|--------|------|
| Q1 | `status --json`이 JSON을 내지 않음 | 중 | **수정됨** (WP1) |
| Q2 | `evaluate`가 뒤따르는 플래그를 표현식에 합침 — 에러 없이 오실행 재현됨 | 높음 | **수정됨** (WP1) |
| Q3 | `web-ai claim-audit`이 FAIL인데 종료 코드 0 | 높음 | **수정됨** (WP1) |
| Q4 | `README.md:334`가 한 번도 동작한 적 없는 Camoufox 레인을 광고 | 중 | WP6 |
| Q5 | 인자 누락이 `internal.unhandled` + `retryHint: report`로 표면화 (`context-dry-run`, `context-render`) | 중하 | WP6 |
| Q6 | Camoufox 결과 필드 불일치(`content` vs `html`)로 레인이 구조적으로 무력 | 중 | WP6 |
| Q7 | 브라우저 커맨드의 실패가 `--json`/`AGBROWSE_JSON_ERRORS=1`을 무시하고 평문을 냄 | 중 | WP6 |
| Q8 | `upload`/`type`/`wait-for-text`가 플래그의 **값**을 위치 인자로 흡수 (Q2와 같은 계열) | 높음 | WP6 |

Q1-Q3은 각각 뮤테이션으로 RED를 확인한 뒤에만 "수정됨"으로 적었다. 되돌렸을 때
실패하는 테스트 수: Q1 1건, Q2 3건, Q3 1건.

Q4-Q6은 Q3을 파고들다 나왔다. `claim-audit`이 종료 코드를 못 내는 바람에 위반이
오래 방치됐고, 그 위반을 확인하러 코드를 읽다가 레인 자체가 죽어 있다는 것이
드러났다.

## 6. 제약

- 게이트: `npm run test:unit`, `test:integration`, `test:e2e`, `docs:drift`,
  `docs:counts`. 통합·e2e는 `AGBROWSE_CHROMIUM_EXECUTABLE_PATH`를 실재하는
  Chrome for Testing 빌드로 지정해 실행한다 (WP10 교훈).
- `devlog/`는 gitignore 대상 → `git add -f`.
- 결함 수정은 회귀 테스트를 동반하고, 뮤테이션으로 RED 되는 것을 확인한 뒤에만
  "고쳤다"고 적는다.
