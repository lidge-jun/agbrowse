# 05 — Error Taxonomy Comparison

Severity: **P2** — 🟡 **OPEN** (저긴급; 2026-06-24 재감사로 코드 수 정정)

## 2026-06-24 Re-audit (v0.1.15)

핵심 gap(단일 클래스 vs 3-tier 서브클래스)은 여전히 유효: `errors.mjs:59`
`export class WebAiError extends Error` 단일 클래스, `TransportError`/`ValidationError` 서브클래스 없음.
단 errorCode 카탈로그는 본문의 "14개+"를 훨씬 넘는다. `grep -rhoE "errorCode: ['\"][^'\"]+['\"]" web-ai/ | sort -u | wc -l` = **37** (`errorCode:` 객체-키 리터럴; 대문자 `TARGET_UNRESOLVED` 포함). 주의: strict `[a-z0-9._-]` 정규식은 이 대문자 코드를 놓쳐 36으로 **오집계**한다. 여기에 직접 대입 `this.errorCode = 'provider.active-capacity'`(`tab-lease-store.mjs:82`) 1종 + `|| '<code>'` 폴백 기본값 4종(`code-mode.retrieval-failed`·`code-extract.retrieval-failed`·`eval.unhandled`(`eval/types.mjs:124`)·`snapshot.failed`(`doctor.mjs:140`))을 더하면 **throwable distinct 42종**. 어느 기준이든 ≥12 벤치를 크게 상회.
`toJSON()`, `wrapError()`, `retryHint`는 그대로 존재. 본문 평가("agbrowse 접근이 오히려 나음")는 유효하므로 우선순위는 낮음.

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse는 단일 `WebAiError` 클래스에 errorCode 문자열로 분류한다.
oracle은 3-tier 에러 계층으로 에러 원인별 처리 경로를 구분한다.

## Oracle Error Hierarchy

```
OracleUserError (base)
├── FileValidationError     — 파일 검증 실패 (크기, 형식, 접근)
├── BrowserAutomationError  — 브라우저 자동화 실패 (DOM, 타임아웃, 셀렉터)
└── PromptValidationError   — 프롬프트 검증 실패 (길이, 형식)

OracleTransportError        — API 통신 에러 (별도 계층)
├── client-timeout
├── client-abort
├── connection-lost
├── model-unavailable
└── (API status별 세분화)

OracleResponseError         — API 응답 에러 (별도 계층)
├── responseId, status
├── incompleteReason
└── requestId
```

### 특징
- `category` 필드로 사용자 표시 여부 판단
- `details` 객체로 구조화된 컨텍스트 (promptLength, observedLength 등)
- `cause` 체이닝으로 원본 에러 보존
- Transport 에러에 모델별 가이드 메시지 (예: gpt-5.5-pro 미지원 시 안내)

## agbrowse Error System

```
WebAiError (단일 클래스)
├── errorCode: string       — 'provider.composer-not-visible', 'context.over-budget' 등
├── stage: string           — 'composer-prereq', 'poll', 'internal' 등
├── retryHint: string       — 're-snapshot', 'reduce-files' 등
├── vendor: string
├── selectorsTried: string[]
└── evidence: unknown
```

### 특징
- 잘 정의된 errorCode 카탈로그 (14개+)
- `retryHint`로 에이전트에게 복구 힌트 제공
- `toJSON()` 직렬화로 `--json` 출력 지원
- `wrapError()`로 일반 에러 → WebAiError 변환

## Comparison

| Aspect | oracle | agbrowse |
|--------|--------|----------|
| Error classes | 5개 (3-tier) | 1개 (flat) |
| Error codes | 암묵적 (message 기반) | 명시적 카탈로그 (14+) |
| Retry hint | 없음 (caller가 판단) | ✅ retryHint 필드 |
| JSON serialization | 없음 | ✅ toJSON() |
| Error cause chain | ✅ | ✅ |
| Transport vs User | ✅ 분리 | ❌ 혼합 |
| Structured details | ✅ details 객체 | evidence 필드 |

## Assessment

agbrowse의 에러 시스템은 **에이전트 친화적** (errorCode + retryHint + JSON)이라는 점에서
oracle보다 오히려 나은 면이 있다.

부족한 점:
1. Transport vs Browser vs Validation 구분이 없어 에러 핸들링 분기가 어려움
2. 파일 크기 초과 등 사전 검증 에러를 별도 클래스로 분리하면 UX 개선 가능

## Recommended Patches

1. **[중기]** `WebAiError` 서브클래스 추가: `TransportError`, `ValidationError`
2. **[중기]** errorCode에 severity/category prefix 추가 (예: `user.file-too-large`)
3. **[유지]** retryHint + toJSON 패턴은 oracle보다 나으므로 유지
