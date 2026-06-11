# Task 3 — cli-jaw Background Runtime Hook 설계 초안

> **➡️ 이관됨 (2026-06-11)**: 이 초안은 cli-jaw devlog로 이관·확장되었다. 최신 상세 설계는
> `cli-jaw/devlog/_plan/260611_bgtask_background_runtime/` (01 런타임 분석 + 02 상세 설계)
> 를 보라. 이 문서는 agbrowse 쪽 리서치 기록으로만 유지하며 더 이상 갱신하지 않는다.

> 목표: `[현재] Boss turn → web-ai query (30분 블로킹) → 턴 종료`를
> `[목표] Boss turn → web-ai send → 턴 종료 → jaw 서버가 백그라운드 모니터링 → 완료 시 boss 자동 재호출`로.
> web-ai 전용이 아닌 **범용 장기 프로세스 hook**으로 설계한다. (설계 문서 — 구현은 별도 plan)

## 0. 현재 cli-jaw가 가진 것 / 없는 것 (소스 앵커)

cli-jaw repo: `/Users/jun/Developer/new/700_projects/cli-jaw`

### 이미 있는 것 (재사용 대상)

| 프리미티브 | 위치 | 내용 |
|-----------|------|------|
| Heartbeat 스케줄러 | `src/memory/heartbeat.ts:65-87` `startHeartbeat()` | interval/cron 잡 타이머, `fs.watch` 자동 리로드 (`:195-206`) |
| Heartbeat 실행 + busy 가드 | `src/memory/heartbeat.ts:95-156` `runHeartbeatJob()` | IDLE 체크(`:96-108`) → `orchestrateAndCollect(prompt, {origin:'heartbeat'})`(`:119`) → 채널 발송(`:129-136`) |
| Heartbeat 대기열 | `src/memory/heartbeat.ts:46-59, 158-165` | `queueHeartbeatJob()` dedup 큐 + `drainPending()` |
| 프롬프트 주입 게이트웨이 | `src/orchestrator/gateway.ts:80-160` `submitMessage()` | busy면 큐, 아니면 orchestrate — **서버 내부에서 boss를 깨우는 표준 경로** |
| 메시지 큐 (재시작 내구) | `src/agent/spawn/queue.ts:99-102, 210-227, 230-313` | `queued_messages` DB 테이블, 서버 기동 시 복구, fair batching |
| ScheduleWakeup 가로채기 | `src/agent/events/index.ts:249-261` + `src/agent/lifecycle-handler.ts:858-907` | 툴콜 캡처 → exit 후 `setTimeout` → `_spawnAgent(wakeupPrompt, {_skipInsert:true})` |
| Worker 스톨 감지 | `src/orchestrator/worker-monitor.ts:14-58` | activity timestamp + onStall/onTimeout/onDisconnect 콜백 패턴 |
| 채널 결과 발송 | `src/messaging/send.ts:164+` `sendChannelOutput()` | heartbeat가 쓰는 결과 전달 경로 |
| Origin/chatId 추적 | `src/agent/spawn.ts:92-108` `currentMainMeta` | 결과를 원래 채널로 회신하는 라우팅 |

### 없는 것 (이번 설계의 본체)

1. **외부 프로세스 모니터링** — 서버가 child process나 외부 작업 상태를 추적하는 런타임 없음.
2. **재시작 내구 wakeup** — ScheduleWakeup/goal 타이머는 in-memory `_goalTimers`
   (`lifecycle-handler.ts:40`) — **서버 재시작 시 유실**. (`queued_messages`는 내구인 것과 대조)
3. **"프로세스 완료 → boss 재호출" 이벤트 경로** — 모든 기존 wakeup은 시간 기반(heartbeat
   cron/interval, ScheduleWakeup delay)이지 이벤트 기반이 아님.

## 1. 설계 결정 4가지

### D1. Heartbeat 확장 vs 별도 런타임 → **별도 `bgtask` 모듈, 전달 경로는 공유**

- Heartbeat는 *시간 주도*(cron/interval), bgtask는 *이벤트 주도*(프로세스 종료) — 스케줄
  의미론이 다르다. heartbeat.json 스키마에 욱여넣으면 둘 다 왜곡됨.
- 대신 검증된 패턴을 그대로 재사용: busy 가드 + 큐 + drain (`heartbeat.ts:46-59,96-108,158-165`)
  구조 복제, 완료 통지는 `submitMessage()`(`gateway.ts:80`) 경유.

### D2. 모니터링 모델: polling vs child process → **managed child process가 기본**

web-ai의 결정적 제약: `sessions show`는 읽기 전용 조회일 뿐, 상태를 *전진*시키는 것은
`watch`/`poll`이다 (브라우저 DOM 폴링 필요 — 02_agbrowse_sufficiency.md §2 참고).
즉 서버가 상태 파일만 폴링하면 세션은 영원히 끝나지 않는다. **서버가 watch 프로세스를
직접 소유**해야 한다.

```
jaw server ──spawn──▶ agbrowse web-ai watch --session SID --json
                │            │ stdout: {"type":"watch.tick",...}  ← liveness
                │            │ stdout: {"type":"watch.complete",...} ← 완료 이벤트
                └─ exit code + 마지막 terminal JSON 라인 → 완료 감지
```

- 완료 감지 1차: stdout 라인 파서 (`watch.complete|watch.timeout|watch.error`).
  2차(보강): 프로세스 exit + `sessions show --json` 최종 확인.
- **headed Chrome 생존** (02 문서 gap #3): 별도 관리 불필요 — agbrowse provider 명령은
  CDP 부재 시 headed Chrome을 자동 기동하고 (`web-ai/cli.mjs:183` usage 명시,
  `ensureHeadedBrowserForWebAi`), 탭 유실은 tab-recovery가 복구. Chrome/탭 사망은
  watch tick의 `reattach-mismatch`/`capability-fail`로 표면화 → 스톨 감지 →
  `--navigate` 재spawn으로 수렴.
- 범용화: web-ai가 아닌 작업(CI/build/deploy)은 "임의 명령 + 완료 판정 규칙"으로 추상화 (§2).
- 스톨 감지는 `worker-monitor.ts:14-58` 패턴 재사용 (tick이 N분간 없으면 onStall → 재spawn).

### D3. 완료 시 행동: spawn vs queue → **submitMessage 단일 경로 (둘 다 자동)**

`gateway.ts:80-160`의 `submitMessage()`가 이미 정확히 이 분기를 한다: boss idle이면
spawn, busy면 `queued_messages` 큐(재시작 내구). 새 분기 로직을 만들지 않는다.
- 완료 프롬프트 origin: `'bgtask'` — heartbeat처럼 origin 메타로 추적.
- PABCD 진행 중일 때: heartbeat는 IDLE이 아니면 연기한다(`heartbeat.ts:96-98`).
  bgtask 결과는 **사용자가 기다리는 결과물**이므로 기본값은 큐 적재(연기 아님 — PABCD가
  끝나면 자동 drain). 잡별 `policy: 'defer-idle' | 'queue' | 'immediate'` 옵션으로 제어.

### D4. 장애 복구: **DB 테이블 `background_tasks` (in-memory 타이머 금지)**

ScheduleWakeup의 실패 사례(재시작 시 유실)를 반복하지 않는다.

```sql
CREATE TABLE background_tasks (
  id TEXT PRIMARY KEY,            -- bg_<ulid>
  kind TEXT NOT NULL,             -- 'web-ai' | 'shell' | ...
  command TEXT NOT NULL,          -- 재spawn 가능한 전체 명령
  completion TEXT NOT NULL,       -- 완료 판정 규칙 JSON (§2)
  prompt_template TEXT NOT NULL,  -- 완료 시 boss에게 줄 프롬프트
  origin_meta TEXT,               -- 채널/chatId 라우팅 (currentMainMeta 스냅샷)
  status TEXT NOT NULL,           -- 'running' | 'complete' | 'failed' | 'orphaned'
  pid INTEGER, started_at TEXT, deadline_at TEXT,
  result TEXT, completed_at TEXT
);
```

서버 기동 시: `status='running'` 행을 로드 → pid-alive 체크 → 죽었으면 재spawn.
web-ai의 경우 agbrowse 자체의 watcher 락(pid-alive + stale 회수,
`agbrowse/web-ai/watcher.mjs:311-354`)이 중복 spawn을 막아주므로 재spawn은 멱등.

## 2. 범용 TaskSpec 추상화

web-ai 전용 코드를 서버에 넣지 않기 위한 완료 판정 추상화:

```ts
interface BgTaskSpec {
  id: string;
  kind: string;                       // 라벨일 뿐, 서버 로직 분기 없음
  command: string[];                  // spawn할 명령
  completion:
    | { type: 'exit' }                              // 프로세스 종료 = 완료
    | { type: 'json-line', match: Record<string,string> }  // stdout JSON 라인 매칭
    | { type: 'line-pattern', regex: string };      // 플레인 sentinel
  resultExtractor?:                   // 완료 후 결과 본문 획득
    | { type: 'last-matching-line' }
    | { type: 'command', command: string[] };       // 예: sessions show --json
  promptTemplate: string;             // "{{result}}" 치환 → boss 프롬프트
  deadlineAt?: string;
  policy?: 'queue' | 'defer-idle' | 'immediate';
  stallAfterMs?: number;              // 출력 무소식 스톨 임계
}
```

web-ai 인스턴스화 예:

```jsonc
{
  "kind": "web-ai",
  "command": ["agbrowse", "web-ai", "watch", "--session", "$SID", "--json", "--navigate"],
  "completion": { "type": "json-line", "match": { "type": "watch.complete" } },
  "resultExtractor": { "type": "command",
    "command": ["agbrowse", "web-ai", "sessions", "show", "$SID", "--json"] },
  "promptTemplate": "[bgtask] web-ai session $SID 완료. 결과:\n{{result}}",
  "stallAfterMs": 120000   // tick 간격 15s 대비 8배 여유
}
```

같은 스펙으로 CI 대기(`gh run watch <id>` + exit), 빌드, 배포 폴링이 모두 표현된다.

## 3. Boss 에이전트 사용 흐름 (목표 상태)

```
1. Boss: SID=$(agbrowse web-ai send --vendor chatgpt ... --json | jq -r .sessionId)
2. Boss: cli-jaw bgtask add --kind web-ai --session $SID \
           --prompt "web-ai $SID 결과를 요약해 사용자에게 전달"   # 서버에 등록
3. Boss: 턴 종료 (30분 점유 없음 — session-poll 규칙의 "외부 작업" 예외로 등록)
4. jaw 서버: watch child process 소유, tick으로 liveness 추적
5. watch.complete → resultExtractor → submitMessage(prompt, {origin:'bgtask', meta})
6. Boss 재spawn (idle) 또는 큐 적재 (busy) → 결과 처리 → 채널 회신
```

주의: 현재 boss 시스템 프롬프트의 `anchor:session-poll`은 "in-flight 작업 중 턴 종료 금지"를
강제한다. bgtask 도입 시 이 앵커에 **"서버 등록된 bgtask는 예외"** 단서를 추가해야
boss가 3단계에서 안심하고 턴을 끝낼 수 있다 (프롬프트 템플릿 변경 — 구현 plan에 포함 필요).

## 4. 구현 단계 제안 (후속 plan용, 이번 goal 범위 아님)

| 단계 | 내용 | 난이도 |
|------|------|--------|
| 1 | `background_tasks` 테이블 + `src/bgtask/` 모듈 (registry, spawn, line parser) | 중 |
| 2 | 완료 → `submitMessage()` 연결 + origin 라우팅 + policy 처리 | 하 |
| 3 | `cli-jaw bgtask add/list/cancel` CLI + REST 라우트 | 하 |
| 4 | 재시작 복구 (pid-alive → 재spawn) + stall 감지 (worker-monitor 패턴) | 중 |
| 5 | boss 프롬프트 anchor:session-poll 예외 단서 + dev 스킬 가이드 갱신 | 하 |
| 선택 | ScheduleWakeup도 `background_tasks`(type: timer)로 이관해 재시작 내구화 | 중 |

## 5. 대안 검토 (기각 사유)

- **heartbeat job으로 sessions show 폴링** — 기각: 상태를 전진시키지 못함(§D2).
  watch를 누군가 돌려야 하는 문제로 회귀.
- **boss가 `watch`를 run_in_background로 직접 실행** — Claude Code 단독 사용자에겐 유효
  (01 문서 시사점)하나, cli-jaw의 boss 턴은 disposable process라 턴 종료와 함께 죽음. 기각.
- **detached watch + 완료 시 `cli-jaw chat send` 셸 체이닝** — 동작은 하나 서버가 작업을
  모르므로 추적/복구/스톨감지/중복방지 전부 없음. 임시 워크어라운드로만 인정.

## 6. 외부 런타임(비 cli-jaw)과의 정합성

이 설계는 cli-jaw 내부 hook이지만, 01 문서의 결론과 합치한다 — agbrowse 쪽 요구사항은
동일하게 "블로킹 watch + 구조화 stdout + 영속 세션 스토어"이며 이는 이미 충족됨
(02 문서). 즉 **agbrowse 코드 변경 없이** Claude Code(run_in_background push),
Cursor(Await sentinel), Codex(외부 resume), cli-jaw(bgtask hook) 네 경로가 모두 성립한다.
