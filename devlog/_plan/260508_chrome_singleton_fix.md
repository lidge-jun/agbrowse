# Chrome Singleton Absorption Fix — Cross-Platform

## Problem

Chrome의 ProcessSingleton이 agbrowse가 띄운 Chrome 인스턴스를 기존 Chrome으로
흡수하여 CDP 포트가 열리지 않음. Windows에서 가장 빈번.

## Root Cause (GPT Pro + Grok Expert + Chromium 소스 확인)

### 틀린 가설
- ~~ProcessSingleton이 `--user-data-dir` 파싱 전에 실행~~ → **후에 실행** (Chromium 소스 확인)
- ~~chrome.exe가 프록시/스텁~~ → fast-start는 agbrowse 플래그 수에서 우회됨
- ~~OS가 바이너리 도달 전에 라우팅~~ → `spawn()` = CreateProcess 직접 실행

### 실제 원인
1. **PROFILE_DIR 미사전생성**: `launchChrome()`에서 `DATA_DIR`만 `mkdirSync`, `PROFILE_DIR`은 Chrome에 위임.
   Chrome이 생성 실패하면 **기본 프로필로 무성 폴백** → 기존 Chrome과 같은 프로필 = 흡수
2. **Chrome 136+ 보안 변경**: 기본 프로필에서 `--remote-debugging-port` 무시됨
3. **`--enable-automation` 미사용**: Chromium은 automation 플래그가 있는 프로세스의 싱글톤 알림을 드롭함

### macOS에서 되는 이유
`homedir()` + `.browser-agent/browser-profile` 경로가 macOS에서는 항상 유효하고 쓰기 가능.
macOS 파일시스템은 경로 생성에 관대해서 Chrome이 PROFILE_DIR을 자체 생성함.

### Chromium 소스 참조 (GPT Pro 검증)
- `chrome/app/chrome_main_delegate.cc`: `PreSandboxStartup()` → `InitializeUserDataDir()` → `PostEarlyInitialization()` → `AcquireProcessSingleton(user_data_dir)`
- `chrome/install_static/user_data_dir.cc`: Windows에서 user-data-dir이 무효하면 기본 프로필로 폴백
- `chrome/browser/chrome_browser_main.cc`: automation 모드에서 싱글톤 알림 드롭
- `chrome/browser/devtools/remote_debugging_server.cc`: Chrome 136+, 기본 프로필에서 remote debugging 비활성

## Solution (3단계)

### Phase 1: 근본 원인 수정 (필수)
- PROFILE_DIR 사전 생성 + 쓰기 가능 검증
- `--enable-automation` 플래그 추가
- Chrome stderr 캡처 (침묵 실패 감지)
- 실행된 경로/user-data-dir 로깅

### Phase 2: 진단 강화
- `doctor`에 Windows/Linux 싱글톤 감지 추가
- 에러 메시지에 Canary 안내 추가

### Phase 3: 폴백 (보험)
- `findChrome()`에 Canary/Chromium 경로 추가
- 근본 수정으로 안 되면 대체 바이너리 자동 시도

---

## Diff Plan

### 1. MODIFY `skills/browser/browser.mjs` — `launchChrome()` (Line 622-758)

**1a. PROFILE_DIR 사전 생성 (Line 672 근처)**

Before:
```javascript
mkdirSync(DATA_DIR, { recursive: true });
const chrome = findChrome(opts.chromePath);
```

After:
```javascript
mkdirSync(PROFILE_DIR, { recursive: true });
const chrome = findChrome(opts.chromePath);
console.error(`[browser] launching: ${chrome}`);
console.error(`[browser] user-data-dir: ${PROFILE_DIR}`);
```

**1b. `--enable-automation` 플래그 추가 (Line 682-688)**

Before:
```javascript
const baseFlags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE_DIR}`,
    `--window-size=${minWidth},${minHeight}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage',
];
```

After:
```javascript
const baseFlags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE_DIR}`,
    `--window-size=${minWidth},${minHeight}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--enable-automation',
];
```

**1c. Chrome stderr 캡처 (Line 699-707)**

Before:
```javascript
chromeProc = spawn(chrome, [
    ...baseFlags,
    ...networkingFlag,
    ...compatFlags,
    ...extraFlags,
    ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
], { detached: true, stdio: 'ignore' });
```

After:
```javascript
chromeProc = spawn(chrome, [
    ...baseFlags,
    ...networkingFlag,
    ...compatFlags,
    ...extraFlags,
    ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
let stderrChunks = [];
chromeProc.stderr?.on('data', chunk => {
    stderrChunks.push(chunk);
    if (stderrChunks.length > 50) stderrChunks.shift();
});
```

**1d. 실패 시 stderr 출력 + Canary 폴백 (Line 725-751)**

Before:
```javascript
} else {
    if (chromeProc && !chromeProc.killed) {
        console.error(`[browser] failed launch: spawned PID ${chromeProc.pid} but CDP did not respond after 10s`);
        chromeProc.kill('SIGTERM');
        chromeProc = null;
    }
    clearPersistedState();
    // ... throw error
}
```

After:
```javascript
} else {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (chromeProc && !chromeProc.killed) {
        console.error(`[browser] failed launch: spawned PID ${chromeProc.pid} but CDP did not respond after 10s`);
        if (stderr) console.error(`[browser] chrome stderr:\n${stderr}`);
        killSpawnedProc(chromeProc);
        chromeProc = null;
    }
    clearPersistedState();

    // Singleton absorption retry: try alternate browser
    if (!opts._retried && !opts.chromePath) {
        const altChrome = findChrome(null, { preferAlternate: true });
        if (altChrome !== chrome) {
            console.warn(`[browser] retrying with alternate browser: ${basename(altChrome)}`);
            releaseProfileLock(DATA_DIR, lockResult.token);
            activeLockToken = null;
            return launchChrome(port, { ...opts, chromePath: altChrome, _retried: true });
        }
    }

    const lockPath = join(DATA_DIR, 'profile.lock');
    const portInfo = await describePortHolder(port).catch(() => null);
    const portLine = portInfo
        ? `Port ${port} held by ${portInfo}.`
        : `Port ${port} held by another process.`;
    const canaryHint = process.platform === 'win32'
        ? 'Install Chrome Canary → https://www.google.com/chrome/canary/'
        : process.platform === 'darwin'
            ? 'brew install --cask google-chrome-canary'
            : '';

    throw new Error(
        `Chrome CDP not responding on port ${port} after 10s.\n` +
        `\n` +
        `Diagnose: agbrowse doctor\n` +
        (stderr ? `Chrome stderr: ${stderr.slice(0, 200)}\n` : '') +
        `\n` +
        `Likely causes (most common first):\n` +
        `  1. Chrome singleton absorbed the launch.\n` +
        `       → Close all Chrome windows, then: agbrowse start --headed\n` +
        (canaryHint ? `       → Or: ${canaryHint}\n` : '') +
        `  2. ${portLine}\n` +
        `       → agbrowse start --port ${port + 1}\n` +
        `  3. Stale profile lock at ${lockPath}.\n` +
        `       → agbrowse stop  (or: rm ${lockPath})\n` +
        `  4. No display available.\n` +
        `       → CHROME_HEADLESS=1 agbrowse start\n`
    );
}
```

---

### 2. MODIFY `skills/browser/browser.mjs` — `findChrome()` (Line 569-616)

Canary/Chromium 경로 추가 + `preferAlternate` 옵션.

Before:
```javascript
function findChrome(customChromePath = CUSTOM_CHROME_PATH) {
    if (customChromePath) {
        if (existsSync(customChromePath)) return customChromePath;
        throw new Error(`Custom Chrome path not found: ${customChromePath}`);
    }
    const platform = process.platform;
    const paths = [];
    if (platform === 'darwin') {
        paths.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        );
    } else if (platform === 'win32') {
        const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
        const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const local = process.env.LOCALAPPDATA || '';
        paths.push(
            `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
            `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome\\Application\\chrome.exe`,
            `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        );
    } else {
        paths.push(
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/usr/bin/brave-browser',
        );
        if (isWSL()) {
            paths.push(
                '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
                '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            );
        }
    }
    for (const p of paths) {
        if (p && existsSync(p)) return p;
    }
    throw new Error('Chrome not found — install Google Chrome');
}
```

After:
```javascript
function findChrome(customChromePath = CUSTOM_CHROME_PATH, { preferAlternate = false } = {}) {
    if (customChromePath) {
        if (existsSync(customChromePath)) return customChromePath;
        throw new Error(`Custom Chrome path not found: ${customChromePath}`);
    }
    const platform = process.platform;
    const stable = [];
    const alternate = [];

    if (platform === 'darwin') {
        stable.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        );
        alternate.push(
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        );
    } else if (platform === 'win32') {
        const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
        const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const local = process.env.LOCALAPPDATA || '';
        stable.push(
            `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
            `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome\\Application\\chrome.exe`,
        );
        alternate.push(
            `${local}\\Google\\Chrome SxS\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome Dev\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome Beta\\Application\\chrome.exe`,
            `${local}\\Chromium\\Application\\chrome.exe`,
            `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        );
    } else {
        stable.push(
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
        );
        alternate.push(
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/usr/bin/brave-browser',
        );
        if (isWSL()) {
            stable.push(
                '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
                '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            );
        }
    }
    const ordered = preferAlternate
        ? [...alternate, ...stable]
        : [...stable, ...alternate];
    for (const p of ordered) {
        if (p && existsSync(p)) return p;
    }
    throw new Error('Chrome not found — install Google Chrome or Chromium');
}
```

---

### 3. MODIFY `skills/browser/browser.mjs` — `runStartDoctor()` (Line 334-376)

Windows `tasklist`로 chrome.exe 감지 + Linux stale SingletonLock 감지 추가.

Before:
```javascript
// 5. macOS Chrome.app singleton
if (process.platform === 'darwin') {
    // ... pgrep logic ...
}
```

After:
```javascript
// 5. Chrome singleton detection (all platforms)
if (process.platform === 'darwin') {
    // ... existing pgrep logic unchanged ...
} else if (process.platform === 'win32') {
    try {
        const ps = spawnSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'], {
            encoding: 'utf8', timeout: 3000,
        });
        const chromeLines = (ps.stdout || '').trim().split('\n')
            .filter(l => l.toLowerCase().includes('chrome.exe'));
        if (chromeLines.length > 0) {
            checks.push({
                id: 'chrome-singleton',
                ok: true,
                severity: 'warn',
                detail: `${chromeLines.length} chrome.exe process(es) running — singleton risk if profile dir creation fails`,
                fix: 'agbrowse uses --enable-automation + unique profile to avoid absorption. If launch fails, close all Chrome windows.',
            });
        } else {
            checks.push({ id: 'chrome-singleton', ok: true, severity: 'info', detail: 'no chrome.exe running' });
        }
    } catch {
        checks.push({ id: 'chrome-singleton', ok: true, severity: 'info', detail: 'tasklist unavailable; skipped' });
    }
} else {
    const singletonLock = join(PROFILE_DIR, 'SingletonLock');
    if (existsSync(singletonLock)) {
        checks.push({
            id: 'chrome-singleton',
            ok: true,
            severity: 'warn',
            detail: `stale SingletonLock found at ${singletonLock}`,
            fix: `rm -f "${PROFILE_DIR}/Singleton*" then retry`,
        });
    } else {
        checks.push({ id: 'chrome-singleton', ok: true, severity: 'info', detail: 'no singleton lock conflict' });
    }
}
```

---

### 4. MODIFY `skills/browser/browser.mjs` — help text env vars (Line 2909-2928)

`AGBROWSE_CHROME_PATH` 안내 강화.

Before:
```
AGBROWSE_CHROME_PATH   Custom Chrome binary path
```

After:
```
AGBROWSE_CHROME_PATH   Custom Chrome/Canary/Chromium binary path.
                       Windows Canary: %LOCALAPPDATA%\Google\Chrome SxS\Application\chrome.exe
                       macOS Canary: /Applications/Google Chrome Canary.app/.../Google Chrome Canary
```

---

## File Summary

| File | Action | Lines Changed (est.) |
|---|---|---|
| `skills/browser/browser.mjs` | MODIFY | ~100 lines |

Single file, 4 edits:
1. `launchChrome()` — PROFILE_DIR 사전생성 + `--enable-automation` + stderr 캡처 + Canary 폴백
2. `findChrome()` — stable/alternate 분리 + Canary/Chromium 경로
3. `runStartDoctor()` — Windows/Linux 싱글톤 감지
4. Help text — AGBROWSE_CHROME_PATH 안내

## Test Plan

1. macOS: Chrome Stable 실행 중 → `agbrowse start --headed` → 정상 실행 확인 (기존 동작 유지)
2. macOS: PROFILE_DIR 삭제 후 → `agbrowse start --headed` → 자동 생성 + 정상 실행
3. Windows (유저 테스트): Chrome 실행 중 → agbrowse start → `--enable-automation` + 사전생성으로 해결 여부 확인
4. Windows: 해결 안 되면 → Canary 폴백 동작 확인
5. Linux: 변경 없이 정상 동작 확인
6. `agbrowse doctor` — 모든 플랫폼에서 싱글톤 감지 출력 확인
7. stderr 캡처: Chrome이 크래시/실패 시 에러 메시지 표시 확인

## Non-goals

- Chrome for Testing 자동 다운로드 (향후 고려)
- `--remote-debugging-port=0` + DevToolsActivePort 전환 (큰 변경, 별도 phase)
- Playwright bundled Chromium 사용 (로그인 프로필 유지 불가)
- Chrome 프로세스 강제 종료 (유저 작업 손실 위험)
