# Oracle vs agbrowse — Stability Gap Analysis

Date: 2026-06-08
Reference: https://github.com/steipete/oracle (main branch)
Target: agbrowse v0.1.7

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
| [31_chatgpt_downloadable_artifacts_pabcd.md](31_chatgpt_downloadable_artifacts_pabcd.md) | ChatGPT 범용 다운로드 파일/ZIP 업로드 무결성 PABCD 계획 | **P0/P2** |
| [32_deep_research_session_followup_pabcd.md](32_deep_research_session_followup_pabcd.md) | Deep Research, model picker, later-session follow-up PABCD 계획 | **P0/P1/P2** |

## Severity Legend

- **P0**: 사용자 대면 실패 직결 — 즉시 패치
- **P1**: 간헐적 실패 / 복구 불가 — 다음 릴리스
- **P2**: 운영 품질 / 디버깅 효율 — 중기
- **P3**: 아키텍처 개선 — 장기

## Key Findings Summary

1. **전송 버튼**: agbrowse 8초 타임아웃 + Enter 폴백 없음 vs oracle 20-45초 + Enter 폴백
2. **첨부파일**: agbrowse는 업로드 칩 준비 확인 없이 전송 시도
3. **응답 캡처**: oracle은 MutationObserver + snapshot poller 이중화; agbrowse는 단일 경로
4. **세션 재접속**: oracle은 SIGINT 시 Chrome 유지 + reattach; agbrowse는 미지원
5. **에러 분류**: oracle은 3-tier 에러 계층 (User/Transport/Response); agbrowse는 단일 WebAiError
6. **DOM 진단**: oracle은 실패 시 DOM snapshot + screenshot 자동 저장; agbrowse는 로그만
7. **Chrome 생명주기**: oracle은 signal handler + in-flight 보호; agbrowse는 기본 start/stop
8. **프로바이더**: oracle은 ProviderDomAdapter 인터페이스 기반; agbrowse는 vendor별 하드코딩
