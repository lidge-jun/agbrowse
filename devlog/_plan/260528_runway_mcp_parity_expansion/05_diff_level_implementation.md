# Diff-Level 구현 계획

## Phase 1: 기존 강화 + recents

### MODIFY: `skills/browser/runway.mjs`

**변경 1: status 추출 확장**

before (inspectRunwayPage → dom evaluate):
```js
return {
  textSample, selectors, counts, quota, auth, actions
};
```

after:
```js
return {
  textSample, selectors, counts, quota, auth, actions,
  plan: {
    type: extractPlanType(visibleText),  // Unlimited|Standard|Free
    credits: extractCredits(visibleText),
  },
  workspace: {
    name: extractWorkspaceName(visibleText),
  },
  model: {
    selected: extractSelectedModel(),    // 현재 선택된 모델
    available: extractAvailableModels(), // 보이는 모든 모델 목록
  },
  generation: {
    mode: extractGenerationMode(visibleText), // Explore|Credits
    params: extractGenerationParams(),        // duration, ratio 등
  },
};
```

**변경 2: recents 명령 추가**

after (runRunwayCli에 recents 분기 추가):
```js
if (command === 'recents') {
  // Recents 서피스로 이동 → DOM 파싱 → 에셋 목록 반환
}
```

**변경 3: RUNWAY_SURFACES에 URL 추가**

before:
```js
recents: { id: 'recents', url: null, deepAutomation: false }
```

after:
```js
recents: { id: 'recents', url: `${RUNWAY_BASE_URL}/ai-tools/recents`, deepAutomation: true }
```

### NEW: `skills/browser/runway-selectors.mjs`

현재 runway.mjs가 500줄에 도달. 셀렉터 계약을 별도 파일로 분리.

내용:
- `RUNWAY_SURFACES` → 이동
- `SURFACE_ALIASES` → 이동
- `COMMON_SELECTORS` → 이동
- `SURFACE_SELECTORS` → 이동 + 확장
- `BLOCKED_ACTIONS` → 이동

확장할 셀렉터:
```js
'custom-tools': [
  // 기존 유지
  ...existingSelectors,
  // 추가
  { name: 'mode-toggle', selector: '[data-testid="explore-credits-toggle"]',
    purpose: 'Explore/Credits 모드 전환' },
  { name: 'duration-select', selector: '[data-testid="duration-select"]',
    purpose: 'Video duration 선택' },
  { name: 'ratio-select', selector: '[data-testid="aspect-ratio-select"]',
    purpose: 'Aspect ratio 선택' },
  { name: 'resolution-select', selector: '[data-testid="resolution-select"]',
    purpose: 'Resolution 선택' },
  { name: 'audio-toggle', selector: '[data-testid="audio-toggle"]',
    purpose: 'Audio 생성 토글' },
],
recents: [
  { name: 'asset-card', selector: '[data-testid="asset-card"]',
    purpose: 'Recents 에셋 카드' },
  { name: 'asset-download', selector: '[data-testid="asset-download"]',
    purpose: '에셋 다운로드 버튼' },
]
```

주의: 위 셀렉터는 예상값. 실제 구현 전에 Computer Use로 라이브 캡처 필요.

---

## Phase 2: 생성 워크플로우

### NEW: `skills/browser/runway-generate.mjs`

핵심 신규 파일. ~400줄 예상.

```js
// 주요 export
export async function setupRunwayGeneration(page, options) { ... }
export async function executeRunwayGeneration(page, options) { ... }
export async function selectRunwayModel(page, modelName) { ... }
export async function setRunwayPrompt(page, promptText) { ... }
export async function setRunwayParams(page, params) { ... }
export async function uploadRunwaySeedImage(page, filePath) { ... }
export async function ensureExploreMode(page) { ... }
export async function clickRunwayGenerate(page) { ... }
```

함수별 역할:

**`selectRunwayModel(page, modelName)`**
1. `[data-testid="select-base-model"]` 클릭
2. 드롭다운에서 modelName 매칭하는 항목 클릭
3. 선택 확인

**`setRunwayPrompt(page, promptText)`**
1. `div[aria-label="Prompt"]` 클릭
2. 기존 텍스트 전체 선택 + 삭제
3. promptText 입력
4. 입력 확인

**`setRunwayParams(page, params)`**
1. duration → duration-select에서 선택
2. ratio → ratio-select에서 선택
3. resolution → resolution-select에서 선택
4. audio → audio-toggle 상태 확인/전환

**`uploadRunwaySeedImage(page, filePath)`**
1. `input[type="file"]`에 파일 경로 주입 (page.setInputFiles)
2. 업로드 완료 대기

**`ensureExploreMode(page)`**
1. 현재 모드 확인 (Explore vs Credits)
2. Credits 모드면 Explore로 전환
3. 전환 확인

**`clickRunwayGenerate(page)`**
1. Safety Level 2 확인 (allow-submit)
2. `role=button[name=/^Generate$/]` 클릭
3. 클릭 후 "generating" 상태 진입 확인

**`setupRunwayGeneration(page, options)` — Level 1 합성**
1. open → model → prompt → params → upload → explore 순서 실행
2. Generate 클릭 안 함
3. readyToGenerate 상태 반환

**`executeRunwayGeneration(page, options)` — Level 2 합성**
1. setupRunwayGeneration 호출
2. clickRunwayGenerate 호출
3. waitForRunwayCompletion (runway-monitor.mjs) 호출
4. 결과 에셋 URL 추출
5. --output 지정 시 다운로드

### MODIFY: `skills/browser/runway.mjs`

`runRunwayCli`에 setup/generate 명령 분기 추가:

```js
if (command === 'setup') {
  // Level 1: 파라미터 세팅만
  const result = await setupRunwayGeneration(page, parsedArgs);
  emit(deps, formatResult(result));
}
if (command === 'generate') {
  // Level 2: 세팅 + 실행 + poll + 다운로드
  const result = await executeRunwayGeneration(page, parsedArgs);
  emit(deps, formatResult(result));
}
```

`formatRunwayUsage()` 업데이트.

### NEW: `skills/browser/runway-download.mjs`

에셋 다운로드 로직. ~150줄 예상.

```js
export async function extractRunwayOutputUrl(page) { ... }
export async function downloadRunwayOutput(page, outputPath) { ... }
```

- CDP Network.getResponseBody 또는 video/img src 속성에서 URL 추출
- Node.js fetch로 파일 다운로드
- 에셋 URL은 ephemeral일 수 있으므로 즉시 다운로드

---

## Phase 3: 파일 업로드

runway-generate.mjs의 `uploadRunwaySeedImage`에 이미 포함.
별도 `upload` 명령은 runway.mjs의 CLI 분기로만 추가.

---

## Phase 4: 고급 워크플로우

### NEW: `skills/browser/runway-multishot.mjs`

~200줄 예상. Workflow 서피스 또는 Custom의 multishot UI 조작.

```js
export async function executeMultishot(page, options) { ... }
```

### NEW: `skills/browser/runway-product-ad.mjs`

~200줄 예상. compound workflow.

```js
export async function executeProductAd(page, options) { ... }
```

---

## Phase 5: 테스트

### NEW: `test/unit/runway-generate.test.mjs`

setup/generate 함수 유닛 테스트.

### NEW: `test/unit/runway-download.test.mjs`

URL 추출 + 다운로드 로직 테스트.

### MODIFY: `test/unit/runway-cli.test.mjs`

신규 명령 (recents, setup, generate, upload) 테스트 추가.

---

## 파일 변경 요약

| 상태 | 파일 | 줄 수 | Phase |
|------|------|-------|-------|
| MODIFY | `skills/browser/runway.mjs` | +80, -120 (셀렉터 분리) | P1-P2 |
| NEW | `skills/browser/runway-selectors.mjs` | ~200 | P1 |
| NEW | `skills/browser/runway-generate.mjs` | ~400 | P2 |
| NEW | `skills/browser/runway-download.mjs` | ~150 | P2 |
| NEW | `skills/browser/runway-multishot.mjs` | ~200 | P4 |
| NEW | `skills/browser/runway-product-ad.mjs` | ~200 | P4 |
| MODIFY | `skills/browser/runway-monitor.mjs` | +20 (확장 신호) | P1 |
| NEW | `test/unit/runway-generate.test.mjs` | ~300 | P5 |
| NEW | `test/unit/runway-download.test.mjs` | ~150 | P5 |
| MODIFY | `test/unit/runway-cli.test.mjs` | +200 | P5 |

총 신규: ~1600줄 (6 파일)
총 수정: ~300줄 변경 (3 파일)
