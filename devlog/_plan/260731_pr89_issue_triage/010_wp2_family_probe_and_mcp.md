# 010 — WP2: 이슈 #87 잔여 갭 구현

선행: WP1. 후행: WP3(같은 파일군).
판정 근거는 `002_pr89_delta_inventory.md`. 이 문서는 구현 diff만 담는다.

대상은 두 갭이다. 갭 A는 capability probe가 family를 읽지 않는 것, 갭 B는 MCP가
스키마상 유효한 family를 비-ChatGPT provider로 보낼 때 막지 않는 것이다.

## 갭 A — `chatGptModelCapabilityProbe`에 family 계약 추가

`web-ai/chatgpt-model.mjs:1725`의 probe는 `options.family`를 참조하지 않는다.
호출부만 고치면 값이 버려지므로 probe 본문을 먼저 고친다.

### 재사용할 실제 헬퍼

자리표시자를 쓰지 않는다. `web-ai/chatgpt-model.mjs`에 이미 있는 심볼이다.

| 심볼 | 위치 | 용도 | mutation |
| --- | --- | --- | --- |
| `openSimplifiedIntelligenceSubmenu(page, { forceFamily: true })` | `:891` | family 서브메뉴 열기 | hover/키/클릭 — 메뉴만 조작 |
| `findOpenFamilySubmenu(page, familyLabels)` | `:986` | 열린 서브메뉴 locator 반환 | 없음 |
| `readVisibleChatGptFamilyEvidence(page)` | `:1007` | 현재 선택된 family 증거 읽기 | 없음 |
| `CHATGPT_FAMILY_OPTIONS` | `:244` | alias→라벨 맵 | — |
| `menuTextHasExactLine(text, label)` | 같은 파일 | 라벨 정확 일치 | 없음 |
| `selectChatGptFamily(page, family)` | `:950` | **선택을 실제로 바꾼다 — probe에서 쓰지 않는다** | 있음 |

probe는 선택을 바꾸면 안 되므로 `selectChatGptFamily`를 부르지 않고, 서브메뉴를 연
뒤 요청 라벨의 `[role="menuitemradio"]` 행이 존재하는지만 확인한다.

### NEW `web-ai/chatgpt-model.mjs` — probe 전용 헬퍼

```js
/**
 * 요청한 family가 현재 UI에서 선택 가능한지 확인한다. 선택은 바꾸지 않는다:
 * probe가 `ok`를 돌려주면 호출자는 그것을 "이 family를 강제할 수 있다"는 증거로
 * 읽으므로, 확인 자체가 상태를 바꾸면 안 된다 (#87).
 * @param {Page} page
 * @param {FamilyChoice} family
 * @returns {Promise<boolean>}
 */
async function isChatGptFamilyOptionAvailable(page, family) {
    const expected = CHATGPT_FAMILY_OPTIONS[family]?.label;
    if (!expected) return false;
    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
    await openSimplifiedIntelligenceSubmenu(page, { forceFamily: true }).catch(() => undefined);
    const submenu = await findOpenFamilySubmenu(page, familyLabels);
    if (!submenu) return false;
    const rows = await submenu.locator('[role="menuitemradio"]').all().catch(() => []);
    for (const row of rows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (menuTextHasExactLine(text, expected)) return true;
    }
    return false;
}
```

### MODIFY `web-ai/chatgpt-model.mjs:1706-1710` — typedef

실제 형태는 `@typedef {Object}` + `@property` 목록이다.

```diff
 /**
  * @typedef {Object} CapabilityProbeOptions
+ * @property {string} [family]
  * @property {string} [effort]
  * @property {string} [reasoningEffort]
  */
```

### MODIFY `chatGptModelCapabilityProbe` (`:1725`)

family 검증은 effort 검증 **뒤에** 온다. 먼저 반환하면 family+effort 조합에서
effort 검증이 건너뛰어진다.

```diff
 export async function chatGptModelCapabilityProbe(page, model, options = {}) {
     const requested = normalizeChatGptModelChoice(model);
     const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
-    if (!model && !(options.effort || options.reasoningEffort)) return { state: 'unknown', evidence: { requested: null, effort: null }, next: 'send' };
-    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
-    if ((options.effort || options.reasoningEffort) && !requestedEffort) return { state: 'fail', evidence: { requested, effort: options.effort || options.reasoningEffort }, next: 'model-fallback' };
-    if (requestedEffort && !isChatGptEffortSupported(requested, requestedEffort)) return { state: 'fail', evidence: { requested, effort: requestedEffort }, next: 'model-fallback' };
+    const requestedFamily = normalizeChatGptFamilyChoice(options.family);
+    // 미지원 alias는 메뉴를 열기 전에 fail한다. probe가 `ok`를 돌려주면 호출자는
+    // 그것을 "요청한 family를 강제할 수 있다"는 증거로 읽는다 (#87).
+    if (options.family && !requestedFamily) {
+        return { state: 'fail', evidence: { requested: requested || null, effort: null, family: options.family }, next: 'model-fallback' };
+    }
+    if (!model && !(options.effort || options.reasoningEffort) && !options.family) {
+        return { state: 'unknown', evidence: { requested: null, effort: null, family: null }, next: 'send' };
+    }
+    // model 없이 family만/family+effort로 요청할 수 있다. 이 경우 model 검증을
+    // 건너뛰되 effort 검증은 그대로 수행한다.
+    if (!requested && !requestedFamily) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
+    if ((options.effort || options.reasoningEffort) && !requestedEffort) return { state: 'fail', evidence: { requested: requested || null, effort: options.effort || options.reasoningEffort, family: requestedFamily || null }, next: 'model-fallback' };
+    // effort 지원 여부는 model 축에 걸린다. model이 없으면 현재 tier 기준이므로
+    // 여기서 판단하지 않는다 (CLI가 `rejectFutureScope`에서 이미 거른다).
+    if (requested && requestedEffort && !isChatGptEffortSupported(requested, requestedEffort)) {
+        return { state: 'fail', evidence: { requested, effort: requestedEffort, family: requestedFamily || null }, next: 'model-fallback' };
+    }
```

메뉴를 연 뒤 model/effort/family 세 축을 각각 확인한다.

```diff
-    const option = await findModelOption(page, requested).catch(() => null);
+    const option = requested ? await findModelOption(page, requested).catch(() => null) : null;
+    // family 서브메뉴 가용성은 model 옵션 존재와 독립이다. 세 축을 모두 확인해야
+    // `ok`가 "요청 전체를 강제할 수 있다"를 뜻한다.
+    let familyAvailable = true;
+    if (requestedFamily) {
+        familyAvailable = await isChatGptFamilyOptionAvailable(page, requestedFamily).catch(() => false);
+    }
     /** @type {Locator | null} */
     let effortOption = null;
     if (option && requestedEffort) {
+        // family 확인이 서브메뉴를 열었을 수 있으므로 effort 메뉴는 여기서 다시
+        // 연다. `openEffortMenu`가 필요한 상태를 스스로 만든다.
         try {
             await openEffortMenu(page, requested, requestedEffort, usedFallbacks);
```

```diff
-    const selectable = Boolean(option) && (!requestedEffort || Boolean(effortOption));
-    const state = selectable ? (menuClosed ? 'ok' : 'warn') : 'fail';
-    return { state, evidence: { requested, effort: requestedEffort || null, menuClosed, usedFallbacks }, next: state === 'ok' ? 'send' : 'model-fallback' };
+    const selectable = (requested ? Boolean(option) : true)
+        && (!requestedEffort || !requested || Boolean(effortOption))
+        && familyAvailable;
+    // model 없이 effort를 요청하면 effort는 "현재 tier" 기준이 된다. probe는
+    // family를 실제로 선택하지 않으므로 선택 후 tier와 effort의 조합을 증명할 수
+    // 없다. 증명하지 못한 것을 `ok`로 승인하면 #87이 고치려던 바로 그 착시가
+    // 다시 생긴다 — `warn`으로 낮춘다.
+    const unprovenEffortTier = Boolean(requestedEffort) && !requested;
+    const state = selectable
+        ? (menuClosed && !unprovenEffortTier ? 'ok' : 'warn')
+        : 'fail';
+    return {
+        state,
+        evidence: {
+            requested: requested || null,
+            effort: requestedEffort || null,
+            family: requestedFamily || null,
+            menuClosed,
+            ...(unprovenEffortTier ? { effortTierUnproven: true } : {}),
+            usedFallbacks,
+        },
+        next: state === 'ok' ? 'send' : 'model-fallback',
+    };
```

계약 정리:

| 입력 | state | 근거 |
| --- | --- | --- |
| model만 | 기존과 동일 | — |
| model + effort | 기존과 동일 | — |
| family만 | 서브메뉴 있으면 `ok` | family 축만 확인하면 충분 |
| family + effort, model 없음 | 최대 `warn` | effort는 현재 tier 기준인데 probe가 tier를 확정하지 못한다. Pro처럼 effort 컨트롤이 없는 tier도 있다(`web-ai/chatgpt-model.mjs:492-496`) |
| effort만, model 없음 | 최대 `warn` | 같은 이유 |
| model + family (+effort) | 세 축 모두 확인 | — |
| 미지원 family alias | `fail` | 메뉴 열기 전 |

`warn`은 이 probe에서 이미 쓰이는 상태값이며(`CapabilityProbeResult.state`가
`'ok'|'warn'|'fail'|'unknown'`, `web-ai/chatgpt-model.mjs:1712-1717`) "선택은 될
것 같지만 확정하지 못했다"를 뜻한다. 여기 의미와 정확히 맞는다.

기존 probe와 같이 `closeModelMenu`로 원복한다.

### MODIFY `web-ai/chatgpt.mjs:120` — capability 정의

```diff
-    defineCapability('chatgpt-model-alias-selectable', async (/** @type {any} */ deps, /** @type {any} */ input) => chatGptModelCapabilityProbe(await deps.getPage(), input.model, { effort: input.reasoningEffort })),
+    defineCapability('chatgpt-model-alias-selectable', async (/** @type {any} */ deps, /** @type {any} */ input) => chatGptModelCapabilityProbe(await deps.getPage(), input.model, {
+        family: input.family,
+        effort: input.reasoningEffort,
+    })),
```

## 갭 B — MCP에서 비-ChatGPT + family 조합 fail-closed

스키마 enum(`web-ai/tool-schema.mjs:55`)이 `validateWebAiToolInput`
(`web-ai/mcp-server.mjs:153`)에서 잘못된 alias를 이미 거부한다. handler에 도달하는
것은 **스키마상 유효한 family**뿐이므로, 막아야 할 조합은 하나다: 유효한 family를
Chat family 축이 없는 provider로 보내는 것.

### MODIFY `web-ai/mcp-server.mjs` — `web_ai_submit_prompt` 분기

기존 early-return(`:194-201`)의 `{ ok, code, tool, reason, retryHint }` 형태를 따른다.

```diff
     if (name === 'web_ai_submit_prompt') {
         const provider = providerFromArgs(args);
         if (args.surface === 'work') {
             return {
                 ok: false,
                 code: 'capability.unsupported',
                 tool: name,
                 reason: 'Chat submit does not support Work surface; use web_ai_work_send.',
                 retryHint: 'use-work-send',
             };
         }
+        // family는 ChatGPT 전용 축이다. 스키마는 alias 유효성만 보므로, 여기서
+        // 막지 않으면 Gemini/Grok으로 보낸 family가 조용히 무시된다 — CLI가
+        // `rejectFutureScope`로 거부하는 조합이다 (#87).
+        if (args.family && provider !== 'chatgpt') {
+            return {
+                ok: false,
+                code: 'capability.unsupported',
+                tool: name,
+                reason: `family selection is supported only for ChatGPT; ${provider} has no Chat family axis`,
+                retryHint: 'omit-family-or-use-chatgpt',
+            };
+        }
```

`sendByProvider` 호출부는 이미 `...args`로 family를 운반한다(`:214-220`). 명시
전달을 추가하지 않는다 — 동작이 같고 의도만 흐려진다.

## 테스트

NEW `test/unit/web-ai-family-probe-and-mcp.test.mjs`:

1. **probe가 미지원 family에 fail** — `chatGptModelCapabilityProbe(page, 'thinking',
   { family: 'gpt-5.6-luna' })`가 `state: 'fail'`이고 evidence에 family가 담긴다.
   페이지 메뉴는 열리지 않는다(스텁의 호출 카운트로 확인).
2. **probe가 family 미가용 시 fail** — model 옵션은 찾지만 family 서브메뉴가 없는
   page double에서 `state: 'fail'`.
3. **probe가 family 가용 시 ok** — model과 family를 둘 다 찾으면 `state: 'ok'`이고
   `evidence.family === 'gpt-5.6-sol'`.
3a. **model 없는 family+effort는 warn** — `{ family: 'gpt-5.6-sol', effort: 'high' }`
   에 model 없이 호출하면 `state: 'warn'`이고 `evidence.effortTierUnproven === true`.
   `ok`가 아니어야 한다 — 증명하지 못한 조합을 승인하지 않는다.
4. **MCP가 gemini + family를 거부** — `callMcpTool`은 export되지 않으므로
   (`web-ai/mcp-server.mjs:134`) 공개 경계인 `handleMcpMessage`(`:387`)로 JSON-RPC
   `tools/call`을 보낸다.

   ```js
   const response = await handleMcpMessage({
       jsonrpc: '2.0', id: 1, method: 'tools/call',
       params: { name: 'web_ai_submit_prompt', arguments: { provider: 'gemini', family: 'gpt-5.6-sol', prompt: 'x' } },
   }, deps);
   ```

   `jsonResult`(`web-ai/mcp-server.mjs:64-69`)가 payload를 `structuredContent`에
   담고 `jsonResponse`가 `result`로 감싸므로(`:403`), 어서션은 다음과 같다.

   ```js
   expect(response.result.structuredContent.code).toBe('capability.unsupported');
   expect(getPageCalls).toBe(0);   // 브라우저 mutation 0
   ```
5. **MCP 스키마가 미지원 alias를 handler 전에 거부** — 같은 경로로
   `family: 'gpt-5.6-luna'`를 보내면 `validateWebAiToolInput`
   (`web-ai/tool-schema.mjs:200-205`) 단계에서 거부된다. 기존 동작 확인이며
   회귀 가드다.

테스트 5는 수정 전에도 통과한다. 회귀 가드로 명시하고 새 동작의 증거로 쓰지 않는다.

실행만 하는 기존 스위트: `test/unit/web-ai-chatgpt-model.test.mjs`,
`test/unit/web-ai-tool-schema.test.mjs`, `test/integration/web-ai-cli-contract.test.mjs`.

## 활성화 관측 (C-ACTIVATION-GROUNDING-01)

| 새 분기 | 트리거 | 관측 |
| --- | --- | --- |
| probe 미지원 family fail | 테스트 1 | `state:'fail'` + `evidence.family` + 메뉴 미개방 |
| probe family 미가용 fail | 테스트 2 | `state:'fail'` |
| probe family 가용 ok | 테스트 3 | `state:'ok'` + `evidence.family` |
| probe 미증명 effort tier → warn | 테스트 3a | `state:'warn'` + `evidence.effortTierUnproven` |
| MCP 비-ChatGPT + family | 테스트 4 | `result.structuredContent.code === 'capability.unsupported'` + `getPage` 0회 |

"스위트 green"은 근거가 아니다. 위 어서션이 각 분기의 발화 증거다.

## 범위 경계

- IN: `web-ai/chatgpt-model.mjs`(probe), `web-ai/chatgpt.mjs:120`,
  `web-ai/mcp-server.mjs`(submit_prompt 분기), 새 테스트, `structure/str_func.md`.
- OUT: `selectChatGptModel` 본문(이미 family를 처리한다), family alias 목록,
  CLI 파서, `web_ai_work_send` 경로.
