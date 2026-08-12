# 03 — Chat picker selector 패치 준비

기준일: 2026-07-10. 이 문서는 02가 확정한 Chat 입력 계약을
`web-ai/chatgpt-model.mjs`의 selector/label 판정과 해당 unit fixture에 옮기는
**diff-level 구현 명세**다. 실제 소스는 이 유닛에서 수정하지 않는다
(`00_index.md:3-7,31-45`).

근거 우선순위는 다음과 같다.

1. 현재 영어 UI 실측: Chat picker root, flat radio 5종, testid 소멸, Chat family
   `GPT-5.6 Sol/GPT-5.5/GPT-5.4/GPT-5.3/o3` submenu
   (`01_ui_contract_evidence.md:18-62`).
2. 02 확정 입력 계약: `instant -> Instant(5.5)`, canonical thinking effort
   `medium -> Medium`, `high -> High`, `xhigh -> Extra High`; raw legacy alias는
   `light|low|standard|normal|regular|default -> medium`, `extended -> high`,
   `heavy -> xhigh`; `pro -> Pro` flat radio다
   (`02_core_contract_decisions.md:42-64,124-183`).
3. 미실측 한국어와 구 UI는 삭제하지 않고 legacy fallback으로만 보존한다
   (`01_ui_contract_evidence.md:108-115`).

## 1. 범위와 불변식

### 1.1 이 슬라이스가 소유하는 것

- `web-ai/chatgpt-model.mjs:24-102`의 Chat trigger/pill/option/effort 라벨 테이블.
- `web-ai/chatgpt-model.mjs:483-595`의 current Chat option 우선 탐색과 family submenu
  진입 의미.
- `web-ai/chatgpt-model.mjs:731-830`의 checked effort/menu 판정.
- `web-ai/chatgpt-model.mjs:836-1105`의 checked model, menu-open, exact-label 정규화.
- `test/unit/web-ai-chatgpt-model.test.mjs:7-723,725-1033`의 GPT-5.6 Chat 회귀와
  fake picker 확장.

### 1.2 이 슬라이스가 하지 않는 것

- Work 자동화, surface detector/guard, `workSurfaceUnsupportedError`는 정의하거나
  호출하지 않는다. 이들은 04가 단독 소유하며, 03은 Chat menu root와 family 헬퍼만
  정의한다 (`04_work_surface_support.md:28-50,219-335`).
- 구 `model-switcher-*` testid를 삭제하지 않는다. toggle 부재에서 composer가 지목한
  menu root 안의 legacy fallback으로 **강등**한다.
- `GPT-5.4 Leaving on July 23`, `GPT-5.3`, `o3`를 `instant/thinking/pro` tier로 추정
  매핑하지 않는다. 이들은 `GPT-5.6 Sol/GPT-5.5`와 동등한 Chat family target이며,
  retirement badge는 `GPT-5.4` identity와 분리한다 (`01_ui_contract_evidence.md:45-62`).
- `GPT-5.6 Terra/Luna`는 Work Model submenu에서만 실측되었다. Work 자동화는 04의
  소유 범위이므로 Chat family alias/selector/fixture에는 넣지 않는다
  (`01_ui_contract_evidence.md:76-91`, `260710_cgate_r1_synthesis.md:5-10`).
- 한국어 신 UI 번역을 추측해 추가하지 않는다. 기존 `즉시/중간/높음/매우 높음/
  Pro 확장/프로 확장`만 legacy 계약으로 보존한다.

## 2. 파손 지점 요약

| 파손 지점 | 현재 문제 | 패치 원칙 |
| --- | --- | --- |
| trigger/pill pattern | 새 pill은 `Instant/Medium/High/Extra High/Pro`; Pro 관측 배열은 구 `Standard Pro/Extended Pro`뿐 | current exact label을 먼저 인식하고 구 문구는 fallback 유지 |
| model options | testid가 첫 선택 경로이고 Pro가 `Heavy/Pro Extended` 중심 | scoped `role=menuitemradio` + exact line을 먼저 찾고 testid는 마지막 |
| effort options | `Light/Standard/Extended/Heavy` 및 Pro submenu가 canonical | `medium/high/xhigh`만 thinking canonical로 두고 Pro는 effort control 없음 |
| simplified map | thinking `light -> Instant`, Pro `-> Pro Extended` | `Medium/High/Extra High/Pro`로 교체하되 기존 한국어/영어 fallback 유지 |
| submenu opener | «GPT-5.5» 한 문자열만 진입점으로 가정 | current family trigger `data-has-submenu`와 legacy 5.5를 분리 |
| menu-open | 전역 legacy testid 또는 전역 «GPT-5.5»만 보여도 true | open composer Intelligence root 우선, toggle 부재 시 composer-controlled legacy root만 후순위 |
| effort menu labels | thinking base가 Standard+Extended, Pro는 전 submenu 필요 | 요청 effort의 canonical flat row 하나, 미지정 시 unique current rows |
| regex/readback | fuzzy substring으로 family/effort/model row가 섞임 | 줄 단위 exact match, `aria-checked` readback, family row는 tier에서 제외 |

## 3. `web-ai/chatgpt-model.mjs` diff

아래 `After`는 03의 Chat selector 구현 순서를 고정하는 unified diff다.
`chatGptComposerMenuRoot(page)`와 family 헬퍼는 Chat menu root만 다루며, 04의
surface detector/guard와 독립적으로 이 문서의 라벨 집합과 우선순위를 유지한다.

### 3.1 trigger/pill 라벨 패턴과 Pro pill 목록

#### Before (`web-ai/chatgpt-model.mjs:30-39`)

```js
const CHATGPT_COMPOSER_MODEL_PILL_SELECTORS = [
    'button.__composer-pill[aria-haspopup="menu"]',
    '[role="button"].__composer-pill[aria-haspopup="menu"]',
    'button.__composer-pill',
    '[role="button"].__composer-pill',
];

const CHATGPT_MODEL_MENU_ITEM_SELECTOR = '[data-testid^="model-switcher-gpt-"]';
const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = /^(ChatGPT|GPT[-\s]?\d|((Light|Standard|Extended|Heavy)\s+)?(Instant|Fast|Thinking|Pro|Heavy)\b|Medium\b|High\b|Extra High\b|Pro Standard\b|Pro Extended\b|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)/i;
const CHATGPT_OBSERVED_PRO_PILL_LABELS = ['Standard Pro', 'Extended Pro'];
```

#### After

```diff
 const CHATGPT_COMPOSER_MODEL_PILL_SELECTORS = [
+    'button[aria-haspopup="menu"]',
     'button.__composer-pill[aria-haspopup="menu"]',
     '[role="button"].__composer-pill[aria-haspopup="menu"]',
     'button.__composer-pill',
     '[role="button"].__composer-pill',
 ];

 const CHATGPT_MODEL_MENU_ITEM_SELECTOR = '[data-testid^="model-switcher-gpt-"]';
-const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = /^(ChatGPT|GPT[-\s]?\d|((Light|Standard|Extended|Heavy)\s+)?(Instant|Fast|Thinking|Pro|Heavy)\b|Medium\b|High\b|Extra High\b|Pro Standard\b|Pro Extended\b|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)/i;
-const CHATGPT_OBSERVED_PRO_PILL_LABELS = ['Standard Pro', 'Extended Pro'];
+const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = /^(?:ChatGPT|Instant(?:\s+5\.5)?|Medium|High|Extra High|Pro|Standard Pro|Extended Pro|GPT[-\s]?\d(?:\.\d+)?(?:\s+(?:Instant|Fast|Thinking|Pro)(?:\s+(?:Light|Standard|Extended|Heavy))?)?|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)$/i;
+const CHATGPT_OBSERVED_PRO_PILL_LABELS = ['Pro', 'Standard Pro', 'Extended Pro'];
```

`button[aria-haspopup="menu"]`는 반드시 04의 active Chat composer form 아래에서
`isModelPillText()`로 text 검증한 뒤 click한다. 페이지 전역 selector button 배열에
넣어 무조건 click하지 않는다. `Instant\n5.5`는 `isModelPillText()`의 줄 단위 판정에서도
처리한다. `CHATGPT_OBSERVED_PRO_PILL_LABELS`에 `Pro`를 넣되, option 후보 제외는 구
`Standard Pro/Extended Pro`에만 적용하도록 §3.7에서 함께 고친다.

### 3.2 `CHATGPT_MODEL_OPTIONS`: current exact label 우선, testid 보존

#### Before (`web-ai/chatgpt-model.mjs:51-56`, verbatim)

```js
/** @type {Readonly<Record<ModelChoice, ModelOptionConfig>>} */
export const CHATGPT_MODEL_OPTIONS = {
    instant: { testIds: ['model-switcher-gpt-5-5', 'model-switcher-gpt-5-3'], labels: ['Instant', '즉시'] },
    thinking: { testIds: ['model-switcher-gpt-5-5-thinking', 'model-switcher-gpt-5-5-thinking-thinking-effort'], labels: ['Thinking', 'Medium', 'High', 'Extra High', '중간', '높음', '매우 높음'] },
    pro: { testIds: ['model-switcher-gpt-5-5-pro', 'model-switcher-gpt-5-5-pro-thinking-effort'], labels: ['Pro', 'Heavy', 'Pro Standard', 'Pro Extended', 'Pro 확장', '프로 확장'] },
};
```

#### After

```diff
 export const CHATGPT_MODEL_OPTIONS = {
     instant: {
         testIds: ['model-switcher-gpt-5-5', 'model-switcher-gpt-5-3'],
         labels: ['Instant', '즉시'],
     },
     thinking: {
         testIds: ['model-switcher-gpt-5-5-thinking', 'model-switcher-gpt-5-5-thinking-thinking-effort'],
-        labels: ['Thinking', 'Medium', 'High', 'Extra High', '중간', '높음', '매우 높음'],
+        labels: ['Medium', 'High', 'Extra High', 'Thinking', '중간', '높음', '매우 높음'],
     },
     pro: {
         testIds: ['model-switcher-gpt-5-5-pro', 'model-switcher-gpt-5-5-pro-thinking-effort'],
         labels: ['Pro', 'Heavy', 'Pro Standard', 'Pro Extended', 'Pro 확장', '프로 확장'],
     },
 };
```

배열 안에서 current label을 앞에 둔 것만으로는 testid가 강등되지 않는다. 실제 탐색
순서도 §3.5처럼 **scoped exact labels -> current family/tier 경로 -> legacy testIds**로
바꿔야 한다. `labels`의 한국어와 구 영어 값은 fallback 호환용이며 신 UI의 canonical
출력으로 기록하지 않는다.

### 3.3 `CHATGPT_MODEL_EFFORT_OPTIONS`: canonical effort와 flat Pro

#### Before (`web-ai/chatgpt-model.mjs:58-76`, verbatim)

```js
/** @type {Readonly<Record<string, EffortConfig>>} */
export const CHATGPT_MODEL_EFFORT_OPTIONS = {
    thinking: {
        triggerTestIds: ['model-switcher-gpt-5-5-thinking-thinking-effort'],
        efforts: {
            light: 'Light',
            standard: 'Standard',
            extended: 'Extended',
            heavy: 'Heavy',
        },
    },
    pro: {
        triggerTestIds: ['model-switcher-gpt-5-5-pro-thinking-effort'],
        efforts: {
            standard: 'Standard',
            extended: 'Extended',
        },
    },
};
```

#### After

```diff
 export const CHATGPT_MODEL_EFFORT_OPTIONS = {
     thinking: {
         triggerTestIds: ['model-switcher-gpt-5-5-thinking-thinking-effort'],
         efforts: {
-            light: 'Light',
-            standard: 'Standard',
-            extended: 'Extended',
-            heavy: 'Heavy',
+            medium: 'Medium',
+            high: 'High',
+            xhigh: 'Extra High',
         },
     },
     pro: {
         triggerTestIds: ['model-switcher-gpt-5-5-pro-thinking-effort'],
-        efforts: {
-            standard: 'Standard',
-            extended: 'Extended',
-        },
+        efforts: {},
     },
 };
```

raw `light|standard`는 selector에 도달하기 전에 `medium`, `extended`는 `high`,
`heavy`는 `xhigh`로 정규화된다. 단 `light|low`에는
`reasoning-effort-downgraded: requested <raw>; selected Medium` 경고를 남긴다.
Pro의 legacy `standard|normal|regular|default|extended`는 `Pro` tier만 선택하고
`SelectModelResult.effort=null`과
`reasoning-effort-unenforced: Pro has no effort control; selected Pro for legacy effort <raw>`
경고를 반환한다. Pro `medium|high|xhigh|light|heavy`와 Instant의 모든 effort는
mutation 전에 reject한다 (`02_core_contract_decisions.md:48-64`).

### 3.4 simplified mapping(현재 78-100): 5.6 tier + legacy aliases

#### Before (`web-ai/chatgpt-model.mjs:78-102`, verbatim)

```js
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

#### After

```diff
 const CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS = {
     instant: {
         defaultLabels: ['Instant', '즉시'],
-        efforts: { light: ['Instant', '즉시'] },
+        efforts: {},
     },
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
+        defaultLabels: ['Pro', 'Pro 확장', '프로 확장'],
-        efforts: {
-            standard: ['Pro Extended', 'Pro 확장', '프로 확장'],
-            extended: ['Pro Extended', 'Pro 확장', '프로 확장'],
-        },
+        efforts: {},
     },
 };
```

canonical table에는 02의 `medium/high/xhigh`만 둔다. legacy raw alias는
`EFFORT_ALIASES`가 canonical key로 바꾼 뒤 이 table을 소비하며, Pro legacy effort는
effort table을 읽지 않고 §3.3의 unenforced-warning 경로를 탄다. 기존 한국어
`즉시/중간/높음/매우 높음/Pro 확장/프로 확장`은 각각 기존 의미의 fallback label로
남기되 `보통/추론/매우 높게` 같은 미실측 번역은 추가하지 않는다. 구 영어 결합 라벨과
testid는 `CHATGPT_MODEL_OPTIONS` 및 legacy fallback 경로가 보존한다.

### 3.5 composer-scoped current menu root

#### Before (`web-ai/chatgpt-model.mjs:483-506,986-996`, verbatim)

`web-ai/chatgpt-model.mjs:483-506`:

```js
async function findModelOption(page, choice) {
    const option = CHATGPT_MODEL_OPTIONS[choice];
    await openSimplifiedIntelligenceSubmenu(page).catch(() => undefined);
    for (const testId of option.testIds) {
        const loc = page.locator(`[role="menuitemradio"][data-testid="${testId}"], [data-testid="${testId}"]`).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        if (!(await isModelOptionCandidate(loc, choice))) continue;
        return loc;
    }
    for (const label of option.labels) {
        const candidates = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: modelLabelPattern(choice, label) });
        const count = await candidates.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
            const loc = candidates.nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            if (!(await isModelOptionCandidate(loc, choice))) continue;
            return loc;
        }
    }
    const simplified = await findOptionByExactLabels(page, simplifiedDefaultLabels(choice));
    if (simplified && await isSimplifiedIntelligenceMenuOpen(page, choice, null)) return simplified;
    if (simplified && await isModelOptionCandidate(simplified, choice)) return simplified;
    return null;
}
```

`web-ai/chatgpt-model.mjs:986-996`:

```js
async function findOptionByExactLabels(page, labels) {
    for (const label of labels) {
        const candidates = await page.locator('[role="menuitemradio"], [role="menuitem"]').all().catch(() => /** @type {Locator[]} */ ([]));
        for (const loc of candidates) {
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
            if (menuTextHasExactLine(text, label)) return loc;
        }
    }
    return null;
}
```

#### After

```diff
+function chatGptComposerMenuRoot(page) {
+    return page.locator(CHATGPT_OPEN_PICKER_CONTENT_SELECTOR).last();
+}

 async function findModelOption(page, choice) {
     const option = CHATGPT_MODEL_OPTIONS[choice];
-    await openSimplifiedIntelligenceSubmenu(page).catch(() => undefined);
-    for (const testId of option.testIds) {
-        const loc = page.locator(`[role="menuitemradio"][data-testid="${testId}"], [data-testid="${testId}"]`).first();
-        if (!(await loc.isVisible().catch(() => false))) continue;
-        if (!(await isModelOptionCandidate(loc, choice))) continue;
-        return loc;
-    }
-    for (const label of option.labels) {
-        const candidates = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: modelLabelPattern(choice, label) });
-        const count = await candidates.count().catch(() => 0);
-        for (let index = 0; index < count; index += 1) {
-            const loc = candidates.nth(index);
-            if (!(await loc.isVisible().catch(() => false))) continue;
-            if (!(await isModelOptionCandidate(loc, choice))) continue;
-            return loc;
-        }
-    }
-    const simplified = await findOptionByExactLabels(page, simplifiedDefaultLabels(choice));
-    if (simplified && await isSimplifiedIntelligenceMenuOpen(page, choice, null)) return simplified;
-    if (simplified && await isModelOptionCandidate(simplified, choice)) return simplified;
+    const current = await findOptionByExactLabels(page, [
+        ...simplifiedDefaultLabels(choice),
+        ...option.labels,
+    ]);
+    if (current && await isModelOptionCandidate(current, choice)) return current;
+
+    // Only old one-row pickers need this compatibility transition.
+    await openSimplifiedIntelligenceSubmenu(page).catch(() => undefined);
+    const legacyByLabel = await findOptionByExactLabels(page, option.labels);
+    if (legacyByLabel && await isModelOptionCandidate(legacyByLabel, choice)) return legacyByLabel;
+
+    // Legacy fallback: only a no-toggle composer's controlled menu may own it.
+    const legacyMenu = await chatGptLegacyMenuRootOpenedByComposer(page);
+    if (legacyMenu) {
+        for (const testId of option.testIds) {
+            const loc = legacyMenu.locator(
+                `[role="menuitemradio"][data-testid="${testId}"], [data-testid="${testId}"]`,
+            ).first();
+            if (!(await loc.isVisible().catch(() => false))) continue;
+            if (await isModelOptionCandidate(loc, choice)) return loc;
+        }
+    }
     return null;
 }

 async function findOptionByExactLabels(page, labels) {
+    let menu = chatGptComposerMenuRoot(page);
+    if (!(await menu.isVisible().catch(() => false))) {
+        menu = await chatGptLegacyMenuRootOpenedByComposer(page);
+        if (!menu) return null;
+    }
     for (const label of labels) {
-        const candidates = await page
-            .locator('[role="menuitemradio"], [role="menuitem"]')
+        const candidates = await menu
+            .locator('[role="menuitemradio"], [role="menuitem"]')
             .all()
             .catch(() => /** @type {Locator[]} */ ([]));
         for (const loc of candidates) {
             if (!(await loc.isVisible().catch(() => false))) continue;
             const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
             if (menuTextHasExactLine(text, label)) return loc;
         }
     }
     return null;
 }
```

`CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR`와 `CHATGPT_OPEN_PICKER_CONTENT_SELECTOR`는 02가
단독 정의한다. 03은 두 상수를 재선언하지 않고, 위 `chatGptComposerMenuRoot()`와
selector 함수에서 참조만 한다.

current menuitemradio에는 testid가 없으므로 `role + exact line`이 identity이고,
`aria-checked=true`/`data-state=checked`는 선택 검증이다
(`01_ui_contract_evidence.md:27-43`). `findOptionByExactLabels`는 이 문서가 정의한
composer-scoped Chat menu root만 사용한다. legacy picker가 새 content testid를 갖지 않는 경우에는
`chatGptLegacyMenuRootOpenedByComposer()`가 no-toggle legacy surface와 composer form trigger의
`aria-controls`로 연결된 open menu root를 검증한 뒤 반환한 root만 사용한다.

### 3.6 `openSimplifiedIntelligenceSubmenu`: 5.5 고정 제거와 family 진입 분리

#### Before (`web-ai/chatgpt-model.mjs:508-534`, verbatim)

```js
/**
 * New ChatGPT picker can open to a one-row "GPT-5.5" family menu before the
 * Intelligence rows. Enter that submenu before looking for Instant/Medium/Pro
 * labels.
 *
 * @param {Page} page
 * @returns {Promise<void>}
 */
async function openSimplifiedIntelligenceSubmenu(page) {
    if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
    const candidates = page.locator('[role="menuitem"], [role="button"], button').filter({ hasText: /^GPT[-\s]?5\.5$/i });
    const count = await candidates.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
        const loc = candidates.nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.hover({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
        if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
        await loc.focus({ timeout: 1_000 }).catch(() => undefined);
        await page.keyboard.press('ArrowRight').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
        if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
        await loc.click({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
        if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
    }
}
```

#### After

```diff
-async function openSimplifiedIntelligenceSubmenu(page) {
-    if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
-    const candidates = page.locator('[role="menuitem"], [role="button"], button')
-        .filter({ hasText: /^GPT[-\s]?5\.5$/i });
+async function openSimplifiedIntelligenceSubmenu(page, options = {}) {
+    const forceFamily = options.forceFamily === true;
+    if (!forceFamily && await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
+    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
+    let menu = chatGptComposerMenuRoot(page);
+    if (!(await menu.isVisible().catch(() => false))) {
+        menu = await chatGptLegacyMenuRootOpenedByComposer(page);
+        if (!menu) return;
+    }
+    const candidateSelector = forceFamily
+        ? '[role="menuitem"][data-has-submenu]'
+        : '[role="menuitem"][data-has-submenu], [role="menuitem"], [role="button"], button';
+    const candidates = menu.locator(candidateSelector);
     const count = await candidates.count().catch(() => 0);
     for (let index = 0; index < count; index += 1) {
         const loc = candidates.nth(index);
         if (!(await loc.isVisible().catch(() => false))) continue;
+        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
+        if (!familyLabels.some(label =>
+            menuTextHasExactLine(text, label))) continue;
         await loc.hover({ timeout: 1_000 }).catch(() => undefined);
+        await page.waitForTimeout(150).catch(() => undefined);
+        if (forceFamily
+            ? Boolean(await findOpenFamilySubmenu(page, familyLabels))
+            : await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
+        await loc.focus({ timeout: 1_000 }).catch(() => undefined);
+        await page.keyboard.press('ArrowRight').catch(() => undefined);
+        await page.waitForTimeout(250).catch(() => undefined);
+        if (forceFamily
+            ? Boolean(await findOpenFamilySubmenu(page, familyLabels))
+            : await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
+        await loc.click({ timeout: 1_000 }).catch(() => undefined);
+        await page.waitForTimeout(250).catch(() => undefined);
+        if (forceFamily
+            ? Boolean(await findOpenFamilySubmenu(page, familyLabels))
+            : await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
     }
 }
```

`CHATGPT_FAMILY_OPTIONS`는 02가 canonical 다섯 family
`GPT-5.6 Sol/GPT-5.5/GPT-5.4/GPT-5.3/o3`로 단독 정의한다. 03은 위 diff에서 그
상수를 참조만 하며 별도 family/alias 집합을 만들지 않는다. Terra/Luna는 04가
단독 소유하는 Work 자동화 범위이므로 이 Chat 경로에 들어오지 않는다.

normal tier 선택은 Intelligence rows가 이미 보이면 family submenu를 열지 않는다.
02의 `family` 선택 경로만 `{ forceFamily: true }`로 `data-has-submenu` row를 연 다음,
submenu의 testid 없는 `menuitemradio`를 exact label로 고르고 `aria-checked=true`로
검증한다. `GPT-5.4\nLeaving on July 23`는 첫 줄 `GPT-5.4`를 family identity로 읽고
badge는 분리한다. `GPT-5.3`과 `o3`도 선택 가능한 family이며 tier 후보에서는 제외한다.
legacy one-row picker의 «GPT-5.5» 진입은 toggle 부재에서만 `forceFamily=false`
compatibility path로 남는다.

02가 options에 `family`를 추가한 뒤 `selectChatGptModel()`은 family를 tier보다 먼저
소비한다 (`web-ai/chatgpt-model.mjs:210-275`의 current flow 앞부분).

```diff
+const requestedFamily = normalizeChatGptFamilyChoice(options.family);
+if (options.family && !requestedFamily) throw familyMismatch(options.family, null);
 const requested = normalizeChatGptModelChoice(model);
 const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
 if (!requested) {
     if (model) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT model selection: ${model}`, evidence: { model } });
-    if (!requestedEffort) return null;
+    if (!requestedEffort && !requestedFamily) return null;
 }

 await openModelMenu(page, usedFallbacks);
+const familyEvidence = requestedFamily
+    ? await selectChatGptFamily(page, requestedFamily)
+    : await readVisibleChatGptFamilyEvidence(page);
+if (requestedFamily) await openModelMenu(page, usedFallbacks);
 let currentEvidence = await waitForModelPillEvidence(page, requested || null);

+async function selectChatGptFamily(page, family) {
+    const expected = CHATGPT_FAMILY_OPTIONS[family]?.label;
+    if (!expected) throw familyMismatch(family, null);
+    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
+    await openSimplifiedIntelligenceSubmenu(page, { forceFamily: true });
+    const before = await readVisibleChatGptFamilyEvidence(page);
+    const submenu = await findOpenFamilySubmenu(page, familyLabels);
+    if (!submenu) throw familyMismatch(family, expected);
+    const rows = await submenu.locator('[role="menuitemradio"]').all()
+        .catch(() => /** @type {Locator[]} */ ([]));
+    let option = null;
+    for (const row of rows) {
+        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
+        if (menuTextHasExactLine(text, expected)) {
+            option = row;
+            break;
+        }
+    }
+    if (!option) throw familyMismatch(family, expected);
+    const changed = !(before?.verified && before.label === expected);
+    if (changed) {
+        await option.click({ timeout: 5_000 });
+        await page.waitForTimeout(400).catch(() => undefined);
+        await openSimplifiedIntelligenceSubmenu(page, { forceFamily: true });
+    }
+    const after = await readVisibleChatGptFamilyEvidence(page);
+    if (!after?.verified || after.label !== expected) throw familyMismatch(family, expected);
+    return { label: after.label, changed, verified: true };
+}
+
+async function findOpenFamilySubmenu(page, familyLabels) {
+    const menus = await page.locator('[role="menu"][data-state="open"]').all()
+        .catch(() => /** @type {Locator[]} */ ([]));
+    for (let index = menus.length - 1; index >= 0; index -= 1) {
+        const menu = menus[index];
+        if (!(await menu.isVisible().catch(() => false))) continue;
+        const rows = await menu.locator('[role="menuitemradio"]').all()
+            .catch(() => /** @type {Locator[]} */ ([]));
+        for (const row of rows) {
+            const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
+            if (familyLabels.some(label => menuTextHasExactLine(text, label))) return menu;
+        }
+    }
+    return null;
+}
+
+async function readVisibleChatGptFamilyEvidence(page) {
+    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
+    const submenu = await findOpenFamilySubmenu(page, familyLabels);
+    if (submenu) {
+        const checkedRows = await submenu.locator(
+            '[role="menuitemradio"][aria-checked="true"], '
+            + '[role="menuitemradio"][data-state="checked"]',
+        ).all().catch(() => /** @type {Locator[]} */ ([]));
+        for (const row of checkedRows) {
+            if (!(await hasConsistentCheckedState(row))) continue;
+            const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
+            const label = familyLabels.find(candidate => menuTextHasExactLine(text, candidate));
+            if (label) return { label, changed: false, verified: true };
+        }
+    }
+    const root = chatGptComposerMenuRoot(page);
+    const triggers = await root.locator('[role="menuitem"][data-has-submenu]').all()
+        .catch(() => /** @type {Locator[]} */ ([]));
+    for (const trigger of triggers) {
+        const text = (await trigger.innerText({ timeout: 500 }).catch(() => '')).trim();
+        const label = familyLabels.find(candidate => menuTextHasExactLine(text, candidate));
+        if (label) return { label, changed: false, verified: false };
+    }
+    return null;
+}
+
+function familyMismatch(requested, expected) {
+    return new WebAiError({
+        errorCode: 'provider.model-mismatch',
+        stage: 'provider-select-mode',
+        vendor: 'chatgpt',
+        retryHint: 'model-fallback',
+        message: `ChatGPT family verification failed: requested ${requested}; expected ${expected || 'supported family'}`,
+        evidence: { requestedFamily: requested, expectedFamilyLabel: expected || null },
+    });
+}
+
+async function hasConsistentCheckedState(row) {
+    const ariaChecked = await row.getAttribute('aria-checked').catch(() => null);
+    const dataState = await row.getAttribute('data-state').catch(() => null);
+    if (ariaChecked !== null && dataState !== null) {
+        return ariaChecked === 'true' && dataState === 'checked';
+    }
+    return ariaChecked === 'true' || dataState === 'checked';
+}
```

`selectChatGptFamily()`의 반환형은 02 소비 계약과 동일한
`{label, changed, verified}`다. `findOpenFamilySubmenu()`는 active Chat family trigger를
조작한 직후의 open menu 중 canonical family exact radio를 포함한 menu만 반환한다.
`family` 생략 시 selector mutation은 0회이고 `readVisibleChatGptFamilyEvidence()`만 현재
보이는 증거를 읽는다.

### 3.7 option 후보와 `Pro` flat radio

#### Before (`web-ai/chatgpt-model.mjs:541-547`, verbatim)

```js
async function isModelOptionCandidate(loc, choice) {
    const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
    if (!text) return false;
    if (isStandaloneEffortLabel(text) || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)) return false;
    if (choice === 'pro' && isLegacyProModelLabel(text)) return false;
    return modelChoiceFromText(text) === choice;
}
```

#### After

```diff
 async function isModelOptionCandidate(loc, choice) {
     const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
     if (!text) return false;
-    if (isStandaloneEffortLabel(text) || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)) return false;
+    if (isStandaloneEffortLabel(text)) return false;
+    if (CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)
+        && !menuTextHasExactLine(text, 'Pro')) return false;
     if (choice === 'pro' && isLegacyProModelLabel(text)) return false;
     return modelChoiceFromText(text) === choice;
 }
```

이 변경이 없으면 §3.1에서 새 `Pro`를 관측 배열에 넣는 순간 실제 flat radio까지
제외된다. 반대로 `Standard Pro/Extended Pro`는 legacy effort pill이라 model row로
선택하지 않는다.

### 3.8 `requiredEffortMenuLabels`: 요청 flat row와 unique set

#### Before (`web-ai/chatgpt-model.mjs:762-819`, verbatim)

```js
async function isEffortMenuOpen(page, model, options = {}) {
    const allowUnlabeled = options.allowUnlabeled !== false;
    const requestedEffort = options.effort || null;
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    if (!config) return false;
    if (await isSimplifiedIntelligenceMenuOpen(page, model, requestedEffort)) return true;
    const labels = Object.values(config.efforts);
    const requiredLabels = requiredEffortMenuLabels(model, requestedEffort);
    const unexpectedLabels = Object.entries(CHATGPT_MODEL_EFFORT_OPTIONS)
        .filter(([choice]) => choice !== model)
        .flatMap(([, option]) => Object.values(option.efforts))
        .filter(label => !labels.includes(label));
    return page.locator('[role="menu"]').evaluateAll((menus, { expectedLabels, requiredLabels, unexpectedLabels, modelChoice, allowUnlabeled }) => {
        return menus.some(menu => {
            const text = /** @type {HTMLElement} */ (menu).innerText || menu.textContent || '';
            if (!menuTextMatchesModel(text, modelChoice, allowUnlabeled)) return false;
            const unexpectedMatches = unexpectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (unexpectedMatches.length > 0) return false;
            const requiredMatches = requiredLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (requiredMatches.length < requiredLabels.length) return false;
            const matches = expectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            const minimumMatches = requiredLabels.length || (expectedLabels.length <= 2 ? expectedLabels.length : Math.min(3, expectedLabels.length));
            return matches.length >= minimumMatches;
        });
        /**
         * @param {string} text
         * @param {string} choice
         * @param {boolean} permitUnlabeled
         */
        function menuTextMatchesModel(text, choice, permitUnlabeled) {
            const hasThinking = /\b(Thinking|Think)\b/i.test(text);
            const hasPro = /\bPro\b/i.test(text);
            if (!hasThinking && !hasPro) return permitUnlabeled;
            if (choice === 'thinking') return hasThinking && !hasPro;
            if (choice === 'pro') return hasPro && !hasThinking;
            return true;
        }
    }, { expectedLabels: labels, requiredLabels, unexpectedLabels, modelChoice: model, allowUnlabeled }).catch(() => false);
}

/**
 * @param {string} model
 * @param {string | null} [effort]
 * @returns {string[]}
 */
function requiredEffortMenuLabels(model, effort) {
    const efforts = CHATGPT_MODEL_EFFORT_OPTIONS[model]?.efforts || {};
    if (model === 'thinking') {
        const base = [efforts.standard, efforts.extended].filter(Boolean);
        if (effort === 'light' || effort === 'heavy') {
            return [...new Set([...base, efforts[effort]].filter(Boolean))];
        }
        if (effort === 'standard' || effort === 'extended') return base;
    }
    if (model === 'pro') return Object.values(efforts);
    if (effort && efforts[effort]) return [efforts[effort]];
    return Object.values(efforts);
}
```

#### After

```diff
-const labels = Object.values(config.efforts);
+const labels = [...new Set(Object.values(config.efforts))];
 const requiredLabels = requiredEffortMenuLabels(model, requestedEffort);
 // exact-line count only; do not use whitespace substring regex

 function requiredEffortMenuLabels(model, effort) {
     const efforts = CHATGPT_MODEL_EFFORT_OPTIONS[model]?.efforts || {};
-    if (model === 'thinking') {
-        const base = [efforts.standard, efforts.extended].filter(Boolean);
-        if (effort === 'light' || effort === 'heavy') {
-            return [...new Set([...base, efforts[effort]].filter(Boolean))];
-        }
-        if (effort === 'standard' || effort === 'extended') return base;
-    }
-    if (model === 'pro') return Object.values(efforts);
     if (effort && efforts[effort]) return [efforts[effort]];
-    return Object.values(efforts);
+    return [...new Set(Object.values(efforts))];
 }
```

GPT-5.6 current root의 full effort set은 thinking=`Medium/High/Extra High`다.
요청 canonical effort가 있으면 해당 row 하나만 필수로 한다. raw `light|standard`가
`medium`으로 정규화되어 같은 `Medium` row에 수렴하는 것은 실패가 아니다. Pro는
effort set이 비어 있으므로 `isEffortMenuOpen()`/`openEffortMenu()`를 호출하지 않고
flat tier 선택 뒤 warning만 구성한다. thinking menu의 `unexpectedLabels`와 match
count도 `menuTextHasExactLine()` 기반으로 바꿔 `High`가 `Extra High` 안에서 부분
일치하지 않게 한다 (`web-ai/chatgpt-model.mjs:762-800`).

### 3.9 checked model과 `isModelMenuOpen`: current first, legacy second

#### Before (`web-ai/chatgpt-model.mjs:836-857,928-945`, verbatim)

`web-ai/chatgpt-model.mjs:836-857`:

```js
async function readCheckedModelEvidence(page, expectedModel = null) {
    for (const [choice, option] of Object.entries(CHATGPT_MODEL_OPTIONS)) {
        for (const testId of option.testIds) {
            const row = page.locator(`[role="menuitemradio"][data-testid="${testId}"][aria-checked="true"], [data-testid="${testId}"][aria-checked="true"]`).first();
            const checked = await row.isVisible().catch(() => false);
            if (checked) {
                const label = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
                return { choice: /** @type {ModelChoice} */ (choice), label: label || String(choice) };
            }
        }
    }
    const checkedRows = await page.locator('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]').all().catch(() => /** @type {Locator[]} */ ([]));
    for (const row of checkedRows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (isStandaloneEffortLabel(text)) continue;
        const choice = modelChoiceFromText(text);
        if (choice) return { choice, label: text || String(choice) };
    }
    const active = await readActiveModelPill(page, { allowStandaloneHeavy: expectedModel === 'pro' });
    const choice = modelChoiceFromText(active);
    return choice ? { choice, label: active || String(choice) } : null;
}
```

`web-ai/chatgpt-model.mjs:928-945`:

```js
async function isModelMenuOpen(page) {
    const legacyOpen = await page.locator(CHATGPT_MODEL_MENU_ITEM_SELECTOR)
        .filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN })
        .evaluateAll((items) => items.some(item => {
            const text = (/** @type {HTMLElement} */ (item).innerText || item.textContent || '').trim();
            const testId = item.getAttribute?.('data-testid') || '';
            if (!text) return false;
            if (testId.includes('effort') && /^(Light|Standard|Extended|Heavy|Standard Pro|Extended Pro)$/i.test(text)) return false;
            return /^(ChatGPT|GPT[-\s]?\d|((Light|Standard|Extended|Heavy)\s+)?(Instant|Fast|Thinking|Pro|Heavy)\b|Medium\b|High\b|Extra High\b|Pro Standard\b|Pro Extended\b|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)/i.test(text);
        }))
        .catch(() => false);
    if (legacyOpen || await isSimplifiedIntelligenceMenuOpen(page, null, null)) return true;
    return page.locator('[role="menuitem"], [role="button"], button')
        .filter({ hasText: /^GPT[-\s]?5\.5$/i })
        .first()
        .isVisible()
        .catch(() => false);
}
```

#### After

```diff
 async function readCheckedModelEvidence(page, expectedModel = null) {
+    const menu = chatGptComposerMenuRoot(page);
+    const checkedRows = await menu.locator(
+        '[role="menuitemradio"][aria-checked="true"], '
+        + '[role="menuitemradio"][data-state="checked"]',
+    ).all().catch(() => /** @type {Locator[]} */ ([]));
+    for (const row of checkedRows) {
+        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
+        if (!(await hasConsistentCheckedState(row))) continue;
+        const choice = modelChoiceFromText(text);
+        if (choice) return { choice, label: text || String(choice) };
+        // Checked family rows such as GPT-5.6 Sol intentionally fall through.
+    }
+
+    // Legacy fallback only after current role/label/checked evidence misses.
     for (const [choice, option] of Object.entries(CHATGPT_MODEL_OPTIONS)) {
         for (const testId of option.testIds) {
             const row = page.locator(
                 `[role="menuitemradio"][data-testid="${testId}"][aria-checked="true"], `
                 + `[data-testid="${testId}"][aria-checked="true"]`,
             ).first();
             if (!(await row.isVisible().catch(() => false))) continue;
             const label = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
             return { choice, label: label || String(choice) };
         }
     }
-    const checkedRows = await page.locator('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]').all().catch(() => /** @type {Locator[]} */ ([]));
-    for (const row of checkedRows) {
-        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
-        if (isStandaloneEffortLabel(text)) continue;
-        const choice = modelChoiceFromText(text);
-        if (choice) return { choice, label: text || String(choice) };
-    }
     const active = await readActiveModelPill(page, { allowStandaloneHeavy: expectedModel === 'pro' });
     const choice = modelChoiceFromText(active);
     return choice ? { choice, label: active || String(choice) } : null;
 }

 async function isModelMenuOpen(page) {
+    if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return true;
-    const legacyOpen = await page.locator(CHATGPT_MODEL_MENU_ITEM_SELECTOR)
-        .filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN })
-        .evaluateAll((items) => items.some(item => {
-            const text = (/** @type {HTMLElement} */ (item).innerText || item.textContent || '').trim();
-            const testId = item.getAttribute?.('data-testid') || '';
-            if (!text) return false;
-            if (testId.includes('effort') && /^(Light|Standard|Extended|Heavy|Standard Pro|Extended Pro)$/i.test(text)) return false;
-            return CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text);
-        }))
-        .catch(() => false);
-    if (legacyOpen || await isSimplifiedIntelligenceMenuOpen(page, null, null)) return true;
-    return page.locator('[role="menuitem"], [role="button"], button')
-        .filter({ hasText: /^GPT[-\s]?5\.5$/i })
-        .first().isVisible().catch(() => false);
+    return Boolean(await chatGptLegacyMenuRootOpenedByComposer(page));
 }
+
+async function chatGptLegacyMenuRootOpenedByComposer(page) {
+    const current = chatGptComposerMenuRoot(page);
+    if (await current.isVisible().catch(() => false)) return null;
+    const composer = page.locator('form').filter({
+        has: page.locator(CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR),
+    }).last();
+    const trigger = composer.locator(CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR)
+        .filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN }).first();
+    if (!(await trigger.isVisible().catch(() => false))) return null;
+    if (await trigger.getAttribute('aria-expanded').catch(() => null) !== 'true') return null;
+    const menuId = await trigger.getAttribute('aria-controls').catch(() => null);
+    if (!menuId) return null;
+    const menu = page.locator(
+        `[role="menu"][data-state="open"][id=${JSON.stringify(menuId)}]`,
+    ).first();
+    if (!(await menu.isVisible().catch(() => false))) return null;
+    const legacyLabels = [
+        ...CHATGPT_MODEL_OPTIONS.instant.labels,
+        ...CHATGPT_MODEL_OPTIONS.thinking.labels,
+        ...CHATGPT_MODEL_OPTIONS.pro.labels,
+        'GPT-5.5',
+    ];
+    const rows = await menu.locator(
+        `[role="menuitemradio"], [role="menuitem"], ${CHATGPT_MODEL_MENU_ITEM_SELECTOR}`,
+    ).all().catch(() => /** @type {Locator[]} */ ([]));
+    for (const row of rows) {
+        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
+        const testId = await row.getAttribute('data-testid').catch(() => null) || '';
+        if (testId.includes('effort') && isStandaloneEffortLabel(text)) continue;
+        if (legacyLabels.some(label => menuTextHasExactLine(text, label))) return menu;
+    }
+    return null;
+}
```

전역 «GPT-5.5» visible fallback은 삭제한다. 페이지 어딘가의 family/Work row 하나가
Chat menu-open 증거가 될 수 없기 때문이다. legacy **testid fallback은 삭제하지 않고**
current root 판정 뒤로 옮긴다. `chatGptLegacyMenuRootOpenedByComposer()`는 기존 testid 없는 June
simplified menu를 보존하되, current Chat content root가 없고 composer form 내부 trigger가
`aria-expanded=true`이며 `aria-controls`로 연결한 open menu root에 legacy exact label이 있을 때만
그 root를 반환한다. surface 판정과 fail-closed 정책은 04가 단독 소유하며, 03은 이를
재정의하지 않는다 (`04_work_surface_support.md:28-50`).
`hasConsistentCheckedState()`는 `aria-checked=true` 또는 `data-state=checked`를 요구하고,
둘 다 존재하면서 서로 모순되면 false를 반환한다. current tier/family 모두 같은 helper를
써야 하며 모순된 row는 `modelSelection.verified=true`의 근거가 될 수 없다
(`02_core_contract_decisions.md:515-518`).

### 3.10 라벨 정규식/정확 일치(`web-ai/chatgpt-model.mjs:952-1105`)

#### Before (`web-ai/chatgpt-model.mjs:952-979,1004-1014,1053-1099`, verbatim)

`web-ai/chatgpt-model.mjs:952-979`:

```js
function modelLabelPattern(choice, label) {
    if (choice === 'instant') return /\b(Instant|Fast)\b|즉시/i;
    if (choice === 'thinking') return /\b(Thinking|Think|Medium|High|Extra High)\b|중간|높음|매우 높음/i;
    if (choice === 'pro') return /\b(Pro|Heavy|Pro Standard|Pro Extended)\b|Pro 확장|프로 확장/i;
    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
}

/**
 * @param {string} label
 * @returns {RegExp}
 */
function effortLabelPattern(label) {
    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
}

/**
 * @param {string} text
 * @returns {ModelChoice | null}
 */
function modelChoiceFromText(text) {
    if (/\b(Instant|Fast)\b|즉시/i.test(text)) return 'instant';
    if (isLegacyProModelLabel(text)) return null;
    if (/\b(Pro Standard|Pro Extended)\b|Pro 확장|프로 확장/i.test(text)) return 'pro';
    if (/\b(Medium|High|Extra High)\b|중간|높음|매우 높음/i.test(text)) return 'thinking';
    if (/\b(Thinking|Think)\b/i.test(text)) return 'thinking';
    if (/\b(Pro|Heavy)\b/i.test(text)) return 'pro';
    return null;
}
```

`web-ai/chatgpt-model.mjs:1004-1014`:

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

`web-ai/chatgpt-model.mjs:1053-1099`:

```js
function menuTextHasExactLine(text, label) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => normalizeModelPickerText(line))
        .includes(normalizeModelPickerText(label));
}

/**
 * @param {unknown} text
 * @returns {string}
 */
function normalizeModelPickerText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Reject legacy explicit GPT-5.x Pro model rows without blocking current Pro labels.
 * @param {unknown} text
 * @returns {boolean}
 */
function isLegacyProModelLabel(text) {
    const normalized = normalizeModelPickerText(text);
    return [
        'gpt 5 pro',
        'gpt 5 0 pro',
        'gpt 5 1 pro',
        'gpt 5 2 pro',
        'gpt 5 3 pro',
        'gpt 5 4 pro',
    ].some(label => normalized.includes(label));
}

/** @param {string} text @returns {boolean} */
function isModelPillText(text) {
    return CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text)
        || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)
        || isStandaloneEffortLabel(text);
}

/** @param {unknown} text @returns {boolean} */
function isStandaloneEffortLabel(text) {
    return /^(Light|Standard|Extended|Heavy)$/i.test(String(text || '').trim());
}
```

#### After

```diff
 function modelLabelPattern(choice, label) {
-    if (choice === 'instant') return /\b(Instant|Fast)\b|즉시/i;
-    if (choice === 'thinking') return /\b(Thinking|Think|Medium|High|Extra High)\b|중간|높음|매우 높음/i;
-    if (choice === 'pro') return /\b(Pro|Heavy|Pro Standard|Pro Extended)\b|Pro 확장|프로 확장/i;
-    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
+    const labels = CHATGPT_MODEL_OPTIONS[choice]?.labels || [label];
+    return exactMenuLinePattern(labels);
 }

 function effortLabelPattern(label) {
-    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
+    return exactMenuLinePattern([label]);
 }

 function modelChoiceFromText(text) {
-    if (/\b(Instant|Fast)\b|즉시/i.test(text)) return 'instant';
+    if (menuTextHasAnyExactLine(text, ['Instant', '즉시'])) return 'instant';
     if (isLegacyProModelLabel(text)) return null;
-    if (/\b(Pro Standard|Pro Extended)\b|Pro 확장|프로 확장/i.test(text)) return 'pro';
-    if (/\b(Medium|High|Extra High)\b|중간|높음|매우 높음/i.test(text)) return 'thinking';
-    if (/\b(Thinking|Think)\b/i.test(text)) return 'thinking';
-    if (/\b(Pro|Heavy)\b/i.test(text)) return 'pro';
+    if (menuTextHasAnyExactLine(text, ['Medium', 'High', 'Extra High', '중간', '높음', '매우 높음'])) return 'thinking';
+    if (menuTextHasAnyExactLine(text, ['Pro', 'Pro 확장', '프로 확장'])) return 'pro';
+    // Legacy combined labels remain a fallback after current exact rows.
+    if (/\b(Thinking|Think)\b/i.test(text)) return 'thinking';
+    if (/\b(Pro Standard|Pro Extended|Standard Pro|Extended Pro|Heavy)\b|Pro 확장|프로 확장/i.test(text)) return 'pro';
     return null;
 }

 async function isSimplifiedIntelligenceMenuOpen(page, model, effort) {
     const requiredLabels = effort && model
         ? simplifiedEffortLabels(model, effort)
-        : ['Instant', 'Medium', 'High', 'Extra High', '즉시', '중간', '높음', '매우 높음'];
+        : ['Instant', 'Medium', 'High', 'Extra High', 'Pro', '즉시', '중간', '높음', '매우 높음'];
     if (requiredLabels.length === 0) return false;
-    return page.locator('[role="menu"]').evaluateAll((menus, labels) => menus.some(menu => {
-        const text = /** @type {HTMLElement} */ (menu).innerText || menu.textContent || '';
-        if (!/\bIntelligence\b|지능/i.test(text)) return false;
-        return labels.some(label => menuTextHasExactLine(text, label));
-    }), requiredLabels).catch(() => false);
+    const menu = chatGptComposerMenuRoot(page);
+    const visible = await menu.isVisible().catch(() => false);
+    if (!visible) return false;
+    const rows = await menu.locator('[role="menuitemradio"]').all()
+        .catch(() => /** @type {Locator[]} */ ([]));
+    for (const row of rows) {
+        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
+        if (requiredLabels.some(label => menuTextHasExactLine(text, label))) return true;
+    }
+    return false;
 }

+function exactMenuLinePattern(labels) {
+    const alternatives = labels.map(escapeRegExp).join('|');
+    return new RegExp(`(?:^|\\r?\\n)\\s*(?:${alternatives})\\s*(?=\\r?\\n|$)`, 'i');
+}
+
+function menuTextHasAnyExactLine(text, labels) {
+    return labels.some(label => menuTextHasExactLine(text, label));
+}
+
 function isModelPillText(text) {
-    return CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text)
+    return menuTextHasAnyExactLine(text, ['Instant', 'Medium', 'High', 'Extra High', 'Pro'])
+        || CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text)
         || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)
         || isStandaloneEffortLabel(text);
 }

 function isStandaloneEffortLabel(text) {
+    // Legacy split-pill/submenu labels only. Current Medium/High/Extra High/Pro
+    // are selectable tier rows and must not be filtered here.
     return /^(Light|Standard|Extended|Heavy)$/i.test(String(text || '').trim());
 }
```

`menuTextHasExactLine()`과 `normalizeModelPickerText()`의 Unicode letter/number 정규화는
그대로 재사용한다 (`web-ai/chatgpt-model.mjs:1053-1069`). 이로써 `High`는
`Extra High`의 substring으로 매치되지 않고, `Instant\n5.5`와
`GPT-5.4\nLeaving on July 23`는 각각 첫 줄 identity와 badge를 함께 보존한다.
`isLegacyProModelLabel()`의 명시적 구 GPT Pro 차단 목록도 유지한다
(`web-ai/chatgpt-model.mjs:1072-1087`).

## 4. family/tier 선택 및 검증 순서

02의 2축 입력을 실제 DOM에 적용하는 순서는 아래로 고정한다.

1. 04의 Chat preflight가 허용한 호출에서 composer-scoped Chat menu root를 확인한다.
2. `family`가 명시되면 tier 종류와 무관하게 current Intelligence root의
   `[role="menuitem"][data-has-submenu]` exact label을 열고 family submenu radio를
   선택한다. family 생략 시 submenu를 열거나 row를 click하지 않는다.
3. family submenu의 checked radio를 exact label + `aria-checked=true`로 재검증한다.
   `GPT-5.4`의 retirement badge는 identity에 합치지 않는다.
4. Intelligence root로 돌아와 tier row를 고른다. `instant`와 family를 함께 요청해도
   family 선택/증거는 보존하지만, 현재 실행 tier `Instant`가 GPT-5.5라는 의미는
   바꾸지 않는다 (`02_core_contract_decisions.md:185-201`).
5. thinking은 canonical effort의 visible row(`Medium/High/Extra High`)를 고르고 checked
   radio로 검증한다. Pro는 `Pro` 한 row를 고르며 별도 effort submenu를 열지 않고
   legacy effort 요청은 `effort=null` + unenforced warning으로 반환한다.
6. current role/label 경로가 없을 때만 legacy label/testid/submenu 경로를 시도한다.

선택 결과는 family와 tier evidence를 한 문자열로 뭉개지 않는다. `surface='chat'`,
exact `familyLabel`, exact `tierLabel`을 분리하고 호환 `resolvedLabel`은 `tierLabel`과
같게 둔다. 특히 `Instant`를 선택한 결과를 checked family «GPT-5.6 Sol» 때문에
thinking tier로 오판하지 않는다 (`02_core_contract_decisions.md:345-428`).

## 5. 한국어 라벨 정책

한국어 UI는 2026-07-10 세션에서 미실측이다 (`01_ui_contract_evidence.md:108-111`).
따라서 이번 패치의 정책은 다음과 같다.

- 기존 `즉시`, `중간`, `높음`, `매우 높음`, `Pro 확장`, `프로 확장` 문자열과 관련
  tests를 삭제하지 않는다.
- 위 문자열은 current 영어 canonical label 뒤의 legacy alias로만 둔다. 영어 실측을
  한국어에도 동일하다고 주장하지 않는다.
- `Medium/High/Extra High/Pro`, `GPT-5.6 Sol/Terra/Luna`의 한국어 번역을 추측하지
  않는다.
- 추후 한국어 라이브 프로브가 확보되면 sanitized DOM/스크린샷 근거와 함께 별도
  table row를 추가한다. 그 전에는 기존 한국어 회귀 통과가 호환성의 하한이다.

## 6. `web-ai-chatgpt-model.test.mjs` GPT-5.6 케이스

현재 suite는 June simplified fixture를 `Pro Standard/Pro Extended`로 만들고
(`test/unit/web-ai-chatgpt-model.test.mjs:51-108,826-857`), 공통 fixture는 legacy
5.5 testid row를 기본 제공한다 (`test/unit/web-ai-chatgpt-model.test.mjs:766-825`).
기존 모드를 덮어쓰지 말고 `pickerContract: 'gpt-5.6'` 모드를 추가한다.

### 6.1 fixture diff

`createFakeModelPage()`에 다음 상태/증거를 추가한다.

- exact Chat/Work header radio와 `data-state`/`aria-checked`; GPT-5.6 happy path는
  Chat=`on`, Work=`off`를 기본으로 한다. no-toggle fixture는 별도의 legacy 성공 경로에서만 쓴다.
- current Chat menu outer root: `[role="menu"][data-state="open"]`와 그 아래
  `data-testid="composer-intelligence-picker-content"`.
- tier rows: testid 없는 `menuitemradio` `Instant\n5.5`, `Medium`, `High`,
  `Extra High`, `Pro`; 각 row의 `aria-checked`/`data-state`를 state에서 계산.
- family trigger: `role=menuitem`, `data-has-submenu`, 현재 family label.
- family rows: testid 없는 `menuitemradio` `GPT-5.6 Sol`, `GPT-5.5`,
  `GPT-5.4\nLeaving on July 23`, `GPT-5.3`, `o3`. Terra/Luna는 넣지 않는다.
- `createElement`/`makeLocator`에 `role`, `data-state`, `aria-checked`,
  `data-has-submenu`, parent/descendant scope, click log를 추가한다. 현재 fake의
  `getAttribute`는 testid만 반환하므로 확장이 필요하다
  (`test/unit/web-ai-chatgpt-model.test.mjs:994-1031`).
- `thinkingEffortTexts()` 등 line 725 fixture는 legacy 회귀용으로 그대로 둔다
  (`test/unit/web-ai-chatgpt-model.test.mjs:725-755`). GPT-5.6 row factory를 별도로
  추가해 구 테스트의 의미를 바꾸지 않는다.

### 6.2 추가/교체 테스트 목록

1. **current contract table**: thinking canonical map이
   `{medium: Medium, high: High, xhigh: Extra High}`, Pro efforts가 `{}`이고 old
   `triggerTestIds/testIds` 배열은 legacy fallback으로 남아 있음을 검증한다.
2. **composer trigger without testid**: form 안의 visible
   `button[aria-haspopup=menu]`로 picker를 열고 current content root를 인식한다.
3. **Instant + 5.5 badge**: `Instant\n5.5`를 exact line으로 선택하고 checked radio,
   `selected=instant`, `tierLabel=Instant`, badge=5.5를 검증한다. `familyLabel`은 별도
   요청/관측값을 유지하며 5.5로 강제 덮어쓰지 않는다.
4. **thinking light/low -> Medium downgrade**: testid 없는 Medium radio를 선택하고
   result effort는 `medium`, warning은 `reasoning-effort-downgraded`이며 raw key를 담는다.
5. **thinking standard aliases -> Medium**: `standard|normal|regular|default|medium`이
   `medium`으로 정규화되고 downgrade warning 없이 같은 Medium row를 사용한다.
6. **thinking extended/high -> High**: `extended` alias와 canonical `high`가 High 한 row를
   click하고 result effort=`high`, `aria-checked=true`를 검증한다. `extended` 결과의
   warning 배열은 정확히 한 항목이며 legacy alias/selected High를 식별한다. canonical
   `high` 결과의 같은 warning은 0개다.
7. **thinking heavy/xhigh -> Extra High**: `High` substring 후보를 고르지 않고
   `Extra High` exact row를 선택하며 result effort=`xhigh`다.
8. **Pro flat radio + legacy warning**: effort 없는 Pro는 warning 없이 성공한다. legacy
   `standard|normal|regular|default|extended`는 current `Pro` 한 row로 수렴하고
   `effort=null` + `reasoning-effort-unenforced`를 반환하며 `Pro Extended`나 effort
   trigger를 열지 않는다. 각 legacy 호출의 warning 배열은 정확히 한 항목이고 중복
   방출하지 않는다. Pro `medium|high|xhigh|light|heavy`는 click 전에 reject한다.
9. **current path outranks legacy testid**: 동일 문서에 current radio와 legacy testid
   row가 함께 있어도 current click만 1회, legacy click은 0회다.
10. **legacy testid fallback retained**: toggle이 없는 old-menu fake에서 composer form의
    trigger와 `aria-controls`로 연결된 open menu root 아래 `model-switcher-gpt-5-5-*`
    경로가 계속 성공한다. 같은 testid가 전역 stray menu에만 있으면 성공하지 않는다.
11. **checked family row ignored as tier**: `GPT-5.6 Sol` family와 `Medium` tier가 둘 다
    checked로 관측돼도 model readback은 `thinking`, family evidence는 Sol로 분리된다.
    `aria-checked`와 `data-state`가 모순된 tier/family row는 `verified=false`다.
12. **family submenu**: `data-has-submenu` «GPT-5.6 Sol»을 열어 `GPT-5.6 Sol`,
    `GPT-5.5`, `GPT-5.4\nLeaving on July 23`, `GPT-5.3`, `o3`를 각각 exact
    role/label로 선택하고 checked 상태를 검증한다. `family + instant`도
    family를 먼저 선택/검증한 뒤 Instant tier를 선택한다. family-only 요청은 현재 tier를
    유지하고 family만 바꾸며, family 생략 케이스는 submenu mutation 0회다.
13. **retirement badge identity**: `GPT-5.4\nLeaving on July 23`가 GPT-5.4 family row로
    읽히되 tier 또는 GPT-5.6 target으로 선택되지 않는다. `GPT-5.3/o3`도 tier 후보에서
    제외한다.
14. **legacy one-row GPT-5.5 transition**: toggle 부재 fixture의 기존 한 줄 «GPT-5.5»
    opener는 composer-controlled menu root 안에서 current family trigger보다 후순위로 동작한다.
15. **menu-open scope**: closed/global/Work stray «GPT-5.5», `Medium`, `High`만으로
    `isModelMenuOpen`이 true가 되지 않는다. current 경로는 open composer Intelligence
    content가 있어야 하고, legacy 경로는 toggle 부재 + form 내부 expanded trigger +
    `aria-controls`로 연결된 open menu root가 모두 있어야 한다. `work|ambiguous`는
    fail-closed이며 trigger-before-fail 자체는 04 테스트 소유다.
16. **Korean legacy preservation**: 기존 한국어 exact rows를 넣은 legacy fixture가
    전과 같이 normalize/select되며, 미실측 신 한국어 문자열 assertion은 추가하지 않는다.
17. **existing behavioral suite remains**: bounded retry, unavailable warning/evidence,
    old split-pill Heavy 방어를 active Chat fixture에서 유지한다. no-flags zero-touch
    assertion은 Chat fixture에서 current/legacy selector의 zero-touch 경계를 갱신한다
    (`test/unit/web-ai-chatgpt-model.test.mjs:24-49,543-710,1035-1048`).

기존 첫 source-string test `supports the observed Heavy/Pro effort UI`
(`test/unit/web-ai-chatgpt-model.test.mjs:8-22`)는 이름과 assertion을 current contract로
교체한다. 단순 `modelSrc.toContain('Pro')`만으로 통과시키지 말고 exported table 값과
fake DOM 행동을 함께 검증한다.

## 7. 적용 순서

1. WP2에서 생성한 07 fixture와 02의 type/normalization/evidence 필드를 stale-check한다.
2. current label/effort/simplified tables를 적용한다.
3. exact-line helpers, composer Chat menu root, family submenu 헬퍼를 추가한다.
4. `findModelOption`, checked readback, `isModelMenuOpen`을 current-first로 바꾼다.
5. legacy one-row transition을 current family submenu와 분리한다.
6. fixture(WP2 생성) 기반 GPT-5.6 unit suite와 기존 legacy/Korean tests를 green으로 만든다.

## 8. 검증과 합격 조건

구현 패치의 검증 명령:

```bash
npx vitest run test/unit/web-ai-chatgpt-model.test.mjs
npm run typecheck:checkjs-dom
```

합격 조건:

- fixture(WP2 생성) 기반 focused unit suite 0 failure. checkjs DOM은 기존 전역
  124건 기준선을 늘리지 않고, 이 phase가 건드린 파일의 신규 진단이 0건이어야 한다.
- current menu selection은 모두 composer-scoped role/exact-label/checked 경로를 사용하고
  current fixture에서 legacy testid click은 0회.
- `instant`, thinking canonical 3종과 legacy alias 행렬, flat `pro`, family 5종의 선택과
  readback/warning이 02 계약과 일치.
- `High`/`Extra High`, `Pro`/`Pro Extended`, family/tier checked row가 서로 오인되지 않음.
- 전역 stray/Work menu는 Chat open/option 증거가 아니며, legacy selector fallback은
  toggle 부재와 composer trigger가 지목한 open menu root 안에서만 동작.
- 기존 한국어 문자열은 회귀 통과하되 미실측 번역에 대한 신규 성공 주장을 하지 않음.

## 9. 구현 체크리스트

- [ ] current exact labels가 `CHATGPT_MODEL_OPTIONS`의 선두이고 testid 배열은 보존됨.
- [ ] effort canonical map이 02의 `medium/high/xhigh -> Medium/High/Extra High`와
  일치하고 Pro effort map은 비어 있음.
- [ ] simplified map은 current label 우선, legacy 영어/한국어 alias 후순위임.
- [ ] `openSimplifiedIntelligenceSubmenu`가 GPT-5.5 한 문자열에 고정되지 않음.
- [ ] family trigger는 `role=menuitem[data-has-submenu]`, family option은
  `role=menuitemradio + exact label + aria-checked`를 사용함.
- [ ] `isModelMenuOpen` current 판정이 composer open Intelligence root에 한정됨.
- [ ] `chatGptLegacyMenuRootOpenedByComposer`는 current Chat content root 부재와 composer
  trigger의 `aria-controls`를 함께 확인하며 detector/guard를 정의하거나 호출하지 않음.
- [ ] global GPT-5.5/testid fallback은 제거되고 legacy model-switcher testid는 composer
  form trigger의 `aria-controls`가 지목한 open menu root 안에서만 후순위로 남음.
- [ ] `requiredEffortMenuLabels`가 duplicate canonical labels를 unique 처리함.
- [ ] 라벨 판정이 줄 단위 exact match이며 badge text를 identity와 혼동하지 않음.
- [ ] 한국어 미실측 사실과 legacy 보존 정책이 테스트에 반영됨.
- [ ] 03 완료 조건은 fixture(WP2 생성) 기반 unit green이며, Work 자동화는 04 소유 참조로만 유지됨.
