# 020 — WP3: 이슈 #88 DOM read deadline 방어

선행: WP2(같은 파일군). 후행: WP5.
결함 조사는 `002_pr89_delta_inventory.md` §이슈 #88.

## 설계 전환: 지점별 패치에서 단일 경계로

첫 설계는 정체하는 `page.evaluate` 호출을 하나씩 찾아 감싸는 것이었다. 두 차례
감사에서 매번 누락 지점이 나왔다 — 1라운드에서 `recoverAssistantResponse`,
2라운드에서 `isResponseFinished`와 `doesAssistantFollowUser`. 열거가 두 번
실패했다는 것은 열거가 방법으로 틀렸다는 뜻이다. 앞으로 추가될 evaluate도 같은
구멍을 만든다.

그래서 방어를 **하나의 경계**로 옮긴다: `pollWebAi`가 페이지를 만지는 유일한
통로를 데드라인 인지 래퍼로 감싸고, 그 아래 모든 읽기는 자동으로 예산 안에서
동작한다. 개별 함수는 시그니처를 바꾸지 않는다.

`pollWebAi`가 데드라인 안에서 await하는 evaluate 전수(재조사, `rg -n "page\.evaluate"`):

| 위치 | 함수 | 호출 |
| --- | --- | --- |
| `web-ai/chatgpt.mjs:560` | `doesAssistantFollowUser` | 루프 `:719` |
| `web-ai/chatgpt.mjs:1035` | `readActivityState` | 루프 `:674` |
| `web-ai/chatgpt.mjs:1067` | `isResponseFinished` | 루프 `:709`, recovery `:869` |
| `web-ai/chatgpt.mjs:1438-1439` | `readAssistantSnapshots` | split 실패 fallback |
| `web-ai/chatgpt.mjs:1466` | `readAssistantSnapshotsSplit` | 루프 `:655` |
| `web-ai/chatgpt-response-observer.mjs:81` | `observeAssistantResponse` | `:625` — 이미 `timeoutMs` 예산 있음 |
| `web-ai/chatgpt-response-observer.mjs:103-104` | `recoverAssistantResponse` | 루프 종료 후 `:865` |

`observeAssistantResponse`를 제외한 전부가 무방비다.

### 프록시가 덮지 못하는 것

프록시는 `page.evaluate`만 가로챈다. `locator.evaluate`는 다른 객체의 메서드라
통과하지 못한다. 해당 경로는 하나다:
`readTopLevelAssistantTextsFromLocators`(`web-ai/chatgpt-response-dom.mjs:413-436`,
호출 `web-ai/chatgpt.mjs:1428`).

이 경로는 별도로 다룬다. Playwright의 `locator.evaluate`는 `page.evaluate`와 달리
**timeout 옵션을 받는다** — 이슈 #88이 지적한 비대칭의 반대편이다. 따라서 래핑이
아니라 옵션 전달로 해결한다.

```diff
-                text = await locator.evaluate((node, activeSelector) => {
+                text = await locator.evaluate((node, activeSelector) => {
                     ...
-                }, selector).catch(() => '');
+                }, selector, { timeout: ASSISTANT_READ_CEILING_MS }).catch(() => '');
```

`locator.innerText()`(`:436` 부근)도 같은 옵션을 받으므로 동일하게 상한을 준다.
구현 시 실제 호출 형태를 읽고 맞춘다. 이 fallback은 턴마다 왕복하므로 상한이
없으면 턴 수만큼 곱해진다.

## 구현

### NEW `web-ai/chatgpt-response-dom.mjs` — 파일 끝에 추가

```js
/**
 * 예산 초과 sentinel. `null`/`[]`과 반드시 구별되어야 한다: 빈 읽기는 "아직 답이
 * 없다"이고, 이 값은 "읽지 못했다"이다. 둘을 합치면 정체가 정상 폴링으로 위장된다.
 * @type {unique symbol}
 */
export const ASSISTANT_READ_TIMED_OUT = Symbol('assistant-read-timed-out');

/** 읽기 1회당 상한. 남은 데드라인과 이 값 중 작은 쪽이 예산이다. */
export const ASSISTANT_READ_CEILING_MS = 15_000;

/**
 * @param {number} [remainingMs]
 * @returns {number}
 */
export function resolveAssistantReadBudgetMs(remainingMs) {
    const remaining = Number(remainingMs);
    if (!Number.isFinite(remaining)) return ASSISTANT_READ_CEILING_MS;
    if (remaining <= 0) return 0;
    return Math.min(remaining, ASSISTANT_READ_CEILING_MS);
}

/**
 * 정체된 promise를 예산으로 race한다. 타이머는 항상 정리하고 unref하여 이벤트
 * 루프를 붙잡지 않는다.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} budgetMs
 * @returns {Promise<T | typeof ASSISTANT_READ_TIMED_OUT>}
 */
export async function withAssistantReadTimeout(promise, budgetMs) {
    if (!(budgetMs > 0)) return ASSISTANT_READ_TIMED_OUT;
    /** @type {any} */
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise(resolve => {
                timer = setTimeout(() => resolve(ASSISTANT_READ_TIMED_OUT), budgetMs);
                if (typeof timer?.unref === 'function') timer.unref();
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 데드라인을 인지하는 page 프록시. `evaluate`만 가로채 남은 시간으로 race하고,
 * 나머지 메서드(`url`, `locator`, `waitForTimeout`, `innerText` …)는 그대로
 * 위임한다.
 *
 * 개별 읽기 함수를 하나씩 감싸는 대신 경계를 하나로 두는 이유: 새 evaluate가
 * 추가돼도 자동으로 예산 안에 들어온다. 호출 지점 열거는 두 번 실패했다.
 *
 * 예산이 소진되면 `evaluate`는 reject하지 않고 `ASSISTANT_READ_TIMED_OUT`을
 * resolve한다 — 기존 호출부들이 `.catch(() => ...)`로 실패를 흡수하므로,
 * reject하면 정체가 조용한 기본값으로 삼켜진다.
 *
 * @param {any} page
 * @param {{ getRemainingMs: () => number, onTimeout?: () => void }} options
 * @returns {any}
 */
export function createDeadlineAwarePage(page, { getRemainingMs, onTimeout }) {
    const evaluate = async (/** @type {any[]} */ ...args) => {
        const budgetMs = resolveAssistantReadBudgetMs(getRemainingMs());
        const result = await withAssistantReadTimeout(
            Promise.resolve().then(() => page.evaluate(...args)),
            budgetMs,
        );
        if (result === ASSISTANT_READ_TIMED_OUT) {
            onTimeout?.();
            return ASSISTANT_READ_TIMED_OUT;
        }
        return result;
    };
    return new Proxy(page, {
        get(target, prop, receiver) {
            if (prop === 'evaluate') return evaluate;
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
```

### 호출부가 sentinel을 안전하게 다루도록 보강

프록시가 sentinel을 돌려주면 각 소비자는 그것을 "정상 값"으로 오해하면 안 된다.
아래 세 곳만 명시적으로 처리하면 나머지는 기존 방어 코드가 흡수한다.

**`readAssistantSnapshotsSplit`** (`web-ai/chatgpt.mjs:1461`) — JSDoc 반환 타입에
`timedOut`을 추가하고 sentinel을 실패로 변환한다.

```diff
 /**
  * @param {any} page
- * @returns {Promise<{ ok: boolean, wrapped: ChatGptCorrelatedSnapshot[], wrapperless: ChatGptCorrelatedSnapshot[] }>}
+ * @returns {Promise<{ ok: boolean, wrapped: ChatGptCorrelatedSnapshot[], wrapperless: ChatGptCorrelatedSnapshot[], timedOut?: boolean }>}
  */
 async function readAssistantSnapshotsSplit(page) {
     const failed = { ok: false, wrapped: [], wrapperless: [] };
     try {
         const result = await page.evaluate(readAssistantSnapshotSources, {
             assistantSelectors: ASSISTANT_SELECTORS,
             resolverSource: resolveTopLevelAssistantTurns.toString(),
         });
+        // 예산 초과는 획득 실패와 다르다: legacy fallback으로 내려가면 이미
+        // 정체된 페이지에 두 번째 무한 읽기를 건다 (#88).
+        if (result === ASSISTANT_READ_TIMED_OUT) return { ...failed, timedOut: true };
         if (!result || typeof result !== 'object'
```

**`readAssistantSnapshots`** (`:1436`) — sentinel을 빈 배열로 흡수하되 두 번째
evaluate를 시도하지 않는다.

```diff
     try {
         let snapshots = await page.evaluate(readTopLevelAssistantSnapshots, ASSISTANT_SELECTORS).catch(() => []);
+        if (snapshots === ASSISTANT_READ_TIMED_OUT) return [];
         if (!Array.isArray(snapshots) || snapshots.length === 0) snapshots = await page.evaluate(
             readTopLevelAssistantSnapshots,
             { selectors: ASSISTANT_SELECTORS, resolverSource: resolveTopLevelAssistantTurns.toString() },
         );
+        if (snapshots === ASSISTANT_READ_TIMED_OUT) return [];
```

**`isResponseFinished`** (`:1065`) — sentinel은 "완료 미확인"이다. 기존 코드가
`result === true`를 특수 처리하므로 그 앞에 둔다.

```diff
         }, { ... });
+        // 읽지 못한 것은 "안 끝났다"로 취급한다. 완료로 오독하면 미완성 답변을
+        // 확정하게 된다 (#88).
+        if (result === ASSISTANT_READ_TIMED_OUT) return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
         if (result === true) {
```

**`doesAssistantFollowUser`** (`:558`)와 **`readActivityState`** (`:1027`)는 명시
처리가 필요하다. 아래 activity 절 참조. `doesAssistantFollowUser`는 sentinel이
`result !== false`에 걸려 `true`(순서 정상)를 돌려주는데, 이는 "확인 못 했는데
통과"라서 안전하지 않다.

```diff
     }).catch(() => null);
+    // 읽지 못했으면 순서를 확인하지 못한 것이다. `true`로 흘려보내면 오래된
+    // 과거 답변이 새 답변으로 승인될 수 있다 (#88).
+    if (result === ASSISTANT_READ_TIMED_OUT) return false;
     return result !== false;
```

`false`는 루프에서 `continue`로 이어져 다음 틱에 재확인한다(`:720`) — 정확히
원하는 동작이다.

## activity 상태: `unknown` strength 추가

`readActivityState`의 sentinel 처리는 완료 조건과 얽혀 있어 별도로 다룬다.

현재 루프는 `strength`를 이렇게 읽는다(`web-ai/chatgpt.mjs:679-680`):

```js
const streaming = activity.strength === 'strong';
const weakActive = activity.strength === 'weak';
```

`'none'`을 돌려주면 quiet으로 간주되어 완료 분기로 진입한다. 따라서 읽기 실패를
`'none'`으로 축약하면 정체가 완료로 오독된다. 기존 catch가 `'none'`을 돌려주는
것(`:1049`)은 그 자체로 보수적이지 않지만, 이번 유닛은 timeout 경로만 고친다 —
catch 경로 변경은 별개 위험이라 `040`에 후속으로 남긴다.

### MODIFY `web-ai/chatgpt-response-dom.mjs:136` — 타입 확장

```diff
- * @typedef {'strong'|'weak'|'none'} ChatGptActivityStrength
- * @typedef {{ strength: ChatGptActivityStrength, evidence: string }} ChatGptActivityState
+ * @typedef {'strong'|'weak'|'none'|'unknown'} ChatGptActivityStrength
+ * @typedef {{ strength: ChatGptActivityStrength, evidence: string, timedOut?: boolean }} ChatGptActivityState
```

`isActiveState`(`:258`)는 `strength !== 'none'`이므로 `unknown`을 active로 읽는다 —
`isStreaming` 경로에서 보수적으로 동작하니 그대로 둔다.

### MODIFY `readActivityState` (`web-ai/chatgpt.mjs:1035`)

```diff
         const state = await page.evaluate(readChatGptStreamingState, { ... });
+        // 활동 상태를 못 읽은 것은 "활동 없음"이 아니다. `none`으로 축약하면
+        // 정체가 조용한 완료로 위장된다 (#88).
+        if (state === ASSISTANT_READ_TIMED_OUT) return { strength: 'unknown', evidence: 'read-timeout', timedOut: true };
```

### MODIFY 루프 — `unknown`이면 완료 판정을 건너뛴다

```diff
-        const activity = await readActivityState(page);
+        const activity = await readActivityState(pollPage);
+        if (activity.timedOut) {
+            domReadTimeouts += 1;
+            // 활동 여부를 모르면 완료·순서 판정을 할 수 없다. 안정성 창도 이
+            // 구간을 통과해 누적되면 안 되므로 리셋하고 다음 틱에서 다시 본다.
+            stableSince = 0;
+            stableText = '';
+            emitStallHeartbeat();
+            if (Date.now() > deadline) break;
+            await pollPage.waitForTimeout(500).catch(() => undefined);
+            continue;
+        }
```

`stableSince`/`stableText` 리셋은 리뷰어 지적(안정성 시간이 unknown 구간을 통과해
누적되는 문제)에 대한 대응이다. 정체 구간을 "조용했다"로 세지 않는다.

## `countAssistantMessages` — baseline 오염 방지

이 함수는 send 직전 baseline(`web-ai/chatgpt.mjs:328`)과 deep research
baseline(`:1151`)에 쓰인다. 정체를 `0`으로 저장하면 과거 답변 전체가 새 답변
후보가 된다.

```diff
 /**
  * @param {any} page
- * @returns {Promise<number>}
+ * @returns {Promise<{ count: number, timedOut: boolean }>}
  */
 async function countAssistantMessages(page) {
     const split = await readAssistantSnapshotsSplit(page);
-    if (split.ok) return split.wrapped.length;
-    return (await readAssistantMessages(page)).length;
+    if (split.ok) return { count: split.wrapped.length, timedOut: false };
+    // 예산 초과는 fallback 대상이 아니고, 0으로 축약해서도 안 된다: baseline이
+    // 0이 되면 과거 답변이 전부 새 답변 후보가 된다 (#88).
+    if (split.timedOut) return { count: 0, timedOut: true };
+    return { count: (await readAssistantMessages(page)).length, timedOut: false };
 }
```

### 소스-텍스트 어서션 갱신 (필수)

`test/unit/web-ai-wrapperless-correlation.test.mjs:119-137`은 이 함수의 **소스
문자열**을 검사한다.

```js
expect(counterBody).toContain('if (split.ok) return split.wrapped.length;');
```

반환 계약을 바꾸면 이 어서션이 깨진다. 테스트가 지키려는 불변식은 "legacy
fallback은 성공한 빈 읽기가 아니라 실패한 획득에서만 동작한다"이며, 그 불변식은
유지된다 — 표현만 바뀐다. 어서션을 새 표현에 맞춰 갱신하되 의도 주석은 보존한다.

```diff
-        expect(counterBody).toContain('if (split.ok) return split.wrapped.length;');
+        expect(counterBody).toContain('if (split.ok) return { count: split.wrapped.length, timedOut: false };');
+        // 예산 초과도 fallback으로 내려가면 안 된다 (#88).
+        expect(counterBody).toContain('if (split.timedOut) return { count: 0, timedOut: true };');
         expect(counterBody).not.toMatch(/if \(split\.wrapped\.length\)/);
```

같은 파일의 `expect(src).toContain('const wrapped = split.ok')`(`:136`)도 루프 본문
변경 후 여전히 성립하는지 확인한다.

호출부 세 곳을 맞춘다.

```diff
     await waitForStableAssistantCount(page);
-    const assistantCount = await countAssistantMessages(page);
+    const counted = await countAssistantMessages(page);
+    if (counted.timedOut) throw new WebAiError({
+        errorCode: 'provider.poll-timeout',
+        stage: 'send',
+        vendor: 'chatgpt',
+        retryHint: 'poll-or-resume',
+        message: 'could not read the assistant baseline before sending; the page is not responding to DOM reads',
+    });
+    const assistantCount = counted.count;
```

`deepResearchWebAi`(`:1151`)도 같은 형태로 고친다. `WebAiError`의 정확한 필드는
구현 시 이 파일의 다른 throw를 읽고 맞춘다.

`waitForStableAssistantCount`(`:1408`)는 timeout을 안정 카운트로 세면 안 된다.

```diff
     while (Date.now() < deadline) {
-        const count = await countAssistantMessages(page).catch(() => 0);
+        const counted = await countAssistantMessages(page).catch(() => ({ count: 0, timedOut: false }));
+        // 정체는 "안정"이 아니다. 두 번 연속 timeout을 stable count 0으로 읽으면
+        // baseline이 0으로 굳는다.
+        if (counted.timedOut) {
+            previous = -1;
+            stableReads = 0;
+            await page.waitForTimeout(500).catch(() => undefined);
+            continue;
+        }
+        const count = counted.count;
```

## recovery 경로

recovery는 루프 밖에서 실행되므로 자체 예산이 필요하다. `pollWebAi`가 프록시를
만들어 넘기면 별도 파라미터가 필요 없다.

```diff
     if (session) {
+        // 폴링 중 읽기가 정체했다면 구조 읽기를 짧게 잡는다. 구조가 명령을 또
+        // 한 번의 상한만큼 늘리면 안 된다 (#88). 정체가 없었다면 통상 예산.
+        const recoveryBudgetMs = domReadTimeouts > 0 ? 2_000 : ASSISTANT_READ_CEILING_MS;
+        const recoveryDeadline = Date.now() + recoveryBudgetMs;
+        const recoveryPage = createDeadlineAwarePage(page, {
+            getRemainingMs: () => recoveryDeadline - Date.now(),
+        });
-        const recovered = await recoverAssistantResponse(page, {
+        const recovered = await recoverAssistantResponse(recoveryPage, {
             baselineAssistantCount: baseline.assistantCount,
             isFinalAnswer,
-            readStreaming: () => isStreaming(page),
+            readStreaming: () => isStreaming(recoveryPage),
             readFinished: async sample => {
-                const completion = await isResponseFinished(page, sample, baseline.assistantCount);
+                const completion = await isResponseFinished(recoveryPage, sample, baseline.assistantCount);
                 return completion.finished === true;
             },
         });
```

`getRemainingMs`가 절대 데드라인 기준이므로, recovery 안의 2단 evaluate가 예산을
각각 다시 쓰는 문제(리뷰어 B4)가 구조적으로 사라진다. 두 번째 읽기는 첫 읽기가
쓰고 남은 시간만 받는다. `chatgpt-response-observer.mjs`는 수정하지 않는다 —
프록시가 그 파일의 evaluate까지 덮는다.

## 폴링 루프 배선

```diff
     const deadline = Date.now() + timeout * 1000;
     const startedAt = Date.now();
+    // 예산을 넘긴 DOM 읽기 횟수. "provider가 아직 스트리밍 중"과 "우리가 DOM을
+    // 못 읽었다"는 운영 대응이 다르다 (#88).
+    let domReadTimeouts = 0;
+    // 루프 안의 모든 페이지 접근은 이 프록시를 통한다. 개별 읽기 함수를 감싸는
+    // 대신 경계를 하나로 둔다 — 호출 지점 열거는 신뢰할 수 없다.
+    const pollPage = createDeadlineAwarePage(page, {
+        getRemainingMs: () => deadline - Date.now(),
+        onTimeout: () => { domReadTimeouts += 1; },
+    });
```

루프 본문에서 `page`를 쓰던 자리를 `pollPage`로 바꾼다. `page.url()`처럼
evaluate가 아닌 호출도 프록시가 그대로 위임하므로 안전하다. 정확한 치환 지점은
구현 시 루프 범위(`:628`–`:860`)를 훑어 확정한다.

정체 하트비트는 헬퍼로 뽑는다.

```js
const emitStallHeartbeat = () => {
    const stalledAt = Date.now();
    if (stalledAt - lastHeartbeat < 30_000) return;
    const elapsed = Math.round((stalledAt - startedAt) / 1000);
    // 정체 중에도 liveness를 낸다. 프로세스는 살아 있는데 출력이 멎는 것이
    // 원래 증상이었다 (#88).
    process.stderr.write(`[poll] ${elapsed}s — assistant DOM read timed out (${domReadTimeouts}x); retrying...\n`);
    lastHeartbeat = stalledAt;
};
```

split 결과 처리:

```diff
-        const split = await readAssistantSnapshotsSplit(page);
+        const split = await readAssistantSnapshotsSplit(pollPage);
+        if (split.timedOut) {
+            emitStallHeartbeat();
+            stableSince = 0;
+            stableText = '';
+            if (Date.now() > deadline) break;
+            await pollPage.waitForTimeout(500).catch(() => undefined);
+            continue;
+        }
```

## warning 전파

`domReadTimeouts > 0`이면 **모든** 반환 경로에 warning을 얹는다. 타임아웃뿐 아니라
성공 완료도 포함한다 — 정체를 겪고 회복한 명령은 그 사실을 알려야 한다.

- 성공 완료: `web-ai/chatgpt.mjs:729-730`의 `const warnings = []` 초기화에 반영
- copy-markdown fallback 타임아웃: `:996`의 warnings 배열에 추가
- 최종 타임아웃: `:1014`의 `warnings: []`를 교체

```js
const stallWarnings = domReadTimeouts > 0 ? [`assistant-dom-read-timeout:${domReadTimeouts}`] : [];
```

각 지점에서 `[...stallWarnings, ...기존]` 형태로 합친다.

## 테스트

NEW `test/unit/web-ai-assistant-read-deadline.test.mjs`.

page double은 `test/unit/web-ai-chatgpt-activity-poll.test.mjs:14-69`의 하네스를
본뜬다. 가상 시계(`waitForTimeout`이 offset 전진) + `createSession`으로
세션/baseline/`getTargetId`/URL/locator를 모두 갖춘다. 정체는 해당 evaluate가
`new Promise(() => {})`를 돌려주게 해서 만든다.

| # | 시나리오 | 기대 |
| --- | --- | --- |
| 1 | `withAssistantReadTimeout`에 영구 pending promise | 예산 후 `ASSISTANT_READ_TIMED_OUT` |
| 2 | `resolveAssistantReadBudgetMs` 경계값 | undefined→ceiling, 0/음수→0, 초과→ceiling, 미만→그 값 |
| 3 | `createDeadlineAwarePage`가 evaluate만 가로챈다 | `url()`/`locator()`는 원본 위임, evaluate만 race |
| 4 | **모든 evaluate 정체** — 짧은 timeout으로 `pollWebAi` | 명령이 반환, `status: 'timeout'`, warnings에 `assistant-dom-read-timeout:` |
| 5 | snapshot 성공, activity만 정체 | 데드라인 안 반환, `status !== 'complete'` |
| 6 | snapshot·activity 성공, `isResponseFinished`만 정체 | 완료로 오판하지 않음(`status !== 'complete'`) |
| 7 | `doesAssistantFollowUser`만 정체 | 완료로 오판하지 않음 |
| 8 | 처음 두 틱 정체 후 정상 | 정상 완료 + warnings에 정체 흔적 |
| 9 | `countAssistantMessages` 정체 시 send | baseline 0으로 저장되지 않고 오류로 실패 |
| 10 | `waitForStableAssistantCount` 연속 정체 | stable count 0으로 확정하지 않음 |

테스트 4는 수정 전 반환되지 않아 vitest 타임아웃으로 실패한다(red). 이 테스트가
recovery 방어까지 함께 증명한다 — recovery가 무방비면 여기서 멈춘다.

## 활성화 관측 (C-ACTIVATION-GROUNDING-01)

| 새 분기 | 트리거 | 관측 |
| --- | --- | --- |
| 프록시 evaluate timeout | 테스트 4 | `onTimeout` 카운터 증가 → warning 문자열 |
| split timedOut → continue | 테스트 4 | `assistant-dom-read-timeout:<n>` |
| activity `unknown` → 완료 판정 스킵 | 테스트 5 | `status !== 'complete'` |
| `isResponseFinished` sentinel → finished:false | 테스트 6 | 완료 미발생 |
| `doesAssistantFollowUser` sentinel → false | 테스트 7 | 완료 미발생 |
| baseline count timedOut → 오류 | 테스트 9 | throw + baseline 미저장 |
| stable count timedOut → 카운터 리셋 | 테스트 10 | count 0 확정 안 함 |
| recovery 짧은 예산 | 테스트 4 | 명령 반환(무한 정체 부재) |
| 정체 후 회복 | 테스트 8 | 정상 답변 + warning 공존 |

"스위트 green"은 근거가 아니다. 위 어서션이 각 분기의 발화 증거다.

## 범위 경계

- IN: `web-ai/chatgpt-response-dom.mjs`(헬퍼·프록시·타입), `web-ai/chatgpt.mjs`
  (프록시 배선, sentinel 처리, count 계약, warning 전파), 새 테스트,
  `structure/str_func.md`.
- OUT: `web-ai/chatgpt-response-observer.mjs` 수정(프록시가 덮는다),
  `readActivityState`의 기존 catch 경로가 `'none'`을 돌려주는 문제(별개 위험,
  `040`에 후속으로 기록), `page.evaluate` 전역 정책 변경.
