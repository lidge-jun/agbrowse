# 06 — DOM Diagnostics & Debug Artifacts

Severity: **P2** — 🟡 **OPEN** (2026-06-24 re-audit, agbrowse v0.1.15)

## 2026-06-24 Re-audit (v0.1.15)

이 문서의 2026-06-08 분석은 agbrowse v0.1.7 기준. v0.1.15에서도 **자동화 실패 시점의 자동 DOM/스크린샷 캡처는 여전히 미구현(OPEN)**. 다만 별도의 *사용자 호출형* 진단 표면이 새로 생겼다.

| Gap (2026-06-08, v0.1.7) | 현재 상태 (v0.1.15) | 증거 |
| --- | --- | --- |
| 실패 시 자동 DOM snapshot | 🟡 미구현 | `web-ai/` 전역에 `logDomFailure`/`captureBrowserDiagnostics` 등가물 0건 (grep) |
| 실패 시 자동 screenshot | 🟡 미구현 | `web-ai/`에 `captureScreenshot`/`Page.captureScreenshot` 0건. web-ai는 `screenshot` **액션 디스크립터**(`action-breadth.mjs:44`) · `browser_screenshot` MCP 스키마(`browser-tool-schema.mjs:106`) · observation-bundle의 `screenshotPath` 입력 필드(`observation-bundle.mjs:105`)만 가지며, 실제 캡처는 CLI 래퍼(`skills/browser/browser.mjs`의 `screenshotAction()` `:1389`, `case 'screenshot'` 디스패치 `:2533`)에서 수행 — web-ai 자동화 실패 시 자동 캡처 경로는 없음 |
| Conversation turn 로그 | 🟡 미구현 | 실패 경로는 `WebAiError.evidence` 일부 컨텍스트만 기록 |
| per-session artifacts 미활용 | 🟡 부분 | `web-ai/session-artifacts.mjs` 존재하나 실패-시점 진단 자동 저장 경로 없음 |
| (신규) 진단 명령 표면 | ✅ 추가됨(별개 기능) | `web-ai/doctor.mjs:diagnoseFeature()`, `web-ai/session-doctor.mjs`(read-only 세션 리포트), CLI `doctor` / `sessions doctor`(`web-ai/cli.mjs:48,54-55,738,783`) — **사용자 호출형**, 실패 시 자동 트리거 아님 |

**잔여 gap(P2)**: 주요 실패 지점(composer focus/commit, response capture, attachment signal)에서 verbose-gated DOM turn 캡처 + screenshot 자동 저장을 `session-artifacts.mjs` 경로로 통합. oracle `domDebug.ts`의 `logDomFailure`/`captureBrowserDiagnostics` 패턴 참조.

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse에서 전송 실패나 응답 캡처 실패 시, 원인을 파악하려면 재현이 필요하다.
oracle은 실패 시점의 DOM 상태와 스크린샷을 자동 저장한다.

## Oracle Approach

### 1. logDomFailure (domDebug.ts:37-48)
모든 자동화 실패 지점에서 호출:
```typescript
export async function logDomFailure(Runtime, logger, context: string) {
    if (!logger?.verbose) return;
    logger(`Browser automation failure (${context}); capturing DOM snapshot...`);
    await logConversationSnapshot(Runtime, logger);
}
```

호출 위치:
- `promptComposer.ts`: focus 실패, prompt commit 실패, prompt too large
- `assistantResponse.ts`: 응답 캡처 실패, copy markdown 실패
- `attachments.ts`: 업로드 시그널 실패

### 2. Conversation Snapshot (domDebug.ts:19-32)
```typescript
// 최근 3개 turn의 role, text(200자), testid를 로그에 기록
const turns = Array.from(document.querySelectorAll(CONVERSATION_SELECTOR));
return turns.map((node) => ({
    role: node.getAttribute('data-message-author-role'),
    text: node.innerText?.slice(0, 200),
    testid: node.getAttribute('data-testid'),
}));
```

### 3. captureBrowserDiagnostics (domDebug.ts:50-100)
세션 ID가 있을 때 파일로 저장:
```typescript
export async function captureBrowserDiagnostics(Runtime, logger, context, options) {
    const dir = resolveSessionArtifactsDir(options.sessionId);
    // DOM snapshot → JSON 파일
    // { url, title, turns(last 6, 2000chars each), bodyText(5000chars) }
    await fs.writeFile(domPath, JSON.stringify(result, null, 2));
    // Screenshot → PNG 파일 (Page.captureScreenshot)
    const screenshot = await Page.captureScreenshot({ format: "png", captureBeyondViewport: true });
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
}
```

## agbrowse Current State

### 1. Error Logging
`WebAiError`에 `evidence` 필드로 일부 컨텍스트 저장.
`--json` 출력 시 에러 객체에 포함됨.

### 2. DOM Snapshot
없음. 실패 시 DOM 상태를 캡처하지 않음.

### 3. Screenshot on Failure
없음. `screenshot` 명령은 있으나 자동화 실패 시 자동 캡처하지 않음.

### 4. Session Artifacts
`session-artifacts.mjs` 존재하나, 실패 시 자동 저장은 미구현.

## Gap Summary

| Feature | oracle | agbrowse | Gap |
|---------|--------|----------|-----|
| Auto DOM snapshot on failure | ✅ JSON 파일 | ❌ | **P2** |
| Auto screenshot on failure | ✅ PNG 파일 | ❌ | **P2** |
| Conversation turn log | ✅ last 6 turns | ❌ | **누락** |
| Artifacts directory | ✅ per-session | 존재하나 미활용 | **약함** |
| Verbose mode gating | ✅ logger.verbose | ❌ | **누락** |

## Recommended Patches

1. **[다음]** 주요 실패 지점에서 DOM snapshot 자동 캡처 (conversation turns + body text)
2. **[다음]** 실패 시 screenshot 자동 저장 (CDP `Page.captureScreenshot`)
3. **[중기]** `session-artifacts.mjs`에 진단 데이터 저장 경로 통합
4. **[중기]** `--verbose` 모드에서만 진단 캡처 (성능 영향 최소화)
