# Code Mode 프롬프트 계약 + end-to-end 실측 (2026-06-11)

GPT(chatgpt, model=thinking, effort=standard)에게 도구 이름을 직접 물어
확정하고, strict 프롬프트로 실제 zip을 왕복 회수해 검증한 결과.

## GPT가 확정한 도구 사실 (thinking/standard 답변)

| 목적 | 도구 (recipient) | 보장 수준 |
|---|---|---|
| 쉘로 파일/zip 생성 | `container.exec` | /mnt/data 생성 시도 |
| Python으로 생성 | `python` / `python.exec` | /mnt/data 생성 시도 |
| 사용자 노출 Python | `python_user_visible.exec` | 출력/파일 노출 적합 |
| 세션 재시작 후 파일 유지 | — | **보장 불가 → 즉시 회수 필수** |

GPT 자기 진술 요지: "execution_output에 외부 자동화가 읽을 정확한 필드/경로가
찍히는 것은 **보장 못 함**. 후단에서 `/mnt/data/*.zip`을 glob 검사하고 1개가
아니면 실패 처리하는 설계가 안전하다." → 우리 설계와 일치.

## 검증된 strict 프롬프트 계약

`/tmp/codemode_prompt.txt` 형태로 전송 (model=thinking, effort=standard):

```
[CODE MODE — 자동화 파이프라인용]
목표: <프로젝트 요구사항>
빌드/패키징 계약 (반드시 준수):
- 모든 소스 파일을 먼저 /mnt/data/workdir 아래에 작성한다.
- 패키징 전에 기존 /mnt/data/*.zip 을 모두 삭제한다.
- container.exec 또는 python 으로 단 하나의 아카이브 /mnt/data/result.zip 생성.
- 다른 아카이브(result-v1.zip, source.zip 등) 절대 금지.
- find /mnt/data -maxdepth 1 -name "*.zip" 가 정확히 1개인지 검증.
- 최종 assistant 메시지는 오직 plain path 한 줄: /mnt/data/result.zip
- markdown/sandbox 링크/설명/인라인 코드 금지.
```

**실측 결과**: GPT가 `container.exec`로 bash 스크립트 실행 → `/mnt/data/result.zip`
1개 생성, 최종 메시지는 `["/mnt/data/result.zip"]` 한 줄. 계약 100% 준수.

## 탐지 로직 — 수정 1건 (중요)

처음 가정("execution_output text에 경로가 찍힌다")은 **틀림**. 실측에서:
- `container.exec` 결과 `execution_output`의 text는 **빈 문자열**.
- 경로는 **마지막 assistant text 메시지** (`["/mnt/data/result.zip"]`)에 있음.

→ **수정된 탐지**: conversation mapping 전체에서 각 메시지의 `content` JSON을
정규식 `/mnt/data/...\.zip`으로 스캔(assistant text·code·output 무관). 
interpreter/download의 `message_id`는 **code/execution_output 메시지 id 후보를
순회**하며 첫 성공(`download_url` 반환 + fetch ok)을 채택. 단일 mid 가정 금지.

## end-to-end 실측 (ping API MVP)

대화 `c/6a29932e-...` (model=thinking/standard, strict 계약):
1. 전송 → GPT가 `/mnt/data/result.zip` 한 줄 반환 ✅
2. mapping 스캔 → `zipPath=/mnt/data/result.zip` 자동 탐지 ✅
3. mid 후보 순회 → `df4ace2d` interpreter/download 200, estuary URL ✅
4. in-page credentialed fetch → 967B 회수, `unzip -t` 0 에러 ✅
5. 내용: package.json(express, type:module, start), src/server.js, README — 4파일.
   `node --check src/server.js` 통과 ✅ (실행 가능한 MVP)

## agbrowse web-ai 활용 방식 (확정)

전송 단계는 기존 명령 그대로:
```
agbrowse web-ai query --vendor chatgpt --model thinking --effort standard \
  --inline-only --timeout 600 --prompt "<strict code-mode 계약 + 요구사항>"
```
- ChatGPT effort 별칭: thinking은 light/standard/extended/heavy (**medium 없음** →
  "thinking medium" 요청은 standard로 매핑).
- 회수 단계는 web-ai에 없는 신규 기능 → Phase 10 (JS 회수 프리미티브).

## Phase 10 탐지/회수 의사코드 (확정본)

```
sendCodeModePrompt(reqs)            // query --model thinking --effort standard
→ pollUntilComplete()
→ conv = GET /backend-api/conversation/<id>
→ zipPath = scanMappingForMntDataZip(conv)        // assistant text 포함 전수 스캔
   if (!zipPath) → code_artifact_missing
→ for mid in [code/output mids]:                  // 단일 mid 가정 금지
     du = interpreter/download?message_id=mid&sandbox_path=zipPath
     if du.download_url:
        bytes = inPageFetch(du.download_url, {credentials:'include'})  // 쿠키 필수
        if ok: break
→ verifyZip(bytes) + extract fileList
→ save <output>/<name>.zip
```

## 대형 코드베이스 강화 규칙 (GPT thinking/standard 2차 답변)

30~50파일은 보통 단일 응답에 가능하나, 길어지면 중단/누락/계약위반 확률↑.
GPT가 확정한 강화 문구를 계약에 추가:

1. **중간 확인 금지**: "중간 확인 질문 금지. 불완전하더라도 현재 응답 안에서
   반드시 /mnt/data/workdir 작성 → result.zip 생성 → 검증까지 끝내라. 실패
   시에도 가능한 최소 완성본을 zip으로 만들어라."
2. **크기**: 공개된 정확한 한계는 없음(GPT 추측). 소스만이면 수 MB로 안전,
   node_modules·빌드·이미지 포함 시 수십~수백 MB로 생성/회수 안정성 저하.
   → 산출물 제외가 곧 크기 방어.
3. **산출물 제외 (효과적 문구)**: "zip에는 사람이 작성한 소스·설정·README만
   포함. `node_modules/ .venv/ venv/ dist/ build/ .next/ coverage/ .turbo/
   __pycache__/ .pytest_cache/ .git/` 및 캐시/빌드 산출물 절대 금지. 의존성은
   package.json·requirements.txt·pyproject.toml 등 매니페스트로만 표현."
4. **self-check 강제 (강한 표현)**: "zip 생성 후 반드시 `find /mnt/data
   -maxdepth 1 -name '*.zip' -print`를 실제 실행하라. 출력이 1개가 아니거나
   경로가 /mnt/data/result.zip이 아니면 모두 삭제하고 다시 생성하라. 이
   검증이 성공하기 전에는 최종 응답을 하지 말라." (GPT: self-check는 실행
   가능하나 도구 오류 후 건너뛸 수 있어 이 표현이 더 강제적)
5. **격리**: 대화가 길면 품질 저하 → **풀스택 1개당 새 대화로 격리** 권장.
   가장 안정적 조합 = "새 대화 + 단일 명세 + 단일 zip 계약 + 산출물 제외 +
   self-check". → code mode는 기본적으로 매 호출 새 대화(신규 conv) 사용.

## 최종 프롬프트 템플릿 (Phase 11에서 코드화)

```
[CODE MODE — 자동화 파이프라인. 아래 계약을 정확히 지켜라.]

목표: <요구사항>

빌드/패키징 계약:
- 모든 소스를 먼저 /mnt/data/workdir 아래에 작성한다.
- 패키징 전 기존 /mnt/data/*.zip 을 모두 삭제한다.
- container.exec 로 단 하나의 /mnt/data/result.zip 을 생성한다.
- zip에는 사람이 작성한 소스·설정·README만 포함. node_modules/ .venv/ venv/
  dist/ build/ .next/ coverage/ __pycache__/ .git/ 및 캐시/빌드 산출물 금지.
  의존성은 매니페스트(package.json 등)로만 표현.
- zip 생성 후 반드시 find /mnt/data -maxdepth 1 -name "*.zip" -print 를 실행.
  1개가 아니거나 경로가 /mnt/data/result.zip 이 아니면 모두 삭제 후 재생성.
  이 검증 성공 전에는 최종 응답 금지.
- 중간 확인 질문 금지. 현재 응답 안에서 작성→생성→검증까지 끝낸다.
- 최종 assistant 메시지는 오직 plain path 한 줄: /mnt/data/result.zip
  markdown/sandbox 링크/설명/인라인 코드 금지.
```

호출: `agbrowse web-ai query --vendor chatgpt --model thinking --effort standard
--inline-only --timeout 1200 --prompt "<위 템플릿>"` (대형은 timeout 상향).

## 참고

- 회수 산출물: /tmp/codemode_result.zip (ping API MVP, 4파일, node --check 통과)
- GPT 도구 확정 대화: c/6a2992f6-... (자동화 파이프라인 도구)
- code-mode 실측 대화: c/6a29932e-... (Node.js Express MVP)
- 대형 엣지케이스 Q&A: 위 MVP 대화의 follow-up (session 01KTS6DRZ7...)
