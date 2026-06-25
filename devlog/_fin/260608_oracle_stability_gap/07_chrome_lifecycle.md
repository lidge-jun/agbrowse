# 07 — Chrome Process Lifecycle

Severity: **P2** — 🟡 **PARTIAL** (모델 오해 정정; signal/WSEndpoint/window-hide만 OPEN; 2026-06-24 재감사)

## 2026-06-24 Re-audit (v0.1.15)

본문의 "agbrowse는 기본 start/stop이며 `agbrowse stop`이 브라우저를 종료"라는 전제가 부정확하다:

- **`stop`은 Chrome kill이 아님**: web-ai의 `stop`은 진행 중 응답(생성) 중단 명령(`cli.mjs:46`, send/poll/query와 동급)이지 브라우저 종료가 아니다. 브라우저 기동/해제는 최상위 `agbrowse start`(Chrome 별도 spawn, `README.md:382`)이며, web-ai는 CDP(기본 9222)로 **연결만** 한다.
- **In-flight Chrome 보존(표 P1행)**: connect-over-CDP 모델 + `sessions resume`/`reattach`로 사실상 완화됨(04 참조). "❌"는 과함 → 🟡 partial.
- 여전히 **OPEN(P3)**: `grep process.on(SIG → 0 hits` (signal handler 없음), WSEndpoint 원격 연결 없음, macOS window hiding 없음, stale profile cleanup 없음.

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse의 Chrome 생명주기 관리는 기본적인 start/stop이다.
oracle은 signal handling, in-flight 보호, 원격 연결, window hiding 등을 지원한다.

## Oracle Approach

### 1. Signal Handler (chromeLifecycle.ts:60-130)
```typescript
const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGQUIT"];

const handleSignal = (signal) => {
    const inFlight = opts?.isInFlight?.() ?? false;
    const leaveRunning = keepBrowser || inFlight;
    
    if (leaveRunning) {
        // Chrome 유지 + reattach hint 저장
        await opts?.emitRuntimeHint?.();
    } else {
        // Chrome 종료 + profile cleanup
        await chrome.kill();
        await rm(userDataDir, { recursive: true, force: true });
    }
};
```

- `isInFlight` 콜백으로 응답 대기 중인지 판단
- `emitRuntimeHint`로 재접속에 필요한 정보 저장
- `preserveUserDataDir` 옵션으로 manual login profile 보존

### 2. Remote Chrome 연결
```typescript
// 원격 Chrome에 연결 (Docker, SSH tunnel, cloud)
export async function connectToRemoteChrome(host, port, logger, targetUrl?, browserWSEndpoint?) {
    // WebSocket endpoint로 직접 연결
    // 또는 targetUrl로 새 탭 열고 연결
}
```

### 3. Window Hiding (macOS)
```typescript
export async function hideChromeWindow(chrome, logger) {
    const script = `tell application "System Events"
        try
            set visible of (first process whose unix id is ${chrome.pid}) to false
        end try
    end tell`;
    await execFileAsync("osascript", ["-e", script]);
}
```

### 4. Profile State Cleanup
```typescript
// 오래된 DevTools port 정보 정리
await cleanupStaleProfileState(userDataDir, logger, { lockRemovalMode: "never" });
```

### 5. Control Plan (controlPlan.ts)
5가지 브라우저 제어 모드:
- `attach-running`: 이미 실행 중인 Chrome에 연결
- `remote-chrome`: 원격 Chrome (WSEndpoint)
- `headless`: 헤드리스 모드
- `hidden-window`: 보이지 않는 창
- `visible-window`: 보이는 창

## agbrowse Current State

### 1. Start/Stop
`agbrowse start --headed/--headless` + `agbrowse stop`
기본적인 chrome-launcher 사용.

### 2. Signal Handler
없음. 프로세스 종료 = Chrome 종료.

### 3. Remote Chrome
`--port` 옵션으로 기존 CDP에 연결 가능.
WSEndpoint 기반 원격 연결은 미지원.

### 4. Window Hiding
없음.

### 5. Profile Management
`BROWSER_AGENT_HOME`에 profile 저장. Stale state cleanup 없음.

## Gap Summary

| Feature | oracle | agbrowse | Gap |
|---------|--------|----------|-----|
| SIGINT/SIGTERM handler | ✅ in-flight aware | ❌ | **P2** |
| In-flight Chrome preservation | ✅ | ❌ | **P1** |
| Remote WSEndpoint connect | ✅ | ❌ | **P3** |
| macOS window hiding | ✅ osascript | ❌ | **P3** |
| Stale profile cleanup | ✅ | ❌ | **P3** |
| Control plan modes | 5가지 | 2가지 (headed/headless) | **P3** |

## Recommended Patches

1. **[다음]** SIGINT handler + in-flight 판단 로직
2. **[중기]** stale DevTools port 정보 cleanup
3. **[장기]** WSEndpoint 기반 원격 Chrome 연결
4. **[장기]** macOS window hiding (osascript)
