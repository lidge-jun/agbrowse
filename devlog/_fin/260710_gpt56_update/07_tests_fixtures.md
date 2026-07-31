# 07: GPT-5.6 공유 DOM fixture와 최종 회귀 매트릭스

기준일: 2026-07-10. 이 문서는 `00_index.md`가 정한 07 슬라이스만 소유한다.
즉, Part 1에서 2026-07-10 실측과 공식 Power 매핑을 sanitized fixture로 먼저 고정하고,
Part 2에서 02~06이 각각 소유한 테스트가 어떤 최종 시나리오를 닫는지 교차 검증한다. 모델
선택, Work send, timeout, MCP 동작 테스트 자체는 이 문서로 이동시키지 않는다
(`00_index.md:32-45`).

## Part 1: fixture 정의(WP2 선행)

### 0. Loop spec와 범위

- **Loop archetype**: 유한 contract-integration / regression-hardening.
- **Trigger**: 현재 inline fake가 2026-07-10 실측과 다른 `Pro Standard` /
  `Pro Extended` 행을 5.6 메뉴처럼 모델링하고, offline eval에는 5.6 DOM 입력이 없다
  (`test/unit/web-ai-chatgpt-model.test.mjs:51-108,725-857`).
- **Goal**: Chat 5.6 선택과 Work send가 동일한 sanitized DOM 계약을 소비하고,
  02~06 최종 테스트가 필수 시나리오를 중복 없이 닫게 한다.
- **Non-goals**: production selector/alias/schema/timeout/capability 구현, fixture에서의
  provider mutation, 한국어 5.6 라벨 창작.
- **Verifier**: fixture safety + offline eval + 02~06 focused suite + checkjs DOM.
- **Stop condition**: 두 fixture가 scrub/network gate를 통과하고, Chat fixture 기반 5.6
  선택, Work fixture 기반 Power/send, legacy fallback, timeout 3-tier 상속, MCP submit
  회귀가 모두 matrix의 primary owner 테스트에서 통과한다.
- **Memory artifact**: 이 문서와 `test/fixtures/provider-dom/chatgpt-gpt56-*`.
- **Expected terminal outcomes**: `PASS`; 또는 실측 부족을 명시한 `DEFERRED`(한국어,
  제출 후 progress/approval/stop/final DOM). 추정 구현을 뜻하는 partial-pass는 없다.
- **Escalation condition**: fixture 적용 중 live DOM이 `01`의 role/testid/label과 다르거나,
  Chat/Work picker가 동시에 mount된 증거가 나오면 fixture를 억지로 일반화하지 않고
  01 재프로브로 되돌린다 (`01_ui_contract_evidence.md:117-129`).

#### 0.1 IN / OUT

**IN**

- `test/fixtures/provider-dom/` 아래 Chat/Work 분리 sanitized HTML 두 개.
- fixture annotation을 읽는 test-only contract loader와 fixture 무결성 테스트.
- 기존 offline eval config 경로를 통한 5.6 fixture 등록 및 필요한 최소 runner 확장.
- 02~06 소유 테스트와 최종 시나리오의 회귀 매트릭스.

**OUT**

- `web-ai/chatgpt-model.mjs`, `web-ai/product-surfaces.mjs`, timeout/runtime 소스 수정.
- 02~06 테스트의 assertion 구현을 07로 재소유하는 일.
- 로그인 live E2E, provider에 대한 mutation, fixture에서 얻지 못한 상태 전이 추정.
- `web-ai/eval-adapters/webvoyager.mjs` 변경. 이 파일은 외부 JSONL을 dry-run trajectory로
  번역하는 어댑터이고 provider DOM fixture registry가 아니다
  (`web-ai/eval-adapters/webvoyager.mjs:1-19,66-82`).

### 1. 근거와 현재 불일치

#### 1.1 2026-07-10 실측에서 고정할 계약

Chat fixture는 다음을 그대로 보존한다.

1. 헤더 Chat/Work는 exact accessible name을 가진 `role=radio`이며 Chat이 `on`,
   Work가 `off`다 (`01_ui_contract_evidence.md:7-16`).
2. composer trigger는 form 안의 `button[aria-haspopup="menu"]`이고 항목별
   `model-switcher-*` testid는 없다 (`01_ui_contract_evidence.md:18-25,38-42`).
3. open menu 아래 `composer-intelligence-picker-content` group과 `Instant`, `Medium`,
   `High`, `Extra High`, `Pro`의 flat `menuitemradio`가 있다. `Instant`만 `5.5`
   badge를 가진다 (`01_ui_contract_evidence.md:24-36,58-62`).
4. family trigger는 `GPT-5.6 Sol`이며 submenu는 Sol/5.5/5.4/5.3/o3와 5.4의
   `Leaving on July 23` badge를 가진다 (`01_ui_contract_evidence.md:45-55`).
5. `Thinking`, `Pro Standard`, `Pro Extended`, 개별 model-switcher testid는 **부재**가
   계약이다 (`01_ui_contract_evidence.md:38-43`).
6. surface toggle이 있으면 Chat active는 진행, Work active는
   `provider-surface-preflight`/`switch-to-chat`로 mutation 전 실패, `aria-checked`와
   `data-state`가 모순되면 `ambiguous`로 fail-closed한다. toggle 자체가 없을 때만
   legacy selector 경로와 warning으로 진행한다 (`02_core_contract_decisions.md:895-1013`).

Work fixture는 다음을 그대로 보존한다.

1. Work radio만 `on`, 별도 composer placeholder는 `Work on anything`, pill은
   `5.6 Sol Light`다 (`01_ui_contract_evidence.md:64-68`).
2. Chat과 같은 `composer-intelligence-picker-content`를 쓰지만 내부에 simple/advanced
   view testid가 있다. 공식 Power 매핑은 `1=Terra Light`, `2=Sol Light`,
   `3=Sol Medium`(기본), `4=Sol High`, `5=Sol xHigh`, `6=Sol Ultra`이며 WP1에서
   라이브 UI와 1회 왕복 검증한다 (`.codexclaw/evidence/260710_work_external_research.md:11-15`).
3. Advanced row의 accessible name은 label+current value이며 Model/Effort/Speed 현재값은
   `GPT-5.6 Sol`/`Light`/`Standard`다 (`01_ui_contract_evidence.md:80-91`).
4. submenu 목록은 순차 프로브 결과이므로 active picker와 동시에 열린 노드처럼
   위조하지 않는다. inert `<template data-eval-state>`에 각 관측 상태를 분리한다.
5. fixture는 picker 계약만 소유하므로 `send.click`/`copy.click` eval intent를 붙이지 않는다.
   이는 Work send 미지원 뜻이 아니며, 제출·poll 셀렉터는 WP1 라이브 재프로브 증거를
   소비하는 04의 CLI/MCP 자동화와 라이브 스모크가 소유한다.

#### 1.2 현재 inline fake가 틀린 지점

`test/unit/web-ai-chatgpt-model.test.mjs`의 fake는 두 역할을 섞고 있다.

- `thinkingEffortTexts()`와 `proEffortTexts()`는 legacy 5.5 메뉴 데이터를 소유한다
  (`test/unit/web-ai-chatgpt-model.test.mjs:725-755`). 이것은 legacy fallback용으로
  남아야 한다.
- `createFakeModelPage()`의 `simplifiedRows`는 새 메뉴처럼 보이지만 `Pro Standard`와
  `Pro Extended`를 생성한다 (`test/unit/web-ai-chatgpt-model.test.mjs:766-857`). 이는
  2026-07-10 5.6 실측과 정면으로 충돌한다.
- fake의 open-menu 판정은 실제 group/testid/surface 구조가 아니라 합성 문자열
  `Intelligence\n...\nGPT-5.5`만 반환한다
  (`test/unit/web-ai-chatgpt-model.test.mjs:963-990`). 따라서 Chat/Work가 같은 picker
  testid를 공유하는 위험을 재현하지 못한다.

결론은 fake 전체 삭제가 아니다. **정적 DOM 계약은 fixture 하나에서 읽고, click 후
checked 상태 전이만 fake state machine이 담당**한다. 실제 production module이 test
fixture를 import하거나 test-only attribute를 selector로 쓰는 것은 금지한다.

#### 1.3 기존 provider-dom / eval 관례

- 파일명은 `<provider>-<variant>.html`이다. 예: `chatgpt-baseline.html`,
  `chatgpt-structural-churn.html` (`web-ai/eval/fixtures.mjs:76-103`). 따라서 신규 이름은
  `chatgpt-gpt56-chat.html`, `chatgpt-gpt56-work.html`로 고정한다.
- fixture는 실제 role/aria 구조와 test-only `data-eval-*` intent/ref를 함께 둔다
  (`test/fixtures/provider-dom/chatgpt-baseline.html:3-10`,
  `test/fixtures/provider-dom/chatgpt-structural-churn.html:5-16`). 신규 annotation도
  `data-eval-*` namespace만 사용한다.
- default discovery variant는 모든 vendor에 공통인 baseline/churn 계열이다
  (`web-ai/eval/types.mjs:17-21`). ChatGPT 전용 5.6 variant를 global default에 넣으면
  Gemini/Grok의 동명 파일까지 요구하므로 금지한다.
- explicit config는 arbitrary `variant`, `htmlPath`, 추가 assertion을 보존한다
  (`web-ai/eval/fixtures.mjs:107-140`). `parallel-eval.json`이 이미 이 등록 방식을 쓴다
  (`test/fixtures/provider-dom/parallel-eval.json:1-30`). 5.6도 config 경로를 사용한다.
- runner는 현재 네 intent를 모든 fixture metric으로 계산하고 composer/send가 없으면
  fail한다 (`web-ai/eval-runner.mjs:91-147`). picker-only Work fixture와 04의 별도 Work send
  harness를 섞지 않으려면 fixture별 required intent가 필요하다.

### 2. 파일 변경 맵

| 상태 | 경로 | 07 소유 변경 |
| --- | --- | --- |
| NEW | `test/fixtures/provider-dom/chatgpt-gpt56-chat.html` | Chat surface + Intelligence menu + inert family submenu 실측 fixture |
| NEW | `test/fixtures/provider-dom/chatgpt-gpt56-work.html` | Work surface + Power/Advanced + inert submenu 상태 실측 fixture |
| NEW | `test/fixtures/provider-dom/chatgpt-gpt56-eval.json` | 두 fixture의 explicit eval 등록, positive/negative markers, required intents |
| NEW | `test/helpers/provider-dom-contract.mjs` | `data-eval-key` record만 읽는 test-only strict loader; DOM 의미 추론 금지 |
| NEW | `test/unit/web-ai-provider-dom-contract.test.mjs` | scrub/network/duplicate-key/필수 label/testid/부재 계약만 검증 |
| MODIFY | `web-ai/eval-runner.mjs` | `requiredIntents`가 없으면 현행 4개, 있으면 명시 subset만 gate/threshold에 사용 |
| MODIFY | `web-ai/eval/fixtures.mjs` | `FixtureConfigEntry.requiredIntents` JSDoc 명시; runtime spread는 유지 |
| MODIFY | `test/unit/web-ai-eval-fixtures.test.mjs` | 5.6 config 두 entry와 경로/intent 보존 검증 |
| MODIFY | `test/unit/web-ai-eval-runner.test.mjs` | Chat full-intent + Work composer-only fixture가 함께 pass하는지 검증 |
| MODIFY | `package.json` | opt-in `test:eval-gpt56` script 추가; 기존 default eval script 불변 |

02~06 소유 파일의 소비 변경은 아래처럼 hand-off한다. 이 변경들은 07의 테스트 소유권이
아니다.

| 소유 슬라이스 | 소비 변경 |
| --- | --- |
| 03 | `test/unit/web-ai-chatgpt-model.test.mjs`의 5.6 case가 Chat fixture record로 rows를 만들고, legacy case만 기존 inline legacy rows 사용 |
| 04 | `test/unit/web-ai-product-surfaces.test.mjs`와 `test/unit/web-ai-chatgpt-model.test.mjs` guard case가 Work fixture의 surface/picker record를 사용 |
| 02/05/06 | DOM fixture를 억지로 사용하지 않는다. 각자의 schema/session/timeout/capability harness가 primary oracle이다 |

### 3. Sanitization 및 fidelity 규칙

1. 저장 금지: URL, conversation/thread/session id, prompt/answer 본문, 사용자명, 이메일,
   avatar, cookie/storage, token/API key, provider class name, 동적 radix id.
2. 저장 허용: role, accessible label, `aria-checked`, `data-state`, 실측된 stable testid,
   placeholder, 메뉴 visible text, badge text.
3. fixture용 synthetic attribute는 `data-eval-*`만 허용한다. production selector는 이
   attribute를 절대 참조하지 않는다.
4. ARIA 연결을 위한 `fixture-*` id는 sanitized local id일 뿐 selector contract가 아니다.
5. mutually exclusive UI 상태는 한 active tree에 동시에 넣지 않는다. 순차 관측 submenu는
   inert template으로 분리하고 loader가 요청한 상태에서만 materialize한다.
6. `assertScrubbedSafe()`와 runner network pattern을 둘 다 통과해야 한다
   (`web-ai/eval/scrub-dom.mjs:4-13,39-53`, `web-ai/eval-runner.mjs:32,91-102`).
7. Work Power fixture contract는 공식 6단 매핑을 정확히 보존한다:
   `1=Terra Light`, `2=Sol Light`, `3=Sol Medium`(기본), `4=Sol High`,
   `5=Sol xHigh`, `6=Sol Ultra`. WP1은 라이브 UI가 이 표와 일치하는지 검증하며,
   불일치하면 fixture를 작성하지 않고 증거를 갱신한다.

### 4. Chat fixture 전문

#### 4.1 NEW `test/fixtures/provider-dom/chatgpt-gpt56-chat.html`

아래 전문을 그대로 추가한다. `data-eval-key`/`data-eval-label`은 test harness annotation이며,
그 밖의 role/aria/testid/text가 01 실측 계약이다.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Sanitized ChatGPT GPT-5.6 Chat picker fixture</title>
  </head>
  <body data-provider="chatgpt" data-variant="gpt56-chat">
    <header>
      <div role="radiogroup" aria-label="Composer surface">
        <button
          type="button"
          role="radio"
          aria-checked="true"
          data-state="on"
          data-radix-collection-item
          data-eval-key="surface.chat"
          data-eval-label="Chat"
        >Chat</button>
        <button
          type="button"
          role="radio"
          aria-checked="false"
          data-state="off"
          data-radix-collection-item
          data-eval-key="surface.work"
          data-eval-label="Work"
        >Work</button>
      </div>
    </header>

    <main aria-label="ChatGPT">
      <form aria-label="Prompt composer" data-eval-key="chat.composer">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded="true"
          aria-controls="fixture-chat-intelligence-menu"
          data-eval-key="chat.picker-trigger"
          data-eval-label="High"
        >High</button>
        <div
          role="textbox"
          contenteditable="true"
          aria-label="Message ChatGPT"
          data-eval-intent="composer.fill"
          data-eval-ref="chatgpt-gpt56-chat-composer"
        ></div>
        <button
          type="button"
          aria-label="Add photos and files"
          data-testid="composer-plus-btn"
          data-eval-intent="upload.open"
          data-eval-ref="chatgpt-gpt56-chat-upload"
        >Add</button>
        <button
          type="submit"
          aria-label="Send prompt"
          data-eval-intent="send.click"
          data-eval-ref="chatgpt-gpt56-chat-send"
        >Send</button>
      </form>

      <div id="fixture-chat-intelligence-menu" role="menu" data-state="open">
        <div
          role="group"
          aria-labelledby="fixture-chat-intelligence-heading"
          data-testid="composer-intelligence-picker-content"
          data-eval-key="chat.intelligence-group"
        >
          <div id="fixture-chat-intelligence-heading" role="presentation">Intelligence</div>
          <div
            role="menuitemradio"
            aria-checked="false"
            data-state="unchecked"
            tabindex="-1"
            data-eval-key="chat.tier.instant"
            data-eval-label="Instant"
            data-eval-tier="instant"
          ><span>Instant</span><span>5.5</span></div>
          <div
            role="menuitemradio"
            aria-checked="false"
            data-state="unchecked"
            tabindex="-1"
            data-eval-key="chat.tier.medium"
            data-eval-label="Medium"
            data-eval-tier="medium"
          ><span>Medium</span></div>
          <div
            role="menuitemradio"
            aria-checked="true"
            data-state="checked"
            tabindex="0"
            data-eval-key="chat.tier.high"
            data-eval-label="High"
            data-eval-tier="high"
          ><span>High</span></div>
          <div
            role="menuitemradio"
            aria-checked="false"
            data-state="unchecked"
            tabindex="-1"
            data-eval-key="chat.tier.extra-high"
            data-eval-label="Extra High"
            data-eval-tier="extra-high"
          ><span>Extra High</span></div>
          <div
            role="menuitemradio"
            aria-checked="false"
            data-state="unchecked"
            tabindex="-1"
            data-eval-key="chat.tier.pro"
            data-eval-label="Pro"
            data-eval-tier="pro"
          ><span>Pro</span></div>

          <div role="separator"></div>
          <div
            role="menuitem"
            aria-haspopup="menu"
            data-has-submenu
            tabindex="-1"
            data-eval-key="chat.family-trigger"
            data-eval-label="GPT-5.6 Sol"
          >
            <span>GPT-5.6 Sol</span>
            <svg
              aria-hidden="true"
              data-testid="menu-item-submenu-chevron"
              viewBox="0 0 16 16"
              width="16"
              height="16"
            ><path d="M6 3.5 10.5 8 6 12.5"></path></svg>
          </div>
        </div>
      </div>

      <article aria-label="Previous assistant response">
        <button
          type="button"
          aria-label="Copy"
          data-eval-intent="copy.click"
          data-eval-ref="chatgpt-gpt56-chat-copy"
        >Copy</button>
      </article>
      <p hidden data-eval-fixture-marker>CHATGPT_GPT56_CHAT_OK</p>
    </main>

    <!-- Sequentially observed state; inert until a test materializes this template. -->
    <template data-eval-state="chat-family-submenu-open">
      <div role="menu" data-state="open" aria-label="Model family">
        <div
          role="menuitemradio"
          aria-checked="true"
          data-state="checked"
          data-eval-key="chat.family.gpt-5.6-sol"
          data-eval-label="GPT-5.6 Sol"
          data-eval-family="gpt-5.6-sol"
        ><span>GPT-5.6 Sol</span></div>
        <div
          role="menuitemradio"
          aria-checked="false"
          data-state="unchecked"
          data-eval-key="chat.family.gpt-5.5"
          data-eval-label="GPT-5.5"
          data-eval-family="gpt-5.5"
        ><span>GPT-5.5</span></div>
        <div
          role="menuitemradio"
          aria-checked="false"
          data-state="unchecked"
          data-eval-key="chat.family.gpt-5.4"
          data-eval-label="GPT-5.4"
          data-eval-family="gpt-5.4"
        ><span>GPT-5.4</span><span>Leaving on July 23</span></div>
        <div
          role="menuitemradio"
          aria-checked="false"
          data-state="unchecked"
          data-eval-key="chat.family.gpt-5.3"
          data-eval-label="GPT-5.3"
          data-eval-family="gpt-5.3"
        ><span>GPT-5.3</span></div>
        <div
          role="menuitemradio"
          aria-checked="false"
          data-state="unchecked"
          data-eval-key="chat.family.o3"
          data-eval-label="o3"
          data-eval-family="o3"
        ><span>o3</span></div>
      </div>
    </template>
  </body>
</html>
```

#### 4.2 Chat fixture 합격/부재 assertion

- exact tier labels는 `['Instant', 'Medium', 'High', 'Extra High', 'Pro']`이고 순서도
  동일하다.
- tier row의 `data-testid` count는 0이다. 허용 testid는 group,
  `menu-item-submenu-chevron`, composer plus button뿐이다.
- `Instant` record에만 visible `5.5` badge가 있다.
- `Pro Standard`, `Pro Extended`, `Thinking`, `model-switcher-`는 raw HTML에 없다.
- family submenu exact labels는
  `['GPT-5.6 Sol', 'GPT-5.5', 'GPT-5.4', 'GPT-5.3', 'o3']`이고,
  `GPT-5.4` record에만 `Leaving on July 23` badge가 있다.
- Chat fixture raw HTML에는 `GPT-5.6 Terra`와 `GPT-5.6 Luna`가 없다. 두 label은
  Work fixture의 `work-model-submenu-open` template에서만 허용한다.
- family submenu template은 loader가 요청하기 전 active locator 결과에 나타나지 않는다.

### 5. Work fixture 전문

#### 5.1 NEW `test/fixtures/provider-dom/chatgpt-gpt56-work.html`

Work main picker는 Advanced가 펼쳐진 하나의 reachable state로 고정한다. Model/Effort/Speed
submenu는 서로 동시에 열린 것으로 만들지 않고 각각 inert template으로 둔다.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Sanitized ChatGPT GPT-5.6 Work picker fixture</title>
  </head>
  <body data-provider="chatgpt" data-variant="gpt56-work">
    <header>
      <div role="radiogroup" aria-label="Composer surface">
        <button
          type="button"
          role="radio"
          aria-checked="false"
          data-state="off"
          data-radix-collection-item
          data-eval-key="surface.chat"
          data-eval-label="Chat"
        >Chat</button>
        <button
          type="button"
          role="radio"
          aria-checked="true"
          data-state="on"
          data-radix-collection-item
          data-eval-key="surface.work"
          data-eval-label="Work"
        >Work</button>
      </div>
    </header>

    <main aria-label="ChatGPT Work">
      <form aria-label="Work composer" data-eval-key="work.composer">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded="true"
          aria-controls="fixture-work-power-menu"
          data-eval-key="work.picker-trigger"
          data-eval-label="5.6 Sol Light"
        >5.6 Sol Light</button>
        <div
          role="textbox"
          contenteditable="true"
          aria-label="Work on anything"
          data-placeholder="Work on anything"
          data-eval-intent="composer.fill"
          data-eval-ref="chatgpt-gpt56-work-composer"
        ></div>
        <button type="button" aria-label="Choose project">Choose project</button>
        <button type="button" aria-label="Plugins">Plugins</button>
        <button type="button" aria-label="GitHub">GitHub</button>
      </form>

      <div id="fixture-work-power-menu" role="menu" data-state="open">
        <div
          role="group"
          aria-label="Work model picker"
          data-testid="composer-intelligence-picker-content"
          data-eval-key="work.picker-group"
        >
          <div
            data-testid="composer-model-picker-slider-simple-view"
            data-eval-key="work.simple-view"
          >
            <div
              role="menuitem"
              aria-label="Power"
              tabindex="0"
              data-eval-key="work.power"
              data-eval-label="5.6 Sol Light"
              data-eval-step="2"
              data-eval-total="6"
            >
              <span>5.6 Sol Light, 2 of 6.</span>
              <span>Use Left and Right arrow keys to adjust power.</span>
            </div>
            <div
              role="menuitem"
              aria-label="Show compact options"
              tabindex="-1"
              data-eval-key="work.advanced-toggle"
              data-eval-label="Advanced"
            ><span>Advanced</span></div>
            <div
              role="menuitemcheckbox"
              aria-label="Enable fast mode"
              aria-checked="false"
              data-state="unchecked"
              tabindex="-1"
              data-eval-key="work.fast-mode"
              data-eval-label="Faster"
            >
              <span>Faster</span>
              <span>Smarter</span>
              <span>Consumes usage limits faster</span>
            </div>
          </div>

          <div
            data-testid="composer-model-picker-slider-advanced-view"
            data-eval-key="work.advanced-view"
          >
            <div
              role="menuitem"
              aria-label="Model GPT-5.6 Sol"
              aria-haspopup="menu"
              data-has-submenu
              tabindex="-1"
              data-eval-key="work.model-row"
              data-eval-label="Model"
              data-eval-value="GPT-5.6 Sol"
            ><span>Model</span><span>GPT-5.6 Sol</span></div>
            <div
              role="menuitem"
              aria-label="Effort Light"
              aria-haspopup="menu"
              data-has-submenu
              tabindex="-1"
              data-eval-key="work.effort-row"
              data-eval-label="Effort"
              data-eval-value="Light"
            ><span>Effort</span><span>Light</span></div>
            <div
              role="menuitem"
              aria-label="Speed Standard"
              aria-haspopup="menu"
              data-has-submenu
              tabindex="-1"
              data-eval-key="work.speed-row"
              data-eval-label="Speed"
              data-eval-value="Standard"
            ><span>Speed</span><span>Standard</span></div>
          </div>
        </div>
      </div>
      <p hidden data-eval-fixture-marker>CHATGPT_GPT56_WORK_OK</p>
    </main>

    <!-- Sequentially observed states; each template is materialized independently. -->
    <template data-eval-state="work-model-submenu-open">
      <div role="menu" data-state="open" aria-label="Model">
        <div role="menuitemradio" aria-checked="true" data-state="checked" data-eval-key="work.model.gpt-5.6-sol" data-eval-label="GPT-5.6 Sol"><span>GPT-5.6 Sol</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.model.gpt-5.6-terra" data-eval-label="GPT-5.6 Terra"><span>GPT-5.6 Terra</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.model.gpt-5.6-luna" data-eval-label="GPT-5.6 Luna"><span>GPT-5.6 Luna</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.model.gpt-5.5" data-eval-label="GPT-5.5"><span>GPT-5.5</span></div>
      </div>
    </template>

    <template data-eval-state="work-effort-submenu-open">
      <div role="menu" data-state="open" aria-label="Effort">
        <div role="menuitemradio" aria-checked="true" data-state="checked" data-eval-key="work.effort.light" data-eval-label="Light"><span>Light</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.effort.medium" data-eval-label="Medium"><span>Medium</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.effort.high" data-eval-label="High"><span>High</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.effort.extra-high" data-eval-label="Extra High"><span>Extra High</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.effort.max" data-eval-label="Max"><span>Max</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.effort.ultra" data-eval-label="Ultra"><span>Ultra</span><span>Consumes usage limits faster</span></div>
      </div>
    </template>

    <template data-eval-state="work-speed-submenu-open">
      <div role="menu" data-state="open" aria-label="Speed">
        <div role="menuitemradio" aria-checked="true" data-state="checked" data-eval-key="work.speed.standard" data-eval-label="Standard"><span>Standard</span><span>Default usage</span></div>
        <div role="menuitemradio" aria-checked="false" data-state="unchecked" data-eval-key="work.speed.fast" data-eval-label="Fast"><span>Fast</span><span>1.5x speed, more usage</span></div>
      </div>
    </template>

    <!-- Official Power mapping; WP1 verifies these labels against the live control. -->
    <template data-eval-state="work-power-map">
      <div data-eval-key="work.power.1" data-eval-step="1" data-eval-label="5.6 Terra Light">5.6 Terra Light</div>
      <div data-eval-key="work.power.2" data-eval-step="2" data-eval-label="5.6 Sol Light">5.6 Sol Light</div>
      <div data-eval-key="work.power.3" data-eval-step="3" data-eval-label="5.6 Sol Medium" data-eval-default="true">5.6 Sol Medium</div>
      <div data-eval-key="work.power.4" data-eval-step="4" data-eval-label="5.6 Sol High">5.6 Sol High</div>
      <div data-eval-key="work.power.5" data-eval-step="5" data-eval-label="5.6 Sol xHigh">5.6 Sol xHigh</div>
      <div data-eval-key="work.power.6" data-eval-step="6" data-eval-label="5.6 Sol Ultra">5.6 Sol Ultra</div>
    </template>
  </body>
</html>
```

#### 5.2 Work fixture 합격/부재 assertion

- surface records는 Chat=`off`, Work=`on`; URL이나 placeholder로 active surface를
  판정하지 않는다.
- Chat과 동일한 picker content testid가 정확히 1개 있고 simple/advanced testid가 각각
  1개다.
- active 실측 record는 `{ step: 2, total: 6, label: '5.6 Sol Light' }`이고,
  `work-power-map` template은 위 공식 6단 라벨을 순서대로 읽으며 3만 default다.
- Advanced row accessible names는 정확히 `Model GPT-5.6 Sol`, `Effort Light`,
  `Speed Standard`다.
- Model submenu exact labels는
  `['GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5']`이며,
  Terra/Luna는 이 Work template 밖에서 발견되면 실패한다. Effort/Speed submenu도
  `01_ui_contract_evidence.md:87-91`과 정확히 일치한다.
- active tree에 `data-eval-intent="send.click"` 또는 `copy.click`이 없다. picker fixture와
  04 소유 Work send 제출/poll harness의 책임을 분리한다.
- guard test가 이 fixture를 사용할 때 click/press/hover/focus/fill/submit log는 모두
  0이어야 한다. composer.fill marker는 offline target resolution용이지 mutation 허용
  표시가 아니다.

### 6. Fixture와 inline fake의 단일 계약 소스화

#### 6.1 NEW `test/helpers/provider-dom-contract.mjs`

새 dependency나 범용 HTML parser를 도입하지 않는다. helper는 production DOM을
해석하지 않고, fixture가 명시적으로 붙인 start-tag `data-eval-*` annotation만 읽는다.
raw HTML은 eval의 scrubber가 검증한다. duplicate key, path traversal, annotation 누락은
즉시 throw한다.

```js
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assertScrubbedSafe } from '../../web-ai/eval/scrub-dom.mjs';

const FIXTURE_ROOT = join(process.cwd(), 'test', 'fixtures', 'provider-dom');
const RECORD_PATTERN = /<([a-z][a-z0-9-]*)\b([^>]*\bdata-eval-key="[^"]+"[^>]*)>/gi;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)="([^"]*)"/g;

export function loadProviderDomContract(fileName) {
    if (basename(fileName) !== fileName || !/^chatgpt-gpt56-(chat|work)\.html$/.test(fileName)) {
        throw new Error(`unsupported provider DOM fixture: ${fileName}`);
    }
    const html = readFileSync(join(FIXTURE_ROOT, fileName), 'utf8');
    assertScrubbedSafe(html);
    const records = [...html.matchAll(RECORD_PATTERN)].map(([, tagName, source]) => ({
        tagName,
        ...Object.fromEntries([...source.matchAll(ATTRIBUTE_PATTERN)].map(([, key, value]) => [key, value])),
    }));
    const byKey = new Map();
    for (const record of records) {
        const key = record['data-eval-key'];
        if (!key || byKey.has(key)) throw new Error(`duplicate or missing data-eval-key: ${key}`);
        byKey.set(key, record);
    }
    return { html, records, byKey };
}
```

이 helper는 ARIA tree를 흉내 내지 않는다. role/name/visibility locator 행동은 기존 fake
state machine이 담당하고, helper는 label/state/testid의 원천만 fixture로 고정한다.

#### 6.2 03 소유 변경: 5.6 rows만 fixture에서 구성

`test/unit/web-ai-chatgpt-model.test.mjs`에서 다음 경계를 적용한다.

1. `legacyModelRows`, `thinkingEffortTexts`, `proEffortTexts`는 legacy fallback 전용으로
   유지한다 (`test/unit/web-ai-chatgpt-model.test.mjs:725-755,806-825`).
2. hard-coded `simplifiedRows`와 `simplifiedProExtendedOnly` option/case는 제거한다
   (`test/unit/web-ai-chatgpt-model.test.mjs:791-792,826-857`).
3. `loadProviderDomContract('chatgpt-gpt56-chat.html')`에서 `chat.tier.*` records를 읽고
   `data-eval-label`, `data-eval-tier`로 fake rows를 만든다. checked state와 click callback만
   fake가 추가한다.
4. 5.6 테스트명은 `simplified June 2026`이 아니라 `observed GPT-5.6 Intelligence menu`
   로 바꾸고, expected mapping은 02/03이 확정한 public tier/legacy alias 결과를 assertion한다.
5. Extended 부재는 fixture raw HTML negative assertion과 `extended` alias가 02의 결정대로
   `High` 또는 해당 canonical tier를 선택하는 behavior assertion을 **둘 다** 둔다.

**Before - `test/unit/web-ai-chatgpt-model.test.mjs:826-857` (verbatim)**

```js
    const simplifiedRows = [
        createElement({
            text: 'Instant',
            get checked() { return state.currentModel === 'instant'; },
            onClick: () => setSimplifiedSelection('instant', null),
        }),
        createElement({
            text: 'Medium',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'standard'; },
            onClick: () => setSimplifiedSelection('thinking', 'standard'),
        }),
        createElement({
            text: 'High',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'extended'; },
            onClick: () => setSimplifiedSelection('thinking', 'extended'),
        }),
        createElement({
            text: 'Extra High',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'heavy'; },
            onClick: () => setSimplifiedSelection('thinking', 'heavy'),
        }),
        ...(simplifiedProExtendedOnly ? [] : [createElement({
            text: 'Pro Standard',
            get checked() { return state.currentModel === 'pro' && state.selectedEffort === 'standard'; },
            onClick: () => setSimplifiedSelection('pro', 'standard'),
        })]),
        createElement({
            text: 'Pro Extended',
            get checked() { return state.currentModel === 'pro' && state.selectedEffort === 'extended'; },
            onClick: () => setSimplifiedSelection('pro', 'extended'),
        }),
    ];
```

**After - fixture-backed replacement shape**

```js
const gpt56Rows = fixtureRecords
    .filter(record => record['data-eval-key'].startsWith('chat.tier.'))
    .map(record => createElement({
        text: record['data-eval-label'],
        checked: state.selectedTier === record['data-eval-tier'],
        onClick: () => setGpt56Tier(record['data-eval-tier']),
    }));
```

fixture record에서 fake를 만드는 것은 test-only이다. production mapping table을 fixture에서
자동 생성하지 않는다. runtime contract와 test data의 dependency 방향은 production → 없음,
test → production + fixture로 유지한다.

#### 6.3 04 소유 변경: Work guard/send 입력을 fixture에서 구성

- Work fixture의 `surface.chat`/`surface.work` record로 role radio state를 만든다.
- 같은 record에서 한 radio의 `aria-checked`와 `data-state`를 의도적으로 어긋나게 만든
  `ambiguous` case를 추가하고 picker 접근 전 fail-closed를 검증한다.
- `work.picker-group`, `work.model-row`, `work.effort-row` records를 stray menu 후보로
  materialize한다.
- mutation log는 fake가 소유한다. **Chat command guard**는 active Work에서 fixture row를
  읽기 전에 hard error를 내고 log 0을 유지해야 한다. 이 Chat guard에서 active Work와
  `ambiguous`는 모두 `capability.unsupported`, stage `provider-surface-preflight`, retry
  `switch-to-chat`를 반환한다. Work send happy path는 아래에서 별도로 검증한다.
- Chat active + stray Work menu case는 Chat fixture active tree와 Work template/menu records를
  조합하는 **테스트 전용 합성**이다. 이 조합을 새로운 live-DOM 주장으로 문서화하지 않는다.
- legacy no-toggle case는 fixture를 사용하지 않고 기존 fake를 유지한다. 라디오 없음이 곧
  legacy compatibility activation scenario다.
- Work happy path는 `work.power.*` 공식 mapping record를 CLI/MCP harness에 공급하고,
  실제 submit/poll locator는 WP1 라이브 재프로브 증거에서 고정한다. Chat 명령의 Work
  hard-error와 전용 `work send` 성공 경로를 서로 다른 activation으로 검증한다.

03 문서의 역순 적용 앵커(`03_chat_picker_selector_patch.md:1240-1248`) 수정은 워커 G
소유다. 07은 fixture-first 선행 조건만 참조하며 그 앵커의 diff를 재소유하지 않는다.

### 7. Eval runner 5.6 등록 diff

#### 7.1 NEW `test/fixtures/provider-dom/chatgpt-gpt56-eval.json`

global `EVAL_VARIANTS`/`DEFAULT_EVAL_RUN_VARIANTS`는 수정하지 않는다. provider-specific
variant를 공통 discovery enum에 넣는 것은 다른 provider fixture 누락을 유발한다. 기존
explicit config 확장점을 사용한다.

```json
{
  "schemaVersion": 1,
  "taskId": "chatgpt-gpt56-dom-contract",
  "maxFixtureConcurrency": 2,
  "fixtures": [
    {
      "id": "chatgpt-gpt56-chat",
      "vendor": "chatgpt",
      "variant": "gpt56-chat",
      "htmlPath": "chatgpt-gpt56-chat.html",
      "requiredIntents": ["composer.fill", "upload.open", "send.click", "copy.click"],
      "mustContain": [
        "CHATGPT_GPT56_CHAT_OK",
        "composer-intelligence-picker-content",
        "chat.tier.extra-high",
        "chat.family.gpt-5.6-sol"
      ],
      "mustNotContain": [
        "model-switcher-",
        "GPT-5.5 Thinking",
        "Pro Standard",
        "Pro Extended"
      ]
    },
    {
      "id": "chatgpt-gpt56-work",
      "vendor": "chatgpt",
      "variant": "gpt56-work",
      "htmlPath": "chatgpt-gpt56-work.html",
      "requiredIntents": ["composer.fill"],
      "mustContain": [
        "CHATGPT_GPT56_WORK_OK",
        "composer-model-picker-slider-simple-view",
        "composer-model-picker-slider-advanced-view",
        "5.6 Sol Light, 2 of 6.",
        "work.effort.ultra",
        "work.speed.fast"
      ],
      "mustNotContain": [
        "model-switcher-",
        "data-eval-intent=\"send.click\"",
        "data-eval-intent=\"copy.click\""
      ]
    }
  ]
}
```

#### 7.2 MODIFY `web-ai/eval-runner.mjs`

현재 runner는 target probe 네 개를 항상 metric threshold 대상으로 삼는다
(`web-ai/eval-runner.mjs:103-147`). `requiredIntents`를 **opt-in override**로 추가한다.
필드가 없을 때 결과와 golden shape는 현행과 같아야 한다.

**Before A - `EvalFixture` typedef (`web-ai/eval-runner.mjs:10-20`, verbatim)**

```js
/**
 * @typedef {{
 *   id?: string,
 *   vendor?: string,
 *   variant?: string,
 *   fixturePath?: string,
 *   scrub?: string[],
 *   mustContain?: string[],
 *   mustNotContain?: string[],
 * }} EvalFixture
```

**Before B - required target resolution (`web-ai/eval-runner.mjs:103-108`, verbatim)**

```js
    const probes = Object.fromEntries(EVAL_TARGET_INTENTS.map((intent) => [
        intent,
        probeEvalTargetIntentFromHtml(html, { provider, intent, variant: fixture.variant || 'baseline' }),
    ]));
    const resolvedCount = Object.values(probes).filter((probe) => probe.status === 'resolved').length;
    const requiredResolved = probes['composer.fill']?.status === 'resolved' && probes['send.click']?.status === 'resolved';
```

**Before C - ratio metrics (`web-ai/eval-runner.mjs:137-141`, verbatim)**

```js
        metrics: {
            targetResolution: makeRatioMetric(resolvedCount, EVAL_TARGET_INTENTS.length, DEFAULT_EVAL_THRESHOLDS.uploadOpen),
            composerFill: makeRatioMetric(probes['composer.fill']?.status === 'resolved' ? 1 : 0, 1, DEFAULT_EVAL_THRESHOLDS.composerFill),
            uploadOpen: makeRatioMetric(probes['upload.open']?.status === 'resolved' ? 1 : 0, 1, DEFAULT_EVAL_THRESHOLDS.uploadOpen),
            copyExactness: makeRatioMetric(probes['copy.click']?.status === 'resolved' ? 1 : 0, 1, DEFAULT_EVAL_THRESHOLDS.copyExactness),
```

**After**

```diff
 /** @typedef {{
  *   ...
+ *   requiredIntents?: string[],
  * }} EvalFixture
  */

+const requiredIntents = fixture.requiredIntents ?? EVAL_TARGET_INTENTS;
+const invalidRequiredIntents = requiredIntents.filter(intent =>
+    !EVAL_TARGET_INTENTS.includes(intent));
+if (requiredIntents.length === 0 || invalidRequiredIntents.length > 0) {
+    errors.push(serializeEvalError(createEvalError(
+        'eval.required-intents-invalid',
+        'fixture-assert',
+        'requiredIntents must be a non-empty subset of EVAL_TARGET_INTENTS',
+        { requiredIntents, allowed: EVAL_TARGET_INTENTS },
+    )));
+}
 const probes = Object.fromEntries(/* existing four probes */);
-const resolvedCount = Object.values(probes).filter((probe) => probe.status === 'resolved').length;
-const requiredResolved = probes['composer.fill']?.status === 'resolved'
-    && probes['send.click']?.status === 'resolved';
+const requiredResolvedCount = requiredIntents
+    .filter(intent => probes[intent]?.status === 'resolved').length;
+const requiredResolved = invalidRequiredIntents.length === 0
+    && requiredResolvedCount === requiredIntents.length;

 metrics: {
-  targetResolution: makeRatioMetric(resolvedCount, EVAL_TARGET_INTENTS.length,
+  targetResolution: makeRatioMetric(requiredResolvedCount, requiredIntents.length,
       DEFAULT_EVAL_THRESHOLDS.uploadOpen),
   composerFill: makeRatioMetric(/* existing value */, 1,
-      DEFAULT_EVAL_THRESHOLDS.composerFill),
+      requiredIntents.includes('composer.fill') ? DEFAULT_EVAL_THRESHOLDS.composerFill : undefined),
   uploadOpen: makeRatioMetric(/* existing value */, 1,
-      DEFAULT_EVAL_THRESHOLDS.uploadOpen),
+      requiredIntents.includes('upload.open') ? DEFAULT_EVAL_THRESHOLDS.uploadOpen : undefined),
   copyExactness: makeRatioMetric(/* existing value */, 1,
-      DEFAULT_EVAL_THRESHOLDS.copyExactness),
+      requiredIntents.includes('copy.click') ? DEFAULT_EVAL_THRESHOLDS.copyExactness : undefined),
 }
```

`send.click`은 기존처럼 `requiredResolved` gate로 검증하고 별도 metric을 신설하지 않는다.
Work config가 composer만 요구하는 이유는 이 fixture가 picker shape만 검증하기 때문이다.
Work send 지원 여부는 04의 CLI/MCP 회귀와 라이브 스모크가 판정한다. `offline:true`, `javascriptEnabled:false`, network block,
`mutationAllowed:false` 오류 계약은 불변이다 (`web-ai/eval-runner.mjs:56-76,91-127`).

#### 7.3 MODIFY `web-ai/eval/fixtures.mjs`

runtime은 config의 extra field를 이미 spread하므로 behavior diff는 없다
(`web-ai/eval/fixtures.mjs:121-140`). JSDoc에 다음 한 줄만 추가한다.

```diff
 *   configPath?: string,
+*   requiredIntents?: string[],
 *   [extra: string]: unknown,
```

#### 7.4 Eval tests와 command

`test/unit/web-ai-eval-fixtures.test.mjs`에 config load case를 추가한다.

```js
const config = await loadFixtureConfig('test/fixtures/provider-dom/chatgpt-gpt56-eval.json');
expect(config.fixtures.map(entry => entry.variant)).toEqual(['gpt56-chat', 'gpt56-work']);
expect(config.fixtures[1].requiredIntents).toEqual(['composer.fill']);
```

`test/unit/web-ai-eval-runner.test.mjs`에는 다음 behavior를 추가한다.

```js
const result = await runWebAiEval({
    config: 'test/fixtures/provider-dom/chatgpt-gpt56-eval.json',
    concurrency: 2,
});
expect(result.ok).toBe(true);
expect(result.results.map(entry => [entry.variant, entry.status])).toEqual([
    ['gpt56-chat', 'pass'],
    ['gpt56-work', 'pass'],
]);
expect(result.results[1].probes['send.click'].status).toBe('missing');
expect(result.results[1].errors).toEqual([]);
expect(result.results[1].metrics.targetResolution.value).toBe(1);
expect(result.results[1].metrics.uploadOpen.threshold).toBeUndefined();
```

invalid/empty `requiredIntents` 한 케이스도 추가해
`eval.required-intents-invalid`, `mutationAllowed=false`를 고정한다. 기존 baseline 결과의
네 intent threshold와 breaking fail-closed 테스트는 그대로 통과해야 한다
(`test/unit/web-ai-eval-runner.test.mjs:8-22`).

`package.json`에는 default eval을 바꾸지 않고 opt-in script만 추가한다.

```diff
 "test:eval-fixtures": "node scripts/run-web-ai-eval.mjs --vendor chatgpt --fixtures test/fixtures/provider-dom --json",
+"test:eval-gpt56": "node scripts/run-web-ai-eval.mjs --config test/fixtures/provider-dom/chatgpt-gpt56-eval.json --concurrency 2 --json",
```

## Part 2: 최종 회귀 매트릭스(WP7)

### 8. 최종 회귀 매트릭스: 02~06 소유 테스트

표기: **P** = 시나리오의 primary behavior oracle, **S** = schema/evidence/통합 보조,
**N/A** = 해당 owner의 책임 아님. 모든 P가 green이어야 최종 gate가 닫힌다.

| 소유 | 테스트 파일 / assertion 묶음 | 5.6 성공 | legacy fallback | Extended 부재 | Work 가드 | Work send | timeout 상속 | MCP submit 회귀 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 02 | `test/integration/web-ai-cli-contract.test.mjs`: family/tier/legacy alias 행렬 | S | **P** | **P** | S (Chat 진입점 reject) | N/A | N/A | S |
| 02 | `test/unit/web-ai-tool-schema.test.mjs` + `web-ai-tool-validation.test.mjs`: Chat MCP schema SSOT/Work reject | S | S | S | **P** | N/A | S (timeout field 계약) | S |
| 02 | `test/unit/web-ai-sessions-command.test.mjs`: 2축 `modelSelection` evidence 직렬화 | **P** | S | S | N/A | N/A | S | S |
| 03 | `test/unit/web-ai-chatgpt-model.test.mjs`: Chat fixture 기반 flat radio 선택/검증 | **P** | **P** | **P** | S (04가 guard cases 소유) | N/A | N/A | N/A |
| 04 | `test/unit/web-ai-product-surfaces.test.mjs`: toggle 존재 시 `chat\|work\|ambiguous` 판정, no-toggle legacy/read-only | S | S (no-toggle=`legacy`) | N/A | **P** | S | N/A | N/A |
| 04 | `test/unit/web-ai-chatgpt-model.test.mjs`: Chat 경로의 active Work/ambiguous hard error + zero mutation | S | S | N/A | **P** | S | N/A | N/A |
| 04 | CLI contract: `web-ai work send` project-sources 선례의 **2단 파서**, `--prompt`, `--power 1..6`, speed/timeout 전달 | N/A | N/A | N/A | S | **P** | S | N/A |
| 04 | MCP v1 contract: `web_ai_work_send` 스키마/handler의 `prompt + power + speed + timeout` 검증·전달 | N/A | N/A | N/A | S | **P** | S | S |
| 04 | authenticated live smoke: Power 공식 매핑 왕복 + Work submit/poll/session evidence | N/A | N/A | N/A | S | **P** | S | N/A |
| 05 | `test/unit/web-ai-timeout-default.test.mjs`: `chatgpt-pro=5400` fallback/최초 deadline | N/A | N/A | N/A | N/A | S | **P** | **P** |
| 05 | 같은 파일: `grok-heavy=3600`, `chatgpt-pro` 비혼입 | N/A | N/A | N/A | N/A | N/A | **P** | N/A |
| 05 | 같은 파일: `deep-research=3600`, `chatgpt-pro`/`grok-heavy` 비혼입 | N/A | N/A | N/A | N/A | N/A | **P** | N/A |
| 06 | `test/unit/web-ai-capability.test.mjs` + `web-ai-capability-registry.test.mjs`: 5.6/Work send probe/status | S | S | S | S | S | N/A | N/A |
| 06 | `test/unit/web-ai-doctor.test.mjs` + 06이 확정할 tab-inspect/session evidence integration tests | S | S | S | S | S | S | S |

#### 8.1 시나리오별 activation과 observable

| 시나리오 | activation | 반드시 보일 결과 |
| --- | --- | --- |
| 5.6 성공 | Chat fixture, Chat=`on`, 5.6 menu open, 각 canonical request 수행 | 정확한 flat row click, checked/pill 재검증, family+tier가 `modelSelection`에 분리 기록, warning 없음 |
| legacy fallback | surface radio와 5.6 group/testid가 없는 기존 inline legacy fake | legacy testid/text 경로가 계속 선택되며 5.6-only selector를 요구하지 않음 |
| Extended 부재 | Chat fixture raw HTML에 old Extended rows 없음 + public legacy `extended/high` 요청 | 없는 label을 찾지 않고 02 mapping의 canonical 5.6 tier 선택; `Pro Extended` fallback 금지 |
| Work 가드 | Work fixture의 Work=`on`과 toggle state 모순 `ambiguous`; Chat 명령의 model/effort 있음과 없음 호출 | 모두 `capability.unsupported`, stage `provider-surface-preflight`, retry `switch-to-chat`; 모든 mutation log 0 |
| Work send CLI | `web-ai work send --prompt ... --power N`을 2단 파서로 호출하고 각 단계의 잘못된 옵션도 주입 | `work`/`send`가 정확히 분기되고 `power=1..6`만 허용; Chat send로 낙하하거나 기존 명령에 `surface=work`를 합성하지 않음 |
| Work send MCP | MCP v1 `web_ai_work_send`에 `prompt + power + speed + timeout` 및 누락/범위 밖 입력 주입 | 전용 스키마가 검증한 값을 handler에 그대로 전달; `web_ai_submit_prompt`는 Work를 계속 reject |
| Work live smoke | WP1 로그인 세션에서 공식 Power 1~6 라벨 왕복 후 최소 prompt 제출·poll | 공식 매핑과 UI 라벨 일치, Work conversation/session evidence 생성, Chat 경로 mutation 0 |
| ChatGPT Pro timeout | deadline 없는 ChatGPT Pro와 timeout 없는 `web_ai_submit_prompt(model=pro)` | `chatgpt-pro=5400`; 최초 persisted deadline과 반환 evidence가 같은 5400s 기준을 참조 |
| Grok Heavy timeout | deadline 없는 Grok Heavy | `grok-heavy=3600`; `chatgpt-pro=5400` 비혼입 |
| Deep Research timeout | deadline 없는 DR/Gemini Deep Think | `deep-research=3600`; `chatgpt-pro`/`grok-heavy` 비혼입 |

### 9. 커버리지 구멍과 disposition

| 구멍 | 현재 위험 | 이 유닛의 처리 |
| --- | --- | --- |
| CI authenticated E2E 없음 | provider DOM 재변경을 static fixture가 스스로 감지 못함 | **잔존**. WP1/04 live smoke는 수동 증거로 남기고, 06 probe/doctor가 drift 신호를 내면 재프로브; CI 로그인 mutation은 금지 |
| 공식 Power mapping과 라이브 UI drift | 문서 라벨과 실제 control이 어긋날 수 있음 | **WP1 선행 gate**. 공식 `1=Terra Light, 2=Sol Light, 3=Sol Medium(기본), 4=Sol High, 5=Sol xHigh, 6=Sol Ultra`를 라이브 왕복 검증한 뒤 fixture 작성 |
| Work submit/stream/poll DOM drift | offline picker fixture만으로 mutation 경로를 보장할 수 없음 | **04 blocker**. CLI/MCP contract 테스트와 authenticated live smoke가 모두 green이어야 Work send 열을 닫음 |
| 한국어 5.6 UI 미실측 | legacy 한국어 label이 새 UI에서도 맞다고 오판할 수 있음 | **잔존**. fixture는 영어만; legacy 한국어 compatibility와 5.6 실측 주장을 분리 |
| inline fake와 fixture label drift | fake가 다시 독자적인 5.6 메뉴를 만들 수 있음 | **닫음**. 5.6 rows는 `data-eval-key` record에서 생성; inline에는 legacy rows와 state transition만 남김 |
| eval runner는 production selector를 실행하지 않음 | eval pass만으로 model 선택 성공을 오판할 수 있음 | **닫음(책임 분리)**. eval은 safety/shape/marker, 03 public `selectChatGptModel` test가 behavior oracle |
| timeout inheritance가 source-string assertion에만 머무를 가능성 | executor가 실제 deadline을 덮어써도 green일 수 있음 | **05 blocker**. stored session/deadline 값을 실행 후 assertion하는 behavior test 없이는 matrix P 불인정 |
| MCP submit이 schema test만 통과할 가능성 | handler가 model을 resolver에 전달하지 않아도 schema는 green | **05 blocker**. 실제 MCP submit handler 호출 + persisted deadline assertion 없이는 matrix P 불인정 |
| Chat/Work picker 동시 mount 여부 미확인 | synthetic stray-menu test를 live 사실로 오해할 수 있음 | **잔존/방어 테스트**. 04 scoped locator를 adversarially 검증하되, 동시 mount 사실 주장은 01 재프로브 전 금지 |

최종 gate에서 위 두 **05 blocker**가 구현되지 않았다면 timeout/MCP 열은 green으로 표시하지
않는다. 세 tier를 한 parameterized 기대값으로 뭉개지 말고 각 tier와 비혼입을 독립 행으로
실행한다. `test/unit/web-ai-timeout-default.test.mjs`의 상수/순수 함수 테스트만으로 최초 MCP
deadline 생성 회귀를 닫았다고 주장할 수 없다 (`test/unit/web-ai-timeout-default.test.mjs:10-67`,
`00_index.md:35`).

### 10. 적용 순서

1. WP1에서 Work 라이브 재프로브와 공식 Power 매핑 1~6 왕복 검증을 완료한다.
2. WP2 Part 1로 Chat/Work HTML, Power mapping records, eval config와 fixture integrity test를
   먼저 작성한다.
3. WP2에서 contract loader와 opt-in `requiredIntents`를 고정하고 02를 적용·독립 검증한다.
4. WP3에서 03이 Chat 5.6 hard-coded rows를 fixture-backed records로 교체한다. 03의 역순
   앵커 수정은 워커 G 소유이며 legacy fake는 보존한다.
5. WP4에서 04가 Work fixture records를 guard 및 Work send CLI/MCP tests에 연결하고 라이브
   스모크를 실행한다.
6. WP5에서 05의 timeout 3-tier 독립 회귀를 실행한다.
7. WP6에서 06 capability/runtime 통합 회귀를 실행한다.
8. WP7에서 08+09를 적용하고 Part 2 matrix, 5.6 eval config, touched-files checkjs와 최종
   focused suite를 실행한다. 실패 시 fixture assertion을 완화하지 말고 owner 테스트/실측
   계약의 모순을 찾는다.

### 11. 검증 명령과 합격 조건

#### 11.1 Fixture / eval gate

```bash
npx vitest run test/unit/web-ai-provider-dom-contract.test.mjs test/unit/web-ai-eval-fixtures.test.mjs test/unit/web-ai-eval-runner.test.mjs
node scripts/run-web-ai-eval.mjs --config test/fixtures/provider-dom/chatgpt-gpt56-eval.json --concurrency 2 --json
```

합격:

- 두 fixture status=`pass`, top-level `ok=true`, network/scrub error 0.
- Chat target resolution 4/4.
- Work required target resolution 1/1이며 send/copy probe는 `missing`으로 명시된다.
- old label/testid negative assertions와 duplicate key check가 통과한다.

#### 11.2 02~06 final regression gate(fixture 선행)

```bash
npx vitest run test/integration/web-ai-cli-contract.test.mjs test/unit/web-ai-tool-schema.test.mjs test/unit/web-ai-tool-validation.test.mjs test/unit/web-ai-sessions-command.test.mjs test/unit/web-ai-chatgpt-model.test.mjs test/unit/web-ai-product-surfaces.test.mjs test/unit/web-ai-timeout-default.test.mjs test/unit/web-ai-capability.test.mjs test/unit/web-ai-capability-registry.test.mjs test/unit/web-ai-doctor.test.mjs
npm run typecheck:checkjs-dom
```

합격:

- matrix의 각 시나리오마다 최소 하나의 P assertion이 실행되고 0 failure.
- active Work에서는 Chat 명령만 canonical surface error와 zero mutation을 내고,
  verified Work의 `work send|web_ai_work_send`는 성공 경로로 간다. `ambiguous`에서는
  Chat/Work 명령 모두 fail closed와 zero mutation이다.
- `web-ai work send` 2단 파서와 MCP v1 `web_ai_work_send(prompt,power,speed,timeout)`가
  독립 contract test를 통과하고, WP1 로그인 세션의 live smoke 증거가 남는다.
- Extended 부재는 raw fixture negative + alias behavior 두 층에서 확인.
- timeout/MCP는 `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600`의 독립
  persisted deadline 및 비혼입 assertion으로 확인하며 source-string만으로 대체하지 않는다.
- checkjs DOM은 기존 전역 124건 기준선을 늘리지 않고 touched files 신규 진단 0건;
  test-only fixture annotation이 production source에 import/selector로 유출되지 않는다.

### 12. 구현 체크리스트

- [ ] Chat/Work를 별도 HTML로 저장하고 동시 active surface를 만들지 않음.
- [ ] Chat tier 5개, Instant 5.5 badge, family submenu의 Sol/5.5/5.4+퇴역 배지/5.3/o3를 실측 그대로 보존하고 Terra/Luna 부재를 검증.
- [ ] Work Power 공식 6단 라벨과 3=Sol Medium 기본, simple/advanced testid, Model/Effort/Speed 전체 관측값과 Work-only Terra/Luna를 보존.
- [ ] Work submit/poll selector는 WP1 실측을 소비하고 한국어 5.6 라벨은 fixture에 발명하지 않음.
- [ ] old `model-switcher-*`, `Thinking`, `Pro Standard`, `Pro Extended` 부재 assertion.
- [ ] 5.6 fake rows의 label source는 fixture; inline fake는 legacy/state transition만 소유.
- [ ] global eval variant/default 목록 불변; explicit config로만 5.6 등록.
- [ ] `requiredIntents` 미지정 fixture의 기존 metric/golden behavior 불변.
- [ ] picker eval의 send/copy 비요구와 04 Work send CLI/MCP/live 회귀를 별도 gate로 모두 기록.
- [ ] 02~06 test ownership을 이동시키지 않고 matrix P/S를 그대로 유지.
- [ ] 05 MCP submit은 실제 persisted deadline assertion 전에는 완료 처리하지 않음.
- [ ] timeout tier를 chatgpt-pro 5400 / grok-heavy 3600 / deep-research 3600으로 3분리하고 상호 비혼입 검증.
- [ ] fixture/eval gate, final focused suite, checkjs DOM을 fresh run으로 기록.
