# 260731 — PR #89 / 이슈 #87·#88 처리와 devlog 정리

- unit: `devlog/_plan/260731_pr89_issue_triage/`
- branch: `dev`
- session: `019fb70f-6dd5-77e2-8535-548f39a8a257`
- class: C3 (공개 CLI/MCP 계약 + 폴링 런타임 경로 + 문서 SoT)
- 기준 시각: 2026-07-31, `origin` fetch 후

## 목표

열려 있는 GitHub 항목(PR #89, 이슈 #87, 이슈 #88)을 `dev` 기준으로 판정하고,
#87의 잔여 갭을 구현하며, #88의 정체 경계를 확정해 후속 유닛으로 넘긴다.

devlog `_plan` 정리와 `00_index.md` 드리프트는 **별도 유닛**이다 — PR triage와
아키텍처 의존이 없는 유지보수 작업이라 분리했다(아래 후속 유닛 표).

## 제약

- 원격 상태 변경 금지: push, PR 머지/클로즈, 이슈 코멘트/클로즈, npm publish,
  릴리스 태그, Actions 승인. 이 유닛은 로컬 커밋까지만 만든다.
- `dev`↔`main` 브랜치 재정렬이나 릴리스 전략 변경은 범위 밖이다.
- `devlog/_fin/mvp/` 아래 파일은 수정하지 않는다.
- 작업과 무관한 더티 파일(`.codexclaw/**` 산출물 등)은 스테이징하지 않는다.

## 현재 상태 (조사 결과)

### 브랜치

```
dev            c7e87c1   origin/main 대비 +93 커밋
origin/main    1463a53   dev에 없는 커밋 6개 (v0.1.18/v0.1.19, #82 fix, postinstall star prompt)
PR #89 head    4ada9cb   hanbinnoh 포크, base=main
```

`dev`가 실제 통합 브랜치이고 PR #89는 `main`을 대상으로 하므로, PR을 그대로
머지해도 `dev`에는 반영되지 않는다. 판정은 PR 커밋 단위로 `dev` 소스와
대조해야 한다.

### PR #89의 두 커밋

PR은 `main` @ v0.1.19 위로 리베이스되어 커밋이 재작성됐다. 아래는 현재 OID다
(`gh pr view 89 --json commits` 기준). PR 본문이 언급하는 `a2dc3e1`/`79db5d1`은
리베이스 이전 해시다.

| 커밋 | 대상 이슈 | dev 상태 |
| --- | --- | --- |
| `d5d9475` | #87 `--family` 무음 드롭 | dev는 `f8e8b9b`로 독립 구현 — 부분 충족, 잔여 갭 2건 |
| `4ada9cb` | #88 assistant DOM read deadline | dev에 대응 방어 없음 — 미충족 |

상세 대조는 `002_pr89_delta_inventory.md`.

### 이슈 #87 — dev 잔여 갭

`dev`의 `f8e8b9b`가 CLI 파서/전달/프리플라이트와 selector 검증까지 이미 배선했다
(`web-ai/cli.mjs:615`, `:761`, `:1692`; `web-ai/chatgpt.mjs:325-328`;
`web-ai/chatgpt-model.mjs:400-409`). 이슈 본문의 핵심 주장은 해소됐다.

남아 있는 갭 2건:

1. **capability probe가 family를 읽지 않는다.**
   `chatGptModelCapabilityProbe`(`web-ai/chatgpt-model.mjs:1725-1759`)의 본문에
   `options.family` 참조가 없다. `web-ai/chatgpt.mjs:120`이 전달하지 않는 것은
   표면 증상이고, 전달해도 probe는 무시한다. probe 함수 자체를 고쳐야 한다.
2. **MCP가 비-ChatGPT + family 조합을 막지 않는다.**
   `web-ai/tool-schema.mjs:55`의 enum이 잘못된 alias는 handler 전에 거부하고
   (`web-ai/mcp-server.mjs:153`), 유효한 family는 `...args`로 이미 전달된다
   (`:214-220`). 실제 갭은 CLI가 `rejectFutureScope`로 거부하는 조합
   (`web-ai/cli.mjs:1692`)이 MCP에는 없다는 것뿐이다.

### 이슈 #88 — dev 미충족

`pollWebAi`는 루프 경계에서만 데드라인을 본다.

- `web-ai/chatgpt.mjs:614` `const deadline = Date.now() + timeout * 1000;`
- `web-ai/chatgpt.mjs:628` `while (Date.now() <= deadline) {`
- `web-ai/chatgpt.mjs:655` `const split = await readAssistantSnapshotsSplit(page);`

`readAssistantSnapshotsSplit`(`web-ai/chatgpt.mjs:1461`)은 `page.evaluate`를
호출-단위 한도 없이 await한다. Playwright의 `page.evaluate()`에는 timeout
옵션이 없으므로, 대화가 커져 평가가 정체되면 다음 데드라인 체크에 도달하지
못한다. 같은 문제가 `readAssistantSnapshots`(`:1436`),
`readAssistantMessages`(`:1425`), `readActivityState`(`:1027`), 그리고 루프 종료
후 반드시 호출되는 `recoverAssistantResponse`
(`web-ai/chatgpt-response-observer.mjs:98-113`, 호출 `web-ai/chatgpt.mjs:865`)에도
있다. 마지막 지점을 빼놓으면 루프를 고쳐도 명령은 recovery에서 다시 정체한다.

PR #89의 `4ada9cb`는 `readAssistantMessages` 기반 구버전 리더를 전제로 하므로
`dev`에 그대로 적용되지 않는다(`dev`는 스냅샷 분할 리더로 리팩터됨). 더 중요한
것은 `dev`의 정체 표면이 PR이 가정한 것보다 넓다는 점이다 — `Page.evaluate`뿐
아니라 Locator API와 외부 모듈 위임(diagnostics·copy fallback)까지 걸쳐 있다.
이식이 아니라 재설계가 필요하며, 그 범위를 확정하는 것이 WP3다.

### devlog 드리프트

`devlog/_plan`에 기존 11개 폴더(이 유닛을 더하면 12개)가 있으나
`devlog/00_index.md`의 `_plan` 표에는 4개만
개별 기재되어 있고, 종료된 최근 7개 `_fin` 유닛(`260712_oracle_chase`,
`260723_pr86_repomix_dev_rebuild`, `260724_oracle_chase2`, `260725_oracle_chase3`,
`260726_agbrowse_qa`, `260726_oracle_chase4`, `260726_qa_round6`)은 표에 없다.
`00_index.md:22-30`의 `_plan` 표는 Oracle stability 행을 `_fin` 경로로 적어
표 제목과 실제 위치가 어긋난다. 상세는 `001_devlog_inventory.md`.

## work-phase 지도 (의존 순서)

| WP | 내용 | 산출 문서 | 선행 |
| --- | --- | --- | --- |
| WP1 | docs-only 로드맵: 실태 조사 + decade 문서 작성 | `000`–`003`, `010`, `020`, `030`, `040` | — |
| WP2 | #87 잔여 갭 2건 구현(probe family 계약, MCP fail-closed) | `010` | WP1 |
| WP3 | #88 정체 경계 인벤토리 확정 + 후속 유닛 로드맵 | `020` → `021` | WP1 |
| WP5 | 게이트 클로즈아웃 + 유닛 마감 + 커밋 정리 | `040` | WP2·WP3 |

`030`은 devlog 정리 유닛(아래)의 계획 문서로 이 유닛에 남되, 실행은 그 유닛에서
한다. WP 번호는 이력 추적을 위해 재배열하지 않는다.

**유닛 분할 (2026-07-31, A 페이즈 누적 6라운드 FAIL 후).** 처음 WP3는 #88 방어를
구현하는 것이었고, 다음엔 경계 인벤토리로 축소했다. 두 리뷰어 6라운드가 모두
같은 자리에서 걸렸고, 그 과정에서 #88의 정체 표면이 이미지 다운로드·탭
lease·raw CDP까지 뻗는다는 것이 확인됐다. `CDPSession.send`에 timeout 옵션이
없어서(`node_modules/playwright-core/types/types.d.ts:15882`) 폴링 데드라인을
보장하려면 web-ai 탭 수명주기까지 손대야 한다. 한 유닛 크기가 아니다.

근거와 죽은 가설은 `003_audit_synthesis.md`.

### 후속 유닛 (같은 goal, LOOP-UNIT-CHAIN-01)

| 유닛 | 범위 | 입력 |
| --- | --- | --- |
| `#88 DOM deadline 계약` | assistant DOM read · activity · finished · ordering · recovery | 이 유닛의 `021` |
| `artifact/finalizer hardening` | 이미지·파일 다운로드, 탭 lease, CDP 경계 | 이 유닛의 `021` |
| `devlog 정리` | `_plan`→`_fin` 이관, `00_index.md` 동기화, 조건부 closeout 4건 | 이 유닛의 `001`, `030` |

devlog 정리를 분리하는 이유: PR #89 triage와 아무 의존이 없는 유지보수
changeset이다. 같은 유닛에 묶으면 코드 변경과 문서 이관이 한 커밋 흐름에 섞이고,
어느 한쪽이 막히면 다른 쪽도 닫히지 않는다. PHASE-SPLIT-01은 아키텍처 의존으로
나누라고 하는데 이 둘 사이에는 그 의존이 없다.

**분할은 목표 축소가 아니다(LOOP-CONTINUE-01).** 총량은 같고 경계만 다시 긋는다.
두 후속 유닛은 이 goal이 살아 있는 한 남으며, WP3의 7절이 그 로드맵을 쓴다.
WP5가 이 유닛을 닫는 것은 "#88 완료"가 아니라 "이 유닛 범위 완료"를 뜻하고,
closeout에 그 구분을 명시한다.

문서 역할(LEXICO-SPLIT-01):

| 문서 | 역할 |
| --- | --- |
| `000_plan.md` | 이 계획 |
| `001_devlog_inventory.md` | devlog 실태 리서치 |
| `002_pr89_delta_inventory.md` | PR #89 대조 리서치 |
| `003_audit_synthesis.md` | 감사 3라운드 종합과 재구성 근거 |
| `010_wp2_family_probe_and_mcp.md` | WP2 구현 diff |
| `020_wp3_stall_boundary_inventory.md` | WP3 인벤토리 명세(코드 변경 없음) |
| `030_wp4_devlog_reorg.md` | WP4 구현 diff |
| `040_wp5_closeout.md` | WP5 게이트·마감 |

WP3가 산출할 `021_stall_boundary_map.md`는 그 사이클에서 작성한다.

의존 근거: WP2와 WP3는 서로 의존하지 않는다 — WP2는 capability 정의
(`web-ai/chatgpt.mjs:120`)와 MCP 분기를 바꾸고, WP3는 `pollWebAi`(`:582` 이후)의
호출 그래프를 조사한다. WP3의 경계 집합은 WP2 결과를 소비하지 않는다. 둘 다
WP1에만 의존하며, 표의 순서는 실행 편의일 뿐 구조적 선행이 아니다. WP5가 둘을
합쳐 게이트를 돌린다.

## 수용 기준

1. PR #89의 두 커밋 각각에 대해 dev 충족/미충족 판정이 `file:line` 근거와 함께
   `002_pr89_delta_inventory.md`에 있다.
2. #88의 정체 가능 경계가 `pollWebAi` 전 구간에 대해 근거와 함께 열거되고, 각
   경계의 방어 가능 여부(Page API / Locator API / CDP 세션 / 순수 계산)가
   판정되며, 모든 경계가 두 후속 유닛 중 하나에 배정된다(WP3). 배정되지 않은
   경계는 "도달 불가" 또는 "이미 bounded"를 증명해야 한다 — 근거 있는 연기도
   허용하지 않는다. 실제 방어 구현과 활성화 관측은 후속 유닛의 수용 기준이다.
3. #87의 잔여 갭 2건이 수정되고 테스트 출력으로 확인된다. probe는 family를
   evidence에 담고, MCP는 비-ChatGPT + family를 거부한다.
4. `npm run typecheck`, 대상 vitest, `npm run gate:all`,
   `structure/check-doc-drift.sh`, `structure/verify-counts.sh`가 신선 출력으로
   통과한다.
5. 각 work-phase가 로컬 커밋으로 남는다.

devlog `_plan`/`_fin` 정리는 이 유닛의 수용 기준이 아니다 — 후속 유닛으로 옮겼다.

## 종료 판정

PR #89 자체의 머지/클로즈와 이슈 #87·#88 클로즈는 원격 쓰기라 이 유닛에서
수행하지 않는다. 해당 항목은 `NEEDS_HUMAN`으로 보고하고, 사용자가 판단할 수
있도록 "dev에는 무엇이 이미 있고 PR에서 무엇을 가져왔는지"를 `040`에 정리한다.
