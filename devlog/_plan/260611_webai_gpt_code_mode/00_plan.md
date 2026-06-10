# web-ai GPT Code Mode — 계획 (artifact zip 회수 파이프라인)

작성일: 2026-06-11. 상태: 계획 + 타당성 실측 완료, 구현 미착수.

## 배경

ChatGPT 웹 세션은 컨테이너 도구(`python`, `container.exec`)로 코드베이스를
생성하고 `/mnt/data`에 zip으로 묶어 `sandbox:/mnt/data/<file>` 링크로 제공할
수 있다 (도구 표면 전문: `/Users/jun/Developer/tool/chatgpt_tool_full_spec_md/`,
특히 `04_files_and_artifacts.md`, `05_python_and_container_runtime.md`).
이를 web-ai 파이프라인으로 받아내면 "GPT에게 코드베이스 생성 → 로컬 회수 →
검증"이 자동화된다 — **GPT Code Mode**.

## 타당성 실측 (2026-06-11, 현재 로직)

대상: 실제 대화 `https://chatgpt.com/c/6a298861-3ecc-83a5-b03a-75f8c84e03cc`
(ChatGPT가 `example-todo-api.zip` 생성해 둔 상태).

| 검증 항목 | 결과 |
|---|---|
| sandbox 링크 DOM 형태 | **앵커가 아니라 버튼** (`button "example-todo-api.zip 다운로드"`). `a[href]` 없음 — JS가 presigned URL을 받아 다운로드 트리거 |
| agbrowse 탭 전환 → `click e316` | ✅ `~/Downloads/example-todo-api.zip` (1,495B) 저장됨 |
| 무결성 | ✅ `unzip -t` 에러 0, 3파일 (package.json, README, src/server.js — 실행 가능한 Express 코드) |
| 로그인 세션 | agbrowse Chrome(9222) 프로필이 chatgpt.com 로그인 유지 |
| cli-jaw 공유 브라우저(9244) 경유 | ⚠️ 직원 dispatch들과 **탭 경합** — click 직후 active tab이 직원 검색 탭으로 바뀜. code mode는 agbrowse 분리 인스턴스/전용 탭 고정 필요 |

결론: **현재 로직(스냅샷 → 버튼 클릭)으로 다운로드 자체는 이미 가능**. 부족한
것은 (1) 다운로드 디렉터리 제어, (2) 완료 감지/무결성 검증, (3) prompt→버튼
탐지→회수를 잇는 CLI 표면.

## 현재 web-ai 표면과의 간극

- `chatgpt-attachments.mjs` — **업로드만** (preflight + attach)
- `chatgpt-images.mjs` `downloadGeneratedImages` — 생성 이미지 한정.
  `Network.getCookies` → cookie 헤더 fetch 패턴. **URL이 DOM에 노출될 때만
  유효** — sandbox zip은 버튼 트리거라 이 패턴 그대로는 못 씀
- `answer-artifact.mjs` — 답변 아티팩트 기록 (다운로드 파일 경로 기록처로 재사용 가능)

## 설계

새 명령: `agbrowse web-ai code --prompt "<요구사항>" [--output <dir>] [--timeout-ms N]`

1. **Prompt 템플릿**: 요구사항 + 고정 지시문 — "코드베이스를 작성해 zip으로
   묶고 sandbox 다운로드 링크로 제공하라. 파일 구조와 실행 방법을 함께 출력하라."
2. **응답 대기**: 기존 ask 폴링 재사용. 완료 후 메시지에서 다운로드 버튼 탐지
   (텍스트 `.zip` + 다운로드 의미 버튼; provider DOM drift 대비 selector는
   chatgpt.mjs의 기존 selector 상수 옆에 정의).
3. **다운로드 캡처**: CDP `Browser.setDownloadBehavior { behavior: 'allow',
   downloadPath: <세션별 outputPath> }` 설정 후 버튼 클릭 →
   `Browser.downloadProgress` 이벤트(또는 파일 폴링)로 완료 감지.
   ~/Downloads 오염 방지를 위해 세션 디렉터리 고정이 기본.
4. **검증**: zip이면 `unzip -t` (또는 yauzl 파싱) 0 에러 확인, 파일 목록 추출.
5. **결과**: `{ ok, savedPath, files[], sizeBytes, conversationUrl }` JSON 반환
   + answer-artifact 기록.

### 실패 모드 (fail-fast, silent fallback 금지)

| 모드 | 처리 |
|---|---|
| 버튼 미등장 (코드를 인라인으로만 출력) | `code_artifact_missing` 보고 — 본문 코드블록 회수는 별도 옵션(`--allow-inline`) |
| sandbox 링크 만료 (컨테이너 재시작) | 클릭 후 다운로드 미발생 타임아웃 → `sandbox_expired` 보고. **생성 직후 즉시 회수**가 운영 원칙 |
| 로그인 만료 | 기존 web-ai 세션 가드 그대로 |
| 탭 경합 | code mode는 전용 탭 targetId 고정 (runway 패턴 재사용) |

### 범위 제외

- 다운로드한 코드의 자동 실행/빌드 (보안 — 사용자 검토 후 수동)
- ChatGPT 외 provider (Gemini/Grok 컨테이너 표면 상이 — 후속 조사)

## Phase 분할 (구현 시)

- 10: 다운로드 캡처 프리미티브 (`setDownloadBehavior` + 완료 감지 + zip 검증) + 단위 테스트
- 11: 버튼 탐지 selector + code prompt 템플릿 + ask 연동
- 12: `web-ai code` CLI 표면 + structure/commands.md + truth table 갱신
- 13: cli-jaw 쪽은 web-ai가 agbrowse로 이관된 구조이므로 미러 불필요 —
  CAPABILITY_TRUTH_TABLE에 code mode 행만 추가

## 참고

- 도구 스펙 전문: /Users/jun/Developer/tool/chatgpt_tool_full_spec_md/ (00~09)
- ChatGPT 쪽 핵심 도구: `python` (컨테이너 파일 생성), `container.exec`,
  `container.download`, sandbox 링크 규약 `sandbox:/mnt/data/<file>`
- 실측 원본 대화: https://chatgpt.com/c/6a298861-3ecc-83a5-b03a-75f8c84e03cc
