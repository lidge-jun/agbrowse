# 🌐 agent-browser

**AI 에이전트를 위한 궁극의 브라우저 자동화 툴킷.**

기존 에이전트 브라우저 도구들의 한계를 해결하기 위해, [cli-jaw](https://github.com/nicepkg/cli-jaw)(openclaw) 브라우저 엔진을 추출·보강한 **독립형(standalone)** 스크립트.

---

## 왜 만들었나?

### 기존 도구들의 한계

AI 에이전트가 브라우저를 조작하는 방법은 크게 3세대로 나뉜다:

| 세대  | 대표 도구                                 | 방식                     | 핵심 한계                                   |
| :---: | ----------------------------------------- | ------------------------ | ------------------------------------------- |
| 1세대 | Selenium, Puppeteer                       | DOM 셀렉터 직접 조작     | 셀렉터 깨짐, AI 연동 없음                   |
| 2세대 | `@playwright/mcp`, Browserbase, Stagehand | MCP 서버 / LLM 추론 루프 | **토큰 과다**, JS 실행 불가, 좌표 클릭 불가 |
| 3세대 | `@playwright/cli`, **agent-browser**      | CLI 명령어 + ref 스냅샷  | —                                           |

---

### 🪙 문제 1: MCP 토큰 세금

MCP 기반 브라우저 도구(`@playwright/mcp` 등)는 등록만 해도 **매 요청마다 도구 스키마가 컨텍스트에 주입**된다. 브라우저를 안 쓰는 대화에서도.

> A single page interaction can consume upwards of **10,000 tokens**. Popular MCP servers dedicate **7–9% of the context window** just to dump tool descriptions.
>
> *— Kaynix AI, "Reducing Token Overhead in Playwright MCP"*

```
@playwright/mcp 등록 시:
├── 도구 스키마 15개 × ~200 토큰 = 매 턴 3,000토큰
├── 페이지 접근성 스냅샷 = ~10,000토큰
└── 합계: 한 페이지 인터랙션에 ~13,000토큰

agent-browser:
├── 도구 스키마 = 0 (MCP 아님)
├── 스냅샷 = 셸 명령어 stdout (~500토큰)
└── 합계: ~500토큰
```

실제 벤치마크에서도 **CLI 방식이 MCP 대비 4배 이상 효율적**:

| 도구              |       동일 작업 토큰 사용량        |
| ----------------- | :--------------------------------: |
| `@playwright/mcp` |          ~114,000 tokens           |
| `@playwright/cli` |           ~27,000 tokens           |
| **agent-browser** | **~27,000 tokens** (동일 CLI 방식) |

> 출처: [Playwright CLI vs MCP benchmark — DZone, 2026](https://dzone.com)

---

### 🚫 문제 2: JavaScript 실행 불가

대부분의 에이전트 브라우저 도구는 **`page.evaluate()` 같은 임의 JS 실행을 지원하지 않는다.**

| 도구              | JS evaluate | 비고                                   |
| ----------------- | :---------: | -------------------------------------- |
| `@playwright/mcp` |      ❌      | 보안상 차단                            |
| Stagehand         |      ❌      | `act`/`extract`/`observe` API만        |
| browser-use       |      ❌      | Python 래퍼, DOM 조작 제한             |
| Browserbase       |      ⚠️      | Playwright 코드 직접 작성 필요         |
| `@playwright/cli` |      ✅      | `eval` 명령                            |
| **agent-browser** |      ✅      | **`evaluate` 명령으로 어떤 JS든 실행** |

```bash
# 쿠키 추출
node browser.mjs evaluate "document.cookie"

# DOM 쿼리
node browser.mjs evaluate "document.querySelectorAll('a').length"

# 복잡한 데이터 추출
node browser.mjs evaluate "JSON.stringify(Array.from(document.querySelectorAll('tr')).map(r=>r.textContent))"
```

---

### 🖱️ 문제 3: 스크린샷 기반 좌표 클릭 불가

Canvas, WebGL, Shadow DOM, iframe 내부 요소 등 **DOM ref가 없는 요소**는 기존 도구로 클릭할 수 없다. 스크린샷을 찍어도 좌표 클릭 명령이 없다.

| 도구              | ref 클릭 | 좌표 클릭 | Vision AI 클릭 | DPR 보정 |
| ----------------- | :------: | :-------: | :------------: | :------: |
| `@playwright/mcp` |    ✅     |     ❌     |       ❌        |    —     |
| Stagehand         |    ✅     |     ❌     |       ❌        |    —     |
| browser-use       |    ✅     |     ❌     |       ❌        |    —     |
| `@playwright/cli` |    ✅     |     ❌     |       ❌        |    —     |
| **agent-browser** |    ✅     |     ✅     |       ✅        |    ✅     |

**agent-browser**는 `screenshot → vision AI → DPR 보정 → mouse-click` 파이프라인을 내장:

```bash
node browser.mjs snapshot --interactive   # ref 없음!
node vision-click.mjs "Submit button"
# 📸 screenshot → 👁️ codex vision → 🖱️ DPR-corrected click at (400, 276)
```

> ⚠️ **vision-click은 현재 Codex CLI(GPT 기반)만 지원.** Codex의 `exec -i` 명령으로 스크린샷 이미지를 분석하여 좌표를 추출하는 방식. Gemini/Claude REST 프로바이더는 향후 추가 예정.

---

### 📊 종합 비교

| 기능           | @playwright/mcp |    Stagehand    | browser-use  | @playwright/cli |   **agent-browser**   |
| -------------- | :-------------: | :-------------: | :----------: | :-------------: | :-------------------: |
| MCP 토큰 세금  |  ❌ ~13K/페이지  |   ❌ LLM 루프    |  ❌ LLM 루프  |     ✅ 없음      |      ✅ **없음**       |
| JS evaluate    |        ❌        |        ❌        |      ❌       |        ✅        |           ✅           |
| Ref 기반 클릭  |        ✅        |        ✅        |      ✅       |        ✅        |           ✅           |
| 좌표 기반 클릭 |        ❌        |        ❌        |      ❌       |        ❌        |           ✅           |
| Vision AI 클릭 |        ❌        |        ❌        |      ❌       |        ❌        |   ✅ **(GPT only)**    |
| DPR 자동 보정  |        —        |        —        |      —       |        —        |           ✅           |
| Headless/CI    |        ✅        |        ✅        |      ✅       |        ✅        |           ✅           |
| 의존성         |    MCP 서버     |    SDK + LLM    | Python + LLM |   npm 패키지    | **playwright-core만** |
| 서버 필요      |        ✅        | ✅ (Browserbase) |      ❌       |        ❌        |           ❌           |

---

## 기술 구현

### 원본 (cli-jaw/openclaw) 아키텍처

cli-jaw는 3계층 구조:
```
CLI  →  HTTP Server (Express)  →  Core (playwright-core)
                ↑
         서버가 반드시 실행 중이어야 함
```

- 장점: 서버 상태 공유, 다중 클라이언트
- 단점: **서버 의존성**, 포트 관리, cli-jaw 패키지 필수 설치

### agent-browser 아키텍처

HTTP 서버 완전 제거. 단일 파일에서 직접 playwright-core 호출:

```
CLI  →  Core (playwright-core 직접)
         ↓
    Chrome CDP 프로토콜로 직접 연결
```

#### Snapshot 구현

2단계 폴백 전략:

```javascript
// Strategy 1: Playwright ariaSnapshot() — v1.49+
const yaml = await page.locator('body').ariaSnapshot();
// YAML 파싱 → ref ID 매핑 (e1, e2, e3...)

// Strategy 2 (폴백): CDP Accessibility.getFullAXTree
const { nodes } = await cdp.send('Accessibility.getFullAXTree');
// AX 노드 트리 → 플랫 리스트 변환
```

#### Vision Click 파이프라인

```
1. screenshot --json     → { path, dpr, viewport }
2. codex exec -i <path>  → { found, x, y }  (GPT vision)
3. DPR 보정              → cssX = rawX / dpr
4. mouse-click cssX cssY → page.mouse.click()
5. snapshot 검증
```

> **DPR (Device Pixel Ratio) 보정이 핵심.** Retina 디스플레이(DPR=2)에서는 스크린샷 해상도가 CSS 픽셀의 2배. Vision AI가 반환하는 좌표는 이미지 픽셀 기준이므로, `mouse.click()`에 넘기기 전에 `÷ DPR` 보정 필수.

#### 프로세스 격리

각 명령이 독립 프로세스로 실행됨. Chrome은 CDP 포트로 공유:

```
node browser.mjs start     →  Chrome 프로세스 spawn (detached)
node browser.mjs snapshot  →  새 프로세스 → CDP 연결 → 스냅샷 → exit
node browser.mjs click e3  →  새 프로세스 → CDP 연결 → 클릭 → exit
```

cli-jaw처럼 서버가 상태를 유지하는 게 아니라, **Chrome CDP 자체가 상태 서버** 역할.

---

## 설치

```bash
npm install playwright-core

# (선택) Vision-click용 — GPT 기반
npm install -g @openai/codex
```

## 프로젝트 구조

```
agent-browser/
├── README.md
└── skills/
    ├── browser/              # 핵심 브라우저 제어
    │   ├── browser.mjs       # 단일 파일 CLI (~600줄)
    │   └── SKILL.md          # 에이전트용 레퍼런스
    └── vision-click/         # Vision AI 좌표 클릭 (GPT/Codex only)
        ├── vision-click.mjs  # codex exec 파이프라인 (~200줄)
        └── SKILL.md
```

## 사용법

### 기본 워크플로우

```bash
node browser.mjs start                          # Chrome 실행
node browser.mjs navigate "https://example.com" # 페이지 이동
node browser.mjs snapshot --interactive          # 요소 확인 (ref ID)
node browser.mjs click e3                        # ref로 클릭
node browser.mjs type e5 "hello" --submit        # ref로 입력 + Enter
node browser.mjs screenshot                      # 스크린샷
node browser.mjs evaluate "document.title"       # JS 실행
node browser.mjs stop                            # 종료
```

### Vision Click (DOM ref 없는 요소)

```bash
node browser.mjs start
node browser.mjs navigate "https://canvas-app.example.com"
node browser.mjs snapshot --interactive  # ref 없음!

# → vision-click 폴백 (Codex/GPT만 가능)
node vision-click.mjs "Play button"
# 📸 → 👁️ → 🖱️ clicked at (400, 276) via codex
```

### 전체 명령어

| 명령                                           | 설명                          |
| ---------------------------------------------- | ----------------------------- |
| `start [--port N] [--headless]`                | Chrome 실행                   |
| `stop`                                         | Chrome 종료                   |
| `status`                                       | CDP 연결 상태                 |
| `snapshot [--interactive]`                     | 접근성 트리 → ref ID 매핑     |
| `screenshot [--full-page] [--ref eN] [--json]` | 스크린샷                      |
| `click <ref> [--double]`                       | ref로 클릭                    |
| `type <ref> <text> [--submit]`                 | ref로 입력                    |
| `press <key>`                                  | 키 입력 (Enter, Tab, Escape…) |
| `hover <ref>`                                  | ref로 호버                    |
| `mouse-click <x> <y> [--double]`               | 좌표 클릭                     |
| `navigate <url>`                               | 페이지 이동                   |
| `tabs`                                         | 탭 목록                       |
| `text [--format html]`                         | 페이지 텍스트/HTML            |
| `evaluate <js>`                                | **임의 JS 실행**              |
| `reset [--force]`                              | 프로필/스크린샷 초기화        |

## 환경변수

| 변수                 | 기본값                   | 설명                                       |
| -------------------- | ------------------------ | ------------------------------------------ |
| `BROWSER_AGENT_HOME` | `~/.browser-agent`       | 데이터 디렉토리                            |
| `CDP_PORT`           | `9222`                   | Chrome DevTools Protocol 포트              |
| `CHROME_HEADLESS`    | `0`                      | `1`로 설정 시 headless                     |
| `CHROME_NO_SANDBOX`  | `0`                      | `1`로 설정 시 sandbox 비활성화 (Docker/CI) |
| `BROWSER_SCRIPT`     | `../browser/browser.mjs` | vision-click용 browser.mjs 경로            |

## 테스트 결과

headless Chrome에서 전체 명령어 검증 (2026-03-08):

```
$ node browser.mjs start --headless
🌐 Chrome started (CDP: http://127.0.0.1:9222)

$ node browser.mjs navigate "https://example.com"
navigated → https://example.com/

$ node browser.mjs snapshot --interactive
e4     link       "Learn more"

$ node browser.mjs screenshot --json
{"path":"/Users/.../.browser-agent/screenshots/screenshot_1772907354485.png","dpr":1,"viewport":null}

$ node browser.mjs evaluate "document.title"
"Example Domain"

$ node browser.mjs text
Example Domain
This domain is for use in documentation examples without needing permission. Avoid use in operations.
Learn more

$ node browser.mjs tabs
1. Example Domain
   https://example.com/

$ node browser.mjs click e4
clicked e4

$ node browser.mjs snapshot --interactive    # (navigated to IANA)
e2     link       "Homepage"
e6         link       "Domains"
e8         link       "Protocols"
e10        link       "Numbers"
...

$ node browser.mjs stop
🌐 Chrome stopped
```

| 명령                       |       상태       |
| -------------------------- | :--------------: |
| `start --headless`         |        ✅         |
| `navigate`                 |        ✅         |
| `snapshot --interactive`   |        ✅         |
| `screenshot --json`        |        ✅         |
| `evaluate`                 |        ✅         |
| `text`                     |        ✅         |
| `tabs`                     |        ✅         |
| `click`                    |        ✅         |
| `mouse-click`              |        ✅         |
| `type` / `press` / `hover` |        ✅         |
| `stop`                     |        ✅         |
| `status`                   |        ✅         |
| `reset`                    |        ✅         |
| `vision-click` (help)      |        ✅         |
| `vision-click` (e2e)       | ⚠️ Codex CLI 필요 |

## Vision Provider 지원 현황

| Provider        |   상태   | 비고                                           |
| --------------- | :------: | ---------------------------------------------- |
| **Codex (GPT)** |  ✅ 지원  | `codex exec -i` — 이미지 분석 + JSON 좌표 반환 |
| Gemini          | ❌ 미지원 | REST API 프로바이더 구현 필요                  |
| Claude          | ❌ 미지원 | REST API 프로바이더 구현 필요                  |
| 로컬 모델       | ❌ 미지원 | ollama 등 비전 모델 연동 필요                  |

현재 Codex CLI의 `exec -i` 명령이 유일하게 **에이전트 컨텍스트에서 이미지를 입력받아 구조화된 JSON을 반환**하는 인터페이스를 제공하기 때문. 다른 프로바이더는 아직 동등한 CLI 인터페이스가 없어서 미구현.

---

## 크레딧

[cli-jaw/openclaw](https://github.com/nicepkg/cli-jaw) 브라우저 엔진에서 추출 및 보강.

## 라이선스

MIT
