# Task 2 — agbrowse 현재 구현 충분성 평가

> 질문: 외부 CLI 사용자(예: Claude Code에서 agbrowse를 직접 사용)가 30분짜리 web-ai 세션을
> 논블로킹으로 처리하기에 현재 구현이 충분한가?

## 결론 요약

**핵심 기반(세션 영속화 + 분리형 send/poll/watch)은 충분하다.**
Claude Code에서는 추가 작업 없이 바로 사용 가능. Cursor/Codex에서는 watch를 백그라운드 셸로
띄우는 패턴으로 동작하지만 런타임별 제약(아래)이 있다. 부족한 것은 단 하나 —
**완료 시 외부 명령을 실행하는 `--on-complete` 류 콜백 훅이 없다** (워크어라운드: 셸 체이닝).

## 체크리스트 평가

### 1. `web-ai send` → sessionId 반환 → 턴 종료 가능한가? — ✅ YES

- `send`는 세션 레코드를 생성하고 sessionId를 반환한 뒤 종료한다. 세션은 디스크에 영속화됨.
- 근거: `web-ai/session-store.mjs:56-57` — 스토어 경로 `~/.browser-agent/web-ai-sessions.json`;
  `insertSession()` (`session-store.mjs:322-329`)이 파일 락 하에 atomic write (`writeSessionStore`,
  `session-store.mjs:122-128`, tmp+rename).
- 세션 레코드는 `status`(`sent`/`polling`/`complete`/`timeout`/`error`), `conversationUrl`,
  `deadlineAt`, `answer`, `trace`를 모두 보존 (`session-store.mjs:8-33` typedef).

### 2. `sessions show $SID --json`으로 상태 체크 가능한가? — ✅ YES

- `sessions` 서브커맨드 존재 (`web-ai/cli.mjs:48`, 디스패치 `cli.mjs:689`).
- `listStoredSessions(filter)` (`session-store.mjs:351-361`)가 sessionId/vendor/status 필터 지원.
- **읽기 전용** — 브라우저 불필요. 어떤 프로세스에서든 JSON 파일만 읽으면 됨.
- ⚠️ 단, `sessions show`는 상태를 *조회*만 한다. 상태를 *전진*시키는 것은 `poll`/`watch`다
  (완료 감지는 브라우저 DOM 폴링이 필요). 외부 모니터가 `sessions show`만 반복하면
  status가 영원히 `sent`에 머문다 — 반드시 누군가 `watch` 또는 `poll`을 실행해야 함.

### 3. `web-ai watch`를 별도 프로세스로 띄울 수 있는가? — ✅ YES

- `watchSession()` (`web-ai/watcher.mjs:42-108`)은 독립 CLI 프로세스로 실행되는 폴링 루프:
  기본 15초 간격 (`DEFAULT_WATCH_INTERVAL_MS`, `watcher.mjs:26`), terminal 상태
  (`complete`/`timeout`/`error`, `watcher.mjs:29`) 도달 시 종료.
- 세션별 watcher 락 (`acquireWatcherSessionLock`, `watcher.mjs:311-354`) — pid-alive 체크 +
  heartbeat 기반 stale 감지 (`isWatcherLockStale`, `watcher.mjs:540-545`)로 **중복 watch 방지 +
  죽은 watcher 자동 회수**. 재스폰 멱등성이 이미 보장됨.
- 이벤트는 stdout으로 구조화 출력 (`createStdoutNotifier`, `watcher.mjs:258-274`):
  `--json`이면 줄 단위 JSON (`watch.start` → `watch.tick`* → `watch.complete|watch.timeout|watch.error`).
- ⚠️ 전제조건: watch는 CDP로 **실제 브라우저 페이지를 구동**한다 (`withSessionPage`,
  `watcher.mjs:176`). headed Chrome + 해당 탭이 살아있어야 함 (tab-recovery가 복구 시도).

### 4. session store가 프로세스 재시작 후에도 살아있는가? — ✅ YES

- 평문 JSON 파일 + atomic rename 쓰기 — 프로세스/머신 재시작과 무관하게 생존.
- 동시성: 스토어 락(`withStoreLock`, `session-store.mjs:135-164`, stale 5분) +
  세션 커맨드 락(`withSessionCommandLock`, `session-store.mjs:272-316`, TTL 35분 + 15초 heartbeat
  + pid-alive stale 감지) — 크래시 후 락 잔존물도 자동 회수.
- `deadlineAt` 기반 활성 판정 (`isSessionActive`, `session-store.mjs:368-372`)으로
  재시작 후 "아직 살아있는 세션" 목록을 신뢰성 있게 얻을 수 있음 (`sessions list --active`).

### 5. 각 런타임의 background terminal에서 `watch`가 동작하는가? — 런타임별 상이

01_runtime_survey.md의 조사 결과와 결합한 판정:

| 런타임 | 판정 | 패턴 | 비고 |
|--------|------|------|------|
| **Claude Code** | ✅ 충분 | `Bash run_in_background`로 `watch --session SID --json` 실행 → 프로세스 종료 시 완료 알림이 대화에 자동 주입(push) → 에이전트가 결과 파일/세션 읽음 | 가장 자연스러움. `Monitor` 도구로 tick 라인 스트리밍도 가능. 단 Claude Code 종료 시 watch도 같이 죽음 — 세션 스토어 덕에 재시작 후 watch 재개 가능 |
| **Cursor** | ⚠️ 조건부 | watch를 백그라운드 셸로 + 3.0 `Await` 도구로 특정 출력 대기 | Await는 sentinel 문자열 매칭 — watch의 `watch.complete` JSON 라인이 sentinel 역할 가능. 푸시 알림 없음, 장기(30분) 백그라운드 셸 생존은 비문서화 |
| **Codex** | ⚠️ 조건부 | `unified_exec` 백그라운드 터미널에서 watch 실행, `write_stdin` 폴링 | 15초마다 tick 라인이 나와 5분 empty-poll 윈도우(`background_terminal_max_timeout`)는 회피됨. 그러나 장기 백그라운드 프로세스 신뢰성 회귀(#10957) 보고 — 완전 외부 watcher + `codex exec resume` 재호출이 더 견고 |

## 부족한 것 (gap)

1. **완료 콜백 훅 없음** — `watch`가 terminal 도달 시 외부 명령을 실행하는
   `--on-complete "<cmd>"` 옵션이 없다. 현재 워크어라운드는 셸 체이닝:
   `agbrowse web-ai watch --session $SID --json; cli-jaw chat send "done $SID"`.
   watch가 정상 exit하므로 `;`/`&&` 체이닝으로 사실상 동등 — **구현 우선순위 낮음**.
2. **exit code 의미 부재 문서화** — terminal 상태(complete vs timeout vs error)가
   exit code로 구분되는지 보장이 없음. 외부 오케스트레이터는 마지막 JSON 라인의
   `type`/`status`를 파싱해야 한다. (계약 문서화 필요 — 코드 변경은 아님)
3. **watch는 브라우저 의존** — 순수 "상태 체크 데몬"으로는 못 쓴다. 서버가 watch를
   관리한다면 headed Chrome 생존도 함께 관리해야 함 (03_hook_design.md에서 다룸).

## 최종 판정

| 관점 | 판정 |
|------|------|
| 외부 CLI 사용자 (Claude Code) | **충분** — send/sessions/watch + 백그라운드 Bash로 즉시 사용 가능 |
| 외부 CLI 사용자 (Cursor/Codex) | **사용 가능하나 런타임 제약** — sentinel/poll 패턴 필요, 초장기 작업은 외부 watcher 권장 |
| cli-jaw 통합 (jaw 서버가 모니터링) | **agbrowse 쪽은 준비됨** — 세션 스토어/락/watch가 서버 관리형 child process 모델의 전제조건을 모두 충족. 필요한 것은 cli-jaw 쪽 hook (03 문서) |
