# Background Runtime Hook — Research Plan

> Goal: 에이전트 런타임(Claude Code, Cursor, Codex)의 백그라운드 장기 프로세스 처리 방식을 조사하고,
> agbrowse + cli-jaw 통합을 위한 백그라운드 런타임 hook 아키텍처를 설계한다.

## Classification

- **Work type**: C5 (research/ambiguous)
- **Deliverables**: Research doc (this folder) + memory summary
- **No code changes** — design document only

## Problem Statement

### 현재 상태

1. `agbrowse web-ai query`는 **완전 블로킹** — ChatGPT Pro 30분 응답 시 boss agent가 30분간 점유됨
2. cli-jaw의 각 턴은 **disposable CLI process** — 턴 종료 = 모든 in-flight 작업 사망
3. `ScheduleWakeup`은 in-flight 작업이 있을 때 **사용 금지**
4. "fire-and-forget + 완료 시 자동 재호출" 패턴이 **아예 없음**

### 목표

```
[현재] Boss turn → web-ai query (30분 블로킹) → turn 종료
[목표] Boss turn → web-ai send → turn 종료 → jaw 서버가 백그라운드 모니터링 → 완료 시 boss 자동 재호출
```

## Research Tasks

### Task 1: Agent Runtime Background Terminal Survey

각 런타임이 어떻게 백그라운드/장기 프로세스를 처리하는지 조사.

| Runtime | 조사 항목 |
|---------|----------|
| **Claude Code** | 백그라운드 터미널 모델, 프로세스 라이프사이클, 완료 감지 방식, `Task` tool 동작 |
| **Cursor** | 터미널 관리, 장기 실행 명령 처리, 백그라운드 작업 패턴 |
| **Codex** | 샌드박스 프로세스 모델, 비동기 작업 처리, 완료 콜백 |

조사 방법:
- 공식 문서 + API 레퍼런스
- 오픈소스 코드베이스 (있는 경우)
- 커뮤니티 토론 (GitHub Issues, Discord)

### Task 2: agbrowse Sufficiency Evaluation

외부 CLI 사용자(Claude Code에서 직접 agbrowse 사용)가 현재 구현으로 충분한지 평가.

체크 항목:
- [ ] `agbrowse web-ai send` → sessionId 반환 → 턴 종료 가능한가?
- [ ] `agbrowse web-ai sessions show $SID --json`으로 상태 체크 가능한가?
- [ ] `agbrowse web-ai watch`를 별도 프로세스로 띄울 수 있는가?
- [ ] session store (JSON 파일)가 프로세스 재시작 후에도 살아있는가?
- [ ] 각 런타임의 background terminal에서 `agbrowse web-ai watch`가 동작하는가?

### Task 3: cli-jaw Background Runtime Hook Design

jaw 인스턴스 레벨의 범용 백그라운드 프로세스 hook 설계.

설계 고려사항:
1. **heartbeat 확장 vs 별도 런타임** — 기존 heartbeat 시스템 재활용 가능성
2. **모니터링 모델** — polling (주기적 상태 체크) vs child process (watch 프로세스 직접 관리)
3. **완료 시 행동** — spawn (boss idle이면 즉시) vs queue (작업 중이면 대기열)
4. **범용성** — web-ai뿐 아니라 CI/deploy/build 등 장기 프로세스에 적용 가능한 추상화
5. **장애 복구** — jaw 서버 재시작 시 백그라운드 작업 복구

## File Plan

All research-only — no source code modifications.

### NEW files

| Path | Purpose |
|------|---------|
| `devlog/_fin/260611_background_runtime_hook/00_plan.md` | This plan (you're reading it) |
| `devlog/_fin/260611_background_runtime_hook/01_runtime_survey.md` | Task 1 결과: 런타임별 비교표 |
| `devlog/_fin/260611_background_runtime_hook/02_agbrowse_sufficiency.md` | Task 2 결과: agbrowse 현재 구현 평가 |
| `devlog/_fin/260611_background_runtime_hook/03_hook_design.md` | Task 3 결과: cli-jaw background hook 설계 초안 |

### MODIFY files

| Path | Change |
|------|--------|
| `devlog/00_index.md` | `_plan/` 테이블에 새 항목 추가 |

### Memory

Goal 완료 시 핵심 발견을 `structured/semantic/agbrowse-background-hook.md`에 저장.

## Success Criteria

1. ✅ 3개 런타임(Claude Code, Cursor, Codex)의 백그라운드 프로세스 모델이 비교표로 정리됨
2. ✅ agbrowse 기존 구현이 각 런타임에서 "충분/부족" 판정 + 부족 시 무엇이 필요한지 명시
3. ✅ cli-jaw 백그라운드 런타임 hook 설계 초안 — heartbeat 확장, 모니터링 모델, 완료 행동, 범용 인터페이스
4. ✅ 핵심 발견이 memory에 저장됨

## Execution Order

```
Task 2 (agbrowse 평가, 코드 이미 조사 완료) → Task 1 (런타임 조사, 웹 검색 필요) → Task 3 (설계, 1+2 종합)
```

Task 2를 먼저 하는 이유: 이미 watcher.mjs, session-store.mjs, chatgpt.mjs, tab-finalizer.mjs 코드를 전부 읽었으므로 즉시 평가 가능. Task 1의 런타임 조사 결과가 Task 2 결론에 영향을 줄 수 있으나, 먼저 baseline을 잡아두는 게 효율적.
