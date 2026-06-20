# Task 1 — Agent Runtime Background Process Survey

> 조사일: 2026-06-11. Claude Code / Cursor / Codex가 백그라운드·장기 실행 프로세스를
> 어떻게 처리하고 완료를 감지하는지 비교. 출처는 공식 문서 우선, 공백은 GitHub 이슈/체인지로그로 보강.

## 비교표

| 질문 | Claude Code | Cursor (IDE + CLI) | Codex (OpenAI CLI) |
|------|-------------|--------------------|--------------------|
| **백그라운드 프로세스 모델** | 1급 지원: `Bash` `run_in_background: true` → 즉시 task ID 반환, `Ctrl+B`로 강제 백그라운드, `/tasks`로 목록/중지. 별도 `Monitor` 도구는 출력 라인을 대화 중 스트리밍 | IDE: 네이티브 터미널이 백그라운드 실행, "Move to background"로 에이전트 언블록. CLI: 백그라운드 프리미티브 비문서화 | 베타 background terminal (`unified_exec`, `codex features enable unified_exec`): 인터랙티브 세션(TUI 가능), `/ps`·`/list`로 확인. `background_terminal_max_timeout` 기본 5분 |
| **완료 감지** | **Push**: 백그라운드 작업 종료 시 완료 알림이 대화에 자동 주입되어 폴링 없이 에이전트 재활성화. `Monitor`는 라인 단위 push | **Poll/wait**: 3.0의 `Await` 도구 — 백그라운드 셸/서브에이전트 완료 또는 특정 출력("Ready"/"Error") 대기. push 알림 없음 | **Poll**: `write_stdin`으로 poll 윈도우 내 폴링. push 재호출 없음. `notify`는 `agent-turn-complete`에만 발화(인간 통지용, 에이전트 재호출 아님) |
| **턴/세션 경계 생존** | 세션 내 턴 간 생존; Claude Code 종료 시 정리됨. `claude -p`(headless)는 최종 결과 후 ~5초 뒤 종료. 출력 5GB 상한 | 세션 내 생존(네이티브 터미널); 세션 간 생존 비문서화. 초장기 작업은 Cloud Agents(원격 VM)로 유도 | 세션 내 턴 간 생존(기능 목적 자체). 단 장기 백그라운드 프로세스가 예기치 않게 죽는 회귀(#10957) 보고. 세션 간 생존 비문서화 |
| **훅/외부 재트리거** | 풍부: 34개 훅 이벤트(Stop, PostToolUse, TaskCompleted, Notification…), `asyncRewake`(exit code 2로 Claude 깨움), Stop 훅 `decision:"block"`으로 턴 연장, `CronCreate`/`ScheduleWakeup`/`PushNotification`, `claude -p --resume <id>`로 외부 재호출 | 훅(1.7+): `afterShellExecution`, `stop` 등(stdin JSON). `cursor-agent -p --resume [thread id]`로 외부 watcher가 재호출 가능. MCP 지원 | 훅 9종(`Stop`/`SubagentStop`에서 `{"decision":"block"}`으로 강제 계속), `notify` 외부 명령(턴 완료 시), `codex exec resume --last`로 외부 재호출. MCP 지원 |

## 런타임별 상세

### Claude Code

- **백그라운드 모델**: `Bash` 도구의 `run_in_background: true` — "비동기로 실행되고 즉시
  백그라운드 task ID 반환, 명령 실행 중에도 새 프롬프트에 응답 가능". 출력은 파일에 기록되어
  `Read`로 조회. `/tasks`로 목록/중지. v2.1.98+에는 `Monitor` 도구 — "명령을 백그라운드로
  실행하고 각 출력 라인을 Claude에 피드백, 로그/파일 변경/폴링 상태에 대화 중 반응".
  (출처: code.claude.com/docs interactive-mode, tools-reference)
- **완료 감지**: push 기반 — 종료 시 "Background command … completed (exit code 0)" 알림이
  대화에 주입되어 에이전트가 폴링 없이 재활성화. 공식 레포 이슈 #21048, #20525, #18544에서
  의도된 동작으로 확인 (문서 자체에는 메커니즘 명시 부족 — 신뢰도 중상).
- **라이프사이클**: 턴 간 생존, "Claude Code 종료 시 자동 정리". headless `claude -p`에서는
  최종 결과 후 약 5초 뒤 종료. (출처: headless 문서)
- **훅**: Stop(`decision:"block"`으로 턴 계속), PostToolUse, TaskCompleted 등 34종.
  `asyncRewake` 커맨드 훅은 "백그라운드 실행, exit code 2로 Claude를 깨움".
  `CronCreate`(세션 스코프 예약 프롬프트), `ScheduleWakeup`(자가 페이싱), `PushNotification`,
  외부 프로그램의 `claude -p --resume <session_id>` 재호출. (출처: hooks, tools-reference)

### Cursor

- **백그라운드 모델**: 1.3부터 에이전트가 네이티브 터미널 사용 — "필요 시 새 터미널 생성,
  백그라운드 실행". 0.49의 "Move to background"가 장기 명령에서 에이전트를 언블록.
  공식 터미널 문서는 샌드박싱/승인 중심이고 백그라운드 라이프사이클은 비문서화.
  (출처: cursor.com/changelog 1-3, 0-49; docs agent/tools/terminal)
- **완료 감지**: 3.0 (2026-04-02)에서 `Await` 도구 추가 — "백그라운드 셸 명령·서브에이전트
  완료 대기, 또는 'Ready'/'Error' 같은 특정 출력 대기". 에이전트 주도 블로킹 대기이며
  외부 push 아님. 2.5부터 서브에이전트 비동기화. (출처: changelog 3-0, 2-5)
- **라이프사이클**: 세션 내 생존; 세션 간 비문서화. 진짜 장기 작업은 Cloud Agents
  (원격 VM, 완료 시 PR로 통지)로 유도. (출처: docs background-agent)
- **훅**: 1.7부터 `afterShellExecution`, `stop` 등 (stdin JSON, exit code/JSON으로 흐름 제어).
  CLI는 `-p` 비대화 모드 + `--resume [thread id]` — 외부 watcher 재호출에 사용 가능.
  (출처: docs hooks, cli/using)

### Codex (OpenAI CLI)

- **백그라운드 모델**: 기본 exec는 샌드박스 내 호출 단위 동기. 베타 **background terminal**
  (`unified_exec` feature flag)이 지속·인터랙티브 백그라운드 세션 제공 — "TUI와 프롬프트형
  워크플로(`git rebase -i`) 사용 가능", `/ps`·`/list`로 확인.
  설정 `background_terminal_max_timeout`: "빈 `write_stdin` 폴링의 최대 poll 윈도우(ms),
  기본 300000(5분)". (출처: developers.openai.com/codex config-reference; 이슈 #3968, #8779)
- **완료 감지**: poll 기반 — 모델이 `write_stdin`으로 백그라운드 터미널을 폴링.
  프로세스 종료 시 push 재호출 없음. `notify`는 `agent-turn-complete`에만 발화
  (JSON: thread-id, turn-id, cwd, last-assistant-message) — *작업 완료→에이전트* 신호가 아니라
  *에이전트 턴 완료→외부* 신호. (출처: config-advanced)
- **라이프사이클**: 세션 내 턴 간 생존이 기능 목적. 단 이슈 #10957 — "장기 백그라운드 명령이
  예기치 않게 중단"(waited 상태 진입) 회귀로 수 시간급 프로세스는 불안정. 세션 간 비문서화.
- **훅**: `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`,
  `SubagentStop` 등 9종 (`hooks.json` 또는 config.toml `[hooks]`). `Stop`/`SubagentStop`에서
  `{"decision":"block","reason":"…"}` 반환 시 "Codex가 계속 진행".
  외부 재호출: `codex exec resume --last`. (출처: codex/hooks, cli/features)

## 외부 장기 CLI(30분 web-ai 작업)에의 시사점

- **Claude Code (최적)**: (a) `agbrowse web-ai watch --session SID --json`을
  `run_in_background`로 실행 — 프로세스 종료 시 완료 알림이 push되어 폴링 도구 호출 불필요.
  (b) `Monitor`로 tick 라인 스트리밍. (c) headless/CI: 외부 watcher가
  `claude -p "job done" --resume <session_id>` 호출.
  → **"완료 시 exit 0으로 종료하는 블로킹 watch 명령" 하나가 세 경로를 모두 커버**.
  세션 종료 후 작업 생존에는 의존하지 말 것 (종료 시 정리됨, `-p`는 ~5초 유예).
- **Cursor**: push에 의존하지 말 것. `send`로 job ID 받고 watch를 백그라운드 셸로 +
  `Await`로 sentinel 라인 대기 (정확한 `READY`/`ERROR:` 형식 출력 권장).
  CLI는 외부 watcher가 `cursor-agent -p --resume <thread id>`로 재호출.
  30분 초과 무인 실행은 Cloud Agents가 공식 경로.
- **Codex**: job ID 발급 후 background terminal에서 watch 실행, `write_stdin` 폴링.
  5분 empty-poll 윈도우를 고려해 **주기적 heartbeat 라인 출력 필수** (agbrowse watch의
  15초 tick이 이를 충족). #10957 신뢰성 회귀 때문에 더 견고한 패턴은 완전 외부형:
  작업 상태를 디스크에 영속화하고 완료 시 job-runner가
  `codex exec resume --last "job <id> finished, results at <path>"` 호출.
  `Stop` 훅에서 미완료 작업 체크 후 `{"decision":"block"}`으로 세션 유지도 가능하나 턴 소모.

## 신뢰도 메모

- **Claude Code 완료 알림**: 공식 문서가 메커니즘을 명시하지 않음 — 공식 레포 이슈 다수로
  교차 확인 (알림이 *안 와서* 버그라는 리포트 포함 = 의도된 동작 방증). 신뢰도 중상.
- **Cursor**: 터미널 문서가 백그라운드 라이프사이클/타임아웃/세션 간 생존에 침묵.
  `Await`는 체인지로그 한 줄만 존재 (API 문서 없음). `stop` 훅의 강제 계속(block) 지원 여부
  미검증. 신뢰도 중하.
- **Codex**: `unified_exec` 상세는 config-reference + GitHub 이슈 기반 (전용 문서 페이지
  미발견). 세션 종료 시 background terminal 처리 비문서화. 신뢰도 중간.
- 세 런타임 모두 변화가 빠름 (Cursor 3.0 2026-04, Codex 베타 플래그, Claude Code 도구 개명
  `BashOutput`→`TaskOutput`→deprecated) — **설계 확정 전 재검증 필요**.

## 출처

Claude Code: code.claude.com/docs (interactive-mode, tools-reference, hooks, headless);
github.com/anthropics/claude-code issues #21048, #20525, #18544.
Cursor: cursor.com/docs (agent/tools/terminal, hooks, cli/using), changelog 0-49/1-3/2-5/3-0,
docs.cursor.com/background-agent, forum.cursor.com #93021.
Codex: developers.openai.com/codex (config-reference, config-advanced, hooks, cli/features);
github.com/openai/codex issues #3968, #8779, #10957.
