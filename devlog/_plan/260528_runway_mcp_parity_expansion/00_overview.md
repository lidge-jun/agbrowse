# 260528 — Runway MCP Parity & Expansion Plan

Date: 2026-05-28
Goal: agbrowse runway를 MCP보다 우월하게 만들기
Method: Runway MCP 전체 도구 해부 → agbrowse 현재 구현 대조 → 확장 계획

## Context

Runway MCP (2026-05-27 공개, `mcp.runwayml.com/mcp`)는 11개 도구로 구성됨.
agbrowse runway는 현재 read-only preflight/poll만 지원 (5개 명령).
사용자 요구: **MCP 전체 표면을 agbrowse가 커버하되, MCP가 못 하는 것까지 추가**.

## 핵심 우위 (agbrowse > MCP)

1. **Unlimited/Explore Mode** — MCP는 크레딧 소모. agbrowse는 웹 UI의 Explore 모드로 무한 생성 가능
2. **전체 모델** — MCP는 7개 모델 고정. agbrowse는 UI에 뜨는 모든 모델 접근 가능
3. **API 키 불필요** — 브라우저 세션으로 인증
4. **시각적 검증** — 스크린샷/DOM으로 실제 생성물 확인
5. **Queue 관리** — DOM 기반 큐 상태 + 수동 개입 가능

## Devlog Index

- [00_overview.md](00_overview.md) — 이 파일
- [01_mcp_full_dissection.md](01_mcp_full_dissection.md) — MCP 11개 도구 전체 해부 (파라미터, 모델, 모드, 제한)
- [02_agbrowse_current_surface.md](02_agbrowse_current_surface.md) — agbrowse runway 현재 구현 정리
- [03_gap_analysis.md](03_gap_analysis.md) — MCP vs agbrowse 기능 대조 + 우위/열위 분석
- [04_args_expansion_plan.md](04_args_expansion_plan.md) — agbrowse runway args 확장 계획 (명령별, 파라미터별)
- [05_diff_level_implementation.md](05_diff_level_implementation.md) — 파일 단위 구현 계획 (NEW/MODIFY/DELETE)
- [06_verification_plan.md](06_verification_plan.md) — 테스트 + 검증 계획
