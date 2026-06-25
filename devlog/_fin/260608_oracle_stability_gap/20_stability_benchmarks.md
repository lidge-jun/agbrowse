# 20 — Stability Benchmark Suite (oracle-derived)

Date: 2026-06-08 · 재감사 2026-06-24 (agbrowse v0.1.15)
Status: active — ✅ **B1–B3 offline CLOSED** / 🟡 B4–B5 live 미검증
Derived from: oracle vs agbrowse gap analysis (docs 01–08)

## 2026-06-24 Re-audit (v0.1.15)

오프라인 벤치(B1–B3)는 v0.1.15에서도 전부 통과. live 컴포넌트(B4–B5 및 B1–B3 일부)는 라이브 브라우저가 필요하여 미검증 상태.

| Benchmark | 상태 (v0.1.15) | 증거 |
| --- | --- | --- |
| B1 send / B2 attach / B3 error (offline) | ✅ 통과 | `npx vitest run test/unit/stability-benchmarks.test.mjs` → **22 passed (22)** (2026-06-24 실행) |
| B3 error code count (목표 ≥12) | ✅ 37/42 | `grep -rhoE "errorCode: ['\"][^'\"]+['\"]" web-ai/ \| sort -u \| wc -l` = 37 리터럴; 직접대입+`\|\|`폴백 포함 throwable 42 — 목표(≥12) 대비 3배+ |
| B4 session resilience (live-only) | 🟡 미검증 | 라이브 브라우저 + Chrome 재시작 필요 |
| B5 response capture (live-only) | 🟡 미검증 | 라이브 브라우저 + Pro 계정 필요 |

테스트 파일(`test/unit/stability-benchmarks.test.mjs`)은 2026-06-08 이후 변경 없으나 v0.1.15 코드 대비 여전히 green.

> 아래 원본 벤치 정의는 그대로 유효하다.

## Purpose

Task-completion benchmarks (WebVoyager, WebArena) measure whether the agent
answers correctly. Stability benchmarks measure whether the browser automation
layer performs its operations reliably — independent of the planner or model.

These benchmarks directly measure the surface area hardened in the P0 patches
and serve as regression gates for future changes.

## Benchmark Categories

### B1 — Send Button Reliability

**What it measures:** Success rate of send button click across DOM variations.

| Metric | Definition | Target |
|--------|-----------|--------|
| `send.selector_coverage` | % of known ChatGPT DOM variations matched by SEND_BUTTON_SELECTORS | ≥95% |
| `send.timeout_adequacy` | Whether timeout values match oracle parity (20s text, 45s attachment) | exact match |
| `send.fallback_chain` | Button click → Enter key fallback path exists | boolean true |
| `send.commit_signals` | Count of independent commit verification signals | ≥4 |

**Testable offline:** selector matching, timeout values, fallback chain existence.
**Requires live browser:** actual send success rate across models (instant/thinking/pro).

### B2 — Attachment Upload Reliability

**What it measures:** Chip detection and upload readiness across file types.

| Metric | Definition | Target |
|--------|-----------|--------|
| `attach.chip_wait_timeout` | Max wait for attachment chip readiness | 45 s |
| `attach.preflight_rejects` | Whether oversized files are rejected before upload | boolean true |
| `attach.file_type_routing` | Image vs non-image file input scoring correctness | 100% |

**Testable offline:** timeout values, preflight logic, scoring function.
**Requires live browser:** actual chip appearance across file types/sizes.

### B3 — Error Classification Coverage

**What it measures:** Whether the error taxonomy covers oracle's failure modes.

| Metric | Definition | Target |
|--------|-----------|--------|
| `error.code_count` | Number of distinct error codes in taxonomy | ≥12 |
| `error.oracle_coverage` | % of oracle error categories mapped to agbrowse codes | ≥80% |
| `error.retry_hint_present` | % of error codes with `retryHint` guidance | 100% |

Oracle error categories (3-tier):
- OracleUserError → maps to `provider.*`, `context.*`
- OracleTransportError → maps to `cdp.*`
- OracleResponseError → maps to `provider.poll-timeout`, `source-audit.failed`

### B4 — Session Resilience (live-only)

**What it measures:** Recovery success after CDP disconnection.

| Metric | Definition | Target |
|--------|-----------|--------|
| `session.reconnect_success` | % of successful reconnections after Chrome restart | ≥90% |
| `session.state_preserved` | Whether page URL survives reconnection | boolean |
| `session.stale_ref_detection` | Whether stale refs from pre-disconnect are rejected | boolean true |

**Requires live browser:** all metrics.

### B5 — Response Capture Completeness (live-only)

**What it measures:** Whether full responses are captured vs truncated.

| Metric | Definition | Target |
|--------|-----------|--------|
| `capture.full_text_rate` | % of responses captured in full (vs truncated) | ≥95% |
| `capture.streaming_recovery` | Whether polling recovers mid-stream after stall | boolean |
| `capture.exactness_score` | answerArtifact exactnessScore distribution | mean ≥0.9 |

**Requires live browser:** all metrics.

## Offline Test Coverage (unit-testable)

Benchmarks B1–B3 have offline-testable components. These are implemented in:
`test/unit/stability-benchmarks.test.mjs`

Running: `npx vitest run test/unit/stability-benchmarks.test.mjs`

## Live Test Protocol

B4–B5 and the live components of B1–B3 require:
1. Chrome with ChatGPT session active
2. agbrowse connected via CDP
3. Pro account (for model switching tests)

These are run manually during QA or via the smoke test harness at
`devlog/_smoke/`.

## Scoring Rules

Same policy as existing benchmarks — no leaderboard claims:
- ✅ Internal regression tracking with pass/fail gates
- ✅ Comparison against oracle baseline thresholds
- ❌ No published "agbrowse stability score" or "X% reliable"
- ❌ No head-to-head claims against oracle or other tools
