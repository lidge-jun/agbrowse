# 260731 — web-ai 아티팩트·finalizer 경계 하드닝 (이슈 #88 자매 유닛)

- unit: `devlog/_plan/260731_webai_artifact_finalizer/`
- branch: `dev`
- class: C4 (CDP·동기 IO·탭 수명주기, 프로세스 경계 가능성)
- 선행: `devlog/_fin/260731_pr89_issue_triage/021_stall_boundary_map.md`
- 자매: `devlog/_plan/260731_webai_poll_deadline/`

## 문제

이슈 #88의 정체 표면 중 **아티팩트 수집과 탭 수명주기** 쪽이다. 답변 읽기 경로는
자매 유닛이 맡는다.

여기 모인 것들의 공통점: CDP와 동기 IO다. **둘 다 race만으로는 계약을 만족할 수
없다** — CDP 호출자의 반환 자체는 외부 race로 제한할 수 있지만 하위 작업은
취소되지 않고, 동기 구간은 race 자체가 불가능하다.

- Playwright `CDPSession.send`에 timeout 옵션이 없다
  (`node_modules/playwright-core/types/types.d.ts:15872-15885`)
- 동기 IO는 event loop를 막아 타이머 자체를 멈춘다

## 자매 유닛과의 관계

**두 유닛은 같은 예산 모델을 써야 한다.** 다른 모델을 쓰면 계약이 성립하지
않는다.

| 방향 | 내용 |
| --- | --- |
| 이 유닛 → 자매 | WP2(동기 IO 처방)의 결과가 자매 WP6·WP7의 선행 |
| 이 유닛 → 자매 | WP6(finalizer·lease)이 자매 WP9(warning 통합)의 선행 |
| 자매 → 이 유닛 | WP0(모델 선택)은 **공동 작업**. 한쪽이 정하고 양쪽에 기록 |

모델 선택 probe(P1~P9)와 판정 기준은 자매 유닛의
`010_wp1_budget_model.md`에 있다. 중복 작성하지 않는다.

### 모델 결정 (2026-07-31, WP0 — 조건부)

**후보 A (in-process)를 조건부로 선택했다.** 확정이 아니다 — 자매 유닛
`011_model_decision.md`의 reversal gate G1~G4 중 하나라도 실패하면 B/C로
복귀한다. 특히 **G1(동기 store의 async 전환)이 이 유닛 WP2와 같은 작업**이므로,
이 유닛의 진행이 곧 A의 존폐를 결정한다.

이 유닛에 직접 영향을 주는 측정 결과:

| probe | 결과 | 이 유닛에 대한 함의 |
| --- | --- | --- |
| P1c/P1d | `Page.reload`(CDP)가 **탭을 유지한 채** pending `evaluate`를 drain. 20회 반복 시 session identity 보존, handle 증가 0 | 세션 유지 취소 수단이 존재한다. `page.close()` 경로는 재사용 불가라 기각 |
| P2 | `Atomics.wait` 309ms 동안 50ms 타이머 미발화 | **WP2(동기 IO 처방)가 A의 전제 조건이다.** 락을 async로 못 바꾸면 A 전체가 무너진다 |
| P7 | 빈 워커 worker 10ms / subprocess 19ms. **`chatgpt.mjs` import 포함 시 55ms / 64ms**(임계 200ms) | 기동 비용은 격리 탈락 사유가 아니다 — 되돌아갈 여지가 남아 있다. 다만 여유가 초판 수치보다 훨씬 작다 |
| P3 | 감사가 측정 — worker에서 targetId 재연결 성공(138ms) | 격리도 기술적으로 가능하다. descriptor만 넘기면 된다 |
| P4~P6 | **미측정** | A 조건부 선택으로 보류. B/C 복귀 시 측정 |
| P8·P9 | **미측정** | reversal gate G2·G3의 대상 |

WP2가 이 유닛의 critical path인 이유가 P2에서 확정됐다. 동기 IO를 async로
옮기지 못하면 예산 계약 자체가 성립하지 않는다.

## 담당 경계 (021 7절 유닛 B)

B10, B14~B25, B28, B30~B36 — 21개.

### fail-open 넷

021 3절이 지목한 여섯 중 넷이 이 유닛 담당이다. **정체가 지연이 아니라 틀린
결론을 만든다.**

| 경계 | 현재 동작 | 위험 |
| --- | --- | --- |
| B23 | 세션 조회 실패 → 빈 결과 | legacy baseline으로 진행해 오래된 답을 읽을 수 있다 |
| B24 | `deps.getTargetId` 실패 → `null` | **mismatch 검사를 건너뛴다**(`web-ai/chatgpt.mjs:634-635`) — 다른 대화의 답을 읽을 수 있다 |
| B25 | `deps.getCdpSession` 실패 → `undefined` | 파일 수집을 조용히 건너뛰고 성공 finalization을 계속한다(`:797-812`). 이미지 쪽(`:751-759`)은 throw라 fail-closed |
| B36 | `isTabAlive` fetch 실패 → `false` | 살아 있는 탭을 `closed`로 만들어 lease를 제거한다(`skills/browser/tab-manager.mjs:395-400` → `tab-lease-store.mjs:630-648`) |

예산 계약과 **독립적으로** 고쳐야 한다. 예산을 씌워도 틀린 결론은 그대로다.

### 동기 IO 경계

이 유닛의 핵심이다. `Promise.race`가 통하지 않으므로 다른 처방이 필요하다.

| 경계 | 위치 |
| --- | --- |
| B18/B19 | `web-ai/session-store.mjs:136-164` `withStoreLock` — `openSync`/`writeFileSync` + 200회 재시도 |
| B20 | 호출부 `web-ai/chatgpt.mjs:1386`, 실제 동기 경로 `web-ai/trace-persistence.mjs:44-61` |
| B22/B23 | `web-ai/session.mjs:156-161`, `session-store.mjs:116-117` |
| B21 일부 | `skills/browser/browser.mjs:480-485` persisted-state 읽기 |
| B31/B32 | `web-ai/chatgpt-images.mjs:257-273`, `web-ai/chatgpt-files.mjs:433-444` |
| B33/B34 | `web-ai/tab-finalizer.mjs:64-86`, `web-ai/tab-lease-store.mjs:179-208` |
| B35 | `skills/browser/tab-manager.mjs:35-52`, `:71-75` `forgetTabActivity` |

### CDP 경계

| 경계 | 위치 |
| --- | --- |
| B14 | `web-ai/chatgpt-images.mjs:226`, `:241`, `:257` — `Network.getCookies` + fetch |
| B15 | `web-ai/chatgpt-files.mjs:321`, `:347` — `Runtime.evaluate` |
| B24 | `skills/browser/browser.mjs:1056-1062` — `newCDPSession` + `Target.getTargetInfo` + `detach` |
| B25 | `web-ai/chatgpt.mjs:751`, `:797`, `:1492` 취득 / `:788`, `:806`, `:1521` detach |
| B28 | `web-ai/failure-diagnostics.mjs:64`, `:67`, `:70` — CDP + `Page.captureScreenshot` |
| B30 | `web-ai/chatgpt-images.mjs:140` — 이미지 탐지 `Runtime.evaluate` |
| B17 | `skills/browser/tab-manager.mjs:310` — `Target.closeTarget` |

## work-phase

| WP | 내용 | 선행 |
| --- | --- | --- |
| WP0 | 예산 계약 모델 선택 — **자매 유닛과 공동** | — |
| WP1 | pre-budget 예산 수립 (B21의 Page/CDP/fetch, B24) | WP0 |
| WP2 | **동기 IO 처방** (B18~B20, B22, B23, B21 일부, B31~B35) | WP0 |
| WP3 | CDP 예산 규약 (B24, B25, B28, B30) | WP0, WP2 |
| WP4 | 아티팩트 수집 (B14, B15, B30, B31, B32) | WP3 |
| WP5 | diagnostics (B10, B28) | WP3 |
| WP6 | 탭 lease와 finalizer (B16, B17, B33, B34, B35, B36의 **예산·수명주기**) | WP2, WP3 |
| WP7 | fail-open 교정 (B23, B24, B25, B36의 **sentinel 소비 계약**) | WP1, WP3, WP6 |
| WP11 | fail-open 교정 선행분 — B24, B36 (완료) | — |
| WP19 | **B25 요구 계약 확정 (문서 전용, 완료)** — `020` | — |
| WP20 | **B25 strict enforcement 구현** | WP19 |

### WP11 — fail-open 교정을 앞으로 뺐다 (2026-07-31)

**WP7의 선행(WP1·WP3·WP6)을 기다리지 않고 먼저 실행한다.** 자매 유닛이 같은
판단으로 WP10을 먼저 돌려 B03·B06을 닫았고(`6742949` 외 2), 남은 넷도 같은
부류다. 근거는 위 §"fail-open 넷"이 이미 적어둔 것 — "예산 계약과
**독립적으로** 고쳐야 한다."

원래 선행 관계를 무시해도 되는 이유는 fail-open 교정이 예산 상한이 아니라
**sentinel 소비 계약**이기 때문이다. 어떤 예산 모델을 고르든 "관측 실패를
정상값으로 읽지 않는다"는 유지된다.

처방: `010_wp11_failopen_sentinels.md`. (구현 전 — 결과는 완료 후 기록한다.)

**WP11이 닫는 것**: B24, B36.

**WP7의 남은 몫**: 둘이다.

- **B23** 완전 교정 — 동기 IO 처방(WP2) 뒤에 재방문. WP11은 관측만 남긴다.
- **B25** fail-closed — WP11은 fail-visible(무음 제거)까지다. 답은 여전히
  `complete`로 나가므로, 진짜 fail-closed는 명시적 artifact 요청 계약이
  생긴 뒤에 가능하다.

### WP19 — B25의 요구 계약을 확정했다 (2026-08-01, 문서 전용)

위에서 "명시적 artifact 요청 계약이 생긴 뒤에 가능하다"고 미뤄 둔 그 계약이다.
`020_wp19_file_artifact_contract.md`에 고정했다.

핵심은 대칭이다 — **명시적으로 요구했으면 fail-closed, 요구하지 않은
opportunistic 수집은 warning을 남기는 best-effort.** 이미지 계약
(`_fin/260508_oracle_parity/11_generated_images_public_contract.md`)이 이미
세운 비대칭을 그대로 따랐다. 새 원칙을 만들지 않았다.

조사에서 확인한 것: 이 경로에는 **호출자가 요구를 표현할 방법이 아예 없다.**
CLI 플래그도, envelope 필드도, 세션 상태도, MCP schema에도 없다. 그래서 요구
신호를 먼저 만들지 않으면 fail-closed가 성립하지 않는다 — 무작정 실패시키면
첨부가 없는 평범한 응답까지 깨진다.

**WP19가 닫는 것**: 없다. 문서 전용이다. B25 자체는 구현 work-phase에서 닫는다.

**구현 work-phase가 받는 것**: helper 두 개의 정확한 반환 union, 지원/거부
행렬, 부분 저장 rollback 의미, hard deadline과의 우선순위, 정책 단조 병합
규칙, 변경 대상 표와 mutation 짝을 갖춘 테스트 행렬.

**WP20 (구현)의 선행은 WP19뿐이다.** WP0~WP7의 예산 계약을 기다리지 않는다.
WP11과 같은 논리다 — strict 계약은 예산 상한이 아니라 요구·증명 계약이고, 어떤
예산 모델을 고르든 "요구했으면 증명 없이 성공으로 보내지 않는다"는 유지된다.

다만 하나가 예산과 얽힌다. hard deadline이 우선이라는 결정 때문에 WP20은
데드라인 이후 write를 막는 배선을 **반드시 포함해야 한다**. 그러지 않으면
자매 유닛이 WP16~WP18에서 닫은 late-side-effect fencing이 이 계약 때문에 다시
열린다. `020`의 해당 절이 그 조건이다.

**WP20이 닫는 것과 닫지 못하는 것을 구분한다.** WP20은 async continuation의
post-timeout write를 막는다. 동기 구간 — `writeFileSync`와 `withStoreLock`의
blocking retry — 의 wall-time 상한은 못 만든다. 이 문서가 처음부터 적어둔
"동기 IO에는 race가 작동하지 않는다"가 그대로 적용된다. 그건 WP2(G1)의 몫이고
그때까지 c7의 그 부분은 open이다. WP20 완료를 c7 종료로 적으면 안 된다.

분할은 021 7절의 유닛 B 순서를 따르되 fail-open 교정을 독립 work-phase로
분리했다 — 예산 계약과 성격이 달라 섞으면 어느 쪽이 효과를 냈는지 알 수 없다.

**WP1과 WP2는 WP0 직후 병행 가능하다.** 다만 WP2가 교차 유닛 critical path다 —
자매 유닛의 WP6·WP7이 이 결과를 기다린다.

## 검증 (021 6절, A·B 공동)

C1~C5는 자매 유닛 `000_plan.md`와 동일하다. 이 유닛의 담당분:

- **C5**: B23·B24·B25·B36 fail-closed. WP11이 B24·B36을 닫고, **B23·B25는
  WP7까지 unmet으로 남는다** — 부분 완료를 met으로 적지 않는다.
- **C4**: 동기 IO가 event loop를 막는 상황의 wall-time 상한 — 이 유닛의 WP2가
  필수지만 **충분조건은 아니다.** 자매 WP3가 소유하는 command lock의
  `Atomics.wait`(`web-ai/session-store.mjs:250-316`)도 공동 C4에 포함된다.
  fake timer로 불가하므로 실시간 프로세스 하네스가 필요하다
- C1~C3: 자매와 공동 게이트

### primitive별 pending 행렬

`CDPSession.send` 하나만 보면 부족하다. 이 유닛이 다루는 blocking primitive를
**각각 주입해서 검증**한다.

| primitive | 대표 위치 | 주입 시나리오 |
| --- | --- | --- |
| `Page.evaluate` | B10 `web-ai/failure-diagnostics.mjs:27-42` `readConversationSnapshot` | 앞선 읽기는 성공하고 **이 evaluate만** pending — 항상 pending인 double은 더 이른 경계에서 멈춰 이 경로를 못 본다 |
| `fetch` | 이미지 다운로드 `web-ai/chatgpt-images.mjs:241-247`, `/json/list` `skills/browser/browser.mjs:1103-1105`, 생존 확인 `skills/browser/tab-manager.mjs:202-205` | 영원히 pending → 데드라인 안 반환 |
| `newCDPSession` | `skills/browser/browser.mjs:1057` | 세션 취득이 pending |
| `CDPSession.send` | `web-ai/chatgpt-images.mjs:226`, `web-ai/chatgpt-files.mjs:321`, `skills/browser/tab-manager.mjs:310` | 명령이 pending |
| `detach` | `skills/browser/browser.mjs:1062`, `web-ai/chatgpt.mjs:788`, `:806`, `:1521` | 정리가 pending — 미해제 CDP request·session·active handle이 남거나 반복 시 누적되는가 |
| locator/click | `web-ai/chatgpt-archive.mjs:90-105` | archive 클릭이 pending |
| 동기 IO | `web-ai/session-store.mjs:136-164` 등 | event loop 차단 |

각 행에 대해 모델별 pass/fail을 기록한다. **B36은 두 사례로 나눈다** — fetch가
reject하는 경우(fail-closed 검증)와 pending인 경우(데드라인 검증)는 다른 결함이다.

### 이 유닛 고유의 관측

| 시나리오 | 관측 |
| --- | --- |
| 아티팩트 저장 중 중단 | 부분 파일 잔존 여부, 다음 명령 동작 |
| lease 조작 중 중단 | 락 파일 잔존, 좀비 탭 |
| detach 미완료 | 미해제 CDP request·session·active handle 수, 반복 폴 시 누적 여부 |

## 범위

IN — 소스:
`web-ai/chatgpt-images.mjs`, `web-ai/chatgpt-files.mjs`,
`web-ai/failure-diagnostics.mjs`, `web-ai/session-artifacts.mjs`,
`web-ai/tab-finalizer.mjs`, `web-ai/tab-lease-store.mjs`,
`web-ai/session-store.mjs`, `web-ai/session.mjs`,
`web-ai/chatgpt-archive.mjs`(B16의 실제 locator/click owner — finalizer가
import한다, `tab-finalizer.mjs:5`),
`web-ai/trace-persistence.mjs`(B20의 실제 동기 세션 경로 `:44-61` —
`chatgpt.mjs:1386`은 호출부다),
`skills/browser/tab-manager.mjs`, `skills/browser/browser.mjs`의 CDP·
persisted-state·fetch 경로, `web-ai/chatgpt.mjs`의 아티팩트·finalizer 호출부.

예산 전달 방식에 따라 `web-ai/tab-pool.mjs:49-63`도 필요할 수 있다 — WP0의
모델 선택 후 확정한다.

IN — 테스트:
`test/unit/web-ai-tab-finalizer.test.mjs`,
`test/unit/web-ai-failure-diagnostics.test.mjs`,
`test/unit/chatgpt-images.test.mjs`, `test/unit/chatgpt-files.test.mjs`,
`test/unit/tab-lifecycle.test.mjs`, 신규 프로세스 하네스.

IN — WP19/WP20 추가분: `web-ai/cli.mjs`(flag·help·preflight),
`web-ai/chatgpt-files.mjs`(detector/save 반환 계약, staging·rollback),
`web-ai/session.mjs`(`envelopeSummary` 보존과 단조 병합),
`web-ai/watcher.mjs`(CDP 주입), `web-ai/mcp-server.mjs`(저장 정책 집행).
테스트: `test/unit/web-ai-chatgpt-activity-poll.test.mjs`,
`test/integration/web-ai-cli-contract.test.mjs`, watcher·MCP wait 계약 테스트.

OUT: 답변 읽기와 완료 판정 경로 — 자매 유닛 소유. #87 관련 코드. devlog 정리.

**WP19/WP20 한정 범위 예외**: 위 OUT에도 불구하고 `chatgpt.mjs`의
`status: 'complete'` 반환 네 곳은 IN이다. strict 계약을 집행할 지점이 거기뿐이라
한 곳만 배선하면 나머지 셋이 우회한다. 완료 **판정**은 바꾸지 않고 그 직전에
artifact 계약을 끼워 넣는 것이므로 자매 유닛의 소유권과 충돌하지 않는다.

## 종료 판정

**"21개를 확인했다"는 DONE 조건이 아니다.** 선행 유닛이 36개를 "완전 목록이
아니라 먼저 볼 곳"으로 규정했고(`021` §0), 21개는 그중 이 유닛 몫일 뿐이다.
개수 체크로 닫으면 새 경계가 계약 밖에 남아도 통과한다.

DONE 조건은 셋이다.

1. **구조적 커버리지** — 동기 구간·주입 경계·CDP/HTTP 경계·직접 `Page`/`Locator`
   접근이 선택한 모델의 계약으로 덮인다. 개별 경계를 하나씩 감싸는 게 아니라, 그 종류의 접근이
   예산 밖에 있을 수 없는 구조여야 한다.
2. **fail-open 교정** — C5의 B23·B24·B25·B36이 fail-closed로 검증된다.
   WP11 완료 시점에는 B24·B36만 충족이며, B23·B25가 남아 있는 한 이 조건은
   미충족이다.
3. **ledger 편입** — 구현 중 발견된 새 경계가 `021` 표본에 없더라도 계약이
   덮는지 확인하고, 안 덮으면 해당 work-phase에 추가한 기록이 남는다.

C1~C4는 자매 유닛 완료 후 공동 게이트다.

**두 유닛이 모두 끝나야 #88이 닫힌다.** 어느 한쪽만으로는 그 경로로 재현된다.

## 이 유닛이 실패하는 방식

동기 IO 처방(WP2)이 막히면 이 유닛뿐 아니라 자매 유닛도 막힌다. 그 경우
`Atomics.wait`를 쓰는 락(`web-ai/session-store.mjs:250-256`)을 async로 바꿀 수
있는지가 관건이고, 불가하면 격리 모델이 유일한 선택지가 된다.

세 후보 모두 탈락하면 문제는 web-ai 전반의 페이지 접근 규약이다 — 아키텍처
결정을 사용자에게 에스컬레이션한다.
