# 05 — Pro timeout budget 상속 패치 준비

기준일: 2026-07-10. 이 문서는 `00_index.md:35,41-45`의 05 슬라이스를 **timeout 기본값의
생성·상속·명시 override 계약**으로 제한한다. timeout tier는 provider 의미에 맞춰
`chatgpt-pro=5400s(90분)` / `grok-heavy=3600s` / `deep-research=3600s`로 분리한다. 라이브 DOM에서는 “기본
추론 40분” 문구를 확인하지 못했으므로 40분 상수나 UI 문구 의존 분기를 추가하지
않는다 (`01_ui_contract_evidence.md:99-105,108-113`).

## 0. 실행 계약

| 항목 | 고정 내용 |
| --- | --- |
| Loop archetype | spec-satisfaction / timeout inheritance repair |
| Trigger | timeout 미지정 MCP `web_ai_submit_prompt(model=pro)`가 tier 정보를 잃고 ChatGPT vendor 기본 1200초 deadline을 저장하며, CLI가 후속 poll/watch/resume에도 기본 timeout을 선주입함 |
| Goal | 최초 deadline은 tier-aware하게 생성하고, 후속 실행은 `explicit timeout -> 저장 deadline 잔여 -> tier default` 순서로 같은 예산을 상속 |
| Non-goals | 40분 상수, 동적/학습형 timeout, poll interval backoff, completion/finality 판정, Work 제출/poll 지원 |
| Verifier | `test/unit/web-ai-timeout-default.test.mjs`의 resolver·MCP submit 회귀 + 기존 provider/session/watcher/schema/MCP suites + checkjs 두 게이트 |
| Stop condition | 모든 소유자가 미지정 timeout을 새 vendor 기본으로 바꾸지 않고, explicit override와 만료 deadline 비갱신 케이스가 테스트로 고정됨 |
| Memory artifact | 이 파일 `devlog/_plan/260710_gpt56_update/05_pro_timeout_budget.md` |
| Expected terminal outcomes | DONE: 상속 계약 전부 통과 / BLOCKED: 02·03 적용 후 `model=pro` normalization이 사라짐 / UNSAFE: 저장 deadline을 자동 연장해야만 테스트가 통과함 |
| Escalation condition | 02가 공개 tier를 `model` 외 필드로 옮기면 `deriveTimeoutTier` 입력 adapter를 02와 함께 재확정하고 구현 전에 이 문서를 갱신 |

## 1. 범위와 불변식

### 1.1 IN

- 최초 session deadline 생성 시 `model`/`research`를 기존 `deriveTimeoutTier`와
  `TIER_DEFAULT_TIMEOUT_SEC`로 해석한다.
- 후속 poll/resume가 저장된 절대 deadline의 **잔여 시간만** 소비하도록 공용
  budget resolver를 `session.mjs`에 둔다.
- watch는 `--deadline`/`--timeout`이 실제로 주어진 경우에만 저장 deadline을
  덮어쓴다.
- CLI는 최초 실행(`send`/`query`)에만 tier default를 주입하고, `poll`/`watch`/
  `sessions resume`에서는 timeout 미지정 상태를 보존한다.
- MCP submit은 모델 입력을 그대로 최초 deadline owner에 전달하고, MCP wait/resume는
  저장 deadline 잔여를 사용한다.
- MCP schema는 위 우선순위와 timeout 생략 의미를 값 비의존 문장으로 설명한다.

### 1.2 OUT

- **40분 또는 2400초 상수 신설 금지.** `chatgpt-pro=5400s(90분)`,
  `grok-heavy=3600s`, `deep-research=3600s`의 SSOT는 `session.mjs:394-404`다.
- tier 3분리를 유지한다. ChatGPT Pro만 5400초로 올리고 Grok Heavy와 Deep Research는
  각각 독립 tier에서 3600초를 사용한다.
- 과거 실행시간을 학습하는 adaptive timeout, 모델별 poll 간격, heartbeat 정책은
  추가하지 않는다. 2026-06-19 결정도 고정 tier table만 채택했다
  (`devlog/_fin/260619_timeout_adaptive_scaling/00_overview.md:22-32`).
- response text 안정성, Stop 버튼, recovery finality, `status="complete"` 판정은
  변경하지 않는다. false-complete는 별도 계획의 소유 범위다
  (`devlog/_plan/260625_webai_streaming_recovery_false_complete/00_overview.md:8-23,35-50`).
- Gemini/Grok poller 내부 fallback 전체를 재작성하지 않는다. 다만 공용 resume/MCP
  경계가 넘겨주는 timeout은 같은 resolver 결과를 소비한다.
- Work surface 제출·poll/session 재사용은 04의 재프로브 전까지 열지 않는다
  (`01_ui_contract_evidence.md:117-129`).

### 1.3 SSOT와 우선순위

1. **explicit timeout**: 양수 `input.timeout`이 있으면 새 상대 예산으로 사용한다.
   사용자가 명시한 값이 저장 deadline보다 우선한다.
2. **stored session deadline remainder**: timeout이 없고 유효한
   `session.deadlineAt`이 있으면 `(deadlineAt - now) / 1000`만 사용한다. 유효하지만
   이미 만료된 deadline은 기존 provider poll API의 하한인 `1`초로 clamp한다. tier
   default로 재무장하지 않는다.
3. **tier default**: 저장 deadline 자체가 없거나 파싱 불가능할 때만
   `resolveTimeoutDefaultSec()`를 사용한다. 입력의 `model/research`, 그다음 저장된
   `envelopeSummary.model`/`researchMode`, 마지막으로 vendor default 순서다.

절대 deadline은 실행 전체 예산이고 watcher의 `pollTimeoutSec`은 한 tick의 짧은
관찰 창이다. 둘을 합치거나 watcher tick마다 deadline을 갱신하지 않는다
(`watcher.mjs:26-29,71-76,173-181,228-247`).

## 2. 현재 실패 경로

### 2.1 최초 MCP Pro submit이 1200초로 저장됨

현재 MCP는 `args`를 그대로 ChatGPT sender에 전달한다
(`mcp-server.mjs:191-210`). `sendWebAi()`는 그 입력으로 session을 만들면서
`resolveDeadlineAt(input, 'chatgpt')`를 호출한다 (`chatgpt.mjs:157-195`). 그러나
`resolveDeadlineAt()`은 explicit deadline/timeout이 없으면 `model=pro`를 보지 않고
`VENDOR_DEFAULT_TIMEOUT_SEC.chatgpt` 1200초를 사용한다
(`session.mjs:371-385`).

```text
web_ai_submit_prompt({ model: "pro", timeout: omitted })
  -> mcp-server.mjs:204-210       args.model 보존, timeout 없음
  -> chatgpt.mjs:190-195          resolveDeadlineAt(input, "chatgpt")
  -> session.mjs:382-385          vendor default 1200
  -> session.deadlineAt           now + 1200s (오류)
```

기존 tier SSOT와 derive 함수는 이미 존재한다. 이 표를 `chatgpt-pro=5400`,
`grok-heavy=3600`, `deep-research=3600`으로 분리하고 ChatGPT/Grok model normalizer의
결과를 provider별 tier 이름으로 매핑한다 (`session.mjs:388-413,417-452`). 별도 MCP
상수를 만들 이유는 없다.

### 2.2 후속 명령이 저장 deadline을 가림

CLI input builder는 모든 command에서 timeout 생략을 tier/vendor default 숫자로
바꾼다 (`cli.mjs:640-657`). 모델이 없는 `poll`/`watch`/`sessions resume`에서는
ChatGPT 1200초가 들어간다. 이 값은 다음 경로에서 explicit처럼 취급된다.

- `pollWebAi()`는 session을 읽기 전에 `input.timeout || 1200`을 확정한다
  (`chatgpt.mjs:327-353`).
- watcher는 그 timeout으로 새 `deadlineAt`을 만들고 저장 session을 덮어쓴다
  (`watcher.mjs:48-72,308-325`).
- generic resume는 CLI input을 그대로 poller에 spread한다
  (`cli-sessions.mjs:92-126`).
- DR resume는 caller 입력과 무관하게 자체 1,200,000ms 기본값을 사용한다
  (`chatgpt-deep-research.mjs:392-405`).
- MCP wait/resume는 `args.timeout`만 전달하므로 ChatGPT poll fallback 1200초로
  돌아간다 (`mcp-server.mjs:241-265`).

따라서 생성만 tier-aware하게 바꾸면 충분하지 않다. 후속 경계가 “미지정”을 보존하고
저장 deadline 잔여를 먼저 해석해야 한다.

## 3. 공용 budget resolver

### 3.1 `web-ai/session.mjs` — tier 3분리와 최초 deadline의 tier-aware 생성

#### Tier table/normalization Before (`web-ai/session.mjs:388-442`, verbatim)

```js
/**
 * Hardcoded default poll timeout (seconds) per normalized model tier.
 * Long-reasoning tiers (pro / deep-research) get an hour; shorter tiers scale down.
 * An explicit --timeout / --deadline always overrides these defaults.
 * @type {Readonly<Record<string, number>>}
 */
export const TIER_DEFAULT_TIMEOUT_SEC = Object.freeze({
    instant: 120,
    thinking: 600,
    pro: 3600,
    'deep-research': 3600,
});

/** Long-reasoning ceiling (seconds), exported for cross-module reuse (e.g. lease TTLs). */
export const PRO_TIMEOUT_SEC = TIER_DEFAULT_TIMEOUT_SEC.pro;

/**
 * Resolve a tier name to a default timeout (seconds), falling back to the vendor
 * default and finally 1200s when the tier is unknown.
 * @param {string|null} tier
 * @param {string} [vendor]
 * @returns {number}
 */
export function tierDefaultTimeoutSec(tier, vendor = 'chatgpt') {
    if (tier && TIER_DEFAULT_TIMEOUT_SEC[tier] != null) return TIER_DEFAULT_TIMEOUT_SEC[tier];
    return VENDOR_DEFAULT_TIMEOUT_SEC[vendor] || 1200;
}

/**
 * Map (vendor, model, research) to a normalized timeout tier, or null when unknown.
 * Reuses the existing per-vendor model normalizers; deep-research is signalled by
 * the separate `research` flag (chatgpt) or the deep-think alias (gemini).
 * @param {string} vendor
 * @param {unknown} model
 * @param {unknown} [research]
 * @returns {string|null}
 */
export function deriveTimeoutTier(vendor, model, research) {
    if (vendor === 'gemini') {
        if (isGeminiDeepThinkChoice(model)) return 'deep-research';
        const m = normalizeGeminiModelChoice(model);
        if (m === 'flash-lite') return 'instant';
        if (m === 'flash' || m === 'pro') return 'thinking';
        return null;
    }
    if (vendor === 'grok') {
        const m = normalizeGrokModelChoice(model);
        if (m === 'heavy') return 'pro';
        if (m === 'fast') return 'instant';
        return m ? 'thinking' : null;
    }
    // chatgpt (default vendor)
    if (String(research || '').trim().toLowerCase() === 'deep') return 'deep-research';
    return normalizeChatGptModelChoice(model);
}
```

#### Tier table/normalization After

```js
/**
 * Hardcoded default poll timeout (seconds) per normalized model tier.
 * Provider-specific long-reasoning tiers stay independent so one budget change
 * cannot silently change another provider's behavior.
 * An explicit --timeout / --deadline always overrides these defaults.
 * @type {Readonly<Record<string, number>>}
 */
export const TIER_DEFAULT_TIMEOUT_SEC = Object.freeze({
    instant: 120,
    thinking: 600,
    'chatgpt-pro': 5400,
    'grok-heavy': 3600,
    'deep-research': 3600,
});

/** ChatGPT Pro ceiling (seconds), exported for cross-module reuse (e.g. lease TTLs). */
export const CHATGPT_PRO_TIMEOUT_SEC = TIER_DEFAULT_TIMEOUT_SEC['chatgpt-pro'];
/** Backward-compatible alias; new consumers use CHATGPT_PRO_TIMEOUT_SEC. */
export const PRO_TIMEOUT_SEC = CHATGPT_PRO_TIMEOUT_SEC;

/**
 * Resolve a tier name to a default timeout (seconds), falling back to the vendor
 * default and finally 1200s when the tier is unknown.
 * @param {string|null} tier
 * @param {string} [vendor]
 * @returns {number}
 */
export function tierDefaultTimeoutSec(tier, vendor = 'chatgpt') {
    if (tier && TIER_DEFAULT_TIMEOUT_SEC[tier] != null) return TIER_DEFAULT_TIMEOUT_SEC[tier];
    return VENDOR_DEFAULT_TIMEOUT_SEC[vendor] || 1200;
}

/**
 * Map (vendor, model, research) to a normalized timeout tier, or null when unknown.
 * Reuses the existing per-vendor model normalizers; deep-research is signalled by
 * the separate `research` flag (chatgpt) or the deep-think alias (gemini).
 * @param {string} vendor
 * @param {unknown} model
 * @param {unknown} [research]
 * @returns {string|null}
 */
export function deriveTimeoutTier(vendor, model, research) {
    if (vendor === 'gemini') {
        if (isGeminiDeepThinkChoice(model)) return 'deep-research';
        const m = normalizeGeminiModelChoice(model);
        if (m === 'flash-lite') return 'instant';
        if (m === 'flash' || m === 'pro') return 'thinking';
        return null;
    }
    if (vendor === 'grok') {
        const m = normalizeGrokModelChoice(model);
        if (m === 'heavy') return 'grok-heavy';
        if (m === 'fast') return 'instant';
        return m ? 'thinking' : null;
    }
    // chatgpt (default vendor)
    if (String(research || '').trim().toLowerCase() === 'deep') return 'deep-research';
    const m = normalizeChatGptModelChoice(model);
    return m === 'pro' ? 'chatgpt-pro' : m;
}
```

`tierDefaultTimeoutSec()`는 키 조회 계약이 그대로이므로 변경하지 않는다. 기존
`PRO_TIMEOUT_SEC` export는 제거하지 않고 5400을 가리키는 호환 alias로 유지한다.

#### Deadline resolver Before (`web-ai/session.mjs:371-386`)

```js
/** @type {Record<string, number>} */
const VENDOR_DEFAULT_TIMEOUT_SEC = { chatgpt: 1200, gemini: 1200, grok: 600 };

/**
 * @param {WebAiEnvelope} [input]
 * @param {string} [vendor]
 * @returns {string}
 */
export function resolveDeadlineAt(input = {}, vendor = 'chatgpt') {
    if (input.deadlineAt) return new Date(input.deadlineAt).toISOString();
    if (input.deadline) return new Date(input.deadline).toISOString();
    const seconds = Number(input.timeout) > 0
        ? Number(input.timeout)
        : VENDOR_DEFAULT_TIMEOUT_SEC[vendor] || 1200;
    return new Date(Date.now() + seconds * 1000).toISOString();
}
```

#### Deadline resolver After

```js
/** @type {Record<string, number>} */
const VENDOR_DEFAULT_TIMEOUT_SEC = { chatgpt: 1200, gemini: 1200, grok: 600 };

/**
 * @param {WebAiEnvelope} [input]
 * @param {string} [vendor]
 * @returns {string}
 */
export function resolveDeadlineAt(input = {}, vendor = 'chatgpt') {
    if (input.deadlineAt) return new Date(input.deadlineAt).toISOString();
    if (input.deadline) return new Date(input.deadline).toISOString();
    const seconds = Number(input.timeout) > 0
        ? Number(input.timeout)
        : resolveTimeoutDefaultSec(input, vendor);
    return new Date(Date.now() + seconds * 1000).toISOString();
}
```

함수 선언 hoisting을 사용하므로 아래에 선언된 `resolveTimeoutDefaultSec()`를 그대로
호출할 수 있다. `resolveTimeoutDefaultSec()`는 `deriveTimeoutTier()`를 거쳐 기존
`TIER_DEFAULT_TIMEOUT_SEC`를 읽는다 (`session.mjs:394-452`). explicit
`deadlineAt/deadline/timeout`의 기존 우선순위는 유지한다.

이 한 변경으로 CLI를 거치지 않는 MCP submit도 `model=pro`를 보존한 채
`chatgpt-pro` tier의 `now + 5400s` deadline을 생성한다. `mcp-server.mjs` submit 경계에 별도 default를
넣지 않는다. MCP는 전달자이고 deadline 생성 SSOT는 `session.mjs`다.

### 3.2 `web-ai/session.mjs` — 잔여 budget resolver 추가

`resolveTimeoutDefaultSec()` 바로 뒤에 다음 export를 추가한다. 새 상수는 없다.

```js
/**
 * Resolve one polling budget in seconds.
 * Priority: explicit timeout -> stored deadline remainder -> tier/vendor default.
 * @param {WebAiEnvelope} [input]
 * @param {WebAiSession|null} [session]
 * @param {string} [vendor]
 * @param {number} [nowMs]
 * @returns {number}
 */
export function resolveTimeoutBudgetSec(
    input = {},
    session = null,
    vendor = 'chatgpt',
    nowMs = Date.now(),
) {
    const explicitTimeoutSec = Number(input.timeout);
    if (Number.isFinite(explicitTimeoutSec) && explicitTimeoutSec > 0) {
        return explicitTimeoutSec;
    }

    const storedDeadlineMs = Date.parse(String(session?.deadlineAt || ''));
    if (Number.isFinite(storedDeadlineMs)) {
        return Math.max(1, (storedDeadlineMs - nowMs) / 1000);
    }

    const summary = session?.envelopeSummary || {};
    return resolveTimeoutDefaultSec({
        model: input.model ?? summary.model,
        research: input.research ?? session?.researchMode ?? summary.research,
    }, session?.vendor || vendor);
}
```

설계 이유:

- 1초보다 큰 잔여값은 fractional seconds를 허용해 `ceil` 때문에 저장 deadline을
  연장하지 않는다.
- 유효한 만료 deadline은 기존 poller들의 `Math.max(1, ...)` 계약과 `timeout || default`
  호환을 위해 1초만 반환한다. “deadline이 존재하지만 만료”와 “deadline이 없음”을
  구분해야 1200/5400/3600초 tier/vendor default가 새 실행 창을 열지 않는다
  (`chatgpt.mjs:327-330`, `gemini-live.mjs:423-441`, `grok-live.mjs:251-269`).
- resume 입력에는 모델이 보통 없으므로 저장 `envelopeSummary.model`을 fallback으로
  읽는다. Deep Research는 `sendDeepResearch()`가 기록하는 `researchMode='deep'`을
  사용한다 (`chatgpt-deep-research.mjs:216-219`).
- vendor는 저장 session을 우선한다. CLI/MCP에서 잘못 전달된 vendor가 저장 session의
  예산 tier를 바꾸지 못한다.
- `nowMs`는 테스트와 poll loop가 동일한 기준 시각을 사용하기 위한 주입점이다. 시간
  provider나 새 clock abstraction은 만들지 않는다.

## 4. 실행 소유자별 before/after diff

### 4.1 `web-ai/chatgpt.mjs` — 단일 poll fallback

import에 `resolveTimeoutBudgetSec`를 추가하고 timeout 계산을 session 조회 뒤로 옮긴다.

#### Before (`web-ai/chatgpt.mjs:327-354`)

```js
export async function pollWebAi(deps, input = {}) {
    const vendor = input.vendor || 'chatgpt';
    const timeout = Math.max(1, Number(input.timeout || 1200));
    const page = await requireChatGptPage(deps);
    const url = page.url();
    const session = input.session
        ? getSession(input.session)
        : findActiveSession({
            vendor,
            targetId: await deps.getTargetId?.().catch(() => null) || null,
            conversationUrl: url,
        });
    const baseline = (session && sessionToBaseline(session))
        || getBaseline(vendor, url)
        || getLatestBaseline(vendor, { sameHostUrl: url });
    if (!baseline) throw new WebAiError({
        errorCode: 'provider.poll-timeout',
        stage: 'poll',
        vendor: 'chatgpt',
        retryHint: 'poll-or-resume',
        message: 'baseline required. Run web-ai send or query first.',
    });
    const copyTraceCtx = session && input.allowCopyMarkdownFallback === true
        ? createTraceContext(session.sessionId)
        : null;

    const deadline = Date.now() + timeout * 1000;
    const startedAt = Date.now();
```

#### After

```js
export async function pollWebAi(deps, input = {}) {
    const vendor = input.vendor || 'chatgpt';
    const page = await requireChatGptPage(deps);
    const url = page.url();
    const session = input.session
        ? getSession(input.session)
        : findActiveSession({
            vendor,
            targetId: await deps.getTargetId?.().catch(() => null) || null,
            conversationUrl: url,
        });
    const baseline = (session && sessionToBaseline(session))
        || getBaseline(vendor, url)
        || getLatestBaseline(vendor, { sameHostUrl: url });
    if (!baseline) throw new WebAiError({
        errorCode: 'provider.poll-timeout',
        stage: 'poll',
        vendor: 'chatgpt',
        retryHint: 'poll-or-resume',
        message: 'baseline required. Run web-ai send or query first.',
    });
    const copyTraceCtx = session && input.allowCopyMarkdownFallback === true
        ? createTraceContext(session.sessionId)
        : null;

    const startedAt = Date.now();
    const timeout = resolveTimeoutBudgetSec(input, session, vendor, startedAt);
    const deadline = startedAt + timeout * 1000;
```

동일한 `startedAt`을 resolver와 local deadline 산식에 사용한다. 저장 deadline이
10분 남았다면 600초만 poll하고, ChatGPT Pro default 5400초를 매 poll마다 다시 시작하지
않는다. explicit `timeout`은 저장 deadline보다 우선하므로 사용자가 의도적으로 새
관찰 창을 줄 수 있다.

만료 deadline은 provider poll API 하한인 1초만 허용한다. 이후 기존 timeout/recovery
상태 전이는 유지하며 completion 판정 코드는 건드리지 않는다.

### 4.2 `web-ai/watcher.mjs` — 명시 override일 때만 저장 deadline 변경

watcher의 30초 `pollTimeoutSec`은 tick budget으로 유지한다
(`watcher.mjs:26-29,499-510`). 저장 deadline override와 이름·flag를 분리한다.

#### Before

`web-ai/watcher.mjs:69-72`:

```js
    let final = null;
    try {
        if (options.deadlineAt) updateSession(options.sessionId, { deadlineAt: options.deadlineAt });
        await emit({ type: 'watch.start', status: 'watching', intervalMs: options.intervalMs, pollTimeoutSec: options.pollTimeoutSec });
```

`web-ai/watcher.mjs:308-334`:

```js
export function normalizeWatchOptions(input = {}) {
    const sessionId = input.session || input.sessionId || null;
    const intervalMs = durationToMs(input.interval || input.intervalMs || DEFAULT_WATCH_INTERVAL_MS, 's');
    const pollTimeoutSec = Number(input.pollTimeoutSec || input.pollTimeout || DEFAULT_WATCH_POLL_TIMEOUT_SEC);
    const maxIterations = input.maxIterations === undefined || input.maxIterations === null || input.maxIterations === ''
        ? null : Number(input.maxIterations);
    const deadlineAt = input.deadline
        ? toIsoDeadline(input.deadline, 'deadline')
        : input.timeout && Number(input.timeout) > 0
            ? new Date(Date.now() + Number(input.timeout) * 1000).toISOString()
            : input.deadlineAt || null;
    return {
        ...input,
        sessionId,
        intervalMs,
        pollTimeoutSec: Number.isFinite(pollTimeoutSec) && pollTimeoutSec > 0 ? pollTimeoutSec : DEFAULT_WATCH_POLL_TIMEOUT_SEC,
        maxIterations: Number.isFinite(maxIterations) && (/** @type {number} */ (maxIterations)) > 0 ? maxIterations : null,
        deadlineAt,
        once: input.once === true,
        navigate: input.navigate === true,
        json: input.json === true,
        captureEvents: input.captureEvents === true,
        lockStaleMs: durationToMs(input.lockStaleMs || DEFAULT_WATCH_LOCK_STALE_MS, 'ms'),
        domHashMaxChars: Number(input.domHashMaxChars || 32768),
        navigateTimeoutMs: Number(input.navigateTimeoutMs || 30_000),
    };
}
```

#### After

첫 번째 범위 replacement:

```js
    let final = null;
    try {
        if (options.hasExplicitDeadlineOverride && options.deadlineAt) {
            updateSession(options.sessionId, { deadlineAt: options.deadlineAt });
        }
        await emit({ type: 'watch.start', status: 'watching', intervalMs: options.intervalMs, pollTimeoutSec: options.pollTimeoutSec });
```

두 번째 범위 replacement:

```js
export function normalizeWatchOptions(input = {}) {
    const sessionId = input.session || input.sessionId || null;
    const intervalMs = durationToMs(input.interval || input.intervalMs || DEFAULT_WATCH_INTERVAL_MS, 's');
    const pollTimeoutSec = Number(input.pollTimeoutSec || input.pollTimeout || DEFAULT_WATCH_POLL_TIMEOUT_SEC);
    const maxIterations = input.maxIterations === undefined || input.maxIterations === null || input.maxIterations === ''
        ? null : Number(input.maxIterations);
    const hasExplicitTimeout = input.timeout !== undefined
        && input.timeout !== null
        && input.timeout !== '';
    const deadlineAt = input.deadline
        ? toIsoDeadline(input.deadline, 'deadline')
        : hasExplicitTimeout && Number(input.timeout) > 0
            ? new Date(Date.now() + Number(input.timeout) * 1000).toISOString()
            : input.deadlineAt || null;
    return {
        ...input,
        sessionId,
        intervalMs,
        pollTimeoutSec: Number.isFinite(pollTimeoutSec) && pollTimeoutSec > 0 ? pollTimeoutSec : DEFAULT_WATCH_POLL_TIMEOUT_SEC,
        maxIterations: Number.isFinite(maxIterations) && (/** @type {number} */ (maxIterations)) > 0 ? maxIterations : null,
        deadlineAt,
        hasExplicitDeadlineOverride: Boolean(deadlineAt),
        once: input.once === true,
        navigate: input.navigate === true,
        json: input.json === true,
        captureEvents: input.captureEvents === true,
        lockStaleMs: durationToMs(input.lockStaleMs || DEFAULT_WATCH_LOCK_STALE_MS, 'ms'),
        domHashMaxChars: Number(input.domHashMaxChars || 32768),
        navigateTimeoutMs: Number(input.navigateTimeoutMs || 30_000),
    };
}
```

`input.deadlineAt`은 programmatic caller가 직접 넘긴 explicit override로 본다. CLI가
미지정 timeout을 더는 watch input에 주입하지 않는 것이 이 guard의 전제다(§4.5).
watch start 시 override가 없으면 line 71의 `updateSession` 자체가 실행되지 않아 기존
Pro deadline이 보존된다.

### 4.3 `web-ai/cli-sessions.mjs` — 일반 resume

`session.mjs` import에 `resolveTimeoutBudgetSec`를 추가한다. resolver 호출은 lock 안에서
다시 읽은 `refreshed` session에 대해 수행한다.

#### Before (`web-ai/cli-sessions.mjs:111-126`)

```js
        const pollInput = {
            ...input,
            vendor: session.vendor,
            session: id,
            allowCopyMarkdownFallback: input.allowCopyMarkdownFallback === true,
        };
        const pollFn = session.vendor === 'gemini' ? geminiPollWebAi : session.vendor === 'grok' ? grokPollWebAi : pollWebAi;
        const result = await withSessionCommandLock(id, () => withSessionPage(deps, id, async ({ page, targetId, session: refreshed }) => {
            const sessionDeps = {
                ...deps,
                getPage: async () => page,
                getTargetId: async () => targetId,
                getCdpSession: async () => /** @type {any} */ (page).context?.().newCDPSession?.(page),
            };
            return pollFn(sessionDeps, { ...pollInput, vendor: refreshed.vendor, session: refreshed.sessionId });
        }));
```

#### After

```js
        const pollInput = {
            ...input,
            vendor: session.vendor,
            session: id,
            allowCopyMarkdownFallback: input.allowCopyMarkdownFallback === true,
        };
        const pollFn = session.vendor === 'gemini' ? geminiPollWebAi : session.vendor === 'grok' ? grokPollWebAi : pollWebAi;
        const result = await withSessionCommandLock(id, () => withSessionPage(deps, id, async ({ page, targetId, session: refreshed }) => {
            const sessionDeps = {
                ...deps,
                getPage: async () => page,
                getTargetId: async () => targetId,
                getCdpSession: async () => /** @type {any} */ (page).context?.().newCDPSession?.(page),
            };
            return pollFn(sessionDeps, {
                ...pollInput,
                vendor: refreshed.vendor,
                session: refreshed.sessionId,
                timeout: resolveTimeoutBudgetSec(input, refreshed, refreshed.vendor),
            });
        }));
```

이 경계에서 ChatGPT/Gemini/Grok resume 모두 같은 우선순위를 얻는다. ChatGPT poller도
resolver를 호출하지만 여기서 넘긴 값은 이미 lock 안의 최신 session으로 계산된 실행
budget이며, provider별 poller API를 바꾸지 않는다. explicit timeout이 있으면 같은 값이
그대로 반환된다.

### 4.4 `web-ai/chatgpt-deep-research.mjs` — DR resume 20분 제거

`session.mjs` import에 `resolveTimeoutBudgetSec`를 추가한다. caller가 explicit/remaining
budget을 넘길 수 있게 유지하면서 자체 1,200,000ms 기본값을 제거한다.

#### Before (`web-ai/chatgpt-deep-research.mjs:403-405`)

```js
export async function resumeDeepResearch(page, deps, { session, timeoutMs = 1_200_000, stableMs = 5_000 }) {
    const warnings = ['deep-research-resumed'];
    const deadline = Date.now() + timeoutMs;
```

#### After

```js
export async function resumeDeepResearch(page, deps, { session, timeoutMs, stableMs = 5_000 }) {
    const warnings = ['deep-research-resumed'];
    const resolvedTimeoutMs = timeoutMs
        ?? resolveTimeoutBudgetSec({}, session, session.vendor || 'chatgpt') * 1000;
    const deadline = Date.now() + resolvedTimeoutMs;
```

그리고 `cli-sessions.mjs:99-108`의 DR 분기에서 generic resume와 같은 최신 session
resolver를 사용해 explicit timeout도 전달한다.

```js
return resumeDeepResearch(page, sessionDeps, {
    session: refreshed,
    timeoutMs: resolveTimeoutBudgetSec(input, refreshed, refreshed.vendor) * 1000,
});
```

저장 deadline이 있으면 그 잔여가 20분 상수보다 우선한다. deadline이 없는 legacy DR
session만 `researchMode='deep' -> deep-research tier default`로 fallback한다.

### 4.5 `web-ai/cli.mjs` — 명령별 timeout 주입

최초 `send/query`는 기존 동작처럼 tier default를 계산해 DR send와 multi-turn의 현재
상대 timeout 소비자도 보호한다. 후속 `poll/watch/sessions`는 undefined를 보존한다.

#### Before (`web-ai/cli.mjs:640-657`)

```js
    const input = {
        vendor: (command === 'watch' && !vendorExplicit) ? null : values.vendor,
        url: values.url,
        prompt: values.prompt,
        system: values.system,
        project: values.project,
        goal: values.goal,
        context: values.context,
        question: values.question,
        output: values.output,
        constraints: values.constraints,
        // When --timeout is omitted, default scales by model tier (instant 120s,
        // thinking 600s, chatgpt-pro 5400s, grok-heavy/deep-research 3600s)
        // so a long pro run is not capped
        // at the legacy 1200s. An explicit --timeout still wins.
        timeout: values.timeout != null
            ? values.timeout
            : resolveTimeoutDefaultSec({ model: values.model, research: values.research }, values.vendor || 'chatgpt'),
        deadline: values.deadline,
```

#### After

```js
    const timeout = values.timeout != null
        ? values.timeout
        : ['send', 'query'].includes(command)
            ? resolveTimeoutDefaultSec({ model: values.model, research: values.research }, values.vendor || 'chatgpt')
            : undefined;
    const input = {
        vendor: (command === 'watch' && !vendorExplicit) ? null : values.vendor,
        url: values.url,
        prompt: values.prompt,
        system: values.system,
        project: values.project,
        goal: values.goal,
        context: values.context,
        question: values.question,
        output: values.output,
        constraints: values.constraints,
        // When --timeout is omitted, default scales by model tier (instant 120s,
        // thinking 600s, chatgpt-pro 5400s, grok-heavy/deep-research 3600s)
        // so a long pro run is not capped
        // at the legacy 1200s. An explicit --timeout still wins.
        timeout,
        deadline: values.deadline,
```

`send/query --session`은 새 prompt를 보내는 명령이므로 새 tier budget을 받는다
(`cli.mjs:1297-1326`). `poll --session`, `watch --session`, `sessions resume`는 이미 보낸
응답을 기다리므로 저장 deadline을 상속한다 (`cli.mjs:1133-1158,735-747`). 이 구분은
명령 의미에 기반하며 Pro 값 자체에는 의존하지 않는다.

### 4.6 `web-ai/mcp-server.mjs` — submit pass-through와 wait/resume 상속

#### Submit: 의도적 no-change (`web-ai/mcp-server.mjs:203-211`)

```js
        return tabMutex.runExclusive(tabKey, () =>
            withMcpActiveCommand(name, provider, deps, args, () => sendByProvider(provider, deps, {
                ...args,
                vendor: provider,
                inlineOnly: args.inlineOnly !== false,
                attachmentPolicy: 'inline-only',
                reasoningEffort: args.effort || args.reasoningEffort,
            })),
        );
```

여기에 tier default 값인 `5400`/`3600`을 넣지 않는다. `args.model='pro'`와 timeout 부재가
`chatgpt.mjs:194 -> resolveDeadlineAt()`까지 전달되는 것이 계약이다. §3.1의 생성
resolver가 이 경로를 고친다. 테스트는 실제 MCP dispatch가 timeout을 합성하지 않고
Pro deadline을 얻는지 고정한다.

#### Wait/resume Before (`web-ai/mcp-server.mjs:259-266`)

```js
            return withMcpActiveCommand(name, provider, sessionDeps, sessionArgs, () =>
                pollByProvider(provider, sessionDeps, {
                    ...args,
                    vendor: session.vendor || provider,
                    session: session.sessionId,
                    timeout: args.timeout,
                }),
            );
```

#### Wait/resume After

`session.mjs` import에 `resolveTimeoutBudgetSec`를 추가한다.

```js
            return withMcpActiveCommand(name, provider, sessionDeps, sessionArgs, () =>
                pollByProvider(provider, sessionDeps, {
                    ...args,
                    vendor: session.vendor || provider,
                    session: session.sessionId,
                    timeout: resolveTimeoutBudgetSec(
                        args,
                        session,
                        session.vendor || provider,
                    ),
                }),
            );
```

MCP가 explicit `timeout`을 주면 resolver의 1순위가 그대로 반환한다. 생략하면
`withSessionPage`가 제공한 최신 session deadline 잔여를 사용한다
(`mcp-server.mjs:246-268`).

### 4.7 `web-ai/tool-schema.mjs` — timeout 생략 의미 서술

숫자 상수를 설명문에 복제하지 않는다. 세 tool의 timeout은 양수 초 단위 explicit
override임을 고정한다.

#### Before

`web-ai/tool-schema.mjs:49-76`:

```js
    web_ai_submit_prompt: {
        description: `Submit prompt to ChatGPT/Gemini/Grok web UI.${MCP_WEB_AI_DEFERRED_NOTE}`,
        inputSchema: objectSchema({
            provider: { ...providerSchema, default: 'chatgpt' },
            vendor: providerSchema,
            model: { type: 'string' },
            effort: { type: 'string' },
            reasoningEffort: { type: 'string' },
            prompt: { type: 'string', minLength: 1 },
            system: { type: 'string' },
            context: { type: 'string' },
            filePath: { type: 'string' },
            url: optionalUrlSchema,
            inlineOnly: { type: 'boolean', default: true },
            timeout: { type: 'number' },
            maxUploadFileSize: { type: 'number', minimum: 1 },
            policy: policySchema,
        }, ['prompt']),
    },
    web_ai_wait_response: {
        description: 'Wait for a stored provider session response. Long runs may return a recoverable timeout; preserve sessionId and retry wait/resume or CLI poll.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: providerSchema,
            vendor: providerSchema,
            timeout: { type: 'number' },
        }, ['sessionId']),
    },
```

`web-ai/tool-schema.mjs:95-103`:

```js
    web_ai_session_resume: {
        description: 'Resume a stored provider session by ID through session-bound recovery. Long runs may need repeated waits or CLI poll.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: providerSchema,
            vendor: providerSchema,
            timeout: { type: 'number' },
        }, ['sessionId']),
    },
```

#### After

```js
    web_ai_submit_prompt: {
        description: `Submit prompt to ChatGPT/Gemini/Grok web UI. When timeout is omitted, the selected model tier supplies the persisted session deadline.${MCP_WEB_AI_DEFERRED_NOTE}`,
        inputSchema: objectSchema({
            provider: { ...providerSchema, default: 'chatgpt' },
            vendor: providerSchema,
            model: { type: 'string' },
            effort: { type: 'string' },
            reasoningEffort: { type: 'string' },
            prompt: { type: 'string', minLength: 1 },
            system: { type: 'string' },
            context: { type: 'string' },
            filePath: { type: 'string' },
            url: optionalUrlSchema,
            inlineOnly: { type: 'boolean', default: true },
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit submit timeout in seconds; overrides the selected tier default.',
            },
            maxUploadFileSize: { type: 'number', minimum: 1 },
            policy: policySchema,
        }, ['prompt']),
    },
    web_ai_wait_response: {
        description: 'Wait for a stored provider session response. When timeout is omitted, inherit the remaining stored session deadline before tier/vendor fallback; preserve sessionId after a recoverable timeout.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: providerSchema,
            vendor: providerSchema,
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit wait timeout in seconds; overrides the remaining stored session deadline.',
            },
        }, ['sessionId']),
    },
```

```js
    web_ai_session_resume: {
        description: 'Resume a stored provider session through session-bound recovery. When timeout is omitted, inherit the remaining stored session deadline before tier/vendor fallback.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: providerSchema,
            vendor: providerSchema,
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit resume timeout in seconds; overrides the remaining stored session deadline.',
            },
        }, ['sessionId']),
    },
```

“40분”, “2400”, `chatgpt-pro=5400`/`grok-heavy=3600`/`deep-research=3600` 같은 값은
schema 문구에 쓰지 않는다. 값이 바뀌어도 schema 계약은
유효해야 한다. 기존 deferred note와 recoverable timeout/sessionId 안내는 보존한다
(`tool-schema.mjs:49-75,95-102`).

## 5. 테스트 diff — `test/unit/web-ai-timeout-default.test.mjs`

기존 tier table/derive/default 5개 테스트를 보존한다
(`test/unit/web-ai-timeout-default.test.mjs:1-66`). import에 `resolveDeadlineAt`,
`resolveTimeoutBudgetSec`, Vitest의 `vi/afterEach`, MCP 회귀에 필요한 dynamic import를
추가한다.

### 5.1 resolver 우선순위

fake system time을 `2026-07-10T00:00:00.000Z`로 고정하고 다음을 추가한다.

1. **최초 ChatGPT Pro deadline**: `resolveDeadlineAt({ model: 'pro' }, 'chatgpt')`가
   정확히 `now + TIER_DEFAULT_TIMEOUT_SEC['chatgpt-pro'] * 1000`, 즉 5400초다.
2. **explicit 생성 override**: `{ model:'pro', timeout:45 }`는 45초이고,
   `{ deadline: iso }`는 그대로다.
3. **explicit poll 우선**: 저장 deadline 10분 + Pro tier가 있어도
   `resolveTimeoutBudgetSec({ timeout:30 }, session, 'chatgpt', now)`는 30이다.
4. **잔여 deadline 상속**: 저장 deadline `now + 10분`이면 600이다. 1분 뒤 같은
   deadline은 540이며 5400/3600 또는 1200으로 reset되지 않는다.
5. **만료 비갱신**: 저장 deadline `now - 1ms`는 poll API 하한 1초다. Pro tier
   fallback을 사용하지 않는다.
6. **3-tier fallback 조건**: deadline이 없는 저장 session에서
   ChatGPT `envelopeSummary.model='pro'`는 `chatgpt-pro` 5400, Grok
   `envelopeSummary.model='heavy'`는 `grok-heavy` 3600, `researchMode='deep'`은
   `deep-research` 3600이다. 모델 없는 Grok은 기존 vendor fallback 600이다.
7. **비혼입 회귀**: Grok Heavy는 `chatgpt-pro` 5400을 소비하지 않고 정확히
   `grok-heavy` 3600이며, Gemini Deep Think는 `chatgpt-pro`/`grok-heavy`가 아닌
   `deep-research` 3600이다.
8. **손상 deadline**: 파싱 불가능한 legacy deadline은 저장 model tier fallback을
   사용한다. 유효하지만 만료된 deadline과 구분한다.

각 fake timer 테스트 뒤 `vi.useRealTimers()`를 복구한다.

### 5.2 MCP submit 회귀 — CLI 비경유 경로

같은 파일의 마지막 describe에서 `vi.doMock('../../web-ai/chatgpt.mjs', ...)`와 dynamic
`import('../../web-ai/mcp-server.mjs')`를 사용한다. mocked `sendWebAi`는 전달받은 실제
input을 캡처하고 **real** `resolveDeadlineAt(input, 'chatgpt')` 결과를 반환한다.

호출:

```js
await handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
        name: 'web_ai_submit_prompt',
        arguments: { prompt: 'budget probe', model: 'pro' },
    },
}, {});
```

assert:

- mocked sender input의 `model === 'pro'`.
- sender input에 `timeout` own-property가 없음. MCP 경계가 default를 합성하지 않음.
- 반환 `deadlineAt - now === TIER_DEFAULT_TIMEOUT_SEC['chatgpt-pro'] * 1000`(5400초).
- explicit `timeout: 77` variant는 정확히 77초로 tier default보다 우선.

이 테스트는 `mcp-server.mjs:191-210 -> chatgpt.mjs:190-195 ->
session.mjs:379-385,450-452`의 계약을 한 시나리오로 고정한다. MCP 서버에 test-only
export나 dependency seam을 추가하지 않는다. mock은 dispatch 입력을 관찰하는 데만 쓰고
deadline 계산은 production resolver를 실행한다.

### 5.3 호출자 source/behavior 계약

같은 테스트 파일에 최소 assertion을 추가한다. 새 테스트 파일은 만들지 않는다.

- `normalizeWatchOptions({ session:'S' })`는 `deadlineAt=null`,
  `hasExplicitDeadlineOverride=false`; `{ timeout:90 }`만 true + `now+90s`.
- `cli.mjs` source는 `send/query` 조건부 default와 후속 command의 undefined 보존을
  포함한다. 가능하면 `runWebAiCli`의 기존 fake deps 패턴으로 input을 관찰하고, 불가능한
  명령은 좁은 source assertion만 사용한다.
- `toolSchemaForMcp()` 또는 schema object를 통해 세 timeout에 `minimum:1`과 설명이
  있고 40분/2400 문구가 없음을 확인한다.
- `resumeDeepResearch` source에 `1_200_000` default가 더는 없고
  `resolveTimeoutBudgetSec`를 사용함을 확인한다. DR DOM loop 자체를 fake timer로
  재현하지 않는다.

## 6. 적용 순서

1. 02·03 적용 후 `deriveTimeoutTier('chatgpt', 'pro') === 'chatgpt-pro'`,
   `deriveTimeoutTier('grok', 'heavy') === 'grok-heavy'`, Gemini Deep Think의 결과가
   `deep-research`인지 확인한다.
2. `session.mjs`의 `resolveDeadlineAt`을 tier-aware로 바꾸고
   `resolveTimeoutBudgetSec`를 추가한다.
3. `chatgpt.mjs` poll fallback을 저장 deadline 잔여로 교체한다.
4. `cli.mjs`의 default 주입을 `send/query`로 제한한다.
5. watcher explicit override guard를 적용한다.
6. generic/DR resume와 MCP wait/resume에 resolver를 배선한다.
7. tool schema 설명과 minimum을 갱신한다.
8. `web-ai-timeout-default.test.mjs`를 확장하고 영향 suite/typecheck를 실행한다.

dependency 방향은 `session.mjs` resolver를 leaf owner로 두고 각 실행자가 import하는
기존 구조를 따른다. `session.mjs`가 CLI/watcher/MCP를 import하는 역방향 의존은 만들지
않는다.

## 7. 검증

### 7.1 명령

```bash
npx vitest run test/unit/web-ai-timeout-default.test.mjs
npx vitest run test/unit/web-ai-provider-session.test.mjs test/unit/web-ai-watcher.test.mjs test/unit/web-ai-tool-schema.test.mjs test/integration/web-ai-mcp-server.test.mjs
npm run typecheck:checkjs
npm run typecheck:checkjs-dom
```

schema 최소값 변경이 MCP validation에 영향을 주므로 최종 affected MCP gate도 실행한다.

```bash
npm run test:mcp
```

### 7.2 합격 조건과 activation scenario

| 조건 경로 | 활성화 입력 | 관찰 가능한 합격 증거 |
| --- | --- | --- |
| MCP 최초 Pro default | submit `model=pro`, timeout 생략 | 저장/반환 deadline이 `chatgpt-pro` SSOT 기준 `now+5400s`(90분); MCP input에 합성 timeout 없음 |
| explicit override | Pro session + `timeout=77` | 생성/poll/resume budget이 77초 |
| 저장 deadline 상속 | Pro session deadline 10분 후, timeout 생략 poll/resume | resolver 600초; 1200/5400/3600 재시작 없음 |
| deadline 소진 | Pro session deadline 과거, timeout 생략 | resolver 1초 API floor; 1200/5400/3600초 tier fallback으로 재무장하지 않음 |
| ChatGPT Pro tier fallback | deadline 없는 legacy ChatGPT Pro session | 저장 model로 `chatgpt-pro=5400` 선택 |
| Grok Heavy tier fallback | deadline 없는 legacy Grok Heavy session | 저장 model로 `grok-heavy=3600` 선택; `chatgpt-pro` 비혼입 |
| Deep Research tier fallback | deadline 없는 legacy DR/Gemini Deep Think session | 저장 research/model로 `deep-research=3600` 선택; 다른 long tier 비혼입 |
| watcher 보존 | 저장 Pro deadline + `watch --session`, override 생략 | session.deadlineAt byte-identical |
| watcher 명시 변경 | `watch --session --timeout 90` | session.deadlineAt이 호출 시각 기준 +90초로 변경 |
| DR resume | `researchMode=deep`, 미래 deadline, timeout 생략 | 1,200,000ms가 아니라 저장 잔여로 local deadline 생성 |
| MCP wait/resume | 미래 deadline session + timeout 생략 | `pollByProvider`가 저장 잔여 timeout을 받음 |
| schema 계약 | tools/list/schema 조회 | timeout 생략 의미·우선순위 서술, 숫자 40분 상수 없음 |

모든 focused test는 0 failure여야 한다. checkjs 두 게이트는 기존 전역 기준선
(`typecheck:checkjs` 24건, `typecheck:checkjs-dom` 124건)을 늘리지 않고 이 phase가
건드린 파일의 신규 진단이 0건이어야 한다. tier table은
`chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600`의 세 독립 키를 가져야 한다.
`CHATGPT_PRO_TIMEOUT_SEC`와 호환 export `PRO_TIMEOUT_SEC`는 모두 5400이어야 한다
(`session.mjs:394-402`, `web-ai-timeout-default.test.mjs:10-18`).

## 8. 리스크와 비범위 연계

### 8.1 false-complete는 OUT

더 긴 Pro budget은 응답을 오래 관찰할 기회를 줄 뿐, 완료 판정의 정확성을 보장하지
않는다. poll 안정성 휴리스틱, streaming indicator, timeout recovery가 잘못된 completed
text를 반환하는 문제는 이 패치에서 고치거나 테스트 통과 근거로 주장하지 않는다.
해당 소유자는 별도 계획의 ChatGPT extraction/recovery/watcher finality다
(`devlog/_plan/260625_webai_streaming_recovery_false_complete/00_overview.md:14-23,
35-50`).

따라서 이 슬라이스의 합격 문구는 “Pro가 false-complete 없이 90분 실행된다”가 아니라
“Pro timeout budget이 생성 후 모든 후속 경계에서 재설정되지 않는다”다.

### 8.2 만료 deadline 처리

만료된 저장 deadline을 tier default로 바꾸면 resume가 매번 새 tier 예산을 얻어 영구
연장될 수 있다. resolver는 유효한 과거 deadline을 기존 poll API 하한 1초로만
clamp한다. 사용자가 새 관찰 창을 원하면 explicit timeout을 줘야 하며, 이것이 우선순위
1번 경로다.

### 8.3 legacy session

deadline이 null이거나 손상된 legacy session은 저장 model/researchMode를 먼저
사용한다. 둘 다 없을 때만 기존 vendor default를 사용한다. session schema migration이나
backfill은 하지 않는다.

## 9. 구현 체크리스트

- [ ] 40분/2400초 상수 또는 UI 문구 의존 분기 없음.
- [ ] tier table은 `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600`으로 분리.
- [ ] `CHATGPT_PRO_TIMEOUT_SEC` 신설, 호환 export `PRO_TIMEOUT_SEC` 유지, 둘 다 5400.
- [ ] `deriveTimeoutTier`가 ChatGPT Pro/Grok Heavy를 각각 `chatgpt-pro`/`grok-heavy`로 정규화하고 Deep Research를 독립 유지.
- [ ] 최초 `resolveDeadlineAt({ model:'pro' })`가 `deriveTimeoutTier` 경로를 소비.
- [ ] 공용 resolver 우선순위가 explicit -> stored remainder -> tier default.
- [ ] 유효하지만 만료된 deadline은 1초 API floor이며 tier default로 갱신되지 않음.
- [ ] `pollWebAi`가 session 조회 후 resolver를 호출.
- [ ] watcher는 explicit override에서만 `updateSession(deadlineAt)` 실행.
- [ ] CLI는 `poll/watch/sessions` timeout 부재를 보존.
- [ ] generic resume와 DR resume가 최신 저장 deadline 잔여를 소비.
- [ ] MCP submit은 pass-through 유지, MCP wait/resume는 resolver 사용.
- [ ] tool schema는 값 비의존 상속 의미와 양수 explicit timeout을 설명.
- [ ] MCP submit(model=pro, timeout omitted) 회귀가 production resolver로 검증됨.
- [ ] false-complete 해결 또는 완료 정확성 개선을 이 슬라이스 성과로 주장하지 않음.
