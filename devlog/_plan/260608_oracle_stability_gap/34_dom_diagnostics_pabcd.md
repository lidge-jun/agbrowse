# 34 — DOM Diagnostics & Failure Artifacts PABCD

Date: 2026-06-24 (agbrowse v0.1.15)
Status: PABCD plan — **impl-ready** (코드-진실 확인 완료)
Parent: [06_dom_diagnostics.md](06_dom_diagnostics.md) · Sibling: [31](31_chatgpt_downloadable_artifacts_pabcd.md) / [32](32_deep_research_session_followup_pabcd.md) / [33](33_response_capture_dualpath_pabcd.md)

## 2026-06-24 재감사 (v0.1.15)

`06_dom_diagnostics.md`의 핵심 gap이 코드 대조로 확인됨 — **자동화 실패 시점의 자동 DOM/스크린샷 캡처 부재**:

- `logDomFailure`/`captureBrowserDiagnostics` 등가물 → `web-ai/` **0 hits**.
- `captureScreenshot`/`Page.captureScreenshot` → `web-ai/` **0 hits**. web-ai의 "screenshot"은 액션 디스크립터(`web-ai/action-breadth.mjs:44`) · `browser_screenshot` MCP 스키마(`web-ai/browser-tool-schema.mjs:106`) · observation-bundle 입력 필드(`web-ai/observation-bundle.mjs:105`)뿐이고, 실제 캡처는 CLI 래퍼(`skills/browser/browser.mjs`의 `screenshotAction()` `:1389` → locator/`page.screenshot` 호출 `:1406-1411`; `case 'screenshot'` 디스패치 `:2533`)에서만 수행. **실패 시 자동 호출 경로 없음**.
- 실패 컨텍스트는 `WebAiError.evidence`(`web-ai/errors.mjs:78`, + `errorCode` `:66`/`stage` `:68`)로 일부만 기록.
- 이미 존재(재활용 대상): per-session artifacts dir `resolveArtifactsDir(sessionId)`(`web-ai/session-artifacts.mjs:39`) + `saveImageArtifact`/`trySaveImageArtifact`(`:144`,`:168`) 패턴, CDP 접근 `deps.getCdpSession?.()`(`web-ai/chatgpt.mjs:214,427`).
- 별개 기능(있음, 자동 아님): 사용자 호출형 `doctor`/`sessions doctor`(`web-ai/cli.mjs:48,54-55,738,783`), `web-ai/doctor.mjs:diagnoseFeature()`, `web-ai/session-doctor.mjs`(read-only 세션 리포트).

## Purpose

Oracle는 모든 자동화 실패 지점에서 `logDomFailure()`를 호출하고, 세션이 있으면 `captureBrowserDiagnostics()`로 **DOM snapshot(JSON) + screenshot(PNG)**를 per-session 디렉터리에 저장한다(`06` 원본 참조, `domDebug.ts`). agbrowse는 실패 시 로그/`evidence`만 남겨 재현이 필요하다. 이 계획은 **verbose-gated**로 주요 실패 지점에서 conversation turn snapshot + (가능 시) screenshot을 기존 `session-artifacts.mjs` 경로에 자동 저장한다. 성능 영향 최소화를 위해 기본 비활성, opt-in.

## Priority Map

| ID | Priority | Outcome |
| --- | --- | --- |
| 34.1 | P2 | `captureFailureDiagnostics()` 모듈 — conversation turn snapshot(JSON) + 메타 |
| 34.2 | P2 | 실패 시 CDP screenshot(PNG) 저장(가능할 때), `session-artifacts.mjs`에 `kind:'diagnostics'` |
| 34.3 | P2 | 주요 실패 지점 hook(verbose-gated): composer focus/commit, response capture, attachment signal |
| 34.4 | P3 | `--diagnostics`/env 게이트 + 문서화 |

## P — Plan

### Part 1 — Easy Explanation

자동화가 실패하면(전송 버튼 못 찾음, 응답 캡처 timeout, 업로드 칩 안 뜸 등) 그 순간의 화면 상태를 자동으로 저장한다. 최근 대화 turn 몇 개의 역할/텍스트/testid를 JSON으로, 그리고 가능하면 PNG 스크린샷을 세션 폴더에 남긴다. 이러면 나중에 재현 없이 원인을 본다. 기본은 꺼져 있고 `--diagnostics`(또는 verbose)일 때만 동작해 정상 경로 성능에 영향이 없다.

### Part 2 — Diff-level Precision

#### NEW `web-ai/failure-diagnostics.mjs`

`web-ai/chatgpt.mjs`(973 lines)·`session-artifacts.mjs`를 과도하게 키우지 말 것. 신규 모듈.

Exports:

```js
// 최근 N개 turn의 role/text(앞 N자)/testid를 읽는 순수-ish DOM 리더.
export async function readConversationSnapshot(page, { turns = 6, maxChars = 2000 } = {}) {}

// 실패 시 진단 번들 저장. CDP 있으면 screenshot 포함. 절대 throw 안 함(진단이 본 에러를 덮지 않게).
// 반환: { saved: true, domPath, screenshotPath } | { saved: false, reason }
export async function captureFailureDiagnostics(deps, { sessionId, context, page }) {}

// verbose/diagnostics 게이트 판정(순수).
export function diagnosticsEnabled(input, env) {}
```

Required behavior:

- `readConversationSnapshot`는 `chatgpt.mjs`의 conversation/turn 셀렉터를 **재사용**(중복 정의 금지 — 필요한 셀렉터 export). `{ url, title, turns:[{role,text,testid}], bodyText(앞 5000자) }` 형태.
- `captureFailureDiagnostics`는:
  - `diagnosticsEnabled()` false면 즉시 no-op(`{saved:false, reason:'disabled'}`).
  - `sessionId` 없으면 로그만, 파일 저장 skip.
  - `deps.getCdpSession?.()` 가능하면 `Page.captureScreenshot({ format:'png', captureBeyondViewport:true })` → PNG 저장. 불가하면 DOM snapshot만.
  - **절대 throw 금지** — 모든 내부 에러는 흡수하고 `{saved:false, reason}` 반환(진단 실패가 원래 자동화 에러를 가리면 안 됨).
- `diagnosticsEnabled`는 `input.diagnostics === true || input.verbose === true || env.AGBROWSE_DIAGNOSTICS === '1'`.

#### MODIFY `web-ai/session-artifacts.mjs`

기존 `saveImageArtifact`(`:144`) 패턴을 그대로 따른다.

Before:

```js
 * @property {'transcript'|'report'|'image'} kind
```

After (33/31과 합류 시 `'file'`도 함께):

```js
 * @property {'transcript'|'report'|'image'|'diagnostics'} kind
```

Add:

```js
export function saveDiagnosticsArtifact(sessionId, { context, domJson, screenshotBuffer }) {}
export function trySaveDiagnosticsArtifact(sessionId, diag) {}
```

Rules:

- `resolveArtifactsDir(sessionId)`(`:39`) 재사용.
- 파일명 stem은 image artifact와 동일한 path-traversal 보호 적용; `context`를 안전한 slug로.
- `appendArtifactRecord()` dedupe는 `(kind, path)` 유지; `diagnostics`는 `image`와 별개 카운트.
- `transcript`/`report`/`image` 동작 byte 단위 보존.
- 저장 실패 시 `stage:'artifact-diagnostics'` 반환(throw 아님).

#### MODIFY 실패 지점 hook (verbose-gated)

다음 지점에서 throw 직전 `captureFailureDiagnostics(deps, { sessionId, context, page })`를 **best-effort** 호출(await하되 실패 무시):

- `web-ai/chatgpt-composer.mjs`: send 버튼 못 찾음/commit 실패 — `context:'composer-commit'`.
- `web-ai/chatgpt.mjs`: `pollWebAi` deadline timeout 직전 — `context:'response-timeout'`(33의 3차 복구 실패 후).
- `web-ai/chatgpt-attachments.mjs`: chip readiness 실패 — `context:'attachment-signal'`.

Rules:

- hook은 **게이트가 켜졌을 때만** 비용 발생(`diagnosticsEnabled` 먼저 체크).
- 진단 호출은 원래 `WebAiError`를 **변경/지연 최소화** — 캡처 후 동일 에러 throw.
- `WebAiError.evidence`에 `{ diagnosticsPath }` 추가(저장됐을 때).

#### MODIFY `web-ai/cli.mjs`

- `--diagnostics` 플래그 파싱(기본 false) → `input.diagnostics`로 전달.
- `sessions show` 진단 아티팩트 descriptor 렌더(기존 artifacts 표시에 `kind:'diagnostics'` 추가 — 최소 텍스트).

#### NEW `test/unit/web-ai-failure-diagnostics.test.mjs`

- `diagnosticsEnabled`: flag/verbose/env 조합 전부.
- `readConversationSnapshot`: fake page에서 turns/maxChars 절단, testid 추출.
- `captureFailureDiagnostics`: CDP 없을 때 DOM-only 저장, CDP 있을 때 screenshot 포함, 내부 에러 흡수(throw 안 함), disabled no-op.

#### MODIFY `test/unit/web-ai-session-artifacts.test.mjs`

- `trySaveDiagnosticsArtifact()` 성공/`artifact-diagnostics` 실패.
- `appendArtifactRecord()`가 `diagnostics`를 `image`와 별개로 dedupe.

## A — Plan Audit Checklist

- 진단 캡처가 **정상 경로 성능에 영향 없음**(게이트 off 시 no-op 증명).
- `captureFailureDiagnostics`가 **절대 throw 안 함** — 원래 자동화 에러를 가리지 않음.
- 아티팩트가 `BROWSER_AGENT_HOME/sessions/<session>/artifacts` 밖으로 나가지 못함(path traversal 보호).
- `session-artifacts.mjs`가 추가 후에도 500 lines 이내(초과 시 split).
- 셀렉터 중복 정의 없음(`chatgpt.mjs`에서 공유).
- 사용자 호출형 `doctor`/`session-doctor` 동작과 충돌/중복 없음.

## B — Build Slices

1. `failure-diagnostics.mjs` 순수 게이트 + `readConversationSnapshot` + 테스트.
2. `captureFailureDiagnostics`(DOM-only) + `saveDiagnosticsArtifact` + 테스트.
3. CDP screenshot 경로 추가(가능 시) + 흡수 동작 테스트.
4. 실패 지점 hook 3곳(verbose-gated) 연결.
5. `--diagnostics` 플래그 + `sessions show` 렌더.
6. release gates + 타깃 테스트.

## C — Check

Minimum:

```bash
npx vitest run test/unit/web-ai-failure-diagnostics.test.mjs test/unit/web-ai-session-artifacts.test.mjs
npm run test:release-gates
git diff --check
```

CLI help/플래그 표면이 바뀌면:

```bash
npm run gate:all
```

라이브 검증(수동): 의도적 실패(잘못된 셀렉터/timeout 단축) 주입 후 `--diagnostics`로 PNG+JSON 생성 확인.

## D — Done Criteria

- 주요 실패 지점에서 verbose-gated DOM snapshot(+가능 시 screenshot)이 per-session 아티팩트로 자동 저장.
- 진단 캡처가 원래 에러를 가리거나 정상 경로를 느리게 하지 않는다.
- 아티팩트 디렉터리 이탈 불가.
- 신규 동작 단위 테스트 커버; 라이브 항목은 수동 프로토콜 명시.
- `structure/str_func.md` count snapshot 갱신, `bash structure/verify-counts.sh` 통과.
