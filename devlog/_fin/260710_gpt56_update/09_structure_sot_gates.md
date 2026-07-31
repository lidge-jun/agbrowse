# 09 — GPT-5.6 structure SoT·semantic gate·closeout diff 준비

기준일: 2026-07-10. 이 문서는 `00_index.md`가 정한 09 슬라이스만 소유한다.
현재 유닛은 **패치 준비** 단계이므로 아래 원본은 수정하지 않는다. 다음 구현
유닛은 `00_index.md`의 fixture-first 실행 순서 SSOT에 따라 WP1 재프로브부터
08+09 및 07 최종 회귀 매트릭스까지 적용한다.

## 목차

1. 범위와 계약 기준
2. 변경 파일 지도
3. structure SoT Before/After
4. semantic doc-contract gate
5. release gate와 EN/KO 레퍼런스
6. 검증 명령
7. 01~09 유닛 closeout과 `_fin` 이동 조건

## 1. 범위와 계약 기준

### 1.1 왜 기존 green gate가 충분하지 않은가

2026-07-10 baseline에서 아래 두 명령은 모두 성공했다.

```text
$ bash structure/check-doc-drift.sh
All structure drift checks passed (144).

$ npm run gate:truth-table-fresh
[PASS] gate:truth-table-fresh — CAPABILITY_TRUTH_TABLE.md edited within 7 days OR matches code refs
truth table 4.03d old
```

그러나 같은 worktree의 현재 사용자 문서에는 `Pro Extended`,
`model-switcher-gpt-5-5-*`, Pro 예시의 `--timeout 1800`, code-mode 예시의
`--effort standard`가 남아 있다. 원인은 다음과 같이 분리된다.

- `structure/check-doc-drift.sh:28-179`는 파일 존재, command/MCP token, package
  export, 링크, phase/devlog anchor만 검사한다. provider model/effort/timeout의
  **의미**는 검사하지 않는다.
- `scripts/release-gates.mjs:27-61`의 `typecheck` gate는 위 script를 재실행할
  뿐이고, `truth-table-fresh`는 수정 시각 또는 code ref 일치만 본다.
- `.github/workflows/pages.yml:70-116`은 필수 파일, landing needle, local link,
  EN→KO pair/link를 검사하지만 provider 계약 문자열은 검사하지 않는다.
- release gate 레퍼런스도 현재 “source-of-truth drift”, count, named gate,
  claim audit만 열거한다 (`docs/dev/reference/release-gates.html:1`,
  `docs/dev/ko/reference/release-gates.html:1`).

따라서 아무 작업도 하지 않는 선택은 알려진 false-green을 유지하므로 기각한다.
새 script/package command를 만드는 선택도 기각한다. 기존
`structure/check-doc-drift.sh`는 이미 `docs:drift`, `test:release-gates`,
`gate:typecheck`, local release preflight에 연결되어 있으므로 그 owner를 확장하는
것이 최소 변경이다 (`package.json:49-73`, `scripts/release.sh:169-172`).

### 1.2 09가 고정하는 현재 계약

| 축 | 현재 계약 | 근거 |
| --- | --- | --- |
| surface | Chat `send/query/poll/watch`와 MCP `web_ai_submit_prompt`는 Work에서 hard-error를 유지한다. Work mutation의 유일한 진입점은 전용 CLI `agbrowse web-ai work send --prompt "..." --power N`과 MCP `web_ai_work_send`이며, 기존 Chat 명령/도구에 `surface=work`를 확장하지 않는다. | `00_index.md` 실행 순서 SSOT, `01_ui_contract_evidence.md:64-95,117-129`, `10_patch_interview.md:95-105,133-166` |
| family | Chat 피커의 실측 family 행은 `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3`, `o3`다. Work에서만 실측된 Terra/Luna는 Chat alias로 광고하지 않는다. | `01_ui_contract_evidence.md:45-62,85-91`, `08_docs_skill_sync.md:24-47` |
| tier/effort | `instant`는 GPT-5.5 `Instant`; `thinking`은 `medium|high|xhigh` → `Medium|High|Extra High`; `pro`는 선택 family의 flat `Pro`다. effort canonical/legacy 정규화는 02가 소유하고 09는 그 결과만 소비한다. | `02_core_contract_decisions.md:172-318`, `01_ui_contract_evidence.md:27-43,56-62`, `08_docs_skill_sync.md:26-43` |
| timeout | explicit timeout → stored session deadline remainder → tier default → vendor fallback. provider-정확 tier는 `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600`으로 독립된다. ChatGPT Pro poll deadline은 5400초(90분)이며 사용자 보고 약 40분은 DOM 미확인 UI 예산이다. | `00_index.md` 실행 순서 SSOT, `01_ui_contract_evidence.md:99-113`, `08_docs_skill_sync.md:49-71`, `10_patch_interview.md:95-105` |
| fixture | Chat/Work sanitized DOM과 contract loader/test가 GPT-5.6 selector 의미의 fixture owner다. | `07_tests_fixtures.md:49-79,119-141` |

family alias는 02가 확정한
`gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3` 다섯 값과 정확히 일치해야 한다
(`02_core_contract_decisions.md:320-451`). Terra/Luna는 Work-only이며 Chat schema/help에
노출하지 않는다. effort의 `medium|high|xhigh` canonical과
`extra-high|extra_high|"extra high"`를 포함한 legacy 정규화도 02 §2가 단독 소유한다.
09의 SoT와 semantic gate는 별도 alias map을 재정의하지 않고 그 계약을 참조한다.

### 1.3 IN / OUT

**IN**

- `structure/`의 capability/phase/command/runtime/index SoT를 GPT-5.6 계약과
  fixture owner에 연결한다.
- `check-doc-drift.sh`에 경로가 고정된 known-stale token 검사를 넣는다.
- 검사 대상에 root CLI help owner인 `skills/browser/browser.mjs`의 Web AI help 블록을
  포함해 skill/docs가 맞아도 실행 진입점 help만 낡는 false-green을 막는다.
- release checklist와 EN/KO release-gate 레퍼런스가 새 semantic 검사를 설명한다.
- 01~09 전체 적용 후 stale-token 최종 감사와 `_fin` 이동 조건을 고정한다.

**OUT**

- selector, schema, timeout, fixture production/test 코드 구현. 각각 02~07 소유다.
- SKILL/README/general docs 수정. 08 소유다.
- Pages workflow 또는 `scripts/release-gates.mjs`에 중복 gate를 신설하는 일.
- historical changelog/devlog에서 과거 UI 문자열을 지우는 일.
- 원본 SoT를 이 준비 유닛에서 선반영하는 일.

## 2. 변경 파일 지도

다음 구현 유닛의 09 슬라이스는 기존 파일 9개만 수정한다. 새 runtime/test/helper
파일이나 package script는 만들지 않는다.

| 작업 | 경로 | 책임 |
| --- | --- | --- |
| MODIFY | `structure/CAPABILITY_TRUTH_TABLE.md` | ChatGPT resolver의 GPT-5.6 Chat 계약, Work send CLI+MCP, fixture owner |
| MODIFY | `structure/phase_status.md` | Phase 17 evidence에 chatgpt-model/fixture 회귀 추가 |
| MODIFY | `structure/commands.md` | family/tier alias, canonical effort, 3-tier timeout, Work send CLI+MCP 계약 |
| MODIFY | `structure/runtime_contracts.md` | provider/evidence/Work send/devlog anchor 구체화 |
| MODIFY | `structure/INDEX.md` | provider semantic 계약 동기화 체크리스트 |
| MODIFY | `structure/check-doc-drift.sh` | known-stale token semantic gate와 명시적 예외 |
| MODIFY | `structure/release_gates.md` | release checklist/script coverage에 semantic gate 노출 |
| MODIFY | `docs/dev/reference/release-gates.html` | EN gate 설명 |
| MODIFY | `docs/dev/ko/reference/release-gates.html` | KO mirror gate 설명 |

## 3. structure SoT Before/After

### 3.1 `structure/CAPABILITY_TRUTH_TABLE.md`

#### Before (`structure/CAPABILITY_TRUTH_TABLE.md:29`)

```markdown
| ChatGPT web-AI resolver | beta | `web-ai/chatgpt.mjs`, `web-ai/chatgpt-composer.mjs`, `web-ai/chatgpt-model.mjs` | `test/unit/web-ai-chatgpt*.test.mjs`, fixture evals under `test/fixtures/provider-dom/` | `src/browser/web-ai/chatgpt.ts` — beta in cli-jaw. |
```

#### After

```markdown
| ChatGPT web-AI resolver | beta | `web-ai/chatgpt.mjs`, `web-ai/chatgpt-composer.mjs`, `web-ai/chatgpt-model.mjs`, `web-ai/product-surfaces.mjs`; GPT-5.6 Chat uses a separate family axis plus `Instant (5.5) / Medium / High / Extra High / Pro` tiers; Work mutation is available only through CLI `web-ai work send --prompt ... --power N` and MCP `web_ai_work_send`, while Chat commands/tools reject Work | `test/unit/web-ai-chatgpt-model.test.mjs`, `test/unit/web-ai-product-surfaces.test.mjs`, `test/unit/web-ai-provider-dom-contract.test.mjs`; fixture owners: `test/fixtures/provider-dom/chatgpt-gpt56-chat.html`, `test/fixtures/provider-dom/chatgpt-gpt56-work.html`, `test/fixtures/provider-dom/chatgpt-gpt56-eval.json` | `src/browser/web-ai/chatgpt.ts` — beta in cli-jaw; GPT-5.6 contract parity must be re-audited before a mirror-ready claim. |
```

상태는 `beta`를 유지한다. live provider UI/account/plan 의존성이 사라진 것이 아니며
fixture green만으로 `ready` 승격을 하지 않는다 (`CAPABILITY_TRUTH_TABLE.md:15-23`,
`release_gates.md:17-33`).

### 3.2 `structure/phase_status.md`

#### Before (`structure/phase_status.md:20`)

```markdown
| 17 provider contracts/source audit | ready in agbrowse | `web-ai/answer-artifact.mjs`, `web-ai/source-audit.mjs`, `web-ai/chatgpt-response-dom.mjs` | Keep streaming finality and nested DOM fragment tests green before claiming provider-ready behavior |
```

#### After

```markdown
| 17 provider contracts/source audit | ready in agbrowse | `web-ai/answer-artifact.mjs`, `web-ai/source-audit.mjs`, `web-ai/chatgpt-response-dom.mjs`; GPT-5.6 Chat/Work model fixtures: `test/fixtures/provider-dom/chatgpt-gpt56-chat.html`, `test/fixtures/provider-dom/chatgpt-gpt56-work.html` | Keep streaming finality, nested DOM fragments, `test/unit/web-ai-chatgpt-model.test.mjs`, and `test/unit/web-ai-provider-dom-contract.test.mjs` green before claiming provider-ready ChatGPT behavior; Work mutation must remain isolated to `work send`/`web_ai_work_send` |
```

Phase status는 fixture 파일만 나열하지 않고 이를 실제로 소비하는 chatgpt-model 및
fixture-contract test owner를 함께 적는다. 그래야 fixture가 존재하지만 resolver가
옛 inline fake만 쓰는 false-green을 막을 수 있다 (`07_tests_fixtures.md:81-141`).

### 3.3 `structure/commands.md` — alias/effort/timeout

#### Before (`structure/commands.md:178-184`)

```markdown
## Provider Alias

| Provider | Model alias | 비고 |
| --- | --- | --- |
| ChatGPT | `instant`, `thinking`, `pro` | `--effort`는 `--model`과 함께 사용 |
| Gemini | `fast`, `thinking`, `pro`, `deepthink` | `deepthink`는 tool alias로 취급 |
| Grok | `auto`, `fast`, `expert`, `thinking`, `heavy` | source-audit 연구 흐름은 `expert`나 `heavy`를 우선 사용 |
```

#### After

```markdown
## Provider Alias

| Provider | Model/tier alias | Family/effort 계약 |
| --- | --- | --- |
| ChatGPT | tier `instant`, `thinking`, `pro`; Chat family `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3`, `o3`; Work command `web-ai work send --prompt ... --power N`; MCP `web_ai_work_send` | `instant`는 GPT-5.5에 고정된다. `thinking`의 canonical effort는 `medium`, `high`, `xhigh`이고 legacy `light|low|standard|normal|regular|default → medium`, `extended → high`, `heavy|extra-high|extra_high|extra high → xhigh`를 mutation 전에 정규화한다. `pro`는 flat `Pro`이며 새 호출은 effort를 생략한다. Work-only Model/Effort/Speed는 WP1 재프로브로 확정한 `--power N` 매핑을 전용 Work 진입점에서만 조작한다. |
| Gemini | `fast`, `thinking`, `pro`, `deepthink` | `deepthink`는 tool alias로 취급 |
| Grok | `auto`, `fast`, `expert`, `thinking`, `heavy` | source-audit 연구 흐름은 `expert`나 `heavy`를 우선 사용 |

ChatGPT Pro의 약 40분 추론 예산은 사용자 보고의 UI-side 값이며 2026-07-10
DOM에서는 확인되지 않았다. agbrowse poll deadline은 provider-정확 tier별로
`chatgpt-pro=5400`(90분), `grok-heavy=3600`, `deep-research=3600`이다. timeout
우선순위는 explicit timeout → stored session deadline remainder → tier default →
vendor fallback이며, 새 Pro 예시에 `--timeout 1800`이나 2400초 상수를 넣지 않는다.
```

`gpt-5.3`을 `instant`의 동의어로 계속 두지 않는다. 현재 실측에서 `GPT-5.3`은
family submenu의 독립 행이다 (`01_ui_contract_evidence.md:45-62`,
`08_docs_skill_sync.md:45-47`).
family와 effort의 canonical/legacy 정규화 owner는 02 §2~3이며, 이 SoT 행은
`gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3`와 그 정규화 결과를 문서 표면에 반영하는
consumer다.

#### Before (`structure/commands.md:232-238`)

```markdown
`web_ai_*` 입력은 strict schema로 검증한다. Runtime에서 쓰는 호환 alias
(`vendor`, `policy`, submit의 `filePath`/`reasoningEffort` 등)만 명시적으로
허용하고, 오탈자/미등록 top-level field는 command 실행 전에 fail-fast한다.
Submit MCP는 `maxUploadFileSize`만 live upload cap으로 허용한다. Generated
image output, Deep Research, batch follow-ups, archive mutation, Project
Sources, context package fields는 이 release에서 CLI-only/deferred이며 MCP
tool description에도 그 제한을 명시한다.
```

#### After

```markdown
`web_ai_*` 입력은 strict schema로 검증한다. Runtime에서 쓰는 호환 alias
(`vendor`, `policy`, submit의 `filePath`/`reasoningEffort` 등)만 명시적으로
허용하고, 오탈자/미등록 top-level field는 command 실행 전에 fail-fast한다.
ChatGPT `send/query/poll/watch`와 MCP `web_ai_submit_prompt`는 Chat surface, 별도
family, tier alias `instant|thinking|pro`, canonical thinking effort
`medium|high|xhigh`와 문서화된 legacy remap만 받으며 Work에서는 hard-error한다.
Work mutation은 CLI `agbrowse web-ai work send --prompt "..." --power N`과 MCP
`web_ai_work_send`만 받는다. 기존 Chat 명령/도구에 `surface=work`를 추가하지 않는다.
Submit MCP는 `maxUploadFileSize`만 live upload cap으로 허용한다. Generated
image output, Deep Research, batch follow-ups, archive mutation, Project
Sources, context package fields는 이 release에서 CLI-only/deferred이며 MCP
tool description에도 그 제한을 명시한다.

MCP timeout도 explicit timeout → stored session deadline remainder → tier default
순서를 공유한다. tier default는 `chatgpt-pro=5400`, `grok-heavy=3600`,
`deep-research=3600`을 독립 적용하며, 사용자 보고 약 40분 UI 예산을 MCP timeout
기본값으로 변환하지 않는다.
```

### 3.4 `structure/runtime_contracts.md`

#### Before (`structure/runtime_contracts.md:59-67`)

```markdown
## Provider Runtime

| Provider | Ready surface | Beta surface | Fail-closed 조건 |
| --- | --- | --- | --- |
| ChatGPT | render, session store, fixture eval, model alias contract, model selection evidence | live send/poll/query/upload/copy/generated image/project sources | composer/send/upload/copy resolver validation, provider DOM drift, account/plan state |
| Gemini | render, model alias contract, Deep Think gate, fixture eval | live send/poll/query/upload | mode picker, upload evidence, completion signal 미확인 |
| Grok | render, source-discipline prompt, fixture eval | live send/poll/query/source-audit | context pack hard gate, source quality 미달, copy evidence 미확인 |
```

#### After

```markdown
## Provider Runtime

| Provider | Ready surface | Beta surface | Fail-closed 조건 |
| --- | --- | --- | --- |
| ChatGPT | render, session store, GPT-5.6 Chat/Work fixture eval, Chat family+tier alias contract, `medium|high|xhigh` thinking effort, model selection evidence, Work CLI/MCP의 strict command/schema/guard 계약(`web-ai work send --prompt ... --power N`, `web_ai_work_send`), timeout resolution `explicit → stored deadline remainder → tier default → vendor fallback` (`chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600`) | live Chat send/poll/query/upload/copy/generated image/project sources와 Work picker/submit/task poll/session resume mutation; 인증된 Work smoke 전까지 Beta. 약 40분 Pro UI 예산은 사용자 보고/DOM 미확인이며 90분(5400s) agbrowse deadline과 별개 | Chat 명령/`web_ai_submit_prompt`의 Work hard-error, active surface와 composer-scoped picker 검증, family/tier checked-state 불일치, provider DOM drift, account/plan state |
| Gemini | render, model alias contract, Deep Think gate, fixture eval | live send/poll/query/upload | mode picker, upload evidence, completion signal 미확인 |
| Grok | render, source-discipline prompt, fixture eval | live send/poll/query/source-audit | context pack hard gate, source quality 미달, copy evidence 미확인 |
```

#### Before (`structure/runtime_contracts.md:88`)

```markdown
| Model selection evidence | ChatGPT `send/query` stores `modelSelection` on the session, and `sessions show` prints the requested/resolved model evidence |
```

#### After

```markdown
| Model selection evidence | ChatGPT `send/query` stores `modelSelection.requestedModel`, `resolvedLabel`, `normalizedModel`, `surface`, `familyLabel`, `tierLabel`, `strategy`, `status`, and `verified`; `sessions show` prints requested/resolved plus surface/family/tier while legacy sessions fall back to `resolvedLabel` without throwing |
```

#### Before (`structure/runtime_contracts.md:130`)

```markdown
| ChatGPT reasoning effort resilience | `devlog/_fin/mvp/07_semantic_resolver/36_chatgpt_reasoning_effort_resilience.md` |
```

#### After

```markdown
| ChatGPT reasoning effort resilience (legacy selector baseline) | `devlog/_fin/mvp/07_semantic_resolver/36_chatgpt_reasoning_effort_resilience.md` |
| ChatGPT GPT-5.6 Chat family/tier/effort contract, Work send CLI+MCP, and Chat/Work guard | `devlog/_fin/260710_gpt56_update/02_core_contract_decisions.md`, `devlog/_fin/260710_gpt56_update/03_chat_picker_selector_patch.md`, `devlog/_fin/260710_gpt56_update/04_work_surface_support.md`, `devlog/_fin/260710_gpt56_update/07_tests_fixtures.md` |
```

새 anchor는 실제 closeout에서 폴더가 `_fin`으로 이동하는 것을 전제로 한다. 이동 전
중간 commit에서 링크가 잠시 존재하지 않는 상태를 release-ready로 주장하지 않는다.

### 3.5 `structure/INDEX.md` 동기화 체크리스트

#### Before (`structure/INDEX.md:68-79`)

```markdown
## 동기화 체크리스트

- [ ] `skills/browser/browser.mjs`의 command help 또는 parser가 바뀌면 [commands.md](commands.md)를 갱신한다.
- [ ] `agbrowse runway` selector/status/preflight/poll 계약이 바뀌면 [commands.md](commands.md), [runtime_contracts.md](runtime_contracts.md), `skills/browser/SKILL.md`를 같이 갱신한다.
- [ ] `web-ai/cli.mjs`의 command, provider flag, session behavior가 바뀌면 [commands.md](commands.md)와 [str_func.md](str_func.md)를 갱신한다.
- [ ] MCP tool schema가 바뀌면 [str_func.md](str_func.md)와 [release_gates.md](release_gates.md)를 갱신한다.
- [ ] live smoke, provider DOM drift, session recovery, model evidence 같은 실제 작동 취약점이 발견되면 [stability-upgrade/](stability-upgrade/00_index.md)에 상태와 검증 방법을 남긴다.
- [ ] release script, workflow, package `files` 목록이 바뀌면 [release_gates.md](release_gates.md)를 갱신한다.
- [ ] public support label이 바뀌면 `README.md`, [phase_status.md](phase_status.md), [release_gates.md](release_gates.md), 관련 `devlog/` phase 문서를 같이 갱신한다.
- [ ] benchmark 또는 comparison claim이 바뀌면 `docs/benchmarks.md`, `docs/comparison.md`, `docs/production-readiness.md`를 같이 갱신한다.
- [ ] GitHub Pages developer docs가 바뀌면 `docs/dev/`, `docs/dev/ko/`, `.github/workflows/pages.yml`, README의 Pages 링크를 같이 갱신한다.
```

#### After

`web-ai/cli.mjs` 항목 바로 다음에 아래 한 항목을 추가하고 나머지는 유지한다.

```markdown
- [ ] ChatGPT surface/family/tier/effort/timeout, Work CLI `web-ai work send`, MCP `web_ai_work_send`, 또는 provider DOM fixture 계약이 바뀌면 [CAPABILITY_TRUTH_TABLE.md](CAPABILITY_TRUTH_TABLE.md), [phase_status.md](phase_status.md), [commands.md](commands.md), [runtime_contracts.md](runtime_contracts.md), `skills/browser/browser.mjs` root help, `skills/web-ai/SKILL.md`, `README.md`, `docs/dev/` EN/KO 쌍을 같이 갱신하고 [check-doc-drift.sh](check-doc-drift.sh)의 stale-token/예외 목록을 재검토한다.
```

이 checklist가 stale-token 목록의 유지 owner다. provider UI가 또 바뀌면 문자열을
무작정 누적하지 않고, 새 current contract와 historical allowlist를 함께 재검토한다.

## 4. semantic doc-contract gate

### 4.1 설계 규칙

1. 새 package command를 추가하지 않는다. `check-doc-drift.sh` 내부 검사이므로
   `npm run docs:drift`, `test:release-gates`, `gate:typecheck`, release preflight가
   자동으로 같은 계약을 소비한다.
2. current guide/reference뿐 아니라 root CLI 진입점인
   `skills/browser/browser.mjs` Web AI help도 scan한다. `--family`, canonical effort,
   `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600` 세 tier가 각각
   독립된 positive token으로 skill 문서와 drift하지 않아야 한다.
3. `devlog/`와 `docs/dev/{,ko/}changelog.html`은 역사 기록이므로 scan 대상에서
   제외한다. current guide/reference/code example만 검사한다.
4. stale token은 전역 금지가 아니다. `Pro Extended` 계열과 옛 testid는 정확한
   `Legacy UI (before 2026-07-10)` 문맥에서만 허용한다.
5. `--effort standard`는 legacy/compatibility 입력 설명에서만 허용하고 현재 실행
   예시에서는 실패한다.
6. `--timeout 1800`은 앞선 command block에 `--research deep`가 있는 SKILL/README
   Deep Research 예시 두 곳에서만 허용한다. Pro/Deep Think 일반 권고나 Pro poll
   예시에서는 실패한다.
7. stale occurrence 오류는 `file:line`과 token을, required current token 누락은
   file과 missing token을 출력한다. 한 파일의 모든 위반을 모아 한 번에 고칠 수
   있게 하고 첫 위반에서 process를 종료하지 않는다.
8. root help는 stale token 부재만으로 통과시키지 않는다. `--surface <chat>`,
   `--family <alias>`, 다섯 family 중 첫 canonical 값, canonical effort, tier timeout
   marker를 positive token으로도 요구한다.

### 4.2 `structure/check-doc-drift.sh` Before

현재 script는 문서를 읽은 뒤 command/token/link 검사를 바로 시작한다
(`structure/check-doc-drift.sh:50-60,92-179`). semantic 문서 집합, stale token,
허용 문맥 함수가 없다.

```js
const commandsDoc = read('structure/commands.md');
const runtimeDoc = read('structure/runtime_contracts.md');
const releaseDoc = read('structure/release_gates.md');
const phaseStatusDoc = read('structure/phase_status.md');
const indexDoc = read('structure/INDEX.md');
const readme = read('README.md');
const productionDoc = read('docs/production-readiness.md');
const comparisonDoc = read('docs/comparison.md');
const benchmarksDoc = read('docs/benchmarks.md');
const pkg = JSON.parse(read('package.json'));
```

### 4.3 `structure/check-doc-drift.sh` After

위 read block과 `rootCommands` 선언 사이에 아래 전문을 삽입한다.

```js
const semanticContractFiles = [
  'structure/CAPABILITY_TRUTH_TABLE.md',
  'structure/phase_status.md',
  'structure/commands.md',
  'structure/runtime_contracts.md',
  'structure/release_gates.md',
  'skills/browser/browser.mjs',
  'skills/web-ai/SKILL.md',
  'README.md',
  'docs/index.html',
  'docs/dev/index.html',
  'docs/dev/quickstart.html',
  'docs/dev/guides/web-ai.html',
  'docs/dev/guides/code-mode.html',
  'docs/dev/reference/cli.html',
  'docs/dev/reference/release-gates.html',
  'docs/dev/ko/index.html',
  'docs/dev/ko/quickstart.html',
  'docs/dev/ko/guides/web-ai.html',
  'docs/dev/ko/guides/code-mode.html',
  'docs/dev/ko/reference/cli.html',
  'docs/dev/ko/reference/release-gates.html',
];

const staleChatGptDocTokens = [
  'Pro Extended',
  'Pro Standard',
  'Pro 확장',
  'model-switcher-gpt-5-5',
  'model-switcher-dropdown-button',
  'composer-intelligence-pro-thinking-effort-trigger',
  'Pro: standard/extended',
  'Thinking: light/standard/extended/heavy',
  '--effort light',
  '--effort standard',
  '--effort extended',
  '--effort heavy',
  '--timeout 1800',
];

const requiredSemanticTokensByFile = new Map([
  ['skills/browser/browser.mjs', [
    '--surface <chat>',
    '--family <alias>',
    'gpt-5.6-sol',
    'Thinking canonical: medium/high/xhigh',
    'chatgpt-pro=5400',
    'grok-heavy=3600',
    'deep-research=3600',
  ]],
]);

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function lineAt(source, offset) {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  const end = source.indexOf('\n', offset);
  return source.slice(start, end === -1 ? source.length : end);
}

function isLegacyUiOccurrence(file, source, offset) {
  const marker = 'Legacy UI (before 2026-07-10)';
  if (file === 'README.md') return lineAt(source, offset).includes(marker);
  if (file !== 'skills/web-ai/SKILL.md') return false;

  const start = source.lastIndexOf(`### ${marker}`, offset);
  if (start === -1) return false;
  const ends = [
    source.indexOf('\nGemini:', start),
    source.indexOf('\n## ', start + marker.length),
  ].filter(candidate => candidate !== -1);
  const end = ends.length > 0 ? Math.min(...ends) : source.length;
  return offset < end;
}

function isAllowedStaleOccurrence(file, token, source, offset) {
  if (token === '--timeout 1800') {
    if (file !== 'skills/web-ai/SKILL.md' && file !== 'README.md') return false;
    return source.slice(Math.max(0, offset - 240), offset).includes('--research deep');
  }
  if (token.startsWith('--effort ')) {
    return /(?:Legacy|legacy|compatibility)/.test(lineAt(source, offset));
  }
  return isLegacyUiOccurrence(file, source, offset);
}

for (const file of semanticContractFiles) {
  const source = read(file);
  const violations = [];
  for (const token of staleChatGptDocTokens) {
    let offset = source.indexOf(token);
    while (offset !== -1) {
      if (!isAllowedStaleOccurrence(file, token, source, offset)) {
        violations.push(`${JSON.stringify(token)} at line ${lineNumberAt(source, offset)}`);
      }
      offset = source.indexOf(token, offset + token.length);
    }
  }
  for (const token of requiredSemanticTokensByFile.get(file) || []) {
    if (!source.includes(token)) {
      violations.push(`missing required current token ${JSON.stringify(token)}`);
    }
  }
  if (violations.length > 0) {
    fail(`${file} has ChatGPT semantic doc-contract violations: ${violations.join(', ')}`);
  } else {
    pass(`${file} has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens`);
  }
}
```

`staleChatGptDocTokens`는 정확히 알려진 2026-07-10 drift만 소유한다. `Extended`
단독이나 `20 minutes`를 금지하지 않는다. 전자는 Gemini/legacy input에서 의미가 있을
수 있고, 후자는 tier 미확인 ChatGPT vendor fallback 1200초의 설명으로 계속 유효하다
(`08_docs_skill_sync.md:131-175,340-378`). 대신 잘못된 Pro 일반 권고를 만드는
`--timeout 1800`과 옛 ChatGPT selector/label 조합을 문맥까지 포함해 차단한다.
`skills/browser/browser.mjs`는 legacy 예외 owner가 아니므로 Web AI root help의 stale
effort/timeout token은 예외 없이 실패한다.

### 4.4 gate acceptance matrix

| 입력 문맥 | 기대 |
| --- | --- |
| current Pro/selector/quickstart/code-mode에 `Pro Extended`, 옛 picker testid, `--effort light|standard|extended|heavy`, `--timeout 1800` | FAIL + `file:line` |
| `skills/browser/browser.mjs` Web AI help에 구 effort 목록/Pro `--timeout 1800`이 있거나 `--surface`/`--family`/canonical effort/tier timeout marker가 없음 | FAIL + `file:line` 또는 missing token; 08의 root-help After와 정합 후 PASS |
| `skills/web-ai/SKILL.md`의 `### Legacy UI (before 2026-07-10)` | old label/testid PASS |
| README의 같은 marker를 가진 단일 legacy line | old label/testid PASS |
| `Legacy ... pro --effort standard|extended` 또는 `compatibility only`인 한 줄 | alias 설명 PASS |
| SKILL/README에서 앞 240자 안에 `--research deep`가 있는 `--timeout 1800` | Deep Research PASS |
| changelog/devlog의 역사 기록 | scan 밖 PASS |
| Work 전용 Terra/Luna를 current Chat alias로 광고 | stale-token gate만으로는 판별 불가; 02 schema test + 08 EN/KO assertion + §3 SoT 수동 audit가 owner |

마지막 행 때문에 이 gate를 “모든 semantic drift의 완전한 parser”로 과장하지 않는다.
known-stale denylist를 자동화하고, positive schema/fixture 계약은 02/07 test가 맡는다.

## 5. release gate와 EN/KO 레퍼런스

### 5.1 `structure/release_gates.md`

#### Before (`structure/release_gates.md:35-41`)

```markdown
## Release Checklist

- [ ] `git diff --check`
- [ ] `bash structure/check-doc-drift.sh`
- [ ] `bash structure/verify-counts.sh`
- [ ] GitHub Pages validation (`.github/workflows/pages.yml`) for `docs/dev/` EN/KO entrypoints, local links, language pairs, and landing quickstart order
- [ ] `npm run test:unit`
```

#### After

```diff
 - [ ] `git diff --check`
 - [ ] `bash structure/check-doc-drift.sh`
+- [ ] `check-doc-drift.sh` semantic doc-contract result: no unallowlisted stale ChatGPT model/effort/timeout token; only the explicit legacy UI and Deep Research exceptions remain
 - [ ] `bash structure/verify-counts.sh`
```

#### Before (`structure/release_gates.md:70`)

```markdown
| `npm run test:release-gates` | structure drift + count checks | Phase status, command, release claim drift 차단 |
```

#### After

```markdown
| `npm run test:release-gates` | structure drift + ChatGPT semantic doc-contract stale-token + count checks | Phase status, command, model/effort/timeout, release claim drift 차단 |
```

### 5.2 English (`docs/dev/reference/release-gates.html:1`)

#### Before

```html
<h2>What it covers</h2><ul><li>Source-of-truth drift checks in <code>structure/check-doc-drift.sh</code>.</li><li>Line and file count checks in <code>structure/verify-counts.sh</code>.</li><li>Named release gates from <code>scripts/release-gates.mjs</code>.</li><li>Claim audit for hosted/cloud/stealth wording.</li></ul>
```

#### After

```html
<h2>What it covers</h2><ul><li>Source-of-truth drift checks in <code>structure/check-doc-drift.sh</code>.</li><li>Known-stale ChatGPT model, effort, and timeout contract tokens outside the explicitly scoped legacy UI and Deep Research exceptions.</li><li>Line and file count checks in <code>structure/verify-counts.sh</code>.</li><li>Named release gates from <code>scripts/release-gates.mjs</code>.</li><li>Claim audit for hosted/cloud/stealth wording.</li></ul>
```

### 5.3 한국어 (`docs/dev/ko/reference/release-gates.html:1`)

#### Before

```html
<h2>검사 범위</h2><ul><li><code>structure/check-doc-drift.sh</code>의 source-of-truth drift.</li><li><code>structure/verify-counts.sh</code>의 파일 수/라인 수.</li><li><code>scripts/release-gates.mjs</code>의 named gate.</li><li>Hosted/cloud/stealth claim audit.</li></ul>
```

#### After

```html
<h2>검사 범위</h2><ul><li><code>structure/check-doc-drift.sh</code>의 source-of-truth drift.</li><li>명시된 legacy UI와 Deep Research 예외 밖에 남은 ChatGPT model, effort, timeout 구식 계약 token.</li><li><code>structure/verify-counts.sh</code>의 파일 수/라인 수.</li><li><code>scripts/release-gates.mjs</code>의 named gate.</li><li>Hosted/cloud/stealth claim audit.</li></ul>
```

두 HTML 파일은 1줄짜리 수동 문서다. 필요한 `<li>` substring만 삽입하고 formatter로
전체 파일을 재개행하지 않는다. EN↔KO 링크와 기존 shell/footer는 그대로 둔다
(`docs/dev/reference/release-gates.html:1`,
`docs/dev/ko/reference/release-gates.html:1`).

## 6. 검증 명령

### 6.1 09 적용 직후

```bash
git diff --check -- \
  structure/CAPABILITY_TRUTH_TABLE.md \
  structure/phase_status.md \
  structure/commands.md \
  structure/runtime_contracts.md \
  structure/INDEX.md \
  structure/check-doc-drift.sh \
  structure/release_gates.md \
  docs/dev/reference/release-gates.html \
  docs/dev/ko/reference/release-gates.html

bash -n structure/check-doc-drift.sh
npm run docs:drift
npm run test:release-gates
npm run gate:typecheck
```

기대 결과:

- `docs:drift`는 기존 144개 검사에 semantic 대상 파일별 PASS가 추가되어 exit 0이다.
- stale 실패는 token과 실제 `file:line`을 함께 출력한다.
- `test:release-gates`는 같은 semantic gate와 count verifier를 모두 통과한다.
- `gate:typecheck`는 별도 구현 없이 동일 `check-doc-drift.sh`를 재사용한다.

### 6.2 SoT/EN-KO 정적 확인

```bash
rg -n -- 'GPT-5\.6|chatgpt-gpt56-(chat|work)|medium\|high\|xhigh|chatgpt-pro=5400|grok-heavy=3600|deep-research=3600|familyLabel|tierLabel|semantic doc-contract|web-ai work send|web_ai_work_send' \
  structure/CAPABILITY_TRUTH_TABLE.md \
  structure/phase_status.md \
  structure/commands.md \
  structure/runtime_contracts.md \
  structure/INDEX.md \
  structure/release_gates.md \
  skills/browser/browser.mjs \
  docs/dev/reference/release-gates.html \
  docs/dev/ko/reference/release-gates.html

node --input-type=module <<'NODE'
import fs from 'node:fs';
const pairs = [[
  'docs/dev/reference/release-gates.html',
  'docs/dev/ko/reference/release-gates.html',
]];
for (const [enPath, koPath] of pairs) {
  const en = fs.readFileSync(enPath, 'utf8');
  const ko = fs.readFileSync(koPath, 'utf8');
  for (const needle of ['model', 'effort', 'timeout', 'Deep Research']) {
    if (!en.includes(needle) || !ko.includes(needle)) throw new Error(`${needle}: EN/KO mismatch`);
  }
  if (!en.includes('../ko/reference/release-gates.html')) throw new Error('EN missing KO link');
  if (!ko.includes('../../reference/release-gates.html')) throw new Error('KO missing EN link');
}
console.log('PASS release-gates EN/KO semantic contract mirror');
NODE
```

## 7. 01~09 유닛 closeout과 `_fin` 이동 조건

### 7.1 실행 순서

closeout은 문서 작성 완료가 아니라 **WP1 재프로브 증거를 바탕으로 02~09 diff가
실제 소스/테스트/문서에 모두 적용된 상태**를 뜻한다. 아래 표는 요약이며 실행 순서의
SSOT는 `00_index.md`다. 각 work-phase P에서 해당 문서의 Before anchor를 다시 확인한다.

```text
WP1 live reprobe → 01 §5.1 evidence + Power↔Model×Effort mapping
→ 07 fixture definition + 02 core schema/alias/evidence
→ 03 Chat selector
→ 04 Work detect/guard + work send CLI/MCP
→ 05 timeout inheritance
→ 06 diagnostics/integration
→ 08 public docs EN/KO + 09 structure SoT/semantic gate
→ 07 final regression matrix
```

fixture 정의와 02 중 한쪽이라도 미완이면 03으로 진행하지 않고, WP1 재프로브의
Power↔Model×Effort 매핑이 없으면 04 B-phase로 진행하지 않는다. 08+09와 07 최종
회귀 매트릭스 중 하나라도 미완이면 09 문서가 존재해도 closeout하지 않는다.

### 7.2 stale-token 최종 `rg`

01~09 구현과 모든 formatter/수정이 끝난 **마지막 상태**에서 실행한다.

```bash
rg -n \
  --glob '!devlog/**' \
  --glob '!docs/dev/changelog.html' \
  --glob '!docs/dev/ko/changelog.html' \
  -- 'Pro Extended|Pro Standard|Pro 확장|model-switcher-gpt-5-5|model-switcher-dropdown-button|composer-intelligence-pro-thinking-effort-trigger|--effort (light|standard|extended|heavy)|--timeout 1800' \
  structure skills/browser/browser.mjs skills/web-ai/SKILL.md README.md docs/index.html docs/dev
```

허용 출력은 아래 문맥뿐이다.

1. `skills/web-ai/SKILL.md`의 정확한 `### Legacy UI (before 2026-07-10)` 블록.
2. README의 `Legacy UI (before 2026-07-10)` 한 줄.
3. legacy/compatibility alias를 설명하는 effort 행(현재 계획에서는
   `pro --effort standard|extended`).
4. SKILL/README의 `--research deep` command block 안 `--timeout 1800` 각 1건.

그 밖의 match가 한 건이라도 있으면 `_fin` 이동을 중단한다. 수동 `rg` 검토 뒤
`npm run docs:drift`를 다시 실행해 같은 allowlist가 machine gate에서도 green인지
확인한다.

### 7.3 `_fin` 이동 전 필수 조건

- [ ] 02~09가 선언한 production/test/docs diff가 모두 적용됐고 placeholder/TODO-only
  patch가 없다.
- [ ] 02~07 각 owner의 focused test와 07 최종 회귀 matrix가 모두 통과했다.
- [ ] 08의 EN/KO 6쌍 assertion과 HTML smoke가 통과했다.
- [ ] §6의 09 gate와 §7.2 최종 stale-token 감사가 통과했다.
- [ ] `skills/browser/browser.mjs` Web AI root help가 family/canonical effort를 노출하고
  Pro poll 예시에 `--timeout 1800`을 남기지 않았다.
- [ ] WP7 검증 직전에 `npm ci`를 다시 실행해 lockfile 의존성과 Vitest 3.2.6을
  복원하고 exit 0을 기록했다.
- [ ] `git diff --check`, `npm run typecheck`, `npm run test:unit`,
  `npm run test:integration`, `npm run test:eval`, `npm run test:mcp`,
  `npm run test:release-gates`, `npm run gate:all`이 fresh run에서 exit 0이다.
- [ ] checkjs는 위 두 명령에 포함되지 않으므로 `npm run typecheck:checkjs`와
  `npm run typecheck:checkjs-dom`을 별도로 실행한다. 기존 전역 기준선 24/124건을
  늘리지 않고 이 유닛 touched files 신규 진단 0건인지 분리 판정하며, 기준선 외
  실패는 허용하지 않는다.
- [ ] full release gate로 `npm run test:contract-drift`,
  `npm run check:strict-baseline`, `npm run check:module-graph`, `npm run smoke:bins`,
  `npm run pack:dry`, `.github/workflows/pages.yml`의 Pages validation을 모두 실행해
  exit 0과 결과를 기록했다.
- [ ] CAPABILITY/commands/runtime SoT가 Work mutation의 유일한 진입점을 CLI
  `web-ai work send`와 MCP `web_ai_work_send`로 고정하고 Chat 명령/도구의 Work
  hard-error를 유지하며, ChatGPT live resolver를 fixture만으로 `ready` 승격하지 않았다.
- [ ] 다른 워커의 unrelated 변경을 reset/checkout/format하지 않았고, 이 유닛의
  실제 diff가 01~09 계획 범위와 대조 완료됐다.

full release gate의 명시적 실행 묶음은 다음과 같다. Pages는 workflow의 validation
block 자체를 로컬에서 실행해 required files, landing needle, local links, EN/KO pair를
검사한다.

```bash
npm run test:contract-drift
npm run check:strict-baseline
npm run check:module-graph
npm run smoke:bins
npm run pack:dry
sed -n '32,119p' .github/workflows/pages.yml | sed 's/^          //' | bash
```

이 goal의 경계는 dirty dev 브랜치에서 변경을 논리 단위로 stage/commit하는 데까지다.
`npm publish`(dry-run이 아닌 실제 publish)와 `main` 머지는 범위 밖이며 별도 승인과
clean-main release 절차 없이는 실행하지 않는다.

모든 항목이 충족된 뒤에만 다음을 실행한다.

```bash
git add devlog/_plan/260710_gpt56_update
git mv \
  devlog/_plan/260710_gpt56_update \
  devlog/_fin/260710_gpt56_update
```

이동 후 `runtime_contracts.md`의 새 `_fin/260710_gpt56_update/...` anchor와 상위
`devlog/00_index.md`의 완료 상태를 최종 확인하고, 다시 `git diff --check`와
`npm run test:release-gates`를 실행한다. 어떤 필수 gate가 실패하거나 01~09 중
한 슬라이스가 부분 적용이면 폴더는 `_plan`에 남긴다.
