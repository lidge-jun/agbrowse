# 040 — WP5: 게이트 클로즈아웃과 인계

선행: WP2, WP3, WP4.

WP3가 두 후속 유닛의 로드맵을 확정하고 모든 경계를 배정한 뒤에 시작한다.
배정되지 않은 도달 가능 경계가 남아 있으면 시작하지 않는다.

## 게이트

이 유닛에서 코드를 바꾸는 것은 WP2뿐이다. WP3는 문서만 만든다.

순서대로 실행하고 각 출력을 이 문서에 기록한다.

```
# 새 테스트 (WP2만 — WP3는 문서 전용이라 테스트가 없다)
npx vitest run test/unit/web-ai-family-probe-and-mcp.test.mjs

# 변경 파일의 영향권 — WP2가 건드리는 모듈을 덮는 기존 스위트.
npx vitest run test/unit/web-ai-tool-schema.test.mjs \
               test/unit/web-ai-chatgpt-model.test.mjs \
               test/unit/web-ai-tool-validation.test.mjs \
               test/unit/web-ai-capability.test.mjs \
               test/unit/web-ai-timeout-default.test.mjs \
               test/integration/web-ai-cli-contract.test.mjs \
               test/integration/web-ai-policy-mcp.test.mjs \
               test/integration/web-ai-mcp-server.test.mjs

npm run typecheck
npm run fix:counts          # str_func.md 카운트 갱신
bash structure/verify-counts.sh
bash structure/check-doc-drift.sh
npm run gate:all
```

영향권 선정 근거: WP2가 바꾸는 것은 `web-ai/chatgpt-model.mjs` probe,
`web-ai/chatgpt.mjs:120` capability 정의, `web-ai/mcp-server.mjs` submit_prompt
분기다. `rg -l "web_ai_submit_prompt" test/`와
`rg -l "chatGptModelCapabilityProbe" test/`로 영향권을 골랐다.

WP3는 문서만 만들므로 게이트 대상이 아니다. 후속 두 유닛은 각자의 게이트를 갖는다.

`typecheck:checkjs` / `typecheck:checkjs-dom`은 `dev`에 선행 오류가 있으므로
파일별 오류 수를 변경 전후로 비교한다. 새 오류를 도입하지 않았음이 기준이지
전체 clean이 기준이 아니다.

전체 스위트(`npx vitest run test/unit test/integration test/e2e`)는 Playwright
Chromium이 설치된 경우에만 유효한 증거다. 미설치로 skip이 발생하면 그 사실을
그대로 기록하고 "전체 통과"라고 쓰지 않는다.

## 유닛 자체 마감

이 유닛도 종료되면 `_fin`으로 옮기고 index에서 `_plan` 행을 지운다.

```
git mv devlog/_plan/260731_pr89_issue_triage devlog/_fin/
```

MODIFY `devlog/00_index.md` — WP4가 만든 `_plan` 표에서 이 유닛 행을 제거:

```diff
 | Post-MVP gap close | `_plan/260705_gapclose/` | 🔧 Phase 10/20/30/40 구현 완료. 04·05·06·09는 PLANNED 잔존. |
-| PR #89 / 이슈 #87·#88 처리 | `_plan/260731_pr89_issue_triage/` | 🔧 진행 중 — 이 유닛. |
 | Strict migration | `_plan/strict-migration/` | ⏸ Deferred. 실행 소스는 여전히 `.mjs`, TS는 declaration만. |
```

그리고 Recent `_fin/` 표 맨 위에 행을 추가:

```diff
 | Topic | Path | Closeout signal |
 | --- | --- | --- |
+| PR #89 / 이슈 #87·#88 triage | `_fin/260731_pr89_issue_triage/` | #87 probe/MCP 갭 수정 + devlog 정리 + #88 경계 인벤토리. #88 방어는 후속 두 유닛으로 분할(`003_audit_synthesis.md`). |
 | QA round 6 | `_fin/260726_qa_round6/` | ... |
```

## 커밋

work-phase마다 하나씩, 로컬만.

```
WP1  docs(devlog): PR #89 / 이슈 #87·#88 처리 로드맵 유닛
WP2  fix(web-ai): make the model probe and MCP honor the requested chat family
WP3  docs(devlog): map every stall boundary and route it to a successor unit
WP4  docs(devlog): sync the index with the real _plan/_fin layout
WP5  docs(devlog): close out the PR #89 / issue triage unit
```

`git add`는 이 유닛이 만든 경로만 지정한다. `.codexclaw/**`의 기존 더티 파일과
미추적 goalplan 폴더는 사용자 것이므로 스테이징하지 않는다.

push는 하지 않는다(DEV-GIT-PUSH-01).

## 인계 (NEEDS_HUMAN)

이 유닛이 끝나도 원격에는 다음이 남는다. 모두 사용자 결정이 필요하다.

1. **PR #89 처분.** base가 `main`이라 머지해도 `dev`에 반영되지 않는다. dev에는
   #87 배선이 이미 있고, #88 방어는 후속 두 유닛에서 구현한다.
   선택지: (a) 기여를 인정하며 "dev에서 다르게 반영됨"으로 닫기, (b) `main`에
   머지한 뒤 dev와의 정합을 별도로 처리, (c) 기여자에게 dev 대상 재작성을 요청.
2. **이슈 #87 클로즈.** dev에 수정이 들어갔지만 릴리스 전이다. 클로즈 시점은
   사용자 판단이다.
   **이슈 #88은 열어 둔다** — 후속 두 유닛이 남아 있다. 인벤토리 결과를 이슈에
   코멘트로 남길지도 사용자가 정한다(원격 쓰기라 이 유닛에서 하지 않는다).
3. **dev↔main 정합.** `main`에 있고 `dev`에 없는 6커밋(v0.1.18/v0.1.19 릴리스,
   #82 fix, postinstall star prompt)은 이 유닛의 범위 밖이다.

## 남긴 후속

**후속 유닛 두 개가 이 goal 아래 남는다** — WP3의 7절이 그 로드맵을 쓴다.

| 유닛 | 범위 |
| --- | --- |
| `#88 DOM deadline 계약` | assistant DOM read · activity · finished · ordering · recovery |
| `artifact/finalizer hardening` | 이미지·파일 다운로드, 탭 lease, CDP 경계 |

이 유닛을 `_fin`으로 옮기는 것은 "#88 완료"가 아니라 "이 유닛 범위 완료"를
뜻한다. 두 후속 유닛이 끝나기 전에는 #88이 닫히지 않는다.

`readActivityState`의 **catch 경로**가 `{ strength: 'none' }`을 돌려준다
(`web-ai/chatgpt.mjs:1049`). 폴링 루프는 `'none'`을 quiet으로 읽어 완료 분기로
들어가므로(`:679-680`, `:710-728`), DOM 예외가 조용한 완료로 이어질 수 있다.

이것은 timeout이 아니라 **예외** 경로이므로 #88의 범위와 겹치되 원인이 다르다.
WP3 인벤토리의 3절(sentinel 소비자)이 이 항목을 판정하고, 같은 유닛에서 다룰지
분리할지 그때 결정한다 — 지금 "처리됨"으로도 "제외"로도 적지 않는다.

`web-ai/chatgpt-response-observer.mjs:78`의 `observeAssistantResponse`는 이미
`timeoutMs` 예산을 받는다(`web-ai/chatgpt.mjs:626`).

## 실패한 것 / 확인하지 못한 것 (LOOP-PESSIMIST-01)

구현 후 이 절에 기록한다:

- 검증하지 못한 가정
- 시도했다가 버린 접근
- 이 방향이 틀렸다는 것을 보여줄 증거
