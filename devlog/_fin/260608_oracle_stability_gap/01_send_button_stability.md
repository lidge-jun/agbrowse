# 01 — Send Button Stability

Severity: **P0** — ✅ **RESOLVED** (2026-06-24 re-audit, agbrowse v0.1.15)

## 2026-06-24 Re-audit (v0.1.15)

이 문서의 2026-06-08 분석은 agbrowse v0.1.7 기준이며 더 이상 코드와 일치하지 않는다.
모든 gap이 `web-ai/chatgpt-composer.mjs` + `web-ai/chatgpt-attachments.mjs`에 구현 완료됨.

| Gap (2026-06-08, v0.1.7) | 현재 상태 (v0.1.15) | 증거 |
| --- | --- | --- |
| Send timeout 8s 고정 | ✅ 해소 | `clickEnabledSendButton(page, timeoutMs = 8_000)` 파라미터화 (`chatgpt-composer.mjs:355`). 실제 호출은 `sendButtonTimeoutMs(uploadPaths)` → 텍스트 20s / 첨부 45s (`chatgpt-attachments.mjs:240`, `chatgpt.mjs:274`). 8s는 기본값일 뿐 실 경로에서 항상 덮어씀. |
| Enter key fallback 없음 | ✅ 해소 | `await page.keyboard.press('Enter'); return { method: 'enter' }` (`chatgpt-composer.mjs:174-175`) |
| `form button[type="submit"]` 누락 | ✅ 해소 | `SEND_BUTTON_SELECTORS`에 추가됨 (`chatgpt-composer.mjs:67`) |
| Broad aria-label 누락 | ✅ 해소 | `'button[aria-label*="Send" i]'` (`chatgpt-composer.mjs:69`) — 좁은 "Send prompt"/"Send message" 셀렉터는 제거됨 |
| Commit 검증 약함 | ✅ 해소 | turns + composer-cleared + stop-button + assistant-role 복합 검증 |

회귀 검증: `test/unit/stability-benchmarks.test.mjs` B1.* (22/22 통과). 구현 근거는 동일 폴더 `10_p0_patch_plan.md`의 6개 변경 전부 반영.

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse의 전송 버튼 클릭이 간헐적으로 실패한다. 특히 파일 첨부 + Pro 모드에서.

## Oracle Approach

### 1. 타임아웃 전략 (promptComposer.ts:660-670)
```
텍스트 전용: 20,000ms
첨부파일 포함: 45,000ms (또는 --browser-attachment-timeout 값)
```

### 2. Enter 키 폴백 (promptComposer.ts:207-223)
```typescript
const clicked = await attemptSendButton(runtime, logger, attachmentNames, ...);
if (!clicked) {
    // CDP Input.dispatchKeyEvent로 Enter 키 전송
    await input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter", ... });
    await input.dispatchKeyEvent({ type: "keyUp", key: "Enter", ... });
}
```

### 3. 프롬프트 커밋 검증 (promptComposer.ts:690-854)
전송 후 conversation turn이 실제로 나타났는지 검증:
- 텍스트 매치 (전체 / prefix 120자)
- 새 turn 카운트 증가 확인
- Stop 버튼 / assistant role 출현 감지
- Composer 비움 + URL `/c/` 패턴 복합 폴백

### 4. 셀렉터 범위
```javascript
// oracle — 5개, 더 넓은 폴백
'button[data-testid="send-button"]',
'button[data-testid*="composer-send"]',
'form button[type="submit"]',           // ← agbrowse에 없음
'button[type="submit"][data-testid*="send"]',
'button[aria-label*="Send"]',           // ← 더 넓음
```

## agbrowse Current State

### 1. 타임아웃
```javascript
// chatgpt-composer.mjs:355
const deadline = Date.now() + 8_000;  // 고정 8초
```

### 2. Enter 키 폴백: **없음**
`clickEnabledSendButton()` 실패 시 `false` 반환하고 종료.

### 3. 프롬프트 커밋 검증: **부분적**
`submitPromptFromComposer()`에서 `commitTimeoutMs`까지 대기하지만,
oracle처럼 다중 신호 복합 검증은 하지 않음.

### 4. 셀렉터 범위
```javascript
// chatgpt-composer.mjs:63-69 — 5개, 더 좁은 범위
'button[data-testid="send-button"]',
'button[data-testid*="composer-send"]',
'button[type="submit"][data-testid*="send"]',
'button[aria-label*="Send prompt" i]',   // "Send prompt"만
'button[aria-label*="Send message" i]',  // "Send message"만
```

## Gap Summary

| Feature | oracle | agbrowse | Gap |
|---------|--------|----------|-----|
| Send timeout (text) | 20s | 8s | **2.5x 짧음** |
| Send timeout (file) | 45s | 8s | **5.6x 짧음** |
| Enter key fallback | ✅ | ❌ | **누락** |
| Commit verification | 다중 신호 복합 | 기본적 | **약함** |
| `form button[type="submit"]` | ✅ | ❌ | 폴백 누락 |
| Broad aria-label match | `Send` | `Send prompt/message` | 좁음 |

## Recommended Patches

1. **[즉시]** 텍스트 전용 타임아웃 8s → 20s, 첨부파일 시 45s
2. **[즉시]** 버튼 클릭 실패 시 Enter key fallback 추가 (CDP `Input.dispatchKeyEvent` 또는 Playwright `keyboard.press`)
3. **[다음]** `form button[type="submit"]` 셀렉터 추가
4. **[다음]** aria-label 매치를 `Send` 로 확장
5. **[중기]** 프롬프트 커밋 복합 검증 (turn count + stop button + composer cleared)
