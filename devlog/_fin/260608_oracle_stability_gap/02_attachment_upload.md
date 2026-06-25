# 02 — Attachment Upload & Chip Verification

Severity: **P0** — ✅ **RESOLVED** (2026-06-24 re-audit, agbrowse v0.1.15); 잔여 P3 1건

## 2026-06-24 Re-audit (v0.1.15)

이 문서의 2026-06-08 분석(v0.1.7 기준)은 "send 플로우에서 chip ready를 확인하지 않는다"는
핵심 주장이 더 이상 사실이 아니다. chip readiness가 전송 직전에 실제로 호출됨.

| Gap (2026-06-08, v0.1.7) | 현재 상태 (v0.1.15) | 증거 |
| --- | --- | --- |
| Chip readiness가 send와 분리됨 | ✅ 해소 | `chatgpt.mjs:258` `attachLocalFilesLive(...)`가 전송 전에 실행 → `waitForAttachmentAcceptedLive()` → `buildAttachmentReadyExpression()` (`chatgpt-attachments.mjs`) |
| Upload status polling 없음 | ✅ 해소 | `[role="progressbar"]`, `[aria-label*="uploading" i]`, `[aria-label*="processing" i]` 감시 후 `progressCount === 0` 게이트 (`chatgpt-attachments.mjs`) |
| Filename truncation 매칭 없음 | ✅ 해소 | stem 매칭 (`chatgpt-attachments.mjs`) |
| Count-based fallback 없음 | ✅ 해소 | `removeCount >= expected.length` (`chatgpt-attachments.mjs`) |
| Attachment-aware timeout 8s 고정 | ✅ 해소 | `sendButtonTimeoutMs()` → 첨부 45s / 텍스트 20s (`chatgpt-attachments.mjs:240`) |
| Post-send 첨부 evidence 검증 | ✅ 추가됨 | `verifySentTurnAttachmentLive()` (`chatgpt.mjs:283`) |
| **DataTransfer/CDP-DOM fallback** | ❌ **잔여 (P3)** | 여전히 Playwright `setInputFiles`에만 의존 (`chatgpt-attachments.mjs:272/336`). 사용자-설정 timeout(`--browser-attachment-timeout` 상당)도 없음 — `--max-upload-file-size`만 존재. |

회귀 검증: `test/unit/stability-benchmarks.test.mjs` B2.* (45s 첨부 timeout, preflight reject, image routing 통과).

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse는 파일 업로드 후 ChatGPT UI에 attachment chip이 나타났는지 확인하지 않고
바로 전송 버튼을 누른다. 업로드가 완료되지 않은 상태에서 전송하면 버튼이 disabled이거나
파일 없이 전송된다.

## Oracle Approach

### 1. Attachment Ready 확인 (promptComposer.ts:340-580)
oracle은 전송 전에 `buildAttachmentReadyExpression()` — 약 240줄의 DOM 검사 로직으로 다음을 확인:

- **Chip 매칭**: 업로드된 파일명이 UI chip의 텍스트/aria-label/title에 나타나는지
- **Truncation 대응**: ChatGPT가 긴 파일명을 `…`로 자르는 경우 prefix+suffix 매칭
- **Input[type=file] 검증**: `<input type="file">` 요소의 `files` 속성에 파일이 있는지
- **Count 폴백**: 이름 매칭 불가 시 "Remove" 버튼 수 ≥ 업로드 파일 수로 판단
- **Upload status 감지**: `[data-state="uploading"]`, `[aria-busy="true"]` 등으로 업로드 중 감지

### 2. Attachment Upload (attachments.ts)
```typescript
// 업로드 → 시그널 체크 루프
const signals = await readAttachmentSignals(attachment.name);
// uiMatch, inputMatch, uploading 등 복합 판단
```

- Composer root를 동적으로 탐색 (send 버튼, 프롬프트 입력 필드 기준)
- 파일 수 카운터로 전체 vs 부분 업로드 구별
- `attachmentDataTransfer.ts`: CDP DOM domain으로 직접 DataTransfer 이벤트 생성

### 3. 타임아웃
```typescript
// 첨부파일 있을 때 send button 대기: 45초 (기본)
// --browser-attachment-timeout으로 커스텀 가능
function sendButtonTimeoutMs(attachmentNames?, attachmentTimeoutMs?): number {
    if (!attachmentNames?.length) return 20_000;
    return attachmentTimeoutMs ?? 45_000;
}
```

## agbrowse Current State

### 1. Attachment Ready 확인
`chatgpt-attachments.mjs`에 `buildAttachmentReadyExpression()` 존재하나,
**send 플로우에서 호출하지 않음**. 독립적인 체크 함수로만 존재.

### 2. Upload Flow
```javascript
// chatgpt-attachments.mjs
// preflight → setInputFiles → chip 확인
```
Playwright `setInputFiles` 사용. chip 출현 대기는 있으나 send 전 검증과 분리됨.

### 3. 타임아웃
Send button: 고정 8초 (첨부파일 유무 무관)

## Gap Summary

| Feature | oracle | agbrowse | Gap |
|---------|--------|----------|-----|
| Chip readiness before send | ✅ 240줄 검증 | ❌ send와 분리 | **P0** |
| Upload status polling | `[data-state]`, `[aria-busy]` | 없음 | **누락** |
| Filename truncation match | prefix+suffix | 없음 | **누락** |
| Count-based fallback | Remove 버튼 수 | 없음 | **누락** |
| DataTransfer fallback | CDP DOM domain | 없음 | **누락** |
| Attachment-aware timeout | 45s configurable | 8s fixed | **P0** |

## Recommended Patches

1. **[즉시]** `attemptSendButton`에서 첨부파일 있을 때 chip ready 대기 로직 통합
2. **[즉시]** 첨부파일 전용 타임아웃 분리 (45초 기본)
3. **[다음]** upload status selector 감시 (`[data-state="uploading"]` 등)
4. **[다음]** 파일명 truncation 대응 (prefix/suffix 매칭)
5. **[중기]** CDP DataTransfer 폴백 (Playwright setInputFiles 실패 시)
