# 35 — Session Reattach Follow-up PABCD

Date: 2026-06-24 · 개정 2026-06-25 (35.1을 new-tab 복구로 전환)
Status: PABCD plan — **impl-ready** (코드-진실 확인 완료; 35.1 new-tab 모델, [36](36_implementation_master_plan.md) §2)
Parent: [04_session_reattach.md](04_session_reattach.md) · Sibling: [31](31_chatgpt_downloadable_artifacts_pabcd.md) / [32](32_deep_research_session_followup_pabcd.md) / [33](33_response_capture_dualpath_pabcd.md) / [34](34_dom_diagnostics_pabcd.md)

## 2026-06-24 재감사 (v0.1.15)

`04_session_reattach.md`의 핵심 reattach/resume는 이미 구현됨 — 잔여 2개 OPEN 항목만 코드 대조로 확인:

- **이미 구현(재활용 대상)**: `sessions resume`(`web-ai/cli-sessions.mjs:91`, 표준 `pollFn` 재실행) / `sessions reattach`(`:114`, `resolveSessionPage` + `session.conversationUrl || session.originalUrl` `:119`, status `reattached`/`reattach-mismatch`/`reattach-failed`). `resolveSessionPage`/`withSessionPage`(`web-ai/tab-recovery.mjs`), session-store `conversationUrl`/`originalUrl` 영속(`web-ai/session-store.mjs:17-18`).
- **35.1 New-tab 복구**: conversationUrl 직접 nav가 대화를 못 띄울 때(드리프트/탭 닫힘) 복구 fallback **부재**. (개정: oracle sidebar 검색 대신 저장 `conversationUrl`을 새 탭으로 open — 32.3 가드로 검증.)
- **35.2 Deep Research reattach**: `researchMode: 'deep'`는 영속됨(`web-ai/chatgpt-deep-research.mjs:210` `updateSession(..., { researchMode:'deep' })`)지만, `resume`(`cli-sessions.mjs:91-113`)는 **모드 분기 없이** 항상 일반 `pollWebAi`를 돌린다 → 진행 중 Deep Research 리포트를 올바르게 캡처하지 못함. DR-aware resume 경로 **부재**.

> 04의 `SIGINT 시 Chrome 유지`는 connect-over-CDP 모델에서 대체로 무의미(web-ai가 Chrome 비소유) — 본 계획 범위 밖.

## Purpose

Oracle의 reattach는 (a) 대화가 열려있지 않으면 복구, (b) Deep Research 모드도 reattach해 진행 중 리포트를 캡처한다. agbrowse는 conversationUrl 기반 reattach/resume는 있으나 이 두 fallback이 없다. 이 계획은 **기존 `resolveSessionPage`/`resume`/`reattach`를 재사용**하면서 두 OPEN 항목을 보강한다 — 복구는 oracle식 sidebar DOM-검색 대신 **저장 `conversationUrl`을 새 탭으로 여는 방식**(32.3 가드 검증, [36](36_implementation_master_plan.md) §2). 신규 명령 표면은 최소화한다.

## Priority Map

| ID | Priority | Outcome |
| --- | --- | --- |
| 35.1 | P1 | New-tab 복구 — 저장 `conversationUrl`을 새 탭으로 open(32.3 가드 검증), reattach/resume fallback |
| 35.2 | P1 | `resume`가 `researchMode:'deep'` 감지 시 DR-aware 캡처로 라우팅 (32.1 재사용) |

## P — Plan

### Part 1 — Easy Explanation

세션을 다시 이어붙일 때, 저장된 대화 URL로 바로 못 여는 경우가 있다(탭이 다른 대화로 바뀌었거나 닫힘). 그럴 때 저장된 `conversationUrl`을 **새 탭으로 열어** 복구한다(32.3 가드로 안전 검증). 또한 Deep Research로 시작했던 세션을 resume하면, 일반 응답 대기가 아니라 Deep Research 리포트 캡처 경로로 이어받아야 한다.

### Part 2 — Diff-level Precision

## 35.1 — New-tab Conversation Recovery

> **결정(2026-06-25, [36](36_implementation_master_plan.md) §2)**: oracle식 sidebar DOM-검색을 채택하지 않는다. 저장된 `conversationUrl`을 **새 탭으로 열어** 복구하고, 32.3 `isSafeChatGptConversationUrl`로 대상을 검증한다. DOM 취약성 제거 + 32.3 가드와 자연 합류.

#### NEW helper — `web-ai/tab-recovery.mjs` 확장 (>400 lines면 분리)

Exports:

```js
// 저장된 conversationUrl을 새 탭으로 열어 복구한다. 32.3 가드 통과 시에만 open.
// 반환: { opened: true, page, conversationUrl } | { opened: false, reason }
export async function openConversationInNewTab(deps, { conversationUrl } = {}) {}
```

Required behavior:

- `isSafeChatGptConversationUrl(conversationUrl)`(32.3) 통과 시에만 새 탭 open — 빈/외부/provider-root URL은 즉시 `{opened:false, reason}`.
- 새 탭 open은 **기존 탭/타깃 생성 경로 재사용**(CDP `Target.createTarget` 또는 `context.newPage()`; 구현 시 pre-write search로 기존 owner 확인). **신규 런처 도입 금지**.
- open 후 URL이 저장 conversationId와 일치하는지 검증(`urlsCompatible` 재사용, `tab-recovery.mjs`). 불일치 시 새 탭 닫고 `{opened:false, reason:'conversation-mismatch'}`.
- 절대 throw 안 함(복구 실패가 원래 에러를 덮지 않게).

#### MODIFY `web-ai/cli-sessions.mjs`

`reattach`(`:114`) / `resume`(`:91`)에서 `resolveSessionPage`가 `mismatch`/대화 부재를 반환할 때 fallback으로 `openConversationInNewTab`을 시도.

Rules:

- fallback은 **명시 게이트** 하에서만(기존 `--navigate` 확장 또는 `--recover`) — 기본은 fail-closed 유지.
- 성공 시 status `reattached`(via-new-tab), 실패 시 기존 `reattach-mismatch`/`reattach-failed` 보존.
- **32.3 `isSafeChatGptConversationUrl`를 단일 진실로** 새 탭 대상 검증 — 저장 conversationId와 일치할 때만 수락.

#### NEW `test/unit/web-ai-tab-recovery-newtab.test.mjs`

- `openConversationInNewTab`: 안전 URL이면 새 탭 open + URL 일치 검증 성공; provider-root/외부/빈 URL 거부(`opened:false`); open 후 불일치면 탭 닫고 `conversation-mismatch`; throw 안 함.
- 32.3 가드 통합: 안전하지 않은 URL은 새 탭 생성 시도조차 안 함.

## 35.2 — Deep Research Reattach

#### MODIFY `web-ai/cli-sessions.mjs` (`resume`, `:91-113`)

`getSession(id)` 직후 `session.researchMode === 'deep'`이면 일반 `pollFn` 대신 DR-aware 경로로 분기.

```js
if (session.researchMode === 'deep') {
  // withSessionCommandLock + withSessionPage 재사용, pollWebAi 대신
  // 32.1의 target-scoped 캡처로 진행 중/완료 리포트 수집
  return resumeDeepResearch(deps, id, input);
}
```

#### MODIFY `web-ai/chatgpt-deep-research.mjs`

`sendDeepResearch`(`:207`) 내부의 완료-대기/추출 로직(32.1에서 `extractResearchReport` 리팩터 대상)을 **resume에서도 호출 가능하게** 분리:

```js
// 새 프롬프트 전송 없이, 이미 진행 중인 Deep Research를 이어받아 리포트만 수집.
export async function resumeDeepResearch(deps, sessionId, input) {}
```

Rules:

- 새 프롬프트를 보내지 않는다 — 기존 대화의 진행 중/완료 리포트만 캡처.
- 32.1의 target-scope/incomplete-report 거부 규칙을 그대로 적용(둘은 같은 캡처 코어 공유).
- 완료 전이면 기존 `sendDeepResearch` 타임아웃 의미(`timeoutMs` 기본 1_200_000) 재사용.
- session artifact 저장 계약(`session-artifacts.mjs`) 보존.
- 32.1 미구현 상태에서 착수 시: 현재 `extractResearchReport`를 호출하는 thin resume를 먼저 만들고, 32.1 리팩터 후 캡처 코어를 공유하도록 좁힌다.

#### MODIFY `test/unit/web-ai-sessions-command.test.mjs` + `test/unit/web-ai-chatgpt-deep-research.test.mjs`

- `resume`가 `researchMode:'deep'` 세션에서 DR 경로로 분기(일반 `pollWebAi` 호출 안 함) — fake session.
- `resumeDeepResearch`가 새 프롬프트를 보내지 않고 리포트만 수집.
- 비-deep 세션 resume는 기존 동작 유지(회귀).

## A — Plan Audit Checklist

- new-tab fallback이 **다른 대화를 절대 열지 않음**(32.3 가드 + conversationId 일치 검증, fail-closed).
- 신규 명령 표면 없음 — 기존 `resume`/`reattach` 재사용.
- DR resume가 **새 프롬프트를 보내지 않음**(이중 실행 방지).
- 32.1/32.3과 캡처/가드 코어 공유 — 중복 구현 없음.
- 신규 모듈 < 500 lines; `cli-sessions.mjs`/`chatgpt-deep-research.mjs` 증가 통제.
- 비-deep resume·기존 reattach 동작 회귀 없음.

## B — Build Slices

1. `openConversationInNewTab`(tab-recovery 확장) + 32.3 가드 연동 + 테스트.
2. `reattach`/`resume`에 new-tab fallback 게이트 연결.
3. `chatgpt-deep-research.mjs`에 `resumeDeepResearch` 분리(32.1 캡처 코어 재사용/선행 thin 버전).
4. `resume`의 `researchMode:'deep'` 분기.
5. 포커스 테스트.
6. release gates + 타깃 테스트.

## C — Check

Minimum:

```bash
npx vitest run test/unit/web-ai-tab-recovery-newtab.test.mjs test/unit/web-ai-sessions-command.test.mjs test/unit/web-ai-chatgpt-deep-research.test.mjs
npm run test:release-gates
git diff --check
```

CLI help/플래그(`--recover`/`--navigate` 등) 표면이 바뀌면:

```bash
npm run gate:all
```

라이브 검증(수동): 진행 중 Deep Research 세션을 CLI 종료 후 `sessions resume <id>`로 리포트 회수; 대화 탭을 다른 대화로 바꾼 뒤 `reattach`가 새 탭으로 복구.

## D — Done Criteria

- conversationUrl 직접 nav 실패 시 new-tab 복구로 정확한 대화만 open(32.3 가드, fail-closed).
- `researchMode:'deep'` 세션 resume가 새 프롬프트 없이 Deep Research 리포트를 캡처.
- 기존 reattach/resume·비-deep 경로 회귀 없음.
- 신규 동작 단위 테스트 커버; 라이브 항목은 수동 프로토콜 명시.
- `structure/str_func.md` count snapshot 갱신, `bash structure/verify-counts.sh` 통과.
- 32.1(DR target-scope) 의존성 명시 — 독립 착수 가능하나 캡처 코어는 32.1과 합류 권장.
