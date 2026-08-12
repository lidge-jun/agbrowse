# 02 - GPT-5.6 코어 계약 결정

상태: **DECIDED (Chat guard + dedicated Work entrypoint contract)**  
근거: `00_index.md:32-45`, `01_ui_contract_evidence.md:7-129`  
소비자: 03 Chat selector, 04 Work guard, 05 timeout, 06 diagnostics,
07 fixtures, 08 public docs, 09 drift gates

## 0. 범위와 불변식

### IN

- 기존 공개 `model` 값은 `instant|thinking|pro`로 유지하되 의미를 **tier 축**으로 고정한다.
- Chat 명령(`send|query|poll|watch`, MCP `web_ai_submit_prompt`)의 `surface`,
  `family`, tier(`model`), `effort` 입력과 Work hard-error 규칙을 고정한다.
- Work mutation의 유일한 진입점인 `web-ai work send`와 MCP
  `web_ai_work_send`의 v1 입력 계약을 고정한다.
- `modelSelection`에 surface/family/tier 실측 증거를 보존한다.
- Chat/Work가 공유하는 picker testid 앞에 surface discriminator를 둔다.
- Chat CLI preflight와 `web_ai_submit_prompt` schema가 Work 입력을 mutation 전에 거부한다.
- 이 슬라이스가 소유하는 세 계약 테스트의 diff를 고정한다.

### OUT

- Work detector/guard, picker 조작, Power·speed 적용, 제출/poll 실행은 02에서
  구현하지 않는다. 시행과 실행 흐름은 04 §detector/guard가 단독 소유한다.
- Pro 40분 주장을 새 상수로 만들지 않는다. timeout 상속은 05가 소유한다.
- selector 함수의 전체 구현과 DOM fixture는 각각 03, 07이 소유한다.
- `mcp-server.mjs:204-210`은 `...args` 전달자이므로 새 변환 로직을 넣지 않는다.

### Chat 명령 공개 입력 형태

```js
{
    surface: 'chat',                         // 생략 시 chat
    family: 'gpt-5.6-sol',                   // 생략 시 family 축 무조작
    model: 'instant' | 'thinking' | 'pro',   // 호환 키, 의미는 tier
    effort: 'medium' | 'high' | 'xhigh',     // thinking tier 세분화
}
```

`model`을 `tier`로 rename하지 않는다. CLI/MCP 호출자와 저장된 세션의
`requestedModel` 호환성을 보존하기 위해 공개 키는 `model`, 문서와 내부 의미는
`tier`로 쓴다. `family`는 별도 축이며 `--model gpt-5.6-sol` 같은 혼합 입력은
거부하고 `--family gpt-5.6-sol`을 안내한다.

Chat 명령에 `surface=work`를 추가해 Work를 실행하는 확장 경로는 없다. Chat
명령 `send|query|poll|watch`와 MCP `web_ai_submit_prompt`는 Work 표면에서 계속
hard-error를 내며 mutation을 시작하지 않는다. Work v1 공개 입력은 별도
`web-ai work send --prompt <text> --power <1..6> [--speed standard|fast]
[--timeout <seconds>]`와 MCP `web_ai_work_send`뿐이다. MCP v1은
`prompt`(required), `power`(required, integer 1..6), `speed`(`standard|fast`),
`timeout`만 허용하고 `model|effort|project` 및 그 밖의 속성은
`additionalProperties:false`로 거부한다.

## 1. 결정 1 - ModelChoice 유지, Chat tier 라디오로 재해석

**결정:** `ModelChoice = 'instant'|'thinking'|'pro'`는 유지한다. 새 UI에서
`instant`는 `Instant`(5.5), `thinking`은 effort에 따라 `Medium|High|Extra High`,
`pro`는 flat `Pro` 라디오를 뜻한다.

| 공개 요청 | 정규화 | Chat 라디오 | 경고/거부 |
| --- | --- | --- | --- |
| `instant` (effort 없음) | `instant` | `Instant` | 없음 |
| `thinking` (effort 없음) | `thinking/medium` | `Medium` | 없음 |
| `thinking/light` 또는 `low` | `thinking/medium` | `Medium` | `reasoning-effort-downgraded: requested <raw>; selected Medium` |
| `thinking/standard|normal|regular|default|medium` | `thinking/medium` | `Medium` | 없음 |
| `thinking/high` | `thinking/high` | `High` | 없음 |
| `thinking/extended` | `thinking/high` | `High` | `extended is a legacy alias; selected High` 한 줄 |
| `thinking/heavy|xhigh` | `thinking/xhigh` | `Extra High` | 없음 |
| `pro` (effort 없음) | `pro` | `Pro` | 없음 |
| `pro/standard|normal|regular|default|extended` | `pro` | `Pro` | `reasoning-effort-unenforced: Pro has no effort control; selected Pro for legacy effort <raw>` |
| `pro/medium|high|xhigh` | - | - | reject: 새 effort를 Pro에서 enforce한다고 오인시키지 않음 |
| `instant/<any effort>` | - | - | reject |

Pro의 legacy 허용 목록은 기존 Pro 계약의 `standard/extended`와 그 기존
`standard` aliases만 포함한다. 기존 코드에서 `high -> extended`였던 우연한
Pro 허용은 `high`가 새 canonical 값이 되므로 종료한다. Pro compatibility
요청의 `SelectModelResult.effort`는 `null`이며 선택 mutation 없이 경고만
반환한다. legacy 경고는 요청당 정확히 한 줄이다. CLI는 그 한 줄을 stderr로
출력하고 MCP는 같은 문구를 warning 결과로 보존한다.

**Before - `web-ai/chatgpt-model.mjs:6-7,78-102`**

```js
/** @typedef {'instant'|'thinking'|'pro'} ModelChoice */
/** @typedef {'light'|'standard'|'extended'|'heavy'} EffortChoice */

/** @type {Readonly<Record<ModelChoice, { defaultLabels: readonly string[], efforts: Readonly<Record<string, readonly string[]>> }>>} */
const CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS = {
    instant: {
        defaultLabels: ['Instant', '즉시'],
        efforts: {
            light: ['Instant', '즉시'],
        },
    },
    thinking: {
        defaultLabels: ['Medium', '중간'],
        efforts: {
            light: ['Instant', '즉시'],
            standard: ['Medium', '중간'],
            extended: ['High', '높음'],
            heavy: ['Extra High', '매우 높음'],
        },
    },
    pro: {
        defaultLabels: ['Pro Extended', 'Pro 확장', '프로 확장'],
        efforts: {
            standard: ['Pro Extended', 'Pro 확장', '프로 확장'],
            extended: ['Pro Extended', 'Pro 확장', '프로 확장'],
        },
    },
};
```

**After - 02 type contract + 03 label-table consumer diff**

```diff
 /** @typedef {'instant'|'thinking'|'pro'} ModelChoice */
-/** @typedef {'light'|'standard'|'extended'|'heavy'} EffortChoice */
+/** @typedef {'medium'|'high'|'xhigh'} EffortChoice */

 const CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS = {
-    instant: {
-        defaultLabels: ['Instant', '즉시'],
-        efforts: {
-            light: ['Instant', '즉시'],
-        },
-    },
+    instant: { defaultLabels: ['Instant', '즉시'], efforts: {} },
     thinking: {
         defaultLabels: ['Medium', '중간'],
         efforts: {
-            light: ['Instant', '즉시'],
-            standard: ['Medium', '중간'],
-            extended: ['High', '높음'],
-            heavy: ['Extra High', '매우 높음'],
+            medium: ['Medium', '중간'],
+            high: ['High', '높음'],
+            xhigh: ['Extra High', '매우 높음'],
         },
     },
     pro: {
-        defaultLabels: ['Pro Extended', 'Pro 확장', '프로 확장'],
-        efforts: {
-            standard: ['Pro Extended', 'Pro 확장', '프로 확장'],
-            extended: ['Pro Extended', 'Pro 확장', '프로 확장'],
-        },
+        defaultLabels: ['Pro'],
+        efforts: {},
     },
 };
```

warning/reject 경계는 같은 selector 함수 안에서 raw effort를 보존해 적용한다:

```diff
 export async function selectChatGptModel(page, model, options = {}) {
     const requested = normalizeChatGptModelChoice(model);
-    const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
+    const rawEffort = String(options.effort || options.reasoningEffort || '').trim().toLowerCase();
+    const requestedEffort = normalizeChatGptEffortChoice(rawEffort);
+    if (requested && rawEffort && !isChatGptEffortSupported(requested, rawEffort)) {
+        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT reasoning effort: ${rawEffort}`, evidence: { model: requested, effort: rawEffort } });
+    }
@@
     const targetModel = requested || currentModel;
+    if (targetModel === 'thinking' && ['light', 'low'].includes(rawEffort)) {
+        warnings.push(`reasoning-effort-downgraded: requested ${rawEffort}; selected Medium`);
+    }
     let selectedEffort = null;
-    if (requestedEffort) {
+    if (requestedEffort && targetModel === 'thinking') {
@@
     }
+    if (targetModel === 'pro' && PRO_UNENFORCED_LEGACY_EFFORTS.has(rawEffort)) {
+        warnings.push(`reasoning-effort-unenforced: Pro has no effort control; selected Pro for legacy effort ${rawEffort}`);
+    }
```

03은 exact English 라벨을 primary로 사용한다. 기존 한국어 라벨은 fallback으로
남길 수 있지만 2026-07-10 실측값으로 간주하지 않는다.

## 2. 결정 2 - canonical effort와 legacy alias 재매핑

**결정:** canonical `EffortChoice`는 `medium|high|xhigh` 세 값이다. legacy
입력은 삭제하지 않고 새 canonical 값으로 정규화한다. raw 입력은 downgrade와
Pro unenforced 경고 판정을 위해 정규화 결과와 별도로 보존한다.

| 입력 표기 | canonical |
| --- | --- |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh` | `xhigh` |
| `light`, `low`, `standard`, `normal`, `regular`, `default` | `medium` |
| `extended` | `high` + `extended is a legacy alias; selected High` 경고 1줄 |
| `heavy`, `extra-high`, `extra_high`, `"extra high"` | `xhigh` |

경고 계약은 alias map과 분리하지 않는다. Thinking의 raw `extended`는 `high`로
정규화하면서 위 문구를 정확히 한 번 기록한다. Pro의 raw
`standard|normal|regular|default|extended`도 선택 mutation 없이
`reasoning-effort-unenforced: Pro has no effort control; selected Pro for legacy effort <raw>`
경고를 정확히 한 번 기록한다. CLI는 해당 warning을 stderr 한 줄로 방출하고,
MCP는 동일 warning을 구조화 결과에 보존한다.

**Before - `web-ai/chatgpt-model.mjs:119-130`, `web-ai/cli.mjs:1647-1674`**

```js
/** @type {Readonly<Record<string, EffortChoice>>} */
const EFFORT_ALIASES = {
    light: 'light',
    low: 'light',
    standard: 'standard',
    normal: 'standard',
    regular: 'standard',
    default: 'standard',
    extended: 'extended',
    high: 'extended',
    heavy: 'heavy',
};
```

`web-ai/cli.mjs:1647-1674`:

```js
function isSupportedWebAiEffort(vendor, model, effort) {
    if (String(vendor || 'chatgpt') !== 'chatgpt') return false;
    const effortKey = String(effort || '').trim().toLowerCase();
    const normalizedEffort = ({
        light: 'light',
        low: 'light',
        standard: 'standard',
        normal: 'standard',
        regular: 'standard',
        default: 'standard',
        extended: 'extended',
        high: 'extended',
        heavy: 'heavy',
    })[effortKey];
    if (!normalizedEffort) return false;
    const modelKey = String(model || '').trim().toLowerCase();
    const normalizedModel = ({
        thinking: 'thinking',
        think: 'thinking',
        'gpt-5-5-thinking': 'thinking',
        'gpt-5.5-thinking': 'thinking',
        pro: 'pro',
        'gpt-5-5-pro': 'pro',
        'gpt-5.5-pro': 'pro',
    })[modelKey];
    if (normalizedModel === 'thinking') return ['light', 'standard', 'extended', 'heavy'].includes(normalizedEffort);
    if (normalizedModel === 'pro') return ['standard', 'extended'].includes(normalizedEffort);
    return false;
}
```

**After - normalization and support matrix**

`web-ai/chatgpt-model.mjs` owns normalization and the model/effort compatibility check:

```diff
 const EFFORT_ALIASES = {
-    light: 'light',
-    low: 'light',
-    standard: 'standard',
-    normal: 'standard',
-    regular: 'standard',
-    default: 'standard',
-    extended: 'extended',
-    high: 'extended',
-    heavy: 'heavy',
+    medium: 'medium',
+    high: 'high',
+    xhigh: 'xhigh',
+    'extra-high': 'xhigh',
+    extra_high: 'xhigh',
+    'extra high': 'xhigh',
+    light: 'medium',
+    low: 'medium',
+    standard: 'medium',
+    normal: 'medium',
+    regular: 'medium',
+    default: 'medium',
+    extended: 'high',
+    heavy: 'xhigh',
 };
+const PRO_UNENFORCED_LEGACY_EFFORTS = new Set([
+    'standard', 'normal', 'regular', 'default', 'extended',
+]);

 export function isChatGptEffortSupported(model, effort) {
     const requestedModel = normalizeChatGptModelChoice(model) || /** @type {string} */ (model);
-    const requestedEffort = normalizeChatGptEffortChoice(effort) || /** @type {string} */ (effort);
-    return Boolean(CHATGPT_MODEL_EFFORT_OPTIONS[requestedModel]?.efforts?.[requestedEffort]);
+    const effortKey = String(effort || '').trim().toLowerCase();
+    const requestedEffort = normalizeChatGptEffortChoice(effort);
+    if (requestedModel === 'thinking') return Boolean(requestedEffort);
+    if (requestedModel === 'pro') return PRO_UNENFORCED_LEGACY_EFFORTS.has(effortKey);
+    return false;
 }
```

`web-ai/cli.mjs`는 그 owner를 호출하고 alias map을 제거한다:

```diff
+import { isChatGptEffortSupported, normalizeChatGptFamilyChoice } from './chatgpt-model.mjs';

 function isSupportedWebAiEffort(vendor, model, effort) {
     if (String(vendor || 'chatgpt') !== 'chatgpt') return false;
-    const effortKey = String(effort || '').trim().toLowerCase();
-    const normalizedEffort = ({
-        light: 'light',
-        low: 'light',
-        standard: 'standard',
-        normal: 'standard',
-        regular: 'standard',
-        default: 'standard',
-        extended: 'extended',
-        high: 'extended',
-        heavy: 'heavy',
-    })[effortKey];
-    if (!normalizedEffort) return false;
-    const modelKey = String(model || '').trim().toLowerCase();
-    const normalizedModel = ({
-        thinking: 'thinking',
-        think: 'thinking',
-        'gpt-5-5-thinking': 'thinking',
-        'gpt-5.5-thinking': 'thinking',
-        pro: 'pro',
-        'gpt-5-5-pro': 'pro',
-        'gpt-5.5-pro': 'pro',
-    })[modelKey];
-    if (normalizedModel === 'thinking') return ['light', 'standard', 'extended', 'heavy'].includes(normalizedEffort);
-    if (normalizedModel === 'pro') return ['standard', 'extended'].includes(normalizedEffort);
-    return false;
+    return isChatGptEffortSupported(model, effort);
 }
```

따라서 Pro raw-key 예외도 selector와 CLI가 같은
`isChatGptEffortSupported(model, rawEffort)` 판정을 쓴다. alias 정규화 결과만
전달해 raw `extended`를 잃지 않으며, CLI/MCP 모두 raw 입력으로 위 경고 계약을
적용한다.

## 3. 결정 3 - family 축 신설

**결정:** family는 tier와 독립된 명시 입력이다. Chat surface에서 선택 가능한
canonical aliases와 DOM 라벨은 `01_ui_contract_evidence.md:45-55`에서 실측한
다음 다섯 개로 닫는다.

| `family` | exact submenu label | 경고 |
| --- | --- | --- |
| `gpt-5.6-sol` | `GPT-5.6 Sol` | 없음 |
| `gpt-5.5` | `GPT-5.5` | 없음 |
| `gpt-5.4` | `GPT-5.4` | `Leaving on July 23` 배지를 보존해 7/23 퇴역 경고 출력 |
| `gpt-5.3` | `GPT-5.3` | 없음 |
| `o3` | `o3` | 없음 |

`GPT-5.6 Terra`와 `GPT-5.6 Luna`는 Work Model 서브메뉴에서만 실측됐으므로
Chat family 집합에서 제외한다. Work v1도 family/model 입력을 받지 않으므로
이 둘은 후속 Work 계약 전까지 schema에서 거부한다.
`sol`, `gpt-5-6-sol` 같은 shorthand도 이번 계약에 추가하지 않는다.
`family`가 없으면 family submenu를 열거나 row를 클릭하지 않으며 **family
submenu mutation 0회**를 보존한다. 현재 UI family 선택은 그대로 존중하고,
읽기와 증거 기록만 허용한다. 요청이 있으면 family를 먼저 선택/검증한 뒤 tier 라디오를 선택한다. `instant`와 family를 함께
요청해도 family 선택은 보존되지만 현재 실행 tier `Instant`는 GPT-5.5라는
`01_ui_contract_evidence.md:58-62` 의미를 바꾸지 않는다.

`selectChatGptFamily()`의 반환형은
`{ label: string|null, changed: boolean, verified: boolean }` 객체로 고정한다.
02의 `selectChatGptModel()` evidence 조합이 이 객체를 소비하며, 03은 이 형을
재정의하지 않고 구현만 제공한다.

> **소유권 각주:** `CHATGPT_FAMILY_OPTIONS` 선언은 02 diff가 단독 소유한다.
> 03/04 diff는 이 상수를 import/reference만 하며 재선언하지 않는다.

**Before - `web-ai/chatgpt-model.mjs:6-9,104-117,163-167`**

```js
/** @typedef {'instant'|'thinking'|'pro'} ModelChoice */
/** @typedef {'light'|'standard'|'extended'|'heavy'} EffortChoice */
/** @typedef {{ testIds: string[], labels: string[] }} ModelOptionConfig */
/** @typedef {{ triggerTestIds: string[], efforts: Readonly<Record<string, string>> }} EffortConfig */
```

`web-ai/chatgpt-model.mjs:104-117`:

```js
/** @type {Readonly<Record<string, ModelChoice>>} */
const MODEL_ALIASES = {
    instant: 'instant',
    fast: 'instant',
    'gpt-5-3': 'instant',
    'gpt-5.3': 'instant',
    thinking: 'thinking',
    think: 'thinking',
    'gpt-5-5-thinking': 'thinking',
    'gpt-5.5-thinking': 'thinking',
    pro: 'pro',
    'gpt-5-5-pro': 'pro',
    'gpt-5.5-pro': 'pro',
};
```

`web-ai/chatgpt-model.mjs:163-167`:

```js
/** @typedef {Object} SelectModelOptions
 * @property {string} [effort]
 * @property {string} [reasoningEffort]
 */
```

**After - family type, aliases, options, and call contract**

```diff
 /** @typedef {'instant'|'thinking'|'pro'} ModelChoice */
+/** @typedef {'chat'|'work'} ChatGptSurface */
+/** @typedef {'gpt-5.6-sol'|'gpt-5.5'|'gpt-5.4'|'gpt-5.3'|'o3'} FamilyChoice */
+/** @typedef {{ label: string, retirementWarning?: string }} FamilyOptionConfig */
+/** @typedef {{ label: string|null, changed: boolean, verified: boolean }} FamilySelectionEvidence */

+/** @type {Readonly<Record<FamilyChoice, FamilyOptionConfig>>} */
+export const CHATGPT_FAMILY_OPTIONS = Object.freeze({
+    'gpt-5.6-sol': { label: 'GPT-5.6 Sol' },
+    'gpt-5.5': { label: 'GPT-5.5' },
+    'gpt-5.4': { label: 'GPT-5.4', retirementWarning: 'Leaving on July 23' },
+    'gpt-5.3': { label: 'GPT-5.3' },
+    o3: { label: 'o3' },
+});
+/** @type {Readonly<Record<string, FamilyChoice>>} */
+const FAMILY_ALIASES = Object.freeze({
+    'gpt-5.6-sol': 'gpt-5.6-sol',
+    'gpt-5.5': 'gpt-5.5',
+    'gpt-5.4': 'gpt-5.4',
+    'gpt-5.3': 'gpt-5.3',
+    o3: 'o3',
+});
+/**
+ * @param {unknown} family
+ * @returns {FamilyChoice|null}
+ */
+export function normalizeChatGptFamilyChoice(family) {
+    const key = String(family || '').trim().toLowerCase();
+    return key ? FAMILY_ALIASES[key] || null : null;
+}

 /** @typedef {Object} SelectModelOptions
  * @property {string} [effort]
  * @property {string} [reasoningEffort]
+ * @property {'chat'} [surface]
+ * @property {string} [family]
  */

 export async function selectChatGptModel(page, model, options = {}) {
     const requested = normalizeChatGptModelChoice(model);
     const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
+    const requestedFamily = normalizeChatGptFamilyChoice(options.family);
+    if (options.family && !requestedFamily) {
+        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT family selection: ${options.family}`, evidence: { family: options.family } });
+    }
     if (!requested) {
         if (model) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT model selection: ${model}`, evidence: { model } });
-        if (!requestedEffort) return null;
+        if (!requestedEffort && !requestedFamily) return null;
     }

@@
+    const familyEvidence = requestedFamily
+        ? await selectChatGptFamily(page, requestedFamily, usedFallbacks)
+        : await readVisibleChatGptFamilyEvidence(page);
+    const familyOption = requestedFamily ? CHATGPT_FAMILY_OPTIONS[requestedFamily] : null;
+    if (familyOption?.retirementWarning) {
+        warnings.push(`family-retirement-warning: GPT-5.4 ${familyOption.retirementWarning}`);
+    }
```

`ChatGptSurface`는 evidence/read contract를 위해 `work`까지 표현하지만, Chat
selector의 mutation 입력 타입은 항상 `'chat'`만 허용한다. Work는 04-owned 전용
경로로 실행하며 `surface: 'work'`를 이 selector에 전달하지 않는다.

## 4. 결정 4 - Chat reject 유지, Work 전용 진입점 분리

**결정:** Chat 명령에서 생략한 `surface`는 `chat`으로 해석한다. Chat CLI는
`surface`, `family`, `speed`를 parse하여 Work 입력에 명시적 hard-error를 내고,
MCP `web_ai_submit_prompt`는 schema enum과 `additionalProperties:false`로 browser
mutation 전에 거부한다. 이 reject는 `send|query|poll|watch`와
`web_ai_submit_prompt`에 한정된다.

Work mutation은 별도 최상위 `work` 서브커맨드의
`web-ai work send --prompt ... --power N`과 MCP `web_ai_work_send`만 진입점으로
사용한다. 기존 Chat 명령이나 `web_ai_submit_prompt`에 `surface=work`를 추가하는
확장은 금지한다. Work 실행의 detector/guard/submit/poll 구현은 04가 소유한다.

| Chat 명령 입력 | CLI `send|query|poll|watch` | MCP `web_ai_submit_prompt` |
| --- | --- | --- |
| `surface=chat` | accept | enum accept |
| `surface=work` | hard-error `capability.unsupported`, stage `provider-surface-preflight` | hard-error: `surface not in enum` |
| `family=gpt-5.6-terra|gpt-5.6-luna` | Work-only family로 `capability.unsupported`, stage `provider-surface-preflight` | family enum reject |
| `speed=<any>` | `capability.unsupported`, stage `provider-surface-preflight` | unknown property `speed` |
| effort `max|ultra` | `capability.unsupported`, stage `provider-surface-preflight` | effort enum reject |
| explicit surface/family + non-ChatGPT vendor | `capability.unsupported` | `validateWebAiToolInput` semantic reject |

| Work v1 진입점 | 허용 입력 | 거부 입력 |
| --- | --- | --- |
| CLI `web-ai work send` | `prompt` required, `power` required(1..6), `speed=standard|fast`, `timeout` | `model|effort|project|surface` 및 미정의 옵션 |
| MCP `web_ai_work_send` | `prompt` required, `power` required(integer 1..6), `speed=standard|fast`, `timeout` | `model|effort|project|surface`, `additionalProperties:false` |

**Before - `web-ai/cli.mjs:578-580,625-627,1550-1590`, `web-ai/tool-schema.mjs:49-66`**

`web-ai/cli.mjs:578-580`:

```js
            model: { type: 'string' },
            effort: { type: 'string' },
            'reasoning-effort': { type: 'string' },
```

`web-ai/cli.mjs:625-627`:

```js
    applyVendorDefaults(values, command);
    rejectFutureScope(values);
    const vendorExplicit = argv.slice(1).includes('--vendor') || argv.slice(1).some((/** @type {any} */ a) => a.startsWith('--vendor='));
```

`web-ai/cli.mjs:1550-1590`:

```js
function rejectFutureScope(values) {
    if (values.vendor && !['chatgpt', 'gemini', 'grok'].includes(values.vendor)) {
        throw new WebAiError({
            errorCode: 'provider.runtime-disabled',
            stage: 'provider-runtime-gate',
            retryHint: 'enable-or-skip',
            message: `unsupported vendor: ${values.vendor}`,
            evidence: { vendor: values.vendor },
        });
    }
    if (values.model && !isSupportedWebAiModel(values.vendor || 'chatgpt', values.model)) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `unsupported ${webAiVendorLabel(values.vendor || 'chatgpt')} model selection: ${values.model}`,
            evidence: { model: values.model },
        });
    }
    const effort = values.effort || values['reasoning-effort'];
    if (effort && !values.model) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `${webAiVendorLabel(values.vendor || 'chatgpt')} reasoning effort requires --model because effort menus differ by model`,
            evidence: { effort },
        });
    }
    if (effort && !isSupportedWebAiEffort(values.vendor || 'chatgpt', values.model, effort)) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `unsupported ${webAiVendorLabel(values.vendor || 'chatgpt')} reasoning effort: ${effort}`,
            evidence: { effort },
        });
    }
```

`web-ai/tool-schema.mjs:49-66`:

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
```

**After - CLI preflight and MCP schema**

```diff
@@ WEB_AI_USAGE Provider section
+--surface <chat>    Chat commands only. Work hard-errors; use web-ai work send.
+--family <alias>    ChatGPT family: gpt-5.6-sol | gpt-5.5 | gpt-5.4 |
+                    gpt-5.3 | o3. GPT-5.4 leaves on July 23.
+                    Omit for zero submenu mutation. Terra/Luna are not Work v1 inputs.
 --model <alias>     Provider model alias; aliases below
-                      ChatGPT: instant, thinking, pro
+                      ChatGPT tiers: instant, thinking, pro
 --effort <alias>    ChatGPT reasoning effort. The reasoning-effort menu is
+                      Canonical: medium, high, xhigh
+                      Legacy: light/standard -> medium, extended -> high,
+                              heavy/extra-high/extra_high/"extra high" -> xhigh

@@ web-ai/cli.mjs parseArgs options
+surface: { type: 'string' },
+family: { type: 'string' },
+speed: { type: 'string' }, // Chat command only: parsed to produce the hard error
 model: { type: 'string' },
 effort: { type: 'string' },
 'reasoning-effort': { type: 'string' },

@@ rejectFutureScope(values), before model/effort validation
+const vendor = String(values.vendor || 'chatgpt');
+const surface = String(values.surface || 'chat').toLowerCase();
+const rawEffort = String(values.effort || values['reasoning-effort'] || '').toLowerCase();
+const rawFamily = String(values.family || '').toLowerCase();
+const workOnlyFamily = ['gpt-5.6-terra', 'gpt-5.6-luna'].includes(rawFamily);
+if (surface !== 'chat' || workOnlyFamily || values.speed || ['max', 'ultra'].includes(rawEffort)) {
+    throw new WebAiError({
+        errorCode: 'capability.unsupported',
+        stage: 'provider-surface-preflight',
+        vendor,
+        retryHint: surface !== 'chat' ? 'switch-to-chat' : 'use-chat-family',
+        mutationAllowed: false,
+        message: 'Chat commands cannot mutate Work; use web-ai work send with prompt, power, speed, and timeout',
+        evidence: { surface, family: rawFamily || null, speed: values.speed || null, effort: rawEffort || null },
+    });
+}
+if ((values.surface !== undefined || values.family !== undefined) && vendor !== 'chatgpt') {
+    throw new WebAiError({
+        errorCode: 'capability.unsupported',
+        stage: 'provider-surface-preflight',
+        vendor,
+        retryHint: 'omit-chatgpt-only-inputs',
+        mutationAllowed: false,
+        message: '--surface and --family are currently supported only for ChatGPT',
+        evidence: { surface: values.surface || null, family: values.family || null },
+    });
+}
+if (vendor === 'chatgpt' && values.model && normalizeChatGptFamilyChoice(values.model)) {
+    throw new WebAiError({
+        errorCode: 'provider.model-mismatch',
+        stage: 'provider-select-mode',
+        vendor: 'chatgpt',
+        retryHint: 'model-fallback',
+        mutationAllowed: false,
+        message: `${values.model} is a ChatGPT family; pass it with --family and keep --model as instant|thinking|pro`,
+        evidence: { model: values.model },
+    });
+}
+if (values.family && !normalizeChatGptFamilyChoice(values.family)) {
+    throw new WebAiError({
+        errorCode: 'provider.model-mismatch',
+        stage: 'provider-select-mode',
+        vendor: 'chatgpt',
+        retryHint: 'model-fallback',
+        mutationAllowed: false,
+        message: `unsupported ChatGPT family selection: ${values.family}; use --family gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3`,
+        evidence: { family: values.family },
+    });
+}

@@ normalized input
+surface: String(values.vendor || 'chatgpt') === 'chatgpt'
+    ? String(values.surface || 'chat').toLowerCase()
+    : undefined,
+family: values.family,
 model: values.model,
 reasoningEffort: values.effort || values['reasoning-effort'],

@@ runCommand render dependency seam (production default unchanged)
-case 'render': return renderWebAi(input);
+case 'render': return (deps.renderWebAi || renderWebAi)(input);

@@ web-ai/tool-schema.mjs
+const chatSurfaceSchema = { type: 'string', enum: ['chat'], default: 'chat' };
+const chatFamilySchema = { type: 'string', enum: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3', 'o3'] };
+const chatEffortSchema = { type: 'string', enum: [
+    'medium', 'high', 'xhigh',
+    'light', 'low', 'standard', 'normal', 'regular', 'default', 'extended', 'heavy',
+    'extra-high', 'extra_high', 'extra high',
+] };
+const workPowerSchema = { type: 'integer', minimum: 1, maximum: 6 };
+const workSpeedSchema = { type: 'string', enum: ['standard', 'fast'] };
 web_ai_submit_prompt: {
     inputSchema: objectSchema({
+        surface: chatSurfaceSchema,
+        family: chatFamilySchema,
         model: { type: 'string' },
-        effort: { type: 'string' },
-        reasoningEffort: { type: 'string' },
+        effort: chatEffortSchema,
+        reasoningEffort: chatEffortSchema,
         // speed is intentionally absent; additionalProperties:false rejects it
@@ WEB_AI_TOOLS, after web_ai_submit_prompt
+web_ai_work_send: {
+    description: 'Submit a prompt through the dedicated ChatGPT Work surface.',
+    inputSchema: objectSchema({
+        prompt: { type: 'string', minLength: 1 },
+        power: workPowerSchema,
+        speed: workSpeedSchema,
+        timeout: { type: 'number' },
+    }, ['prompt', 'power']), // objectSchema enforces additionalProperties:false
+},
```

이 주입점은 `runCommand`의 마지막 ChatGPT switch에만 적용한다. Gemini/Grok render
분기는 바꾸지 않으며, production 호출은 기존 `renderWebAi`를 그대로 사용한다.

`web_ai_work_send` v1에는 `model`, `effort`, `project`를 추가하지 않는다. Power와
Model×Effort의 실측 매핑 및 project/attachment 의미가 04의 재프로브 이후 계약이기
때문이다. 이 섹션은 도구 이름과 strict 입력 schema만 소유하며 실행 handler를
등록하거나 04 구현을 호출하지 않는다.

`validateWebAiToolInput`는 schema 검증 직후 `provider/vendor`의 유효 값을 구해
explicit `surface|family`가 있고 provider가 ChatGPT가 아니면 거부한다.
적용 diff는 다음과 같다.

```diff
 export function validateWebAiToolInput(toolName, input) {
     const tool = WEB_AI_TOOLS[toolName];
     if (!tool) throw new Error(`unknown web-ai tool: ${toolName}`);
     validateSchema(toolName, tool.inputSchema, input ?? {});
+    const args = /** @type {Record<string, unknown>} */ (input ?? {});
+    const provider = String(args.provider || args.vendor || 'chatgpt');
+    if (toolName === 'web_ai_submit_prompt'
+        && (args.surface !== undefined || args.family !== undefined)
+        && provider !== 'chatgpt') {
+        throw new Error(`${toolName}: surface/family are ChatGPT-only`);
+    }
     return true;
 }
```

현재 custom validator는
JSON Schema `if/then`을 지원하지 않으므로(`web-ai/browser-tool-schema.mjs:178-257`),
검증되지 않는 conditional schema를 추가하지 않는다. 이 semantic check도
`tool-schema.mjs`에 두어 MCP 실행자는 전달자로 유지한다.

## 5. 결정 5 - modelSelection 증거 스키마 확장

**결정:** 기존 필드를 삭제하지 않고 `surface`, `familyLabel`, `tierLabel`을
추가한다. `resolvedLabel`은 호환 필드로 유지하며 새 기록에서는 `tierLabel`과
같다. session store version은 올리지 않는다. `modelSelection`은 이미
`unknown` 확장 필드이며(`web-ai/session-store.mjs:24-31`) additive 변경이다.

`verified`는 다음 식이다.

```text
surfaceVerified
&& (!familyRequested || familyLabel === requested family의 exact label)
&& (!tierRequested || tierLabel === requested tier/effort의 exact label)
```

family를 요청하지 않았을 때 `familyLabel`은 mutation 없이 관측 가능하면 채우고,
그렇지 않으면 `null`이다. 이 `null`은 `verified`를 낮추지 않는다. legacy Pro
effort는 의도적으로 unenforced이므로 `Pro` tier 자체가 확인되면 `verified=true`가
될 수 있고, 별도 warning이 그 한계를 보존한다.

**Before - `web-ai/chatgpt-model.mjs:13-22,323-343`, `web-ai/chatgpt.mjs:178-199`**

```js
/** @typedef {Object} BrowserModelSelectionEvidence
 * @property {string|null} requestedModel
 * @property {string|null} resolvedLabel
 * @property {ModelChoice|null} normalizedModel
 * @property {'select'} strategy
 * @property {ModelSelectionEvidenceStatus} status
 * @property {boolean} verified
 * @property {'chatgpt-model-picker'} source
 * @property {string} capturedAt
 */
```

`web-ai/chatgpt-model.mjs:323-343`:

```js
/**
 * @param {{
 *   requestedModel: string|null,
 *   resolvedLabel: string|null,
 *   normalizedModel: ModelChoice|null,
 *   status: ModelSelectionEvidenceStatus,
 *   verified: boolean,
 * }} input
 * @returns {BrowserModelSelectionEvidence}
 */
function createModelSelectionEvidence(input) {
    return {
        requestedModel: input.requestedModel,
        resolvedLabel: input.resolvedLabel,
        normalizedModel: input.normalizedModel,
        strategy: 'select',
        status: input.status,
        verified: input.verified,
        source: 'chatgpt-model-picker',
        capturedAt: new Date().toISOString(),
    };
}
```

`web-ai/chatgpt.mjs:178-199`:

```js
    const selectedModel = await selectChatGptModel(page, input.model, { effort: input.reasoningEffort });

    await waitForStableAssistantCount(page);
    const assistantCount = await countAssistantMessages(page);
    const baseline = saveBaseline({
        vendor: envelope.vendor,
        url: page.url(),
        envelope,
        assistantCount,
        textHash: String((await page.innerText('body').catch(() => '')).length),
    });
    const targetId = await deps.getTargetId?.().catch(() => null) || null;
    const session = createSession(envelope, {
        targetId,
        originalUrl: input.url || page.url(),
        conversationUrl: page.url(),
        deadlineAt: resolveDeadlineAt(input, 'chatgpt'),
        envelopeSummary: { ...summarizeEnvelope(input, contextPack), assistantCount },
    });
    if (selectedModel?.modelSelection) {
        updateSession(session.sessionId, { modelSelection: selectedModel.modelSelection });
    }
```

**After - additive evidence schema**

```diff
 /** @typedef {Object} BrowserModelSelectionEvidence
  * @property {string|null} requestedModel
  * @property {string|null} resolvedLabel
  * @property {ModelChoice|null} normalizedModel
+ * @property {'chat'|'work'} surface
+ * @property {string|null} familyLabel
+ * @property {string|null} tierLabel
  * @property {'select'} strategy
  * @property {ModelSelectionEvidenceStatus} status
  * @property {boolean} verified
  * @property {'chatgpt-model-picker'} source
 * @property {string} capturedAt
 */

 /**
  * @param {{
  *   requestedModel: string|null,
- *   resolvedLabel: string|null,
+ *   surface: 'chat'|'work',
+ *   familyLabel: string|null,
+ *   tierLabel: string|null,
  *   normalizedModel: ModelChoice|null,
  *   status: ModelSelectionEvidenceStatus,
  *   verified: boolean,
  * }} input
  * @returns {BrowserModelSelectionEvidence}
  */
 function createModelSelectionEvidence(input) {
     return {
         requestedModel: input.requestedModel,
-        resolvedLabel: input.resolvedLabel,
+        resolvedLabel: input.tierLabel,
         normalizedModel: input.normalizedModel,
+        surface: input.surface,
+        familyLabel: input.familyLabel,
+        tierLabel: input.tierLabel,
         strategy: 'select',
         status: input.status,
         verified: input.verified,
         source: 'chatgpt-model-picker',
         capturedAt: new Date().toISOString(),
     };
 }

@@
 createModelSelectionEvidence({
     requestedModel: requested || String(model || '') || null,
-    resolvedLabel: null,
+    surface: 'chat',
+    familyLabel: null,
+    tierLabel: null,
     normalizedModel: null,
     status: 'unavailable',
     verified: false,
 });

```

02는 여기까지의 additive evidence typedef/factory schema만 적용한다. `verified`
조합과 input wiring은 03 selector 및 04 §detector/guard가 각자 소유한 관측값을 이
schema에 전달해 시행한다. 02 diff에는 detector 호출이나 04 helper 참조를 넣지
않는다.

`web-ai/cli-sessions.mjs:275-285` 출력은 기존 세션도 읽도록 fallback한다.

```diff
 const surface = evidence.surface ?? '(unknown)';
 const family = evidence.familyLabel ?? '(unavailable)';
 const tier = evidence.tierLabel ?? evidence.resolvedLabel ?? '(unavailable)';
-lines.push(`model requested=${requested}; resolved=${resolved}; status=${evidence.status || 'unknown'}; strategy=${strategy}; verified=${verified}`);
+lines.push(`model requested=${requested}; resolved=${resolved}; surface=${surface}; family=${family}; tier=${tier}; status=${evidence.status || 'unknown'}; strategy=${strategy}; verified=${verified}`);
```

## 6. 결정 6 - selector root와 surface discriminator

**결정:** 새 selector의 순서는 `surface 판별 -> composer trigger -> open menu
root -> exact role/label row`다. 페이지 전체 `button`, 열린 모든 menu, 공유 testid만
단독으로 검색하지 않는다.

surface discriminator는 **toggle 존재 시 3상태** 계약이다. toggle이 없으면
네 번째 오류 상태로 만들지 않고 legacy UI로 판정한다.

| 관측 | 결과 |
| --- | --- |
| Chat/Work toggle 존재 + `chat` active | 신규 Chat picker 경로 진행 |
| toggle 존재 + `work` active | mutation 전 fail, stage `provider-surface-preflight`, retry `switch-to-chat` |
| toggle 존재 + active state 모순/불완전 | `ambiguous`로 fail-closed |
| Chat/Work toggle 부재 | legacy UI 판정, legacy selector 경로 진행 + warning 기록 |

```text
surface controls : button[role="radio"] exact name Chat|Work
active state     : data-state="on" (aria-checked="true"와 일치해야 함)
trigger          : form button[aria-haspopup="menu"]
menu content     : [role="menu"][data-state="open"] [data-testid="composer-intelligence-picker-content"]
tier row         : menu content 내부 [role="menuitemradio"] exact label
family trigger   : menu content 내부 [role="menuitem"][data-has-submenu] exact current family label
family row       : 새로 열린 submenu 내부 [role="menuitemradio"] exact family label
```

toggle이 존재한 상태에서 활성 radio가 `Work`이거나 state가 모순되면 picker
trigger를 클릭하기 전에 fail closed한다. toggle 자체가 없으면
`surface-discriminator-absent: legacy UI selector path` warning을 남기고 기존
`model-switcher-*` selector 흐름으로 진행한다. 신규 menu content에 Work slider
marker `composer-model-picker-slider-simple-view|advanced-view`가 나타나도 Work
오류로 닫는다. guard 구현/테스트는 04가, Chat/legacy picker scoped 탐색은 03이
소유한다.

> **소유권 각주:** 아래 `CHATGPT_*_SELECTOR` 피커 root/discriminator 상수는
> 02 diff가 단독 정의한다. 03/04는 상수를 import/reference만 하며 같은 상수나
> literal 대체 선언을 추가하지 않는다. 메뉴 root helper와 legacy menu helper는
> 03 소유이고, surface mismatch error helper는 04 소유다.

**Before - `web-ai/chatgpt-model.mjs:24-28,394-404,1004-1013`**

```js
export const CHATGPT_MODEL_SELECTOR_BUTTONS = [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Model selector"]',
    'button[aria-label*="model selector" i]',
];
```

`web-ai/chatgpt-model.mjs:394-404`:

```js
async function openModelMenu(page, usedFallbacks) {
    if (await isModelMenuOpen(page)) return;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        for (const selector of CHATGPT_MODEL_SELECTOR_BUTTONS) {
            const loc = page.locator(selector).first();
            if (!(await loc.isVisible().catch(() => false))) continue;
            await loc.click({ timeout: 5_000 });
            await page.waitForTimeout(400).catch(() => undefined);
            if (await isModelMenuOpen(page)) return;
        }
```

`web-ai/chatgpt-model.mjs:1004-1013`:

```js
async function isSimplifiedIntelligenceMenuOpen(page, model, effort) {
    const requiredLabels = effort && model
        ? simplifiedEffortLabels(model, effort)
        : ['Instant', 'Medium', 'High', 'Extra High', '즉시', '중간', '높음', '매우 높음'];
    if (requiredLabels.length === 0) return false;
    return page.locator('[role="menu"]').evaluateAll((menus, labels) => menus.some(menu => {
        const text = /** @type {HTMLElement} */ (menu).innerText || menu.textContent || '';
        if (!/\bIntelligence\b|지능/i.test(text)) return false;
        return labels.some(label => menuTextHasExactLine(text, label));
    }), requiredLabels).catch(() => false);
}
```

**After - 02-owned selector/discriminator constants**

```diff
+export const CHATGPT_SURFACE_RADIO_SELECTOR = 'button[role="radio"]';
+export const CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]';
+export const CHATGPT_OPEN_PICKER_CONTENT_SELECTOR =
+    '[role="menu"][data-state="open"] [data-testid="composer-intelligence-picker-content"]';
+export const CHATGPT_WORK_PICKER_MARKER_SELECTOR = [
+    '[data-testid="composer-model-picker-slider-simple-view"]',
+    '[data-testid="composer-model-picker-slider-advanced-view"]',
+].join(', ');
+
+/** @typedef {'chat'|'work'|'ambiguous'|'legacy'} ChatGptSurfaceDiscriminator */
```

시행은 04 §detector/guard가 단독 소유한다. 04는
`detectChatGptComposerSurface`, `workSurfaceUnsupportedError`, composer-scoped
picker 흐름과 Work send 실행을 위 상수/typedef 계약을 소비해 구현한다. 02는
detector 함수, guard 호출, picker mutation 흐름을 정의하거나 04 helper를
import하지 않는다. Chat 명령은 detector 결과가 `work|ambiguous`이면 mutation 전
hard-error, `legacy`이면 warning과 legacy Chat 경로, `chat`이면 composer-scoped
Chat 경로라는 시행 계약만 고정한다.

구 `model-switcher-*` selector는 04 §detector/guard 시행에서 legacy fallback으로만 뒤에 남길 수 있다.
신규 path의 row 탐색은 `CHATGPT_OPEN_PICKER_CONTENT_SELECTOR` 내부로만 제한한다.
legacy helper의 기존 page-level menu 탐색을 이 root로 일괄 치환하지 않는다.
신규 path의 성공 판정은 testid row가 아니라 exact label + checked state이며,
`aria-checked="true"` 또는 `data-state="checked"` 중 하나를 읽되 둘이 함께 있을
때 모순되면 verified로 기록하지 않는다.

## 7. 02 자기 테스트 명세

### `test/integration/web-ai-cli-contract.test.mjs`

기존 `:157-193` ChatGPT preflight 블록을 다음 행렬로 확장한다.

1. help가 `--surface <chat>`, `--family <alias>`, canonical effort
   `medium|high|xhigh`, legacy mapping, GPT-5.4 7/23 퇴역 경고를 출력한다.
2. Chat family enum/CLI alias가 정확히
   `gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3`이고 각각 exit 0이다.
3. `--surface chat --family gpt-5.6-sol --model thinking --effort medium|high|xhigh`
   각각 exit 0이다.
4. thinking legacy
   `light|low|standard|normal|regular|default|extended|heavy|extra-high|extra_high|"extra high"`가
   preflight를 통과한다. 실제 `extended` warning 생성과 개수는 03 selector test가
   소유하고, 02의 CLI 테스트는 아래 주입 result로 출력 직렬화만 검증한다.
5. Pro legacy `standard|normal|regular|default|extended`는 통과하고,
   Pro `medium|high|xhigh|light|heavy`는 실패한다.
6. `--model instant --effort medium`과 effort-only 입력은 실패한다.
7. `--model gpt-5.6-sol`은 실패하면서 `--family`를 안내하고, 지원하지 않는
   family도 실패한다.
8. Chat 명령의 `--surface work`, `--family gpt-5.6-terra|gpt-5.6-luna`,
   `--speed fast`, `--effort max`, `--effort ultra`는 모두
   `provider-surface-preflight` hard-error로 exit non-zero이며 mutation은 0회다.
9. non-ChatGPT vendor + `--family`는 mutation 전 실패한다.
10. `runWebAiCli`를 직접 호출하면서 02-owned `deps.renderWebAi` 주입점으로
    `{rendered:{composerText:'x'}, warnings:['extended is a legacy alias; selected High']}`를
    반환한다. `console.error` capture는 정확히
    `[warnings] extended is a legacy alias; selected High` 한 줄이고, stdout warning과
    selector import/call은 0회임을 assert한다.

`execBrowser(... render ...)`는 browser 없는 preflight 허용/거부 경계를 검증한다.
exactly-one stderr 직렬화는 child process의 실제 selector behavior에 기대지 않고
`runWebAiCli` direct call + injected render result로 검증한다. downgrade/unenforced
warning의 실제 생성과 structured result는 selector result를 소유하는 03 unit test가 맡는다.

### `test/unit/web-ai-tool-schema.test.mjs`

`web_ai_submit_prompt`, `web_ai_work_send` schema와 `validateWebAiToolInput`에 대해
다음을 추가한다.

1. `surface.enum === ['chat']`, family enum이 다섯 canonical alias
   `gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3`와 exact 일치한다.
2. effort/reasoningEffort enum이 canonical + legacy 목록과 일치하고
   `extra-high|extra_high|"extra high"`를 `xhigh` alias로 포함하되 `max|ultra`는
   포함하지 않는다.
3. schema properties에 `speed`가 없고 `additionalProperties === false`다.
4. `web_ai_work_send` properties는 정확히 `prompt|power|speed|timeout`, required는
   정확히 `prompt|power`, power는 integer `1..6`, speed enum은
   `standard|fast`, `additionalProperties === false`다.
5. `web_ai_work_send`의 `model|effort|project|surface`는 각각 unknown-property
   오류를 낸다.
6. `{provider:'chatgpt', surface:'chat', family:'gpt-5.6-sol', model:'thinking', effort:'xhigh', prompt:'x'}`는 통과한다.
7. `web_ai_submit_prompt`의 `surface:'work'`, Work-only family `gpt-5.6-terra|gpt-5.6-luna`,
   `effort:'max'`, `effort:'ultra'`, `speed:'fast'`는 각각 enum/unknown-property
   오류를 낸다.
8. `{provider:'gemini', family:'gpt-5.6-sol', prompt:'x'}`는 semantic validation
   오류를 낸다.

### `test/unit/web-ai-sessions-command.test.mjs`

기존 `:137-177` human show evidence 테스트를 확장한다.

```diff
 modelSelection: {
     requestedModel: 'pro',
-    resolvedLabel: 'GPT-5.5 Pro',
+    resolvedLabel: 'Pro',
     normalizedModel: 'pro',
+    surface: 'chat',
+    familyLabel: 'GPT-5.6 Sol',
+    tierLabel: 'Pro',
     strategy: 'select',
     status: 'switched',
     verified: true,
 }
```

사람용 출력에
`model requested=pro; resolved=Pro; surface=chat; family=GPT-5.6 Sol; tier=Pro;
status=switched; strategy=select; verified=yes`가 포함되어야 한다. 별도 legacy
fixture는 새 세 필드 없이도 throw하지 않고 `surface=(unknown)`,
`family=(unavailable)`, `tier=<resolvedLabel>` fallback을 출력해야 한다. JSON show는
새 필드를 그대로 보존한다.

### 실행 게이트

```bash
npx vitest run \
  test/integration/web-ai-cli-contract.test.mjs \
  test/unit/web-ai-tool-schema.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  --reporter=verbose
npm run typecheck:checkjs
```

focused Vitest 명령은 exit 0과 세 테스트 파일 failure 0이어야 한다. check-JS는
현재 전역 기준선(`typecheck:checkjs` 24건, `typecheck:checkjs-dom` 124건)을 증거로
저장하고, 총 진단 수가 늘지 않으며 이 phase가 건드린 파일의 신규 진단이 0건인지
확인한다. 기존 기준선 때문에 전역 check-JS exit 0을 이 phase의 합격 조건으로
요구하지 않는다.
02 적용분은 typedef/alias, strict schema reject, additive evidence schema,
selector/discriminator 상수 정의만으로 닫으며 04-owned 함수 import/call이 없다.
따라서 04 병합을 기다리지 않고 02 자기 diff만으로 focused test와 touched-file
check-JS가 clean하게 독립 종료해야 한다.

## 8. 03~09 소비 계약

| 문서 | 반드시 소비할 결정 |
| --- | --- |
| 03 | canonical effort 라벨, family-first/tier-second 순서, composer-scoped root, warning 두 종류, exact tier verification |
| 04 | detector/guard 단독 소유, Chat 명령 Work hard-error, 전용 `work send` + `web_ai_work_send` 실행, Power/speed mutation |
| 05 | `model`의 `instant|thinking|pro`와 provider/research 값은 `deriveTimeoutTier`의 입력이며, 결과 키는 `chatgpt-pro|grok-heavy|deep-research`; family/effort는 timeout tier를 바꾸지 않음 |
| 06 | diagnostics/session 출력에서 `surface/familyLabel/tierLabel/verified`를 읽고 legacy fallback 유지 |
| 07 | fixture에 Chat/Work radio state, composer trigger, open menu content root, checked tier/family row 포함 |
| 08 | public docs는 `model`을 tier로 설명하고 `family` 생략 시 submenu mutation 0회, 전용 Work 진입점을 명시 |
| 09 | schema/docs drift gate가 Chat reject와 `web_ai_work_send` v1 strict schema를 고정 |

## 9. OPEN DECISION

| 상태 | 항목 | 현재 정책 | 해소 조건/소유자 |
| --- | --- | --- | --- |
| **OPEN DECISION** | Work Power 6단계와 Model/Effort 조합 | v1은 `power=1..6`만 공개하고 내부 매핑은 TBD-WP1 | `01_ui_contract_evidence.md:117-129` 재프로브 후 04 |
| **OPEN DECISION** | Work Power/speed DOM 실행 의미 | v1은 `speed=standard|fast`; `model|effort`는 schema 제외 | 전이/checked/제출 DOM 재프로브 후 04 |
| **OPEN DECISION** | 새 UI 한국어 exact labels | English exact labels만 verified evidence; 기존 한국어 문자열은 legacy fallback | 한국어 로그인 세션 probe 후 03 amendment |
| **OPEN DECISION** | 무료/Plus 계정의 header/picker shape | header discriminator 부재면 legacy selector 경로 + warning으로 진행, 모순이면 fail closed | 계정별 probe + sanitized fixture 후 03/04 |
| **OPEN DECISION** | Chat/Work picker 동시 mount 가능성 | active header와 Work marker가 불일치하면 fail closed | `01_ui_contract_evidence.md:128-129` 재프로브 후 04 |

Pro 40분은 이 표의 core-contract open decision이 아니다. DOM 무증거라는 사실을
유지한 채 05의 기존 tier timeout 상속으로 처리한다
(`01_ui_contract_evidence.md:99-113`).

## 10. 완료 기준

- 여섯 결정 모두 before 코드 근거와 after diff가 있다.
- public input과 DOM selector가 03~09가 소비할 수 있는 exact 값으로 닫혀 있다.
- Chat 명령의 Work 입력은 CLI/MCP 어느 쪽에서도 browser mutation에 도달하지
  않고, Work mutation은 `work send|web_ai_work_send`로만 진입한다.
- legacy alias는 삭제되지 않고 canonical effort로 재매핑된다.
- `family` 미지정은 family submenu mutation 0회를 보존한다.
- additive evidence가 기존 session record를 깨뜨리지 않는다.
- 02가 04 구현 helper를 참조하지 않은 채 §7의 집중 테스트와 check-JS gate를
  독립적으로 통과한다.

## 이관 보존

> **→ 04로 이관 (04 병합 후 제거 예정)**
>
> 아래 인용은 종전 02:964-1037 구현 블록의 이관 추적용 보존본이다. 02의 적용
> diff가 아니며 detector/guard/composer-scoped 시행은 04가 병합·소유한다.
>
> **After - constants and scoped locator flow consumed by 03/04**
>
> ```diff
> +export const CHATGPT_SURFACE_RADIO_SELECTOR = 'button[role="radio"]';
> +export const CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]';
> +export const CHATGPT_OPEN_PICKER_CONTENT_SELECTOR =
> +    '[role="menu"][data-state="open"] [data-testid="composer-intelligence-picker-content"]';
> +export const CHATGPT_WORK_PICKER_MARKER_SELECTOR = [
> +    '[data-testid="composer-model-picker-slider-simple-view"]',
> +    '[data-testid="composer-model-picker-slider-advanced-view"]',
> +].join(', ');
> +
> +/** @typedef {'chat'|'work'|'ambiguous'|'legacy'} ChatGptSurfaceDiscriminator */
> +/** @param {Page} page @returns {Promise<ChatGptSurfaceDiscriminator>} */
> +async function readChatGptSurfaceDiscriminator(page) {
> +    const radios = await page.locator(CHATGPT_SURFACE_RADIO_SELECTOR).all();
> +    /** @type {{ surface: 'chat'|'work', active: boolean }[]} */
> +    const states = [];
> +    for (const radio of radios) {
> +        if (!(await radio.isVisible().catch(() => false))) continue;
> +        const name = (await radio.innerText({ timeout: 500 }).catch(() => '')).trim();
> +        if (name !== 'Chat' && name !== 'Work') continue;
> +        const dataState = await radio.getAttribute('data-state');
> +        const ariaChecked = await radio.getAttribute('aria-checked');
> +        if (!['on', 'off'].includes(dataState || '')
> +            || !['true', 'false'].includes(ariaChecked || '')
> +            || (dataState === 'on') !== (ariaChecked === 'true')) return 'ambiguous';
> +        states.push({ surface: name === 'Chat' ? 'chat' : 'work', active: dataState === 'on' });
> +    }
> +    if (states.length === 0) return 'legacy';
> +    if (states.length !== 2) return 'ambiguous';
> +    const active = states.filter(state => state.active);
> +    return active.length === 1 ? active[0].surface : 'ambiguous';
> +}
> +
>  async function openModelMenu(page, usedFallbacks, warnings) {
> -    if (await isModelMenuOpen(page)) return;
> +    const surface = await readChatGptSurfaceDiscriminator(page);
> +    if (surface === 'work' || surface === 'ambiguous') {
> +        throw workSurfaceUnsupportedError({
> +            surface,
> +            ui: 'toggle',
> +            evidence: [`surface-discriminator:${surface}`],
> +            warning: null,
> +        }); // 04-owned helper
> +    }
> +    if (surface === 'legacy') {
> +        warnings.push('surface-discriminator-absent: legacy UI selector path');
> +        if (await isModelMenuOpen(page)) return;
> +    } else {
> +        const composer = page.locator('form').filter({
> +            has: page.locator('#prompt-textarea, textarea[name="prompt-textarea"], [contenteditable="true"]'),
> +        }).last();
> +        const trigger = composer.locator(CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR)
> +            .filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN }).first();
> +        await trigger.click({ timeout: 5_000 });
> +        const content = page.locator(CHATGPT_OPEN_PICKER_CONTENT_SELECTOR).last();
> +        await content.waitFor({ state: 'visible', timeout: 5_000 });
> +        if (await content.locator(CHATGPT_WORK_PICKER_MARKER_SELECTOR).count()) {
> +            throw workSurfaceUnsupportedError({
> +                surface: 'work',
> +                ui: 'toggle',
> +                evidence: ['work-picker-marker-visible'],
> +                warning: null,
> +            });
> +        }
> +        return;
> +    }
> +    // Existing CHATGPT_MODEL_SELECTOR_BUTTONS/composer-pill/text-button loop continues here.
>  }
>
> -await openModelMenu(page, usedFallbacks);
> +await openModelMenu(page, usedFallbacks, warnings);
> ```
