# Oracle vs agbrowse — Stability Gap Analysis

Date: 2026-06-08
Reference: https://github.com/steipete/oracle (main branch)
Target: agbrowse v0.1.7 (원 분석) · **재감사 v0.1.15 (2026-06-24)** — 각 문서 상단의 "2026-06-24 Re-audit" 블록 참조

## Purpose

Oracle(steipete/oracle)은 ChatGPT Pro 브라우저 자동화에서 가장 성숙한 오픈소스 구현체.
이 문서 세트는 oracle 대비 agbrowse의 안정성 부족점을 식별하고 패치 우선순위를 결정한다.

## Documents

| File | Topic | Severity |
|------|-------|----------|
| [01_send_button_stability.md](01_send_button_stability.md) | 전송 버튼 클릭 안정성 | **P0** |
| [02_attachment_upload.md](02_attachment_upload.md) | 파일 업로드 및 칩 검증 | **P0** |
| [03_response_capture.md](03_response_capture.md) | 응답 캡처 이중화 | **P1** |
| [04_session_reattach.md](04_session_reattach.md) | 세션 재접속/이어받기 | **P1** |
| [05_error_taxonomy.md](05_error_taxonomy.md) | 에러 분류 체계 비교 | **P2** |
| [06_dom_diagnostics.md](06_dom_diagnostics.md) | DOM 디버깅/진단 | **P2** |
| [07_chrome_lifecycle.md](07_chrome_lifecycle.md) | Chrome 프로세스 생명주기 | **P2** |
| [08_provider_abstraction.md](08_provider_abstraction.md) | 멀티 프로바이더 아키텍처 | **P3** |
| [30_oracle_0_15_delta_followup.md](30_oracle_0_15_delta_followup.md) | 0.11.1 이후 Oracle 0.15 델타와 agbrowse 추적 순서 | **P0/P1 follow-up** |
| [31_chatgpt_downloadable_artifacts_pabcd.md](31_chatgpt_downloadable_artifacts_pabcd.md) | ChatGPT 범용 다운로드 파일/업로드 감사 PABCD 계획 | **P0/P2** |
| [32_deep_research_session_followup_pabcd.md](32_deep_research_session_followup_pabcd.md) | Deep Research, model picker, later-session follow-up PABCD 계획 | **P0/P1/P2** |
| [33_response_capture_dualpath_pabcd.md](33_response_capture_dualpath_pabcd.md) | 응답 캡처 이중 경로(observer race)+3차 복구 PABCD 계획 (03 구체화) | **P1** |
| [34_dom_diagnostics_pabcd.md](34_dom_diagnostics_pabcd.md) | 실패 시 DOM/스크린샷 자동 진단 아티팩트 PABCD 계획 (06 구체화) | **P2** |

## 2026-06-24 Re-audit Status (v0.1.15)

원 분석은 agbrowse v0.1.7 기준. 현 코드(v0.1.15) 대비 코드-진실 재감사 결과:

| 문서 | 상태 | 요약 |
| --- | --- | --- |
| 01 send button | ✅ CLOSED | timeout 파라미터화, Enter fallback, 셀렉터/커밋검증 전부 구현 |
| 02 attachment | ✅ CLOSED | chip readiness 전송 직전 호출; 잔여 P3(DataTransfer fallback) |
| 03 response capture | 🟡 OPEN → 📋 33 | 이중 경로 race + 3차 복구 미구현 (`MutationObserver` 0건) → **33 PABCD impl-ready** |
| 04 session reattach | 🟡 PARTIAL | `sessions reattach`/`resume` 구현; sidebar·DR-reattach만 OPEN |
| 05 error taxonomy | 🟡 OPEN | 서브클래스 미구현(저긴급); errorCode 37개 |
| 06 dom diagnostics | 🟡 OPEN → 📋 34 | 실패 시 자동 DOM/스크린샷 캡처 없음 → **34 PABCD impl-ready** |
| 07 chrome lifecycle | 🟡 PARTIAL | `stop`=생성중단(≠kill), connect-over-CDP; signal/WSEndpoint OPEN |
| 08 provider abstraction | 🟡 PARTIAL | ChatGPT `EditorAdapter` 추가; cross-provider OPEN |
| 10 P0 patch plan | ✅ DONE | 6개 변경 전부 반영, 벤치 22/22 통과 |
| 20 benchmarks | ✅ CLOSED(B1–B3) | offline 22/22 통과; B4–B5 live 미검증 |
| 30 0.15 delta | 📋 plan | Oracle 0.15 여전히 최신 release; 31/32로 분기 |
| 31 downloadable files | 📋 impl-ready | generic file lane 미구현(`chatgpt-files.mjs` 부재) |
| 32 deep research/session | 📋 impl-ready | DR target-scope·session guard 미구현; 32.2 감사 완료 |
| 33 response dual-path | 📋 impl-ready | observer race + 3차 복구; 03 구체화, code-truth 확인 |
| 34 dom diagnostics | 📋 impl-ready | 실패-시점 DOM/screenshot 아티팩트; 06 구체화 |

**즉시 구현 착수 가능 backlog (P0–P2, PABCD impl-ready)**: 31(P0 generic file lane) · 32.1(P0 DR capture) · 32.3(P1 session guard) · 32.2(P1 model picker, 감사 완료) · **33**(P1 dual-path 캡처) · **34**(P2 diagnostics).

**아직 PABCD 미구체화(낮은 우선순위 / 아키텍처성, 재감사 블록만 보유)**: 04(세션 sidebar/DR-reattach, PARTIAL) · 05(error 서브클래스, 저긴급) · 07(chrome signal/WSEndpoint, PARTIAL) · 08(cross-provider `ProviderDomAdapter`, P3). 이들은 gap-analysis + 현행 상태 마커까지만 갱신됨 — 착수 시 31–34 패턴으로 별도 PABCD 문서화 필요.

## Severity Legend

- **P0**: 사용자 대면 실패 직결 — 즉시 패치
- **P1**: 간헐적 실패 / 복구 불가 — 다음 릴리스
- **P2**: 운영 품질 / 디버깅 효율 — 중기
- **P3**: 아키텍처 개선 — 장기

## Key Findings Summary

원 분석(2026-06-08, v0.1.7) + 현 상태(v0.1.15) 마커:

1. ✅ **전송 버튼**: (해소) timeout 파라미터화 + Enter 폴백 + 20/45s — `chatgpt-composer.mjs`
2. ✅ **첨부파일**: (해소) chip readiness 전송 직전 호출 — `chatgpt.mjs:258`; 잔여 P3 DataTransfer fallback
3. 🟡 **응답 캡처**: (OPEN) oracle MutationObserver + poller 이중화 vs agbrowse 단일 경로 — `MutationObserver` 0건
4. 🟡 **세션 재접속**: (PARTIAL) `sessions reattach`/`resume` 구현; SIGINT-keep은 connect-over-CDP로 무의미; sidebar·DR-reattach OPEN
5. 🟡 **에러 분류**: (OPEN, 저긴급) oracle 3-tier vs agbrowse 단일 `WebAiError`; errorCode 37개
6. 🟡 **DOM 진단**: (OPEN) 실패 시 DOM snapshot + screenshot 자동 저장 없음
7. 🟡 **Chrome 생명주기**: (PARTIAL) `stop`≠kill, connect-over-CDP; signal handler/WSEndpoint OPEN
8. 🟡 **프로바이더**: (PARTIAL) ChatGPT `EditorAdapter` 추가됨; cross-provider `ProviderDomAdapter` OPEN
