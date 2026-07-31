# 040 — WP5: 게이트 클로즈아웃과 인계

선행: WP2, WP3, WP4.

## 게이트

순서대로 실행하고 각 출력을 이 문서에 기록한다.

```
# 새 테스트
npx vitest run test/unit/web-ai-assistant-read-deadline.test.mjs \
               test/unit/web-ai-family-probe-and-mcp.test.mjs

# 변경 파일의 영향권 — WP2/WP3가 건드리는 모듈을 덮는 기존 스위트.
# response-observer와 activity-poll은 recovery/activity 방어 때문에 필수다.
npx vitest run test/unit/web-ai-tool-schema.test.mjs \
               test/unit/web-ai-chatgpt-model.test.mjs \
               test/unit/web-ai-provider-session.test.mjs \
               test/unit/web-ai-chatgpt-activity-poll.test.mjs \
               test/unit/web-ai-timeout-default.test.mjs \
               test/integration/web-ai-cli-contract.test.mjs \
               test/integration/web-ai-fake-chatgpt.test.mjs

npm run typecheck
npm run fix:counts          # str_func.md 카운트 갱신
bash structure/verify-counts.sh
bash structure/check-doc-drift.sh
npm run gate:all
```

영향권 선정 근거: WP2는 `web-ai/chatgpt-model.mjs`, `web-ai/chatgpt.mjs`,
`web-ai/mcp-server.mjs`를 바꾸고, WP3는 `web-ai/chatgpt.mjs`,
`web-ai/chatgpt-response-dom.mjs`, `web-ai/chatgpt-response-observer.mjs`를 바꾼다.
`rg -l "pollWebAi" test/`로 폴링 하네스를 가진 스위트를 찾아 위 목록에 넣었다.
page double 계약이 바뀌므로 `web-ai-provider-session`이 특히 중요하다.

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
+| PR #89 / 이슈 #87·#88 triage | `_fin/260731_pr89_issue_triage/` | `040_wp5_closeout.md`에 게이트 출력과 인계 사항 기록. dev에 #87 probe/MCP 갭과 #88 read deadline 방어 반영. |
 | QA round 6 | `_fin/260726_qa_round6/` | ... |
```

## 커밋

work-phase마다 하나씩, 로컬만.

```
WP1  docs(devlog): PR #89 / 이슈 #87·#88 처리 로드맵 유닛
WP2  fix(web-ai): make the model probe and MCP honor the requested chat family
WP3  fix(web-ai): bound assistant DOM reads by the polling deadline
WP4  docs(devlog): sync the index with the real _plan/_fin layout
WP5  docs(devlog): close out the PR #89 / issue triage unit
```

`git add`는 이 유닛이 만든 경로만 지정한다. `.codexclaw/**`의 기존 더티 파일과
미추적 goalplan 폴더는 사용자 것이므로 스테이징하지 않는다.

push는 하지 않는다(DEV-GIT-PUSH-01).

## 인계 (NEEDS_HUMAN)

이 유닛이 끝나도 원격에는 다음이 남는다. 모두 사용자 결정이 필요하다.

1. **PR #89 처분.** base가 `main`이라 머지해도 `dev`에 반영되지 않는다. dev에는
   #87 배선이 이미 있고, #88 방어는 이 유닛이 dev 구조에 맞춰 다시 구현했다.
   선택지: (a) 기여를 인정하며 "dev에서 다르게 반영됨"으로 닫기, (b) `main`에
   머지한 뒤 dev와의 정합을 별도로 처리, (c) 기여자에게 dev 대상 재작성을 요청.
2. **이슈 #87 / #88 클로즈.** dev에 수정이 들어갔지만 릴리스 전이다. 클로즈
   시점을 릴리스에 맞출지 지금 닫을지는 사용자 판단이다.
3. **dev↔main 정합.** `main`에 있고 `dev`에 없는 6커밋(v0.1.18/v0.1.19 릴리스,
   #82 fix, postinstall star prompt)은 이 유닛의 범위 밖이다.

## 남긴 후속

`readActivityState`의 **catch 경로**가 `{ strength: 'none' }`을 돌려준다
(`web-ai/chatgpt.mjs:1048-1049`). 폴링 루프는 `'none'`을 quiet으로 읽어 완료 분기로
들어가므로(`:679-680`, `:709-728`), DOM 예외가 조용한 완료로 이어질 수 있다.

이번 유닛은 **timeout** 경로만 `'unknown'`으로 고쳤다. catch 경로까지 바꾸면
평범한 네비게이션 중 예외가 폴링을 늘리는 회귀 위험이 있어 분리했다. 별도 유닛의
대상이다 — 근거 없이 "처리됨"으로 적지 않는다.

`web-ai/chatgpt-response-observer.mjs:81`의 `observeAssistantResponse`는 이미
`timeoutMs` 예산을 받으므로(`web-ai/chatgpt.mjs:624-627`) 이번 범위에서 제외했다.

## 실패한 것 / 확인하지 못한 것 (LOOP-PESSIMIST-01)

구현 후 이 절에 기록한다:

- 검증하지 못한 가정
- 시도했다가 버린 접근
- 이 방향이 틀렸다는 것을 보여줄 증거
