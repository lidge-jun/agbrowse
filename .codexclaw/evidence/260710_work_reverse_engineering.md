# Work 자동화 역설계 요약 (2026-07-10, sol explorer 반환 — WP0/WP1/WP4 입력)

총판정: Work는 새 프로바이더가 아니라 ChatGPT 내부의 별도 실행 surface.
세션·탭·deadline·trace·오류 직렬화는 재사용, surface 전환·Work picker
mutation·composer 스코프·완료 판정은 전용 adapter로 분기.

## 핵심 판정 (path:line 근거는 원 반환 참조)

1. **컴포저**: 입력 엔진 재사용 가능성 높음. 단 (a) vendor-editor-contract.mjs:114
   semantic name이 `message|prompt|chatgpt`만 허용 — «Work on anything» 추가 필요,
   (b) chatgpt-composer.mjs:277,320 전역 querySelector fallback이 hidden Chat
   컴포저를 오타깃 가능 — composerRoot/composerTarget 전달형 어댑터 필요,
   (c) :377 전역 send 버튼 fallback은 Work에서 금지.
2. **완료 판정**: chatgpt-composer.mjs:184 "새 conversation turn" 필수 가정,
   chatgpt.mjs:393,403 Stop 소멸+텍스트 안정화, :700 Copy/Like/Share evidence —
   Work가 task card형이면 전부 깨짐. response contract를 chat|work로 분리,
   Work가 다르면 `readWorkTaskState()`(running|blocked|failed|complete) 신설.
3. **세션**: session-store는 임의 필드 허용 — surface/taskId/taskUrl 추가 가능.
   위험: chatgpt.mjs:1068 conversation id 파서가 `/c/<uuid>`만 인식,
   session.mjs:296 findActiveSession의 Chat/Work 혼입 — surface 필터 필요.
4. **mutation 헬퍼** (신설 `chatgpt-work-picker.mjs` 소유 권장):
   ensureWorkSurface, openWorkPicker, readWorkPickerState, normalizeWorkPower,
   setWorkPower, openWorkAdvancedView, normalizeWork{Model,Effort,Speed},
   setWorkAdvancedOption, verifyWorkSelection, buildWorkSelectionEvidence.
   Chat의 normalizer/label 테이블/전역 메뉴 탐색은 재사용 금지.
5. **MCP v1 스키마**: `web_ai_work_send` = { prompt(req), power(req, 1..6),
   speed(standard|fast), timeout } — model/effort/project는 mutation 구현 전
   스키마에서 제외 (정직성). additionalProperties:false.
6. **1차 스코프**: prompt-only(+power). Choose project/첨부는 후속 슬라이스.
   기존 `--project`는 envelope 텍스트라 Work Choose project와 의미 다름 — 혼용 금지.

## WP1 재프로브 추가 실측 (기존 01 §5.1의 5항목에 추가)

1. Chat/Work 컴포저 동시 마운트 여부, 각 form/textbox accessible name/send 귀속.
2. 제출 전후 URL 전체, redirect, task/conversation ID, 새로고침 복원.
3. user turn/task card 생성 시점 + commit 성공 최소 DOM.
4. running/blocked/failed/complete 상태별 DOM, Stop/Cancel, approval·retry.
5. 초기 acknowledgement 후 백그라운드 실행 지속 여부.
6. 상태별 assistant selector 수, nesting, Copy/Share 출현 시점.
7. 탭 종료 후 task URL 재접속 + 저장 세션 resume/poll 성공 여부.
8. Power의 aria-valuenow/min/max/text, Arrow/Home/End, clamp/wrap, 재오픈 지속성.
9. Power와 Speed 토글 독립성, Advanced 변경의 Power 역변경 규칙.
10. project 선택·첨부의 URL/task identity/완료 DOM 영향 (증거만).

## WP4 난이도

CLI 2단 파서+MCP=중하, surface 전환+Power mutation=중, composer 스코프=중상,
task형 완료 판정+session resume=상 (WP1 결과에 최민감). 전체 C3-상.
