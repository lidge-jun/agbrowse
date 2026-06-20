# web-ai GPT Code Mode — MVP/프로젝트 생성 자동화 계획

작성일: 2026-06-11. 갱신: JS-only 회수 경로 실측 완료. 상태: 계획 + 완전
무인 파이프라인 타당성 검증됨, 구현 미착수.

## 목적

ChatGPT 웹 세션을 "코드 생성 백엔드"로 써서 **MVP/프로젝트 구현물을
zip으로 받아 로컬에 회수**한다. 사용 시나리오:

```
agbrowse web-ai code --prompt "FastAPI+React 게시판 MVP, SQLite, Docker, zip으로" \
  --output ~/Developer/scaffold-out
→ ChatGPT가 컨테이너에서 코드 생성 → /mnt/data/*.zip → 로컬 회수 + 검증
```

ChatGPT는 `python`/`container.exec`로 `/mnt/data`에 파일 트리를 쓰고 zip으로
묶는다 (도구 스펙: `/Users/jun/Developer/tool/chatgpt_tool_full_spec_md/`
`05_python_and_container_runtime.md`). 우리는 그 산출물을 회수한다.

## 회수 경로 조사 결과 (2026-06-11 실측)

대상: 실제 대화 `c/6a298861-...` (ChatGPT가 `/mnt/data/example-todo-api.zip`
생성해 둔 상태). cli-jaw 공유 브라우저(로그인 세션 chatgpt.com) 사용.

### 경로 A — 버튼 클릭 (직전 계획)

- sandbox 링크는 `a[href]`가 아니라 **버튼**. snapshot → click → `~/Downloads`
  저장. **동작은 하나** 다운로드 경로 제어 불가(OS 다운로드 폴더 고정), 완료
  감지 어려움, 탭 경합에 취약.

### 경로 B — **JS-only 회수 (신규 발견, 권장)** ✅

버튼 없이 in-page fetch만으로 **완전 무인 회수 검증 완료**:

1. **세션 토큰**: `fetch('/api/auth/session')` → `accessToken` (Bearer).
   실측: `hasToken:true`, exp 2026-09-08 (장기 유효).
2. **sandbox 경로 자동 탐지**: `GET /backend-api/conversation/<id>` → `mapping`
   순회 → `execution_output` 메시지의 `/mnt/data/*.zip` 추출. 클릭/스냅샷 불필요.
   실측: `example-todo-api.zip` 경로 자동 추출됨.
3. **presigned URL 발급**:
   `GET /backend-api/conversation/<id>/interpreter/download?message_id=<mid>&sandbox_path=<path>`
   (Authorization: Bearer) → `{status:"success", download_url:"https://chatgpt.com/backend-api/estuary/content?...&sig=..."}`.
   실측: status 200, estuary presigned URL 수신.
4. **다운로드**: presigned URL은 **쿠키 필수** — 외부 `curl`(쿠키 없음)은 **403**.
   in-page `fetch(url, {credentials:'include'})`로 받아 arrayBuffer →
   base64 → 로컬 저장. 실측: 1,495B, `unzip -t` 에러 0, 4파일 전부 정상.

→ **결론: 경로 B로 클릭/다운로드폴더 의존 없이 회수 가능.** estuary URL이
쿠키 바운드라 회수의 마지막 단계는 반드시 **브라우저 컨텍스트 안**에서
실행해야 한다(외부 fetch 불가). 이게 설계의 핵심 제약.

### 경로 B를 막는 정책 한 가지

`agbrowse evaluate`는 **policy로 차단**("evaluate denied by policy",
`web-ai/policy/enforce.mjs` 계열). cli-jaw `browser evaluate`는 허용됨.
code mode는 in-page fetch가 필수이므로, web-ai 정책에 **code mode 전용
allow 플래그**(provider=chatgpt, backend-api 동일 출처 fetch + base64 회수
한정)를 추가하거나, cli-jaw browser evaluate 경로를 쓰도록 설계해야 한다.

## 설계 (경로 B 기반)

새 명령: `agbrowse web-ai code --prompt "<요구사항>" [--output <dir>] [--conv <id>] [--timeout-ms N] [--allow-inline]`

파이프라인:
1. **프롬프트 전송**: 요구사항 + 고정 지시문 — "코드베이스를 컨테이너에서
   생성해 단일 zip으로 `/mnt/data`에 저장하고, 파일 트리와 실행법을 함께
   출력하라. 완료되면 zip 경로를 한 줄로 명시하라." (기존 ask 폴링 재사용)
2. **완료 대기**: assistant 응답 + python tool 실행 완료까지 폴링.
3. **sandbox 경로 탐지**: 대화 JSON `mapping`에서 `execution_output`의
   `/mnt/data/*.zip` 추출 (경로 B-2). 복수면 최신 선택, 0개면
   `code_artifact_missing` (또는 `--allow-inline`이면 코드블록 회수).
4. **presigned URL**: interpreter/download 호출 (경로 B-3).
5. **in-page 회수**: 브라우저 컨텍스트 fetch+base64 → `<output>/<name>.zip`.
   세션 디렉터리 기본, `~/Downloads` 미오염 (경로 B-4).
6. **검증**: zip 무결성(`unzip -t` 또는 yauzl), 파일 목록 추출, 크기 기록.
7. **결과**: `{ ok, savedPath, files[], sizeBytes, convUrl, sandboxPath }` +
   answer-artifact 기록.

### 실패 모드 (fail-fast, silent fallback 금지)

| 모드 | 신호 | 처리 |
|---|---|---|
| zip 미생성 (인라인 코드만) | mapping에 /mnt/data zip 없음 | `code_artifact_missing`; `--allow-inline`로 코드블록 회수 옵션 |
| sandbox 만료 (컨테이너 재시작) | interpreter/download 404/만료 | `sandbox_expired` — **생성 직후 즉시 회수**가 원칙 |
| presigned 403 (쿠키 없는 회수) | 외부 fetch | 설계상 in-page 고정으로 회피 (실측 확인) |
| evaluate 정책 차단 | policy denied | code mode allow 플래그 (위 참조) |
| 토큰 만료 | session.accessToken 없음 | 기존 web-ai 세션 가드 |
| 탭 경합 | active tab 변동 | 전용 탭 targetId 고정 (runway 패턴) |

### 범위 제외

- 회수 코드 자동 실행/빌드 (보안 — 사용자 검토 후 수동)
- ChatGPT 외 provider (Gemini/Grok 컨테이너 표면 상이 — 후속)
- 대용량(수십 MB) zip의 base64 메모리 부담 — MVP 범위 밖, 청크 회수는 후속

## Phase 분할

- 10: 회수 프리미티브 — session token → conv JSON sandbox 탐지 →
  interpreter/download → in-page base64 fetch → zip 검증. 단위 테스트(모킹).
- 11: code prompt 템플릿 + ask 연동 + 완료 감지(python tool 종료).
- 12: `web-ai code` CLI 표면 + policy allow 플래그 + structure/commands.md +
  CAPABILITY_TRUTH_TABLE 행 추가.
- 13: e2e 스모크 (실제 대화로 작은 zip 1개 왕복) — provider DOM/endpoint drift 게이트.

## 검증된 엔드포인트 레퍼런스 (실측)

```
GET  /api/auth/session                              → { accessToken, user, expires }
GET  /backend-api/conversation/<conv_id>            → { mapping: { <mid>: {message:{content:{content_type, text|parts}}} } }
GET  /backend-api/conversation/<conv_id>/interpreter/download?message_id=<mid>&sandbox_path=/mnt/data/<f>.zip
                                                    → { status:"success", download_url:"https://chatgpt.com/backend-api/estuary/content?...&sig=..." }
GET  <download_url>  (쿠키 필수, 외부 403)          → zip 바이너리
```

## 참고

- 도구 스펙: /Users/jun/Developer/tool/chatgpt_tool_full_spec_md/ (00~09)
- 기존 web-ai 표면: `chatgpt-attachments.mjs`(업로드만),
  `chatgpt-images.mjs` `downloadGeneratedImages`(이미지 URL이 DOM 노출 시 fetch —
  estuary 쿠키 패턴은 유사하나 sandbox는 interpreter/download 선발급 필요),
  `answer-artifact.mjs`(회수 경로 기록처 재사용).
- 실측 대화: https://chatgpt.com/c/6a298861-3ecc-83a5-b03a-75f8c84e03cc
- 회수 산출물 검증: /tmp/js_path_inpage.zip (in-page fetch, 4파일, 무결성 OK)

## Phase 10 구현 결과 (2026-06-11)

- `web-ai/code-artifact.mjs` (195줄): `scanConversationForZip`(순수),
  `verifyZipBuffer`(무의존 EOCD 파서, 파일 목록 추출), `fetchConversationJson`,
  `mintDownloadUrl`, `fetchBinaryBase64`(청크 base64), `retrieveCodeArtifact`
  (오케스트레이터, mid 후보 순회, 단계별 reason — silent fallback 없음).
- 테스트: `test/unit/web-ai-code-artifact.test.mjs` 10케이스 (실제 zip 픽스처
  포함) — 전체 스위트 771/771, tsc(checkjs) 0, counts 60/drift 140 PASS.
- **라이브 e2e**: 실제 code-mode 대화(c/6a29932e)에 모듈 연결 →
  `{ok:true, files:[src/server.js, package.json, README.md], 967B}` 회수,
  `unzip -t` 0 에러. 순수 EOCD 파서의 파일 목록이 unzip과 일치.
- 다음: Phase 11 (code prompt 템플릿 + ask 연동), Phase 12 (CLI 표면 + policy
  allow + truth table).

## Phase 11–12 구현 결과 (2026-06-11)

- `web-ai/code-mode-prompt.mjs`: `buildCodeModePrompt`(검증된 strict 계약 +
  강화 규칙 코드화), `checkContractCompliance`(plain-path/bracket-wrap 판정).
- `web-ai/code-mode.mjs`: `codeWebAi` 오케스트레이터 (ChatGPT 전용 가드 →
  query → conversationId 해석 → retrieveCodeArtifact), `extractConversationId`.
- `web-ai/cli.mjs`: `code` 명령 배선 — COMMANDS/BROWSER_REQUIRED 등록,
  `--output-zip` 옵션, 새 탭 per-call, code 전용 human 출력(저장 경로+파일수),
  usage 텍스트.
- 테스트: code-artifact 10 + code-mode 6 + prompt 4 = 20 신규, 전체 781/781,
  tsc 0, drift 140/counts 60 PASS.
- **라이브 e2e (실제 CLI 명령)**: `agbrowse web-ai code --vendor chatgpt
  --model thinking --effort standard --prompt "Flask hello MVP" --output-zip ...`
  → `/tmp/cli-codemode/out.zip` 818B 저장, app.py/requirements.txt/README 3파일,
  `python3 ast.parse(app.py)` 통과. 버튼 클릭 0회, 완전 무인.
- 문서: CAPABILITY_TRUTH_TABLE에 code mode(beta) 행, commands.md에 `code` 행.
- 남은 것: Phase 13 (provider DOM/endpoint drift e2e 게이트), policy allow
  플래그는 cli-jaw browser evaluate가 아닌 agbrowse 자체 page.evaluate를 쓰므로
  현 구현에선 불필요(코드가 deps.getPage()로 직접 실행).

## 멀티 zip 패치 (2026-06-11)

질문: "zip 여러개 넣는것도 패치 가능한가?" → 가능, 구현 완료.

- `code-artifact.mjs`: `scanConversationForAllZips`(global regex로 모든
  /mnt/data/*.zip 수집, first-seen 순서) + `retrieveAllCodeArtifacts`(각 zip을
  basename으로 outputDir에 저장, per-artifact reason, 최소 1개 성공 시 ok) +
  공통 `downloadAndSaveZip` 헬퍼로 단일/멀티 회수 로직 통합.
- `code-mode-prompt.mjs`: `buildCodeModePrompt(spec, {multiZip})` —
  멀티 모드는 "논리적 산출물마다 이름있는 zip, 최종 응답은 경로 한 줄씩" 계약.
  단일 모드 계약은 그대로.
- `code-mode.mjs`: `input.multiZip`이면 retrieveAllCodeArtifacts + outputDir,
  partial-retrieval 경고. 단일 모드는 기존대로.
- `cli.mjs`: `--multi-zip`, `--output-dir` 옵션; human 출력이 artifacts 배열
  대응.
- 테스트: 멀티 스캔/회수 4 + 프롬프트 1 + 오케스트레이터 1 = 신규 6, 전체
  786/786, tsc 0, drift 140/counts 60.
- **라이브 e2e**: `agbrowse web-ai code --multi-zip --output-dir ...` →
  backend.zip(app.py+requirements+README, ast 통과) + frontend.zip(index.html,
  /api/ping 참조) 동시 생성·회수. 버튼 0회.
