# 08 — Multi-Provider Architecture

Severity: **P3** — 🟡 **PARTIAL** (명시적 ChatGPT EditorAdapter 추가됨; cross-provider만 OPEN; 2026-06-24 재감사)

## 2026-06-24 Re-audit (v0.1.15)

본문의 "프로바이더 인터페이스가 암묵적 모듈 계약뿐"이라는 표현은 일부 낡았다.
v0.1.7 이후 명시적 `EditorAdapter` typedef + `createChatGptEditorAdapter()`가 추가됨
(`vendor-editor-contract.mjs:24,57`: `waitForReady`/`getCommitBaseline`/`insertPrompt`/`submitPrompt`/`verifyPromptCommitted`),
`chatgpt.mjs:223/230`, `chatgpt-multi-turn.mjs:78`, `chatgpt-deep-research.mjs:243`에서 소비됨.

단 이 어댑터는 `vendor: 'chatgpt'` 하드코딩(ChatGPT 전용)이라, oracle식 **cross-provider** `ProviderDomAdapter` gap은 여전히 OPEN(P3, 장기).
self-heal(`self-heal.mjs:99`), `semanticTargetsForVendor`, action-cache, ref-registry는 그대로 agbrowse 고유 강점.

남은 구현 대상(OPEN, 장기): `EditorAdapter`를 vendor 일반화(현재 ChatGPT-scoped) + 공통 `runProviderFlow()`.

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse는 ChatGPT/Gemini/Grok 각각에 대해 별도 모듈(`chatgpt.mjs`, `gemini-model.mjs`, `grok-model.mjs`)로 구현하되 공통 인터페이스가 느슨하다.
oracle은 `ProviderDomAdapter` 인터페이스로 프로바이더 추가를 구조화한다.

## Oracle Approach

### 1. ProviderDomAdapter Interface (providerDomFlow.ts)
```typescript
interface ProviderDomAdapter {
    providerName: string;              // "chatgpt-web", "gemini-deep-think"
    waitForUi(ctx): Promise<void>;     // UI 준비 대기
    typePrompt(ctx): Promise<void>;    // 프롬프트 입력
    submitPrompt(ctx): Promise<void>;  // 전송
    waitForResponse(ctx): Promise<{text, html?, meta?}>;  // 응답 대기
    selectMode?(ctx): Promise<void>;   // 모드 선택 (optional)
    extractThoughts?(ctx): Promise<string>;  // 사고 과정 추출 (optional)
}
```

### 2. Orchestration Functions
```typescript
// 전송 파이프라인
async function runProviderSubmissionFlow(adapter, ctx) {
    await adapter.waitForUi(ctx);
    await adapter.selectMode?.(ctx);
    await adapter.typePrompt(ctx);
    await adapter.submitPrompt(ctx);
}

// 전체 파이프라인 (전송 + 응답)
async function runProviderDomFlow(adapter, ctx) {
    await runProviderSubmissionFlow(adapter, ctx);
    const response = await adapter.waitForResponse(ctx);
    const thoughts = await adapter.extractThoughts?.(ctx);
    return { response, thoughts };
}
```

### 3. 등록된 프로바이더
- `chatgptDomProvider` — ChatGPT Web UI
- `geminiDeepThinkDomProvider` — Gemini Deep Think

### 4. State 관리
각 프로바이더가 `ctx.state`를 자체 타입으로 캐스팅:
```typescript
interface ChatgptDomProviderState { /* ChatGPT 전용 상태 */ }
interface GeminiDomProviderState { /* Gemini 전용 상태 */ }
```

### 5. Model Selection
- ChatGPT: `modelSelection.ts`에서 별도 처리 (picker 열기 → fuzzy match → 클릭)
- Gemini: adapter 내부 `selectMode()`에서 Deep Think 토글

## agbrowse Current State

### 1. 프로바이더 구조
```
web-ai/
├── chatgpt.mjs              # ChatGPT 메인 플로우
├── chatgpt-composer.mjs     # ChatGPT 입력/전송
├── chatgpt-model.mjs        # ChatGPT 모델 선택
├── chatgpt-attachments.mjs  # ChatGPT 파일 업로드
├── gemini-model.mjs         # Gemini 모델 선택
├── gemini-live.mjs          # Gemini Live
├── grok-model.mjs           # Grok 모델 선택
├── grok-live.mjs            # Grok Live
└── vendor-editor-contract.mjs  # 프로바이더별 셀렉터 계약
```

### 2. vendor-editor-contract.mjs
프로바이더별 semantic target 정의:
```javascript
// 각 vendor의 composer, sendButton, responseFeed 등의 셀렉터를 선언
export function semanticTargetsForVendor(vendor) { ... }
```

### 3. self-heal.mjs
`resolveActionTarget()`으로 셀렉터 해석 + 캐시 + 검증.
이것은 oracle에 없는 agbrowse 고유 기능.

## Comparison

| Aspect | oracle | agbrowse |
|--------|--------|----------|
| Provider interface | 명시적 TS interface | 암묵적 모듈 계약 |
| Orchestration | `runProviderDomFlow()` | 각 vendor 모듈에서 독립 구현 |
| State typing | per-provider typed state | 없음 |
| Selector contract | `constants.ts` (flat) | `vendor-editor-contract.mjs` (per-vendor) |
| Self-healing | ❌ | ✅ `self-heal.mjs` |
| Target resolution cache | ❌ | ✅ `action-cache.mjs` |
| Ref registry | ❌ | ✅ `ref-registry.mjs` |

## Assessment

이 영역은 **양쪽이 다른 강점**을 가진다:
- oracle: 명시적 interface 기반 확장성
- agbrowse: self-heal, action cache, ref registry 기반 런타임 적응성

agbrowse의 self-heal/cache 시스템은 oracle보다 실전 안정성에서 우위일 수 있다.
다만, 새 프로바이더 추가 시 oracle의 interface 패턴이 더 명확한 가이드를 제공한다.

## Recommended Patches

1. **[장기]** `ProviderAdapter` 인터페이스 명시화 (JSDoc typedef)
2. **[장기]** `runProviderFlow()` 공통 오케스트레이터
3. **[유지]** self-heal, action-cache, ref-registry는 agbrowse 고유 강점이므로 유지
4. **[유지]** vendor-editor-contract 패턴은 oracle의 constants.ts보다 확장적이므로 유지
