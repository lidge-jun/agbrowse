# 04 — Session Reattach / Resume

Severity: **P1** — 🟡 **PARTIAL** (reattach/resume 구현됨; sidebar·DR-reattach만 OPEN; 2026-06-24 재감사)

## 2026-06-24 Re-audit (v0.1.15)

이 문서의 2026-06-08 분석은 "CDP 재연결/진행 중 응답 캡처 미지원"이라 했으나 둘 다 구현됨.

| 항목 (2026-06-08, v0.1.7) | 현재 상태 (v0.1.15) | 증거 |
| --- | --- | --- |
| CDP 재연결 (기존 탭) | ✅ 해소 | `agbrowse web-ai sessions reattach <id>` → `resolveSessionPage`로 영속 탭 복원, `status: 'reattached'`/`'reattach-mismatch'` (`cli-sessions.mjs:114`) |
| 진행 중 응답 캡처 | ✅ 해소 | `agbrowse web-ai sessions resume <id>` → 저장 세션에 `pollWebAi` 재실행 (`cli-sessions.mjs:91`) |
| SIGINT 시 Chrome 유지 | 🟢 대체로 무의미 | web-ai는 Chrome을 소유하지 않고 CDP(기본 9222)로 **이미 실행 중인** Chrome에 연결. 따라서 web-ai 프로세스 종료가 Chrome을 죽이지 않음. `grep process.on(SIG → 0 hits`이지만 connect-over-CDP 모델 + `resume`/`reattach`로 in-flight 보호가 사실상 제공됨. |
| Sidebar 대화 검색 복구 | ❌ **OPEN** | `openConversationFromSidebar` → 0 hits |
| Deep Research reattach | ❌ **OPEN** | `chatgpt-deep-research.mjs`에 resume/reattach 경로 없음 (`researchMode:'deep'`만 영속) |

남은 구현 대상(OPEN, jawdev 후보): sidebar conversationId 검색-열기, Deep Research 세션 reattach.

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse는 프로세스 종료 후 진행 중인 ChatGPT Pro 세션에 재접속하는 기능이 없다.
Pro 모드는 응답에 2-10분 걸릴 수 있어, CLI가 죽거나 OS sleep 되면 결과를 잃는다.

## Oracle Approach

### 1. Signal Handler + In-Flight 보호 (chromeLifecycle.ts:60-130)
```typescript
const handleSignal = (signal: NodeJS.Signals) => {
    const inFlight = opts?.isInFlight?.() ?? false;
    const leaveRunning = keepBrowser || inFlight;
    if (leaveRunning) {
        // Chrome을 죽이지 않고 reattach hint만 저장
        await opts?.emitRuntimeHint?.();
        logger('Session still in flight; reattach with "oracle session <slug>"');
    } else {
        await chrome.kill();
    }
};
```

### 2. Reattach Flow (reattach.ts)
```
1. Runtime hint에서 chromePort / browserWSEndpoint 읽기
2. listRemoteChromeTargets()로 살아있는 탭 찾기
3. pickTarget()으로 대화 탭 선택
4. CDP 재연결 (Runtime/DOM/Page enable)
5. 대화가 열려있는지 확인 → 없으면 sidebar에서 검색
6. waitForAssistantResponse()로 진행 중인 응답 캡처
7. captureAssistantMarkdown()으로 최종 텍스트 추출
```

### 3. Conversation Recovery
```typescript
// sidebar에서 대화를 찾아 열기 (retry 포함)
const opened = await openConversationFromSidebarWithRetry(
    Runtime,
    { conversationId, preferProjects: true, promptPreview },
    15_000,
);
```

### 4. Deep Research Reattach
Deep Research 모드도 reattach 지원:
```typescript
if (config?.researchMode === "deep") {
    const researchResult = await waitForDeepResearch(Runtime, logger, timeoutMs, ...);
    return { answerText: researchResult.text, ... };
}
```

## agbrowse Current State

### 1. Session Persistence
`session-store.mjs`에 세션 데이터 저장 (sessionId, url, promptHash 등).
`--session <id>` 플래그로 이전 세션 참조 가능.

### 2. Session Resume
`session.mjs`에서 기본적인 세션 관리는 있으나:
- **프로세스 종료 시 Chrome 유지**: 미지원
- **CDP 재연결**: 미지원 (새 탭/새 대화만)
- **진행 중 응답 캡처**: 미지원
- **Sidebar 검색으로 대화 복구**: 미지원

### 3. Signal Handler
없음. SIGINT 시 Chrome이 함께 종료됨.

## Gap Summary

| Feature | oracle | agbrowse | Gap |
|---------|--------|----------|-----|
| SIGINT in-flight protection | ✅ Chrome 유지 | ❌ | **P1** |
| CDP reconnect to existing tab | ✅ | ❌ | **P1** |
| Sidebar conversation search | ✅ retry 포함 | ❌ | **누락** |
| Deep Research reattach | ✅ | ❌ | **누락** |
| Runtime hint persistence | ✅ | ❌ | **누락** |
| Session store | 유사 | ✅ | 비슷 |

## Recommended Patches

1. **[다음]** SIGINT handler에서 in-flight 감지 시 Chrome 유지 + runtime hint 저장
2. **[다음]** `web-ai poll --session <id>` 시 기존 Chrome 탭에 CDP 재연결
3. **[중기]** sidebar에서 conversationId로 대화 찾기/열기
4. **[중기]** Deep Research 세션 reattach 지원
