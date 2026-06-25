# 36 — Implementation Master Plan (Oracle Stability-Gap Backlog)

Date: 2026-06-25 (agbrowse v0.1.15)
Status: **MASTER PLAN — locked, execution in progress**
Parent: [00_index.md](00_index.md) · Specs: [31](31_chatgpt_downloadable_artifacts_pabcd.md) / [32](32_deep_research_session_followup_pabcd.md) / [33](33_response_capture_dualpath_pabcd.md) / [34](34_dom_diagnostics_pabcd.md) / [35](35_session_reattach_followup_pabcd.md)

이 문서는 31–35 impl-ready PABCD 스펙들을 **실제 구현으로 완료**하기 위한 마스터 계획이다. 사용자 확정 결정을 잠그고, PABCD 반복 사이클의 순서·의존성·사이클당 워크플로우·검증/릴리스 정책을 정의한다.

## 1. 잠긴 결정 (LOCKED — 2026-06-25 사용자 확정)

| # | 결정 | 상태 |
| --- | --- | --- |
| 구현 방식 | 스펙별 **PABCD 사이클 반복** (한 스펙 = 한 사이클), Boss 직접 orchestrate | LOCKED |
| 범위 | **31–35 전체** 구현; 05·07·08 보류 | LOCKED |
| 복구 모델 | **new-tab** — 저장된 `conversationUrl`을 새 탭으로 열어 복구. oracle sidebar DOM-검색(35.1)을 **대체** | LOCKED |
| Profile-copy (32.4 / 30) | **보류** (보안 민감; `BROWSER_AGENT_HOME`+CDP로 충분) | LOCKED |
| Byte-preserving ZIP 업로드 (30 P2) | **보류** (현행 text-only + `--file` 유지) | LOCKED |
| dual-path (33) | **진행하되 마지막 사이클**; observer는 단축경로만, poller 권위 유지 | LOCKED |
| 05 / 07 / 08 | **보류** (P2-저긴급 / P3 / P3-아키텍처; gap-analysis 유지) | LOCKED |
| 릴리스 | **main 로컬 커밋만**, `git push` 금지(사용자 승인 필요), `npm publish` 금지 | LOCKED |
| 라이브 검증 | B4/B5 등 Pro 계정 필요 항목은 **별도 QA**; 랜딩은 유닛+게이트로 | LOCKED |

## 2. new-tab 복구 모델 (35 스펙 개정 근거)

oracle의 sidebar 검색-클릭(DOM 취약)을 채택하지 않는다. 대신:

- 세션 복구/재접속/follow-up 시 저장된 `conversationUrl`(`session-store.mjs:18`)을 **새 탭으로 연다** (CDP `Target.createTarget` 또는 새 page).
- 새 탭 대상은 **32.3 `isSafeChatGptConversationUrl`** 가드로 검증 — provider-root/외부 URL/스레드 불일치 fail-closed.
- 효과: DOM 검색 취약성 제거, in-tab nav 드리프트 회피, 32.3 가드와 자연 합류.
- **35.1 개정**: `chatgpt-sidebar.mjs`(DOM 검색) 삭제 → `openConversationInNewTab(conversationUrl)` 신규. **35.2 DR reattach**: DR 대화도 새 탭으로 열고 32.1 캡처 코어로 이어받기.

## 3. PABCD 반복 시퀀스 (의존성 정렬)

| 순서 | 사이클 | 우선 | 핵심 의존성 |
| --- | --- | --- | --- |
| C1 | **31** generic files | P0 | 독립 (신규 `chatgpt-files.mjs`) |
| C2 | **32.1** DR target-scope | P0 | 35.2 캡처 코어의 토대 |
| C3 | **32.3** session guard | P1 | 35의 new-tab 대상 검증에 필요 |
| C4 | **32.2** model picker | P1 | 독립 (확정 patch 2건) |
| C5 | **35** reattach (new-tab) | P1 | **32.1 + 32.3 이후** |
| C6 | **33** dual-path | P1 | **마지막** (load-bearing `pollWebAi`) |
| C7 | **34** diagnostics | P2 | 독립 (verbose-gated) |

불변 의존성: **32.1 → 35.2**, **32.3 → 35.1/35.2**. 32.2/31/34는 순서 자유.

## 4. 사이클당 워크플로우 (PABCD)

각 사이클은 해당 스펙의 P/A/B/C/D를 따른다. 스펙 자체가 diff-level 계획(P)이고 5회 독립 재감사로 A는 사실상 완료 — 사이클 실행은 B→C 중심.

```
P  스펙의 "Part 2 — Diff-level Precision" 재확인 (이미 작성됨)
A  goal-mode evidence checkpoint (스펙은 5회 독립 감사 통과); 코드 변경 전 pre-write search
B  Boss 직접 구현 — 순수 helper + 단위 테스트 먼저, 그다음 wiring.
   신규 모듈로 분리해 파일 <400~500 lines 유지. ESM only. 기존 export 보존.
C  스펙의 C-phase 명령 + `npm run test:release-gates`; 파일 추가 시 `npm run fix:counts`
D  원자 커밋 (no push) + goal checkpoint(evidence) + 다음 사이클
```

검증 게이트(STRICT): 완료 주장 전 명령 fresh 실행 + 출력 확인. 독립 검증 sub-agent로 B 결과 challenge.

## 5. 보류 항목 (명시적 — 구현 안 함)

- **32.4 Profile-copy** (`--copy-profile`): 보안 민감, 보류.
- **30 P2 byte-preserving ZIP 업로드**: 현행 text-only + `--file` 유지.
- **05 error 서브클래스**: 저긴급, agbrowse flat 접근이 적절할 수 있음.
- **07 chrome signal/WSEndpoint**: 잔여 전부 P3, connect-over-CDP로 대부분 무의미.
- **08 cross-provider `ProviderDomAdapter`**: P3 장기 아키텍처.

착수 시 31–35 패턴으로 별도 PABCD 문서화 필요.

## 6. 검증 & 릴리스 정책

- **랜딩 기준**: 각 사이클의 유닛 테스트 통과 + `npm run test:release-gates` 통과 + `git diff --check` clean.
- **CLI/capability 표면 변경 사이클**(31 `kind:'file'`, 34 `--diagnostics`, 35 new-tab/`--recover` 등)은 `npm run gate:all` 추가 실행.
- **라이브 (B4/B5, Pro 계정)**: 별도 QA — 랜딩 차단 안 함, `devlog/_smoke/` 프로토콜로 기록.
- **push 금지** (사용자 승인 필요). **npm publish 금지**.
- 각 사이클 = 독립 원자 커밋(되돌리기 가능).

## 7. 진행 추적

- 사이클 완료 시 `cli-jaw goal update "<cycle> done" --evidence "<test/commit>"`.
- 본 문서 §3 표를 진행 체크리스트로 사용. 사이클 완료 시 `00_index.md` 상태 표 갱신(스펙 → ✅ implemented).
