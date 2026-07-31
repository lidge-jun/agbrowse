# 04 — Work surface 자동화 계약과 구현 계획

기준일: 2026-07-10. 이 문서는 ChatGPT Work 자동화의 단독 구현 소유자다.
기존의 감지·Chat 오발 방지·read-only 범위를 활성화해 **surface 전환, Power/Speed
mutation, Work composer 제출, task 응답 판정, session 재사용, CLI/MCP 진입점**까지
구현한다. 근거는 reconciliation canon 2·7·10·11,
`260710_work_reverse_engineering.md`, `260710_work_external_research.md`, 그리고
`02_core_contract_decisions.md:1151-1228`의 이관 블록이다. WP1 라이브 정본은
`.codexclaw/evidence/260710_wp1_live_work_probe.md`, 제품 능력/경계의 외부 정본은
`10_patch_interview.md`의 공식 OpenAI source ledger다.

## 1. 경계와 공개 계약

### 1.1 Chat과 Work 진입점 분리

- 기존 Chat 명령 `send|query|poll|watch`와 MCP `web_ai_submit_prompt`는 active Work 또는
  ambiguous surface에서 계속 hard-error한다. 이 경로는 Work mutation으로 우회하지
  않는다.
- Work mutation의 유일한 공개 진입점은 최상위 `work` 커맨드와 MCP
  `web_ai_work_send`다. 기존 send/tool에 `surface=work`를 추가하지 않는다.
- 두 경로는 같은 detector를 소비하지만 예외 경계가 다르다. Chat 경로는
  `workSurfaceUnsupportedError()`로 `switch-to-chat`을 반환하고, Work 경로는
  `ensureWorkSurface()`로 Work를 활성화한 뒤 전용 adapter만 호출한다.
- URL은 surface discriminator가 아니다. 헤더의 exact `role=radio` «Chat»/«Work»와
  `aria-checked` + `data-state` 쌍만 사용한다
  (`01_ui_contract_evidence.md:7-16`).

| 경로 | active Chat | active Work | ambiguous | toggle 없음 |
| --- | --- | --- | --- | --- |
| Chat `send|query|poll|watch`, `web_ai_submit_prompt` | 기존 Chat 실행 | hard-error, mutation 0 | hard-error, mutation 0 | legacy warning 후 기존 Chat 경로 |
| `work send`, `web_ai_work_send` | `ensureWorkSurface()`가 Work로 전환 | Work 실행 | hard-error, mutation 0 | `capability.unsupported`; Work legacy 추정 금지 |

Chat hard-error는 `errorCode=capability.unsupported`,
`stage=provider-surface-preflight`, `retryHint=switch-to-chat`을 유지한다. Work 전용
경로의 surface/picker 검증 실패는 `stage=provider-work-preflight` 또는
`provider-work-select`로 분리하고, Chat의 `provider.model-mismatch` warning 경로가
삼키지 못하게 한다.

### 1.2 CLI v1

CLI 문법은 다음으로 닫는다.

```text
web-ai work send --prompt <text> --power <1..6> [--speed standard|fast] [--timeout <seconds>] [--json]
```

`web-ai/cli.mjs:1813-1831`의 `project-sources list|add` 선례처럼 1단계에서 `work`,
2단계에서 `send`를 판별한 뒤 `args.slice(1)`을 별도 `parseArgs`로 파싱한다.
`prompt`와 `power`는 필수, `speed`와 `timeout`은 선택이다. `power`는 integer 1..6,
`speed`는 `standard|fast` 외 값을 browser mutation 전에 reject한다. v1에는
`--surface`, `--model`, `--effort`, `--project`, `--plugin`, 첨부 옵션을 넣지 않는다.
Work의 Choose project/첨부/Plugins는 기존 Chat envelope와 의미가 다르므로 후속
슬라이스에서 별도 계약한다. 특히 관측된 `hints=plugin:<id>` URL은 현재 UI 힌트이지
안정된 공개 API가 아니므로 v1에서 합성하지 않는다.

### 1.3 MCP v1

`web-ai/tool-schema.mjs`에 다음 strict schema를 추가한다.

```js
web_ai_work_send: {
    description: 'Submit a prompt through the ChatGPT Work surface.',
    inputSchema: objectSchema({
        prompt: { type: 'string', minLength: 1 },
        power: { type: 'integer', minimum: 1, maximum: 6 },
        speed: { type: 'string', enum: ['standard', 'fast'] },
        timeout: { type: 'number' },
    }, ['prompt', 'power']),
}
```

`additionalProperties:false`는 `objectSchema()`가 보장한다
(`web-ai/tool-schema.mjs:18-23`). `model|effort|project|plugin|filePath|surface`는 v1
schema에 없고 validation 단계에서 거부된다. `web-ai/mcp-server.mjs`는 기존
`web_ai_submit_prompt` 분기와 별도 분기로 Work adapter를 호출하며 provider alias나
Chat `sendByProvider()`를 거치지 않는다.

## 2. 소유권과 병합 심볼

02의 `→ 04로 이관` 블록과 기존 04 구현은 아래 단일 심볼 집합으로 병합한다.
동일 detector 또는 오류 helper를 다른 파일/절에 다시 정의하지 않는다.

| 심볼/계약 | 단독 소유 | 병합 결정 |
| --- | --- | --- |
| `CHATGPT_SURFACE_RADIO_SELECTOR`, `CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR`, `CHATGPT_OPEN_PICKER_CONTENT_SELECTOR`, `CHATGPT_WORK_PICKER_MARKER_SELECTOR` | 02 | 04는 import/소비만 |
| `detectChatGptComposerSurface`, `readChatGptSurfaceRadio`, `detectChatGptWorkAvailability` | 04, `product-surfaces.mjs` | 기존 04 detector가 02의 `readChatGptSurfaceDiscriminator`를 흡수; 후자는 만들지 않음 |
| `workSurfaceUnsupportedError` | 04, `chatgpt-model.mjs` | 기존 04 정의 하나만 유지; 02 호출 diff를 흡수 |
| `openModelMenu`의 surface guard와 composer-scoped flow | 04, `chatgpt-model.mjs` | 02:1191-1228과 기존 04 §3.3을 한 흐름으로 병합 |
| `chatGptComposerMenuRoot`와 Chat 라벨 semantics | 03 | 04는 active Chat menu root로만 소비 |
| Work picker helper 목록 | 04, 신설 `chatgpt-work-picker.mjs` | Chat normalizer/라벨/전역 menu 탐색과 분리 |
| Work composer/response orchestration | 04 | 기존 Chat primitive는 root 주입형으로만 재사용 |

### 2.1 Detector 단일 구현

`detectChatGptComposerSurface(page)`는 exact radio 두 개를 읽어 다음 계약을 지킨다.

1. radio가 모두 없을 때만 `{ui:'legacy', surface:null}` + warning이다.
2. 둘 다 visible하고 각 `aria-checked=true|false`와 `data-state=on|off`가 일치하며
   active가 하나일 때만 `surface=chat|work`다.
3. 속성 누락/불일치, 한쪽 누락, 둘 다 active/inactive는
   `{ui:'toggle', surface:'ambiguous'}`로 fail closed한다.
4. `detectChatGptWorkAvailability()`의 `available`은 Work radio visibility이며 active
   여부와 분리한다.
5. detector에는 `click|press|hover|focus|fill|evaluate` mutation이 없다.

이 구현이 02 이관본의 `readChatGptSurfaceDiscriminator()` 역할까지 포함한다.
따라서 해당 이름의 두 번째 discriminator를 추가하지 않는다.

### 2.2 Chat guard와 composer scope 병합

`selectChatGptModel()`은 model/effort 조기 반환 전에 detector를 호출한다. active Work
또는 ambiguous이면 `workSurfaceUnsupportedError()`를 throw하고 selector click/type/
submit은 0회다. legacy만 warning evidence를 남기고 기존 selector 경로를 허용한다.

`openModelMenu()`는 같은 guard 이후 active Chat composer root를 먼저 정하고, trigger,
composer pill, text button을 그 root 아래에서만 찾는다. portal menu는
`CHATGPT_OPEN_PICKER_CONTENT_SELECTOR`로 제한하고 Work marker가 보이면 hard-error한다.
`isModelMenuOpen`, `findModelOption`, `findOptionByExactLabels`도 03 소유의
`chatGptComposerMenuRoot(page)`를 받는다. 페이지 전역 «GPT-5.5»,
`[role=menuitem]`, send button fallback은 제거한다. 이것이
`02_core_contract_decisions.md:1191-1228`의 composer-scoped 이관 흐름을 기존 04
구현과 합친 최종 형태다.

## 3. Work picker mutation 계약

신설 `web-ai/chatgpt-work-picker.mjs`가 다음 helper를 단독 소유한다.

```text
ensureWorkSurface
openWorkPicker
readWorkPickerState
normalizeWorkPower
setWorkPower
openWorkAdvancedView
normalizeWorkModel / normalizeWorkEffort / normalizeWorkSpeed
setWorkAdvancedOption
verifyWorkSelection
buildWorkSelectionEvidence
```

목록의 `normalizeWork{Model,Effort,Speed}`는 각각의 함수 3개를 뜻한다. 공개 v1은
`normalizeWorkPower`와 `normalizeWorkSpeed`만 입력 정규화에 사용한다. model/effort
helper는 Power 검증과 내부 state 판독용이며 public schema를 열지 않는다.

### 3.1 Power 라이브 UI 어댑터 매핑

아래 매핑은 2026-07-10 WP1에서 실제 UI를 왕복해 확정했다. public Power는 1..6,
slider DOM은 `aria-valuemin=0`, `aria-valuemax=5`인 0-based 값이다.

| Power | Model | Effort | 의미 | 상태 |
| ---: | --- | --- | --- | --- |
| 1 | GPT-5.6 Terra | Light | Terra Light | WP1 PASS (`aria-valuenow=0`) |
| 2 | GPT-5.6 Sol | Light | Sol Light | WP1 PASS (`aria-valuenow=1`) |
| 3 | GPT-5.6 Sol | Medium | 기본 preset | WP1 PASS (`aria-valuenow=2`) |
| 4 | GPT-5.6 Sol | High | Sol High | WP1 PASS (`aria-valuenow=3`) |
| 5 | GPT-5.6 Sol | Extra High (`xHigh`) | Sol Extra High | WP1 PASS (`aria-valuenow=4`) |
| 6 | GPT-5.6 Sol | Ultra | subagents 병렬 분할 실행 | WP1 PASS (`aria-valuenow=5`) |

`Max`는 Power 축 밖에서 단일 작업의 추론 시간을 늘리는 Advanced 전용 effort이며
Power 1..6에 매핑하지 않는다.
`Ultra`와 `Max`를 동의어로 취급하지 않는다. `Fast`는 speed 선택이며 Power와 독립이다.
UI는 Fast를 `1.5x speed, more usage`로 표시하지만 공개 CLI/MCP help, result, warning에는
변동 가능한 배수 숫자를 계약으로 노출하지 않는다. 반환 evidence는 `moreUsage:true`와
관측된 UI 설명만 보존한다.

### 3.2 mutation과 검증

`ensureWorkSurface()`는 detector가 `chat`일 때 exact Work radio 하나만 click하고,
재검출 결과가 `work`가 아니면 실패한다. `openWorkPicker()`는 active Work composer
아래 trigger를 통해 연 open picker만 반환한다. hidden Chat picker나 페이지 전역
동명 menu는 후보가 아니다.

`setWorkPower()`는 현재값을 `aria-valuenow|min|max|text`로 읽고 검증된 keyboard
계약(Left/Right 한 단계, 양 끝 clamp)으로 목표값까지 이동한다. Home/End는 WP1에서 값을
바꾸지 않았으므로 사용하지 않는다. 변경 후 `readWorkPickerState()`를 다시 읽어 Power,
compact label, model/effort가 §3.1 매핑과 모두 일치해야 성공한다. `setWorkAdvancedOption`
역시 checked state, accessible name, compact/pill 전이를 재검증하며 변화가 없으면
현재값으로 계속 제출하지 않고 fail closed한다. `speed` 미지정은 현재 UI를 보존해
speed mutation 0회, 지정 시에만 `standard|fast`를 선택한다.

## 4. Work composer와 제출

Work는 새 provider가 아니라 ChatGPT 내부 surface다. tab/deadline/trace/error
serialization은 재사용하되 composer target과 submit은 Work adapter 경계로 분기한다.

- Work의 실제 textbox accessible name은 `Chat with ChatGPT`이고 비어 있을 때 내부
  paragraph가 `Work on anything`이다. `web-ai/vendor-editor-contract.mjs:114`에는
  Work 전용 contract override를 제공하고 두 신호를 함께 검증한다.
- `web-ai/chatgpt-composer.mjs:277-300`과 `:320-340`의 전역 `querySelector` 기반 write/
  read fallback은 Work에서 사용하지 않는다. `composerRoot`/`composerTarget`을 받아
  해당 root에서만 동작하도록 adapter를 분기한다.
- `web-ai/chatgpt-composer.mjs:377-387`의 페이지 전역 send 후보 fallback은 Work
  경로에서 금지한다. Work composer에 귀속된 send button만 click한다.
- `sendWork()` 순서는 detector → `ensureWorkSurface` → picker open/read → Power와
  선택 speed mutation/verify → Work composer resolve → prompt write/read-back →
  scoped send → commit evidence → session 생성이다.
- submit 직전 detector와 picker evidence를 다시 읽어 surface가 바뀌었거나 selection이
  drift하면 mutation을 중단한다.

v1의 project/첨부/plugin activation은 구현하지 않는다. Choose project·Plugins·app
button을 composer target이나 send button으로 오인하지 않도록 exclusion
selector/evidence만 fixture에 둔다. plugin detail/install/connect/approval 계약은
`.codexclaw/evidence/260710_plugins_directory_probe.md`의 후속 slice로 유지한다.

## 5. response contract와 완료 판정

Chat의 “새 conversation turn + Stop 소멸 + assistant text 안정화” 계약을 Work에 그대로
적용하지 않는다 (`chatgpt-composer.mjs:184`, `chatgpt.mjs:393-403,700`). response
adapter는 명시적으로 `chat|work`로 분리한다.

```js
/** @typedef {'chat'|'work'} ResponseSurface */
/** @typedef {'running'|'complete'|'unknown'} WorkTaskStatus */

// WP1 fixture로 selector와 evidence 우선순위를 확정한다.
async function readWorkTaskState(page, { composerRoot, taskId } = {}) {
    // { surface:'work', status, taskId, taskUrl, answerText, evidence }
}
```

| Work 상태 | 반환 계약 | poll 동작 |
| --- | --- | --- |
| `running` | `Thinking` + `Stop answering` 또는 task progress evidence | deadline까지 poll, heartbeat |
| `complete` | final assistant output + Response actions + Stop 소멸 | answer artifact를 만들고 종료 |
| `unknown` | approval/failure/contradictory DOM을 포함해 관측 계약 밖 상태 | `provider.work-state-unknown` typed error로 즉시 fail closed |

초기 acknowledgement만으로 `complete`를 반환하지 않는다. task가 계속 실행되면
`running`이다. WP1은 running/complete만 라이브 확인했고 blocked/failed를 유발하지
않았다. 따라서 v1은 보지 않은 approval/failure selector를 발명하지 않는다. known
running/complete 계약에 맞지 않는 상태는 Chat fallback이나 임의 분류 없이
`unknown`/`provider.work-state-unknown`으로 fail closed한다. blocked/failed 세분화는
각 activation evidence가 생기는 후속 버전에서만 추가한다.

## 6. session 계약

`WebAiSession`을 additive하게 확장한다.

```js
{
    surface: 'chat' | 'work',
    taskId: string | null,
    taskUrl: string | null,
    responseContract: 'chat' | 'work',
}
```

기존 record는 `surface`가 없으면 `chat`으로 호환 판독한다. Work send는
`surface:'work'`, 관측 가능한 `taskId/taskUrl`, `responseContract:'work'`를 저장한다.
`findActiveSession({ vendor, targetId, conversationUrl, surface })`에 surface filter를
추가해 Chat과 Work latest session이 섞이지 않게 한다
(`web-ai/session.mjs:296`). active target에서 이어지는 Work poll/watch는 반드시
`surface:'work'`를 넘기고 Chat 경로는 `surface:'chat'`을 넘긴다. WP1에서 Work task도
`/c/<uuid>`를 사용하고 **완료된 task**가 새 탭 재진입 뒤 복원됨을 확인했다. 따라서
`extractConversationId()`가 UUID 파싱에는 재사용될 수 있지만 UUID만으로 surface를
판별하지 않는다. Work record에는 full `taskUrl`, parsed `taskId`, `surface:'work'`,
`responseContract:'work'`를 함께 저장한다.

이 증거는 실행 중 task의 탭 종료/새 target resume, watcher 연속성, 브라우저·앱·기기
종료 뒤 생존을 증명하지 않는다. 저장 session이 `running`인데 원 target이 사라졌다면
v1은 task URL로 자동 재접속하지 않고 `provider.work-reattach-unverified`로 fail closed한다.
task URL 재접속은 저장 상태가 `complete`인 결과 재조회에만 허용한다. running-task
reattach/poll은 별도 activation evidence가 생긴 뒤 연다.

CLI `work send`와 MCP `web_ai_work_send`의 결과는 최소
`{ok,status,surface:'work',sessionId,taskId,taskUrl,power,speed,responseContract:'work'}`를
공유한다. Power evidence에는 resolved model/effort를 포함하되, Fast 사용량 숫자는
포함하지 않는다.

## 7. WP1 선행 게이트

WP1은 WP0 D-close 직후, WP2 이전에 로그인된 브라우저로 수행했고 2026-07-10에
picker/submit/completion/re-entry 증거를 닫았다. **WP4 P는 아래 두 묶음과
`.codexclaw/evidence/260710_wp1_live_work_probe.md`를 읽은 뒤 B에 진입한다.**

### 7.1 `01_ui_contract_evidence.md:117-129` 5항목

1. Power 1..6 전체 label과 Model×Effort 전이, 라이브 UI 어댑터 매핑 왕복 일치.
2. Model/Effort/Speed 변경 후 checked, pill, compact view 전이.
3. Work→Chat→Work 왕복 시 선택 상태의 독립/공유 여부.
4. submit 후 streaming, Stop, assistant/task container와 poll/session 재사용 가능성.
5. Chat/Work picker 동시 mount와 hidden/open 처리 규칙.

### 7.2 역설계 추가 실측 10항목

1. Chat/Work composer 동시 mount, 각 form/textbox accessible name/send 귀속.
2. 제출 전후 URL, redirect, task/conversation ID, 새로고침 복원.
3. user turn/task card 생성 시점과 commit 성공 최소 DOM.
4. 관측된 `running|complete`, Stop과 final action DOM. approval/failure는 selector를
   추측하지 않고 `unknown` fail-closed activation gap으로 기록.
5. 초기 acknowledgement 뒤 백그라운드 실행 지속 여부.
6. 상태별 assistant selector 수/nesting과 Copy/Share 출현 시점.
7. 완료 task의 탭 종료 후 task URL 재접속. running task resume/poll은 미확인으로 분리.
8. Power `aria-valuenow|min|max|text`, Arrow/Home/End, clamp/wrap, 재오픈 지속성.
9. Power/Speed 독립성과 Advanced 변경 시 Power 역변경 규칙.
10. project/첨부가 URL/task identity/완료 DOM에 미치는 영향은 증거만 수집.

WP1 결과는 5개 기본행과 역설계 10개가 모두 **row-bounded PASS**다. R04 PASS는
자연 발생하지 않은 approval/failure selector를 주장하지 않는 조건을 포함하고, R10
PASS는 no-project/no-attachment baseline과 v1 exclusion만 증명한다. 두 비활성 영역은
각각 `provider.work-state-unknown`과 v1 schema rejection으로 fail closed한다. 완료 task
재접속 PASS는 running task resume로 일반화하지 않는다. project/첨부/plugin 실측은 v1
기능 범위를 넓히지 않는다.

## 8. 구현 순서

1. WP1 증거와 07 선행 Work fixture를 stale-check한다.
2. 02 상수를 소비해 detector, availability, Chat hard guard, composer-scoped
   `openModelMenu`를 병합한다.
3. `chatgpt-work-picker.mjs`와 Power/Speed read-mutate-verify 계약을 구현한다.
4. Work-root composer adapter와 scoped submit을 구현한다.
5. `readWorkTaskState()`와 `chat|work` response adapter를 구현한다.
6. session record와 `findActiveSession(..., surface)`를 확장한다.
7. CLI 2단 parser와 MCP strict tool을 각각 전용 Work adapter에 연결한다.
8. unit → integration → fixture regression → check-JS 순으로 검증한다.

## 9. 테스트와 완료 기준

필수 회귀:

- detector: Chat/Work/ambiguous/legacy, availability와 active 분리, detector mutation 0.
- Chat guard: active Work/ambiguous에서 model/effort 유무와 관계없이 hard-error,
  click/type/submit 0; legacy Chat 무회귀.
- composer scope: hidden/stray Work menu와 전역 send가 있어도 Chat/Work 각 active root만
  조작.
- picker: Power 1..6, invalid/out-of-range, already-selected, keyboard 전이 실패,
  post-selection mismatch, speed 미지정 mutation 0, standard/fast 전이.
- CLI: `work send` 2단 dispatch, prompt/power 필수, power 1..6, speed enum, unknown option,
  project/plugin/첨부 거부.
- MCP: `web_ai_work_send` listing/validation/dispatch, `additionalProperties:false`,
  model/effort/project/plugin/file/surface 거부.
- response: observed `running|complete`, acknowledgement 비완료, approval/failure/contradictory
  DOM은 `unknown` typed fail closed.
- session: additive old-record compatibility, Chat/Work surface filter, completed taskId/taskUrl
  reattach, running target-loss fail closed, 같은 vendor의 latest session 혼입 방지.

검증 명령은 구현 시 실제 touched test 목록으로 좁혀 먼저 실행한 뒤 아래 gate를 통과한다.

```bash
npx vitest run test/unit/web-ai-product-surfaces.test.mjs test/unit/web-ai-chatgpt-model.test.mjs test/unit/web-ai-session-store.test.mjs test/unit/web-ai-tool-schema.test.mjs test/integration/web-ai-cli-contract.test.mjs test/integration/web-ai-mcp-server.test.mjs
npm run typecheck:checkjs-dom
npm run check:module-graph
```

완료 판정:

- Chat 명령의 Work hard-error와 Work 전용 send 성공 경로가 동시에 증명된다.
- `work send`와 `web_ai_work_send`가 prompt+power(+speed, timeout) v1만 노출한다.
- Power mapping 전 행에 WP1 live evidence가 연결되고 Max/Ultra/Fast 의미가 섞이지 않는다.
- Work submit이 root-scoped이며 `readWorkTaskState()`가 observed running/complete와
  unclassified unknown을 구분한다.
- session이 `surface/taskId/taskUrl/responseContract`를 보존하고 surface filter로 재사용된다.
- focused tests와 module graph는 exit 0이다. check-JS DOM은 기존 전역 124건
  기준선을 늘리지 않고, 이 phase가 건드린 파일의 신규 진단이 0건이어야 한다.

## 10. 구현 체크리스트

- [ ] detector/availability는 04에 한 번만 정의하고 02 이관 discriminator를 흡수.
- [ ] `workSurfaceUnsupportedError`는 04에 한 번만 정의.
- [ ] Chat 명령과 `web_ai_submit_prompt`의 Work hard-error 유지.
- [ ] `work send`와 `web_ai_work_send`만 Work mutation 진입 허용.
- [x] Power 1..6 mapping 각 행의 WP1 live verification 해소.
- [ ] `chatgpt-work-picker.mjs` helper 목록 구현, Chat normalizer/전역 menu 재사용 금지.
- [ ] speed 미지정 mutation 0, Fast 사용량 배수 숫자 미노출.
- [ ] Work composer root 밖 write/read/send fallback 금지.
- [ ] `readWorkTaskState`가 `running|complete|unknown`을 구분하고 unknown은 typed fail closed.
- [ ] session additive fields와 `findActiveSession` surface filter 구현.
- [ ] v1 project/plugin/첨부/model/effort/surface 입력 거부; 후속 슬라이스로 유지.
- [x] WP1 5+10 실측 증거 작성(미유발 approval/failure, completed-only reattach,
  제외 범위 project/attachment 명시).
- [ ] WP1 증거를 소비한 07 fixture 테스트 통과.
