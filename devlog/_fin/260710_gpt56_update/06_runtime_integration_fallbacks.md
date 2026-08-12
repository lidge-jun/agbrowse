# 06: 런타임 통합과 fallback 패치 준비

기준일: 2026-07-10. 이 문서는 02의 2축 선택 계약과 03/04의 Chat/Work surface helper를
capability, 진단, 탭 inspect, 세션 출력에 연결하는 diff-level 계획이다. Work mutation과
`readWorkTaskState()` 자체는 04가 단독 구현하지만, 06은 그 Work 전용 성공 evidence와
`surface/taskId/taskUrl` 세션 계약을 capability/diagnostic 소비자에 반영한다
(`04_work_surface_support.md:197-249`).

## 1. 고정 전제와 소유 경계

- 공개 선택 증거의 필수 축은 `modelSelection.{surface,familyLabel,tierLabel,verified}`다. 기존
  `requestedModel`, `status`, `strategy`, `resolvedLabel`은 저장된 세션을 읽기 위한
  호환 필드로만 유지하고 새 판정의 SSOT로 사용하지 않는다.
- 공개 tier 키는 02 결정대로 `model`을 유지한다. `family`만 별도 축이며 내부/증거에서
  `tierLabel`로 부른다 (`02_core_contract_decisions.md:26-40`).
- runtime timeout tier는 `chatgpt-pro=5400`, `grok-heavy=3600`,
  `deep-research=3600`의 3분리다. `chatgpt-pro`의 90분/5400s와 다른 두 tier의
  3600s를 합치거나 `pro=3600`으로 되돌리지 않는다.
- Chat picker trigger는 composer 안에서 찾고, 열린 메뉴는 `[role="menu"][data-state="open"]` 중
  `[data-testid="composer-intelligence-picker-content"]`를 포함한 root만 사용한다.
  항목 identity와 선택 상태는 exact role/label 및 `aria-checked`/`data-state`로
  확인한다 (`01_ui_contract_evidence.md:20-42`).
- family와 tier는 독립 축이다. Chat에서 선택 가능한 family는 GPT-5.6 Sol/GPT-5.5/
  GPT-5.4/GPT-5.3/o3의 실측 5종이며, `Instant`는 GPT-5.5, 나머지 tier는 선택된
  family를 사용한다. tier 존재만으로 family를 확인했다고 판정하지 않는다
  (`01_ui_contract_evidence.md:45-62`).
- 02가 `CHATGPT_FAMILY_OPTIONS`와 picker root selector 상수를 단독 소유한다. 03 계획이
  `chatGptComposerMenuRoot`, `openSimplifiedIntelligenceSubmenu`,
  `findOpenFamilySubmenu`, `findOptionByExactLabels`,
  `readVisibleChatGptFamilyEvidence`, `familyMismatch`,
  `chatGptLegacyMenuRootOpenedByComposer`의 구현 diff를 정의하며, 06은 이 03 소유 심볼을
  참조/호출만 한다. 04가 `detectChatGptComposerSurface`와
  `workSurfaceUnsupportedError`를 정의하며 06은 마찬가지로 소비만 한다. 06은 이 심볼을
  재선언하거나 wrapper helper 추가, 전역 메뉴 탐색을 하지 않는다
  (`02_core_contract_decisions.md:357-402,773-832`,
  `03_chat_picker_selector_patch.md:264-474,593-657`,
  `.codexclaw/evidence/260710_cgate_r1_synthesis.md:21-28`).
- 06이 단독 소유하는 심볼은 `TabSummary.modelSelection`과 `INSPECT_EXPRESSION` 내부의
  read-only `readChatGptTabModelSelection()`이다. 둘의 완전한 구현 diff는 §4.2에 둔다.
- 구 `model-switcher-*` testid는 legacy fallback이다. 현재 UI의 primary evidence로
  승격하거나 새 5.6 라벨을 testid 문자열로 추정하지 않는다
  (`01_ui_contract_evidence.md:38-41,99-105`).

## 2. capability probe 오판 경로

### 2.1 Before: 새 입력을 무시하는 false-ready

현재 `chatGptCapabilities`는 `input.model`과 `input.reasoningEffort`만 전달한다
(`web-ai/chatgpt.mjs:108-118`). family-only 요청은
`chatGptModelCapabilityProbe(page, undefined, { effort: undefined })`가 되어
`unknown/next=send`를 반환한다
(`web-ai/chatgpt-model.mjs:1125-1131`). `worstCapabilityState`는 하나라도 unknown이면
unknown을 반환하지만 (`web-ai/capability.mjs:66-71`), `statusWebAi`는 fail만
blocked로 취급해 unknown을 `ok=true,status=ready`로 노출한다
(`web-ai/chatgpt.mjs:135-149`). 결과는 5.6 계약을 한 번도 검사하지 않은
false-ready다.

일반 5.6 요청도 `family`가 drop된다. `model=thinking,reasoningEffort=high`가 tier
row를 찾으면 (`web-ai/chatgpt-model.mjs:1139-1159`) 요청한 GPT-5.6 Sol family를
확인하지 않고 성공할 수 있으므로 false-ready다.

### 2.2 After: Chat probe의 동일 정규화, 두 축 관측, 3-상태 fail-closed

probe는 선택 동작을 수행하지 않는다. 메뉴 열기, family submenu 열기, 읽기,
Escape 닫기만 허용한다 (`web-ai/capability.mjs:15-17`). 입력은 02의 canonical 규칙으로
정규화하고, DOM 탐색은 03/04 owner helper를 직접 재사용한다.

#### Before 1 (`web-ai/chatgpt.mjs:108-112`, verbatim)

```js
export const chatGptCapabilities = [
    defineCapability('chatgpt-active-tab-verification', async (/** @type {any} */ deps) => probeHostMatches(await deps.getPage(), CHATGPT_HOSTS)),
    defineCapability('chatgpt-composer-visible', async (/** @type {any} */ deps) => probeFirstVisibleSelector(await deps.getPage(), CHATGPT_COMPOSER_SELECTORS)),
    defineCapability('chatgpt-model-alias-selectable', async (/** @type {any} */ deps, /** @type {any} */ input) => chatGptModelCapabilityProbe(await deps.getPage(), input.model, { effort: input.reasoningEffort })),
    defineCapability('chatgpt-upload-surface-visible', async (/** @type {any} */ deps, /** @type {any} */ input) => {
```

#### After 1

```diff
     defineCapability('chatgpt-model-alias-selectable', async (/** @type {any} */ deps, /** @type {any} */ input) =>
+        chatGptModelCapabilityProbe(await deps.getPage(), input.model, {
+            family: input.family,
+            effort: input.reasoningEffort,
+        })),
```

기존 `(page, model, options)` 시그니처를 유지해 direct unit call을 깨지 않는다.
model/effort/family 정규화와 family label table은 02의 export를 재사용한다.

#### Before 2 (`web-ai/chatgpt-model.mjs:1125-1160`, verbatim)

```js
export async function chatGptModelCapabilityProbe(page, model, options = {}) {
    const requested = normalizeChatGptModelChoice(model);
    const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
    if (!model && !(options.effort || options.reasoningEffort)) return { state: 'unknown', evidence: { requested: null, effort: null }, next: 'send' };
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    if ((options.effort || options.reasoningEffort) && !requestedEffort) return { state: 'fail', evidence: { requested, effort: options.effort || options.reasoningEffort }, next: 'model-fallback' };
    if (requestedEffort && !isChatGptEffortSupported(requested, requestedEffort)) return { state: 'fail', evidence: { requested, effort: requestedEffort }, next: 'model-fallback' };
    /** @type {string[]} */
    const usedFallbacks = [];
    try {
        await openModelMenu(page, usedFallbacks);
    } catch {
        return { state: 'fail', evidence: { requested, menuOpenFailed: true, usedFallbacks }, next: 'model-fallback' };
    }
    const option = await findModelOption(page, requested).catch(() => null);
    /** @type {Locator | null} */
    let effortOption = null;
    if (option && requestedEffort) {
        try {
            await openEffortMenu(page, requested, requestedEffort, usedFallbacks);
            effortOption = await findEffortOption(page, requested, requestedEffort);
        } catch {
            effortOption = null;
        }
    }
    let menuClosed = false;
    try {
        await closeModelMenu(page);
        menuClosed = !(await isModelMenuOpen(page));
    } catch {
        menuClosed = false;
    }
    const selectable = Boolean(option) && (!requestedEffort || Boolean(effortOption));
    const state = selectable ? (menuClosed ? 'ok' : 'warn') : 'fail';
    return { state, evidence: { requested, effort: requestedEffort || null, menuClosed, usedFallbacks }, next: state === 'ok' ? 'send' : 'model-fallback' };
}
```

#### After 2

기존 validation과 menu-close `finally`를 보존한 채 아래 순서를 적용한다. 이 순서는
새 helper 정의가 아니라 02/03/04 owner 심볼의 조합이다.

1. `normalizeChatGptFamilyChoice(options.family)`가 raw family를 거부하면 즉시
   `state=fail,next=model-fallback`을 반환한다. model/effort/family가 모두 없을 때의
   기존 `unknown/next=send`는 선택 검증 요청이 아니므로 유지한다.
2. 04의 `detectChatGptComposerSurface(page)` 결과에서 토글 관측 유무와 active surface를
   읽는다. `ambiguous`는 `unknown`이 아니라 surface radio의 `aria-checked`/`data-state`
   불일치 상태다. 토글이 하나라도 존재하면서 active가 `work`이거나 `ambiguous`이면 메뉴를
   열기 전에 fail-closed로 `state=fail`을 반환한다. evidence는
   `stage=provider-surface-preflight`, `retryHint=switch-to-chat`, `verified=false`를 갖는다.
3. 토글이 없을 때만 기존 legacy selector probe를 실행한다. target을 찾고 메뉴를 닫으면
   `state=warn,next=send,verified=false`와 `legacy-model-switcher-testid` warning evidence를
   반환한다. 이 경로만 미검증 상태의 ready 소비를 허용한다.
4. 토글이 있고 active가 `chat`이면 03의 `openSimplifiedIntelligenceSubmenu`,
   `findOpenFamilySubmenu`, `findOptionByExactLabels`,
   `readVisibleChatGptFamilyEvidence`로 requested family/tier exact row와 일관된
   `aria-checked`/`data-state`를 확인한다. family submenu를 열었다면 성공/실패와 관계없이
   `closeModelMenu`를 `finally`에서 호출한다.
5. current Chat 경로는 requested family와 tier, checked-state, menu close가 모두
   확인된 경우에만 `state=ok,next=send,verified=true`다. 하나라도 미확인 또는 모순이면
   `warn`으로 낮추지 않고 `state=fail,next=model-fallback,verified=false`다.

| discriminator | family/tier 검증 | probe | `statusWebAi` |
| --- | --- | --- | --- |
| toggle 존재 + active Chat | 모두 verified | `ok` | `ready` |
| toggle 존재 + active Chat | 하나라도 미검증/모순 | `fail` | `blocked` |
| toggle 존재 + Work | 해당 없음 | `fail` + `provider-surface-preflight` / `switch-to-chat` | `blocked` |
| toggle 존재 + ambiguous | 해당 없음 | `fail` + `provider-surface-preflight` / `switch-to-chat` | `blocked` |
| toggle 부재 | legacy selector 성공 | `warn` + legacy warning | `ready` |

`statusWebAi` 자체의 `worst === 'fail'` 소비식(`web-ai/chatgpt.mjs:135-149`)은 바꾸지
않는다. toggle이 존재하는 미검증 family/tier를 probe 단계에서 반드시 `fail`로 올려
false-ready를 차단한다.

### 2.3 Work send preflight: Work surface 성공 경로

§2.2와 표의 다섯 행은 Chat capability probe 전용이다. 따라서 Chat
`send|query|poll|watch`와 `web_ai_submit_prompt`가 active Work에서
`provider-surface-preflight`/`switch-to-chat`의 `fail`을 반환하는 계약은 그대로
유지한다. 이를 Work가 unsupported/deferred라는 진단으로 재해석하지 않는다.

`web-ai work send`와 `web_ai_work_send`는 같은 detector를 사용하되 04의
`ensureWorkSurface()`를 preflight로 호출한다. active Work에서는 Work composer와 picker
evidence가 검증되면 `ok`로 계속 진행하며, active Chat에서는 Work radio 전환 후 같은
검증을 수행한다. ambiguous와 toggle 부재는 `capability.unsupported`의 fail-closed
결과이며 mutation 0회다. 이 `ok`는 Work task 완료가 아니라 Work 전용 submit 진입이
검증됐다는 뜻이고, 제출 뒤 상태는 `readWorkTaskState()`의
`running|blocked|failed|complete` 계약으로만 판정한다.

| command/probe 경계 | active Work | active Chat | ambiguous/toggle 없음 |
| --- | --- | --- | --- |
| Chat capability probe 및 Chat 명령 | `fail`, `switch-to-chat`, mutation 0 | 기존 Chat 3-상태 계약 | `fail`, mutation 0 (legacy Chat은 기존 warning 경로만) |
| `work send` / `web_ai_work_send` preflight | `ok`; Work picker/composer evidence를 저장 | Work 전환 뒤 `ok` 또는 fail closed | `capability.unsupported`, mutation 0 |

Work `ok` evidence는 최소 `surface:'work'`, `responseContract:'work'`, picker
selection evidence와 관측 가능한 `taskId/taskUrl`를 포함해 세션으로 넘긴다. session
resume/poll은 `findActiveSession(..., surface:'work')`로만 찾으며, Chat의
`conversationId`를 Work identity fallback으로 쓰지 않는다
(`04_work_surface_support.md:228-249`).

## 3. 관측 preset과 registry 서술

### 3.1 `web-ai/capability-observation-presets.mjs:10-32`

새 컨테이너 testid와 role 계약을 앞에 두고 구 5.5 item testid를 배열 끝 legacy
fallback으로 내린다. `composer-model-picker-slider-*`는 Work discriminator evidence일
뿐 Chat 선택 성공 근거가 아니라는 note를 함께 둔다.

#### Before 3 (`web-ai/capability-observation-presets.mjs:10-32`, verbatim)

```js
export const CHATGPT_MODEL_SELECTOR_OBSERVATION = {
    status: 'implemented',
    source: 'live-frontend',
    selectorCandidates: [
        '[data-testid="model-switcher-dropdown-button"]',
        'button.__composer-pill[aria-haspopup="menu"]',
        '[data-testid="model-switcher-gpt-5-3"]',
        '[data-testid="model-switcher-gpt-5-5-thinking"]',
        '[data-testid="model-switcher-gpt-5-5-pro"]',
        '[data-testid="model-switcher-gpt-5-5-thinking-thinking-effort"]',
        '[data-testid="model-switcher-gpt-5-5-pro-thinking-effort"]',
    ],
    textCandidates: ['Latest', 'Instant', 'Fast', 'Thinking', 'Thinking • Heavy', 'Pro', 'Heavy', 'Effort', 'Configure...'],
    activationPath: ['open model switcher or composer model pill', 'select menuitemradio or model-switcher effort menuitem', 'verify aria-checked=true or active pill text'],
    activeStateSignals: ['composer model pill text', 'role=menuitemradio', 'aria-checked=true', 'Heavy pill for Pro/Heavy'],
    mutationRisk: 'low',
    notes: [
        'Codex Cloud is out of scope.',
        'Model label text must be filtered from response capture.',
        '2026-04-30 headed UI moved the visible model opener to the composer pill; top data-testid opener may be absent.',
        'Thinking/Pro effort controls are runtime selectors; Pro can appear as a Heavy composer pill in the headed UI.',
    ],
};
```

#### After 3

```js
export const CHATGPT_MODEL_SELECTOR_OBSERVATION = {
    status: 'implemented',
    source: 'live-frontend',
    selectorCandidates: [
        'form:has(#prompt-textarea, [data-testid="composer-textarea"], div[contenteditable="true"]) button[aria-haspopup="menu"]',
        '[role="menu"][data-state="open"] [data-testid="composer-intelligence-picker-content"]',
        '[data-testid="menu-item-submenu-chevron"]',
        // Legacy fallback candidates only.
        '[data-testid="model-switcher-dropdown-button"]',
        '[data-testid="model-switcher-gpt-5-5"]',
        '[data-testid="model-switcher-gpt-5-3"]',
        '[data-testid="model-switcher-gpt-5-5-thinking"]',
        '[data-testid="model-switcher-gpt-5-5-pro"]',
        '[data-testid="model-switcher-gpt-5-5-thinking-thinking-effort"]',
        '[data-testid="model-switcher-gpt-5-5-pro-thinking-effort"]',
    ],
    textCandidates: ['Intelligence', 'Instant', 'Medium', 'High', 'Extra High', 'Pro', 'GPT-5.6 Sol', 'GPT-5.5'],
    activationPath: ['confirm active Chat surface', 'open the composer-scoped aria-haspopup=menu trigger', 'scope to composer-intelligence-picker-content', 'observe exact family and tier menuitemradio labels', 'verify aria-checked/data-state and close with Escape'],
    activeStateSignals: ['active Chat surface radio', 'composer trigger tier text', 'role=menuitemradio exact label', 'aria-checked=true or data-state=checked'],
    mutationRisk: 'low',
    notes: [
        'Codex Cloud is out of scope.',
        'Model label text must be filtered from response capture.',
        '2026-04-30 headed UI moved the visible model opener to the composer pill; top data-testid opener may be absent.',
        '2026-07-10 Chat uses flat Intelligence tiers and a separate family submenu.',
        'composer-model-picker-slider-* is a Work discriminator, not a Chat success selector.',
        'model-switcher-* candidates are legacy fallback only.',
    ],
};
```

### 3.2 `web-ai/capability-registry.mjs:237-248`

status/gate/family 값은 유지한다. 실제 동작과 어긋난 `instant|thinking|pro via model
switcher` 서술만 2축 계약과 legacy normalization으로 교체한다.

#### Before 4 (`web-ai/capability-registry.mjs:236-249`, verbatim)

```js
    {
        id: 'chatgpt-model-selection',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.8/32.9',
        commandBehavior: 'support --model instant|thinking|pro via ChatGPT model switcher and aria-checked verification',
        browserMutationAllowed: true,
        failClosedStage: 'provider-select-model',
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'modelSelection',
        observation: CHATGPT_MODEL_SELECTOR_OBSERVATION,
    },
```

#### After 4

```diff
+        commandBehavior: 'support Chat --family plus --model/--reasoning-effort tier selection through the composer-scoped Intelligence picker with exact role/label and aria-checked verification; normalize legacy aliases before selection',
```

## 4. 진단과 fallback 소비자 판정

### 4.1 `web-ai/doctor.mjs:8,18-24`: 변경 필요

현재 진단은 mutation 모듈의 raw selector를 전역 실행한다. 새 trigger에서는
false-fail이 나고 generic `button[aria-haspopup="menu"]`가 추가되면 sidebar/header를
잡을 수 있다. 갱신된 observation preset을 진단 SSOT로 사용한다.

#### Before 5 (`web-ai/doctor.mjs:8,18-24`, verbatim)

`web-ai/doctor.mjs:8`:

```js
import { CHATGPT_MODEL_SELECTOR_BUTTONS } from './chatgpt-model.mjs';
```

`web-ai/doctor.mjs:18-24`:

```js
const CHATGPT_FEATURES = [
    { feature: 'composer', selectors: ['#prompt-textarea', '[data-testid="composer-textarea"]', 'div[contenteditable="true"]'] },
    { feature: 'model-picker', selectors: CHATGPT_MODEL_SELECTOR_BUTTONS },
    { feature: 'upload', selectors: ['button[aria-label*="Upload" i]', 'button[aria-label*="Attach" i]', 'button[data-testid*="plus" i]'] },
    { feature: 'response-feed', selectors: ['[data-message-author-role="assistant"]', '[data-turn="assistant"]', 'article[data-testid^="conversation-turn"]'] },
    { feature: 'copy-fallback', selectors: CHATGPT_COPY_SELECTORS.copyButtonSelectors },
    { feature: 'streaming-indicator', selectors: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'] },
];
```

#### After 5

```diff
+import { CHATGPT_MODEL_SELECTOR_OBSERVATION } from './capability-observation-presets.mjs';
+import {
+    CHATGPT_SURFACE_RADIO_SELECTOR,
+    CHATGPT_WORK_PICKER_MARKER_SELECTOR,
+} from './chatgpt-model.mjs';
+
+    { feature: 'model-picker', selectors:
+        [...CHATGPT_MODEL_SELECTOR_OBSERVATION.selectorCandidates] },
+    { feature: 'work-surface', selectors: [
+        CHATGPT_SURFACE_RADIO_SELECTOR,
+        CHATGPT_WORK_PICKER_MARKER_SELECTOR,
+    ] },
```

이 변경은 picker를 열지 않는다. closed composer trigger 또는 이미 열린 scoped menu 중
하나를 관측하며, legacy testid match는 report의 selector evidence로만 남는다. `work-surface`
진단은 exact Chat/Work radio와 Work marker를 읽어 `surface=work`를 capability evidence로
기록한다. doctor가 Chat 명령의 Work `fail`을 재사용해 Work 자체를 unsupported/deferred로
보고해서는 안 되며, Work send의 실제 가능 여부는 §2.3의 전용 preflight 결과로 보고한다.

### 4.2 `web-ai/tab-inspect.mjs:3-20,24-46,79-95`: 변경 필요

현재 전역 `button[aria-haspopup="menu"] > div > span` 첫 항목은 profile/도구 메뉴를
modelLabel로 오인할 수 있고 family+tier를 합쳐 버린다. inspect는 read-only이므로
메뉴를 강제로 열지 않으며, 확인하지 못한 family를 GPT-5.6으로 추정하지 않는다.

#### Before 6 (`web-ai/tab-inspect.mjs:3-20,31-33,41-43,79-95`, verbatim)

`web-ai/tab-inspect.mjs:3-20`:

```js
/**
 * @typedef {Object} TabSummary
 * @property {string} targetId
 * @property {string} title
 * @property {string} url
 * @property {string} vendor
 * @property {string|null} modelLabel
 * @property {boolean} stopExists
 * @property {boolean} sendExists
 * @property {boolean} promptReady
 * @property {boolean} authenticated
 * @property {number} assistantCount
 * @property {string|null} lastAssistantText
 * @property {string|null} lastAssistantSnippet
 * @property {string|null} conversationId
 * @property {string|null} fingerprint
 * @property {'running'|'completed'|'detached'|'stalled'} state
 */
```

`web-ai/tab-inspect.mjs:31-33`:

```js
    const lastText = lastAssistant?.innerText?.trim() || null;
    const modelEl = document.querySelector('[data-testid="model-switcher"] span, button[aria-haspopup="menu"] > div > span');
    const convMatch = window.location.pathname.match(/\\/c\\/([a-f0-9-]+)/);
```

`web-ai/tab-inspect.mjs:41-43`:

```js
        lastAssistantSnippet: lastText ? lastText.slice(0, 200) : null,
        modelLabel: modelEl?.textContent?.trim() || null,
        conversationId: convMatch ? convMatch[1] : null,
```

`web-ai/tab-inspect.mjs:79-95`:

```js
        return {
            targetId,
            title: meta.title || '',
            url: meta.url || '',
            vendor: 'chatgpt',
            modelLabel: data.modelLabel || null,
            stopExists: !!data.stopExists,
            sendExists: !!data.sendExists,
            promptReady: !!data.promptReady,
            authenticated: !!data.authenticated,
            assistantCount: data.assistantCount || 0,
            lastAssistantText: data.lastAssistantText || null,
            lastAssistantSnippet: data.lastAssistantSnippet || null,
            conversationId: data.conversationId || null,
            fingerprint: data.fingerprint || null,
            state,
        };
```

#### After 6

```diff
+ * @property {{surface:'chat'|'work'|'ambiguous'|null,familyLabel:string|null,
+ *   tierLabel:string|null,verified:boolean}|null} modelSelection

 const INSPECT_EXPRESSION = `(() => {
     const stopBtn = document.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label*="Stop"]');
     const sendBtn = document.querySelector('[data-testid="send-button"], button[aria-label="Send prompt"]');
     const composer = document.querySelector('#prompt-textarea, [contenteditable="true"]');
     const authEl = document.querySelector('[data-testid="profile-button"], img[alt="User"]');
     const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
     const lastAssistant = assistants[assistants.length - 1];
     const lastText = lastAssistant?.innerText?.trim() || null;
-    const modelEl = document.querySelector('[data-testid="model-switcher"] span, button[aria-haspopup="menu"] > div > span');
+    function readChatGptTabModelSelection() {
+        const surfaceRadios = Array.from(document.querySelectorAll('[role="radio"]'))
+            .filter(el => /^(Chat|Work)$/.test((el.textContent || '').trim()));
+        const hasSurfaceToggle = surfaceRadios.length > 0;
+        const activeRadios = surfaceRadios.filter(el =>
+            el.getAttribute('aria-checked') === 'true'
+            && el.getAttribute('data-state') === 'on');
+        const surfaceStateConsistent = surfaceRadios.length === 2
+            && surfaceRadios.every(el => {
+                const aria = el.getAttribute('aria-checked');
+                const state = el.getAttribute('data-state');
+                return (aria === 'true' && state === 'on')
+                    || (aria === 'false' && state === 'off');
+            });
+        const surface = !hasSurfaceToggle
+            ? null
+            : surfaceStateConsistent && activeRadios.length === 1
+                ? (activeRadios[0].textContent || '').trim().toLowerCase()
+                : 'ambiguous';
+        const composerRoot = composer?.closest('form');
+        const pickerTrigger = Array.from(
+            composerRoot?.querySelectorAll('button[aria-haspopup="menu"]') || [])
+            .find(el => /^(Instant|Medium|High|Extra High|Pro)$/i
+                .test((el.textContent || '').trim()));
+        const openPicker = document.querySelector(
+            '[role="menu"][data-state="open"] [data-testid="composer-intelligence-picker-content"]')
+            ?.closest('[role="menu"]');
+        const checkedRows = Array.from(
+            openPicker?.querySelectorAll('[role="menuitemradio"]') || [])
+            .filter(el => {
+                const aria = el.getAttribute('aria-checked');
+                const state = el.getAttribute('data-state');
+                return (aria === 'true' || state === 'checked')
+                    && (aria == null || state == null
+                        || (aria === 'true') === (state === 'checked'));
+            });
+        const familyLabel = (checkedRows.find(el =>
+            /^(GPT-5\.(?:6 Sol|5|4|3)|o3)$/i.test((el.textContent || '').trim()))
+            ?.textContent || '').trim() || null;
+        const legacyModelEl = document.querySelector('[data-testid="model-switcher"] span');
+        const tierLabel = (pickerTrigger?.textContent
+            || legacyModelEl?.textContent || '').trim() || null;
+        return {
+            surface,
+            familyLabel,
+            tierLabel,
+            verified: surface === 'chat' && Boolean(familyLabel && tierLabel),
+        };
+    }
+    const modelSelection = readChatGptTabModelSelection();
     const convMatch = window.location.pathname.match(/\\/c\\/([a-f0-9-]+)/);
     return JSON.stringify({
         stopExists: !!stopBtn,
         sendExists: !!sendBtn,
         promptReady: !!(sendBtn || (composer && !stopBtn)),
         authenticated: !!authEl,
         assistantCount: assistants.length,
         lastAssistantText: lastText,
         lastAssistantSnippet: lastText ? lastText.slice(0, 200) : null,
-        modelLabel: modelEl?.textContent?.trim() || null,
+        modelLabel: modelSelection.tierLabel,
+        modelSelection,
         conversationId: convMatch ? convMatch[1] : null,
         fingerprint: lastText ? String(assistants.length) + ':' + String(lastText.length) : null,
     });
 })()`;

         return {
             targetId,
             title: meta.title || '',
             url: meta.url || '',
             vendor: 'chatgpt',
             modelLabel: data.modelLabel || null,
+            modelSelection: data.modelSelection || null,
             stopExists: !!data.stopExists,
             sendExists: !!data.sendExists,
             promptReady: !!data.promptReady,
             authenticated: !!data.authenticated,
             assistantCount: data.assistantCount || 0,
             lastAssistantText: data.lastAssistantText || null,
             lastAssistantSnippet: data.lastAssistantSnippet || null,
             conversationId: data.conversationId || null,
             fingerprint: data.fingerprint || null,
             state,
         };

             results.push({
                 targetId: target.id,
                 title: target.title,
                 url: target.url,
                 vendor: 'chatgpt',
                 modelLabel: null,
+                modelSelection: null,
                 stopExists: false,
                 sendExists: false,
                 promptReady: false,
                 authenticated: false,
                 assistantCount: 0,
                 lastAssistantText: null,
                 lastAssistantSnippet: null,
                 conversationId: null,
                 fingerprint: null,
                 state: /** @type {const} */ ('completed'),
                 inUse: true,
             });
```

위 diff는 06 소유 심볼의 정의와 세 소비 지점을 모두 포함한다. 토글이 없으면
`surface=null`인 legacy UI로 기록하고,
토글이 있으나 두 radio의 `aria-checked`/`data-state`가 불일치하면
`surface=ambiguous,verified=false`다. 메뉴가 닫혔거나 legacy label만 읽은 상태는
`tierLabel`만 기록하고 `verified=false`다. `verified`는 Chat family/tier 선택 증거의
검증값이므로 active Work에서 false여도 Work surface 감지 실패가 아니다. outer Work
integration은 04의 `readWorkTaskState()` 결과에서 `surface:'work'`, `taskId`, `taskUrl`을
세션 evidence에 합친다. tab inspect는 그 값을 추정하거나 Chat `conversationId`로 대체하지
않으며, Work 탭의 surface 관측과 task 상태/identity evidence를 함께 표시한다.

### 4.3 `web-ai/vendor-editor-contract.mjs:111-120`: 변경 필요

현재 semantic name `/model/i,/gpt/i`는 tier text trigger를 놓친다. exact
tier/family name을 generic legacy name보다 앞에 두고 CSS fallback은 03의
`CHATGPT_MODEL_SELECTOR_BUTTONS`를 계속 소비한다.

#### Before 7 (`web-ai/vendor-editor-contract.mjs:111-122`, verbatim)

```js
export const CHATGPT_EDITOR_CONTRACT = Object.freeze({
    vendor: 'chatgpt',
    semanticTargets: {
        composer: { roles: ['textbox'], names: [/message/i, /prompt/i, /chatgpt/i], excludeNames: [/search/i], cssFallbacks: CHATGPT_COMPOSER_SELECTORS, required: true },
        sendButton: { roles: ['button'], names: [/send/i, /submit/i], cssFallbacks: CHATGPT_SEND_SELECTORS },
        modelPicker: { roles: ['button', 'combobox'], names: [/model/i, /gpt/i], cssFallbacks: CHATGPT_MODEL_SELECTOR_BUTTONS },
        uploadSurface: { roles: ['button'], names: [/attach/i, /upload/i, /file/i, /add/i], cssFallbacks: CHATGPT_UPLOAD_SELECTORS },
        responseFeed: { roles: ['article', 'region', 'group'], names: [/assistant/i, /response/i], cssFallbacks: CHATGPT_RESPONSE_SELECTORS },
        copyButton: { roles: ['button'], names: [/copy/i], cssFallbacks: CHATGPT_COPY_SELECTORS.copyButtonSelectors },
        streamingIndicator: { roles: ['button'], names: [/stop/i], cssFallbacks: CHATGPT_STREAMING_SELECTORS },
    },
});
```

#### After 7

```diff
+        modelPicker: {
+            roles: ['button', 'combobox'],
+            names: [/^(Instant|Medium|High|Extra High|Pro)$/i,
+                /^(GPT-5\.6 Sol|GPT-5\.5|GPT-5\.4|GPT-5\.3|o3)$/i,
+                /intelligence/i, /model/i, /gpt/i],
+            excludeNames: [/search/i, /attach/i, /upload/i],
+            cssFallbacks: CHATGPT_MODEL_SELECTOR_BUTTONS,
+        },
```

### 4.4 `web-ai/cli-sessions.mjs:275-290`: model 축과 Work identity 출력으로 확장

새 세션은 기존 resolved와 family/tier를 함께 출력한다. 구 세션은 `tierLabel`이
없으면 `resolvedLabel`을 tier fallback으로 보여 주되 family를 만들지 않는다. Work
세션은 `surface/taskId/taskUrl/responseContract`를 같은 evidence 줄에 출력해 Chat과
동일 vendor의 latest record가 혼입됐는지 사람이 판별할 수 있게 한다.

#### Before 8 (`web-ai/cli-sessions.mjs:275-290`, verbatim)

```js
function formatBrowserEvidenceLines(session) {
    /** @type {string[]} */
    const lines = [];
    const evidence = session?.modelSelection;
    if (evidence && typeof evidence === 'object') {
        const requested = evidence.requestedModel ?? '(none)';
        const resolved = evidence.resolvedLabel ?? '(unavailable)';
        const strategy = evidence.strategy ?? '(default)';
        const verified = evidence.verified ? 'yes' : 'no';
        lines.push(`model requested=${requested}; resolved=${resolved}; status=${evidence.status || 'unknown'}; strategy=${strategy}; verified=${verified}`);
    }
    for (const warning of session?.warnings || []) {
        if (!warning || typeof warning !== 'object' || !warning.code) continue;
        lines.push(`warning ${warning.code}: ${warning.message || ''}`.trim());
    }
    return lines;
}
```

#### After 8

```diff
+        const surface = evidence.surface ?? '(unavailable)';
+        const family = evidence.familyLabel ?? '(unavailable)';
+        const tier = evidence.tierLabel
+            ?? evidence.resolvedLabel
+            ?? '(unavailable)';
+        const taskId = evidence.taskId ?? '(unavailable)';
+        const taskUrl = evidence.taskUrl ?? '(unavailable)';
+        const responseContract = evidence.responseContract ?? '(unavailable)';
+        lines.push(`model requested=${requested}; resolved=${resolved}; surface=${surface}; family=${family}; tier=${tier}; taskId=${taskId}; taskUrl=${taskUrl}; responseContract=${responseContract}; status=${evidence.status || 'unknown'}; strategy=${strategy}; verified=${verified}`);
```

## 5. 테스트 확장

### 5.1 `test/unit/web-ai-capability.test.mjs:124-137`: 3-상태 회귀 행렬

기존 unknown/unsupported 테스트 (`test/unit/web-ai-capability.test.mjs:124-137`)는
보존한다. 같은 describe에 composer-scoped Chat trigger, scoped menu root, exact
`GPT-5.6 Sol` family와 `High` tier row를 제공하는 최소 fake page를 추가한다. 공용
sanitized fixture 생성은 07 소유이므로 이 테스트는 작은 inline fake만 사용한다.

```diff
+    it('accepts a GPT-5.6 Chat family+tier contract without legacy testids', async () => {
+        const { chatGptModelCapabilityProbe } =
+            await import('../../web-ai/chatgpt-model.mjs');
+        const page = fakeChatGpt56CapabilityPage({
+            surfaceToggle: { chat: ['true', 'on'], work: ['false', 'off'] },
+            familyLabel: 'GPT-5.6 Sol',
+            tierLabel: 'High',
+            legacyTestIds: false,
+        });
+
+        await expect(chatGptModelCapabilityProbe(page, 'thinking', {
+            family: 'gpt-5.6-sol', effort: 'high',
+        })).resolves.toMatchObject({
+            state: 'ok',
+            evidence: { surface: 'chat', familyLabel: 'GPT-5.6 Sol',
+                tierLabel: 'High', verified: true },
+            next: 'send',
+        });
+    });
```

fake는 `model-switcher-*`를 반환하면 안 되며, 호출 기록으로 family/tier locator가
03의 composer menu root 아래에서 평가됐고 최종 Escape로 메뉴가 닫혔음을 assert한다.
같은 inline fake에 아래 행을 추가해 probe와 `statusWebAi` 소비 결과를 함께 고정한다.

| case | probe 기대 | status 기대 | mutation 기대 |
| --- | --- | --- | --- |
| toggle 존재 + Chat + family/tier checked 일치 | `ok`, `verified=true` | `ready` | open/read/close만 |
| toggle 존재 + Work | `fail`, `stage=provider-surface-preflight`, `retryHint=switch-to-chat` | `blocked`, `ok=false` | picker mutation 0회 |
| toggle 존재 + `aria-checked`/`data-state` 모순 | 동일 preflight `fail` | `blocked`, `ok=false` | picker mutation 0회 |
| toggle 존재 + Chat + family 또는 tier 미검증 | `fail`, `verified=false`, `next=model-fallback` | `blocked`, `ok=false` | submit/selection 0회 |
| toggle 부재 + legacy selector 성공 | `warn`, `verified=false`, legacy warning, `next=send` | `ready`, `ok=true` | 기존 legacy open/read/close만 |

이 다섯 행이 새 입력 무시 false-ready, current surface 미검증 ready, old testid 제거
회귀를 함께 고정한다. `ambiguous` surface라는 이유만으로 `warn`을 허용하는 테스트는 두지
않는다. `warn` 허용 조건은 surface toggle 부재가 증명된 legacy 경로뿐이다.

Work 전용 fixture 행은 이 Chat 3-상태 행렬과 분리한다. `work send`와
`web_ai_work_send`는 active Work에서 `ensureWorkSurface()` 후 picker/composer evidence가
일치하면 preflight `ok`와 `surface:'work'`를 반환해야 한다. 같은 fixture에서 Chat
`send`는 여전히 `switch-to-chat` fail, ambiguous는 양쪽 경로 모두 mutation 0 fail을
assert한다. 제출 뒤에는 `readWorkTaskState()`의
`running|blocked|failed|complete` 각각을 session `taskId/taskUrl` 및
`responseContract:'work'`와 함께 회귀로 고정한다.

### 5.2 `test/unit/web-ai-sessions-command.test.mjs`: evidence 출력

기존 human show 테스트 (`test/unit/web-ai-sessions-command.test.mjs:137-177`)의
fixture와 기대 문자열을 새 필드로 확장한다. structured warning 검증은 그대로 둔다.

#### Before 9 (`test/unit/web-ai-sessions-command.test.mjs:137-177`, verbatim)

```js
    it('human show prints model selection evidence and structured warnings', async () => {
        const logs = [];
        const originalLog = console.log;
        console.log = (line = '') => logs.push(String(line));
        try {
            const { runWebAiCli } = await import('../../web-ai/cli.mjs');
            const { createSession } = await import('../../web-ai/session.mjs');
            const { patchSession } = await import('../../web-ai/session-store.mjs');
            const s = createSession({ vendor: 'chatgpt', prompt: 'x', attachmentPolicy: 'inline-only' });
            patchSession(s.sessionId, {
                modelSelection: {
                    requestedModel: 'pro',
                    resolvedLabel: 'GPT-5.5 Pro',
                    normalizedModel: 'pro',
                    strategy: 'select',
                    status: 'switched',
                    verified: true,
                    source: 'chatgpt-model-picker',
                    capturedAt: '2026-05-14T00:00:00.000Z',
                },
                warnings: [
                    'legacy warning string',
                    {
                        code: 'browser-pro-fast-large-run',
                        severity: 'warning',
                        message: 'Large browser Pro run completed quickly.',
                    },
                ],
            });

            await runWebAiCli(['sessions', 'show', s.sessionId]);

            const output = logs.join('\n');
            expect(output).toContain('Browser evidence:');
            expect(output).toContain('model requested=pro; resolved=GPT-5.5 Pro; status=switched; strategy=select; verified=yes');
            expect(output).toContain('warning browser-pro-fast-large-run: Large browser Pro run completed quickly.');
            expect(output).not.toContain('legacy warning string');
        } finally {
            console.log = originalLog;
        }
    });
```

#### After 9

```diff
+                    resolvedLabel: 'Pro',
+                    surface: 'chat',
+                    familyLabel: 'GPT-5.6 Sol',
+                    tierLabel: 'Pro',
+                    taskId: null,
+                    taskUrl: null,
+                    responseContract: 'chat',
+            expect(output).toContain('model requested=pro; resolved=Pro; surface=chat; family=GPT-5.6 Sol; tier=Pro; taskId=(unavailable); taskUrl=(unavailable); responseContract=chat; status=switched; strategy=select; verified=yes');
```

같은 테스트에 `resolvedLabel`만 가진 legacy session assertion을 한 줄 추가해
`family=(unavailable)` 및 `tier=<resolvedLabel>` fallback을 고정한다. 저장소 migration은
필요 없다 (`web-ai/session-store.mjs:8-32`). 별도 Work fixture는
`surface=work; taskId=<id>; taskUrl=<url>; responseContract=work` 출력과
`findActiveSession(..., surface:'work')` resume을 고정한다. 이 출력은 Chat probe의 Work
fail과 독립적인 Work send 성공 evidence다.

## 6. 적용 순서와 검증 게이트

1. 02 normalization/evidence/상수와 03 Chat role/label/menu-root helper가 먼저 반영됐는지 확인한다.
2. 04의 surface discriminator, `workSurfaceUnsupportedError`, `ensureWorkSurface`,
   `readWorkTaskState`, Work session surface filter를 반영한다.
3. Chat capability 배선/probe와 Work send 전용 preflight evidence, observation preset,
   registry 서술을 적용한다.
4. doctor, tab inspect, vendor contract, sessions human output에 Work surface/task identity
   evidence를 소비하게 한다.
5. Chat capability 5행 회귀 행렬, Work send success/fail 경계, sessions 출력 회귀를
   추가하고 아래 명령을 순서대로 실행한다.

```bash
npx vitest run test/unit/web-ai-capability.test.mjs test/unit/web-ai-sessions-command.test.mjs
npm run typecheck:checkjs-dom
npm run test:unit
git diff --check -- web-ai test/unit
```

focused Vitest와 `npm run test:unit`은 exit 0이어야 한다. checkjs DOM은 기존 전역
124건 기준선을 늘리지 않고, 이 phase가 건드린 파일의 신규 진단이 0건이어야 한다.

완료 조건은 (a) 5.6 family+tier Chat probe가 legacy testid 없이 `ok`, (b) Chat 명령의
toggle 존재 Work/ambiguous/current-Chat 미검증은
`provider-surface-preflight`/`switch-to-chat` 또는 `model-fallback`의 `fail`로
`statusWebAi=blocked`, (c) active Work의 `work send`/`web_ai_work_send` preflight는
`ok`이고 Chat 명령의 Work fail과 구분됨, (d) toggle 부재 legacy Chat probe만 `warn`과
warning evidence로 `statusWebAi=ready`, (e) 닫힌 메뉴의 tab inspect가 family를 추정하지
않고 `verified=false`이며 Work surface/task evidence를 보존, (f) session human output이
surface/family/tier/taskId/taskUrl/responseContract를 분리 출력, (g) 기존 5.5 세션과 legacy
selector fallback이 읽기 호환을 유지하는 것이다.

## 7. 비범위

- Work Power/Model/Effort/Speed 조작, Work submit/poll, `readWorkTaskState()` 구현은 04
  소유이며, 06은 그 결과를 capability/diagnostic/session evidence 소비자에 연결한다.
- `Instant -> GPT-5.5`를 DOM 무증거 상태에서 tab inspect family로 합성하지 않는다.
- 구 testid를 삭제하지 않는다. primary selector로 사용하지 않을 뿐이다.
- capability unknown 전체 정책을 이 슬라이스에서 바꾸지 않는다. 선택 입력이 없는
  `unknown`은 유지하되, toggle이 존재하는 family/tier 요청의 미검증 결과는 반드시
  `fail`이며 `warn -> ready`로 소비하지 않는다.
- 07의 공유 fixture, 08의 사용자 문서, 09의 structure gate를 선점하지 않는다.
