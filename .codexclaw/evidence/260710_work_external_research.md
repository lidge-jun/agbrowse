# ChatGPT Work 외부 조사 요약 (2026-07-10, sol explorer — agbrowse fetch로 원문 검증)

## 확인된 사실 (공식 근거)

- 정식 명칭 **ChatGPT Work** — "장기·복잡 작업용 agent" (Release Notes 2026-07-09,
  help.openai.com/en/articles/6825453). Codex 기술의 ChatGPT 편입, 크레딧/사용량
  구조 공유 (articles/20001275, learn.chatgpt.com/docs/enterprise/work-admin-faq).
- 대상: Free/Go 제외 유료 플랜 (Pro/Pro Lite/Enterprise/Edu 선행, Plus/Business 후속).
- 실행: 웹·모바일 Work는 **클라우드 실행**, hosted long-running + 병렬 대화
  (learn.chatgpt.com/docs/long-running-work). 공개 task-queue API 없음.
- **Power 공식 매핑** (learn.chatgpt.com/docs/models 인터랙티브 컨트롤 실측):
  1/6=GPT-5.6 Terra·Light, 2/6=Sol·Light, 3/6=Sol·Medium(**기본**),
  4/6=Sol·High, 5/6=Sol·Extra High, 6/6=Sol·Ultra.
  `Max`는 Power 축 밖 Advanced 전용(단일 작업 추론 시간 확대),
  `Ultra`는 **subagents 병렬 분할 실행**.
- Speed Fast = 속도 1.5x. 크레딧 배수는 별도: 5.5=2.5x, 5.4=2x 문서화,
  **5.6 배수 미공표** — 숫자 노출 금지, `more_usage: true`만 반환할 것.
- 세션 모델: 웹 Work는 별도 태스크 객체가 아니라 **일반 chat conversation**으로
  저장 (learn.chatgpt.com/docs/projects) — 같은 대화에서 이어 지시/상태 질의.
  → agbrowse session/resume 틀 재사용 근거 충분. poll DOM은 여전히 실측 필요.
- GitHub 연동: Plugins는 MCP-backed app. Codex cloud는 repo 선택→격리 환경→PR.
  Work 컴포저의 GitHub 버튼이 어느 쪽 handoff인지 **미확인**.

## WP1 재프로브에 미치는 영향

- Power 매핑은 공식 문서로 선확정 — WP1은 **검증**(라이브 UI가 문서 매핑과
  일치하는지 1회 왕복)으로 축소. aria-valuenow 등 조작 계약 실측은 유지.
- 최대 리스크는 여전히 제출 후 progress/approval/stop/final DOM (역설계 보고서
  260710_work_reverse_engineering.md의 실측 10항목 유지).

## work send 설계 확정 입력

- `--power N` 1..6 = 위 공식 매핑. v1은 `--power`/MCP `power`를 필수로 요구한다.
  생략은 browser mutation 전 preflight 오류이며 현재 UI 유지나 UI 기본값으로
  진행하는 경로를 제공하지 않는다.
- Max/Ultra 의미 차이를 help 텍스트에 반영 (Ultra=병렬 subagents, 사용량 급증).
