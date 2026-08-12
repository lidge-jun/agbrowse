# 08 — GPT-5.6 문서·skill 동기화 diff 준비

기준일: 2026-07-10. 이 문서는 02의 Chat 입력 계약과 05의 timeout 상속 계약을
사용자에게 보이는 문서 표면에 옮기는 **패치 준비 문서**다. 이 유닛에서는 아래
문서 원본을 수정하지 않는다. 다음 구현 유닛이 이 문서의 Before/After를 그대로
적용한다 (`00_index.md:6-7,32,35,38-45`).

## 목차

1. 계약 고정문과 범위
2. 변경 파일 지도
3. `skills/web-ai/SKILL.md`
4. `README.md`
5. `docs/index.html`
6. `docs/dev/` EN/KO 수동 HTML 쌍
7. changelog 신설 항목
8. 레거시 격리와 문구 금지선
9. 검증 명령과 완료 조건

## 1. 계약 고정문과 범위

### 1.1 현재 Chat 계약

문서가 설명할 현재 계약은 다음과 같다.

| 축 | 현재 계약 | 근거 |
| --- | --- | --- |
| surface | Chat 명령(`send/query/poll/watch`)과 MCP `web_ai_submit_prompt`는 Work에서 계속 hard-error한다. Work mutation의 유일한 진입점은 `agbrowse web-ai work send --prompt "..." --power N`과 MCP `web_ai_work_send`이며 기존 Chat 도구에 `surface=work`를 추가하지 않는다. | 캐논 2, `10_patch_interview.md:97-108,112-135` |
| family | Chat family alias는 `--family gpt-5.6-sol`, `--family gpt-5.5`, `--family gpt-5.4`, `--family gpt-5.3`, `--family o3`의 다섯 값이다. `--model`은 tier 전용이며, `--family`를 생략하면 family submenu mutation은 0회이고 현재 UI 선택을 존중한다. `gpt-5.6-terra`와 `gpt-5.6-luna`는 Work 전용 실측값이므로 Chat 입력으로 받지 않는다. | 캐논 13, `02_core_contract_decisions.md:319-340,386-419,561-563` |
| instant | `instant`/`fast`는 `Instant`를 선택하며 `Instant`는 GPT-5.5에 고정된다. | `01_ui_contract_evidence.md:27-36,58-62` |
| thinking | 현재 정식 effort는 `medium`, `high`, `xhigh`이며 각각 UI의 `Medium`, `High`, `Extra High`를 선택한다. effort 생략 시 `medium`이다. | `02_core_contract_decisions.md:47-64,178-318` |
| pro | `pro`는 선택된 family의 flat `Pro` 행을 고른다. 현재 UI에는 Pro effort submenu가 없으므로 새 예시에서 `--effort`를 붙이지 않는다. | `01_ui_contract_evidence.md:38-43,56-62` |

effort canonical 값과 legacy 표기 정규화의 SSOT는
`02_core_contract_decisions.md:47-64,178-318`이다. 08은 그 집합이나 remap을
재정의하지 않고 공개 문서로 전사만 한다. 특히 `extra-high`, `extra_high`,
`extra high`를 `xhigh`로 정규화하는 계약과 Pro compatibility 경계는 02를 그대로
참조한다. legacy `--effort extended`는 High로 재매핑한 뒤 stderr에
`extended is a legacy alias; selected High` 형태의 경고를 정확히 1줄 방출한다.
legacy Pro의 `standard|extended`도 flat Pro로 처리하되 선택 없음 경고 1줄을 방출한다.

`gpt-5.3`은 더 이상 `instant`의 동의어로 설명하지 않는다. 현재 UI에서는 독립된
family 행이므로 `--family gpt-5.3`으로만 문서화한다
(`skills/web-ai/SKILL.md:659-661`, `README.md:689-700`,
`02_core_contract_decisions.md:319-340`).

### 1.2 timeout 계약: UI 예산과 poll deadline 분리

문서의 공통 문구는 아래 의미를 바꾸지 않는다.

> An explicit timeout wins. Otherwise agbrowse reuses the stored session deadline;
> only a session without either value derives a tier default. ChatGPT Pro uses a
> 5400-second (90-minute) poll deadline. Grok Heavy and Deep Research each use a
> separate 3600-second deadline. The user-reported roughly 40-minute Pro reasoning
> budget is a ChatGPT UI-side value and was not present in the inspected DOM; it
> is not the agbrowse timeout.

한국어 공통 문구:

> `--timeout`을 직접 지정하면 그 값이 가장 먼저 적용된다. 직접 지정하지 않으면
> 저장된 세션 deadline의 남은 시간을 이어 쓰고, 둘 다 없을 때만 tier 기본값을
> 계산한다. ChatGPT Pro의 agbrowse poll deadline은 5400초(90분)다. Grok Heavy와
> Deep Research는 서로 분리된 tier이며 각각 3600초다. 사용자가 알려 준
> 약 40분은 ChatGPT UI 쪽 추론 예산이며 이번 DOM에서는 확인되지 않았다. 이 값과
> agbrowse timeout을 같은 값으로 설명하지 않는다.

구현 SSOT는 `web-ai/session.mjs:372-385,388-413`이다. 장기 tier 기본값은
`chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600`이고, tier를 알 수
없을 때 vendor fallback은 ChatGPT 1200, Gemini 1200, Grok 600이다. 우선순위는
`explicit timeout → stored deadline remainder → tier default → vendor fallback`으로
서술한다 (`00_index.md:24,35`, `01_ui_contract_evidence.md:99-113`).

### 1.3 하지 않는 일

- Work의 1차 공개 UX는 `work send --prompt "..." --power N`(`N=1..6`)만 문서화한다.
  Power와 Model×Effort의 상세 매핑은 WP1 재프로브 결과를 소비한 04의 확정 계약만
  따르며 추정값을 만들지 않는다.
- Chat 명령이나 기존 MCP 도구에 `surface=work`를 추가하지 않는다.
- 사용자 보고 40분을 DOM 실측, 공식 보장, agbrowse 상수로 승격하지 않는다.
- `Extended`, `Pro Extended`, `Pro Standard`를 현재 UI 라벨처럼 쓰지 않는다.
- Deep Research의 명시적 `--timeout 1800` 예시는 Pro tier 예시가 아니므로 일괄
  치환하지 않는다 (`skills/web-ai/SKILL.md:587-605`, `README.md:924-940`).
- `docs/dev/*.html`을 재포맷하거나 새 생성기를 만들지 않는다. 이 저장소에는 해당
  HTML 생성 파이프라인이 없으므로 기존 압축 형식에서 필요한 substring만 손으로
  바꾼다 (`package.json:38-60`).

## 2. 변경 파일 지도

다음 구현 유닛의 문서 변경 범위는 16개 기존 파일이다. 이 08 문서 자체 외에 새 파일은
만들지 않는다.

| 작업 | 경로 | 책임 |
| --- | --- | --- |
| UPSTREAM VERIFY | `web-ai/cli.mjs` | 04 소유의 `work send` 2단 parser와 subcommand help를 08 문서가 그대로 반영하는지 확인 |
| MODIFY | `skills/browser/browser.mjs` | root CLI의 Work command/help, web-ai flags, timeout, long-Pro 예시 |
| MODIFY | `skills/web-ai/SKILL.md` | Work CLI/MCP 사용법, metadata, timeout, current/legacy UI 계약, alias와 예시 |
| MODIFY | `README.md` | Work CLI/MCP 사용법, 첫 Pro 흐름, timeout 표, alias 표, code-mode 예시 |
| MODIFY | `docs/index.html` | Work send 예시, 첫 화면 code-mode effort와 long-Pro 예시 |
| MODIFY x2 | `docs/dev/guides/web-ai.html`, `docs/dev/ko/guides/web-ai.html` | Work send와 Chat 모델/effort·timeout 입문 |
| MODIFY x2 | `docs/dev/reference/cli.html`, `docs/dev/ko/reference/cli.html` | Work CLI/MCP, 입력 alias와 timeout 우선순위 레퍼런스 |
| MODIFY x2 | `docs/dev/changelog.html`, `docs/dev/ko/changelog.html` | 2026-07-10 항목 신설 |
| MODIFY x2 | `docs/dev/index.html`, `docs/dev/ko/index.html` | 대표 code-mode 예시 |
| MODIFY x2 | `docs/dev/quickstart.html`, `docs/dev/ko/quickstart.html` | quickstart code-mode 예시 |
| MODIFY x2 | `docs/dev/guides/code-mode.html`, `docs/dev/ko/guides/code-mode.html` | single/multi artifact 예시 |

`docs/dev` 쌍은 모두 사람이 직접 편집한 압축 HTML이다. 아래 line은 현재 파일의
물리 줄 번호다. 태그를 보기 좋게 개행하더라도 파일 전체 formatter는 돌리지 않는다.

### 2.1 root CLI web-ai help 블록

`skills/browser/browser.mjs`의 root help는 `web-ai/cli.mjs`와 별도 공개 표면이다.
현재 구현의 Pro standard/extended 광고, vendor fallback을 일반 default처럼 쓴
1200/600 표기, long-Pro `--timeout 1800` 예시를 함께 교체한다.

#### Before (`skills/browser/browser.mjs:3371-3386,3416-3424`)

```text
      Common flags:
        --vendor <chatgpt|gemini|grok>
        --model <alias>                ChatGPT: pro/thinking/instant
                                       Gemini:  flash-lite/flash/pro + tool deepthink
                                       Grok:    heavy/expert/thinking/fast/auto
        --effort <alias>               ChatGPT only; requires --model
                                       Pro: standard/extended
                                       Thinking: light/standard/extended/heavy
        --reasoning-effort <alias>     Alias for --effort
        --url <conversation-or-provider-url>
        --inline-only | --file <path> | --context-from-files <glob>
        --context-transport <upload|inline>
        --allow-copy-markdown-fallback Capture provider Copy button output
        --allow-grok-context-pack      Override Grok hard-gate (prefer inline)
        --timeout <sec>                Default 1200 ChatGPT/Gemini · 600 Grok
        --session <id>                 Resume a previous session; surviving
```

```text
      Examples:
        agbrowse web-ai render --vendor chatgpt --prompt "hello" --json
        agbrowse web-ai query  --vendor grok    --inline-only --prompt "Reply OK"
        agbrowse web-ai query  --vendor gemini  --model deepthink --inline-only --prompt "Reply OK"
        agbrowse web-ai query  --vendor chatgpt --context-from-files "src/**/*.ts" \\
                                                --context-transport upload --prompt "Review this"
        SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \\
                --prompt "long Pro prompt" --json | jq -r .sessionId)
        agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800
```

#### After

```diff
@@
     web-ai send            Send a prompt; returns a sessionId for later resume
+    web-ai work send       Send a prompt through ChatGPT Work with --power N
     web-ai poll            Poll a session (or latest baseline) for completion
@@
       Common flags:
         --vendor <chatgpt|gemini|grok>
-        --model <alias>                ChatGPT: pro/thinking/instant
+        --surface <chat>               Chat commands reject an active Work surface
+        --family <alias>               ChatGPT: gpt-5.6-sol | gpt-5.5 | gpt-5.4 |
+                                       gpt-5.3 | o3; omit to leave unchanged
+        --model <alias>                ChatGPT tiers: pro/thinking/instant
                                        Gemini:  flash-lite/flash/pro + tool deepthink
                                        Grok:    heavy/expert/thinking/fast/auto
         --effort <alias>               ChatGPT only; requires --model
-                                       Pro: standard/extended
-                                       Thinking: light/standard/extended/heavy
+                                       Thinking canonical: medium/high/xhigh
+                                       Legacy normalization: see web-ai skill
         --reasoning-effort <alias>     Alias for --effort
@@
-        --timeout <sec>                Default 1200 ChatGPT/Gemini · 600 Grok
+        --timeout <sec>                Long tier defaults: 5400 ChatGPT Pro ·
+                                       3600 Grok Heavy · 3600 Deep Research;
+                                       unknown tier falls back
+                                       to 1200 ChatGPT/Gemini · 600 Grok
@@
+      Work send flags:
+        --prompt <text>                Required Work prompt
+        --power <1..6>                 Required Work Power step
+                                       (mapping follows the WP1-probed contract)
@@
-        SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \\
+        SID=$(agbrowse web-ai send --vendor chatgpt --model pro --inline-only \\
                 --prompt "long Pro prompt" --json | jq -r .sessionId)
-        agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800
+        agbrowse web-ai poll --vendor chatgpt --session "$SID"
+        agbrowse web-ai work send --prompt "Analyze this repository" --power 4
```

family를 지정하는 root-help 예제를 후속 구현에서 추가한다면 반드시
`--model thinking --effort high --family gpt-5.6-sol` 순서를 사용한다.
`work send`는 `project-sources <list|add>`와 같은 2단 parser를 쓰며, Chat의
`send/query/poll/watch` flag 집합에 `--power`나 `surface=work`를 섞지 않는다.
`web-ai/cli.mjs`의 parser와 전용 `work --help` 구현은 04 소유이므로 08에서 다시
수정하지 않는다. 08은 live help에 아래 계약이 이미 있는지 stale-check한 뒤 root
help, SKILL, README, EN/KO 문서에 같은 표면을 전사한다.

```text
agbrowse web-ai work send --prompt <text> --power <1..6>
```

## 3. `skills/web-ai/SKILL.md`

### 3.1 metadata

#### Before (`skills/web-ai/SKILL.md:4-12`)

```yaml
  Ask AI web UIs (ChatGPT, Gemini, Grok) via standalone agbrowse browser automation.
  Model selection, effort control, session resume, file/context upload, polling, copy-markdown fallback, and response extraction.
  NOT for: generic page navigation or screenshots (use browser skill).
  Triggers: web-ai, agbrowse, ChatGPT, GPT, GPT Pro, GPT Thinking, GPT Instant, GPT Heavy,
  Gemini, Gemini Pro, Gemini Thinking, Gemini DeepThink, deep think, deepthink,
  Grok, Grok Heavy, Grok Expert, Grok Fast, grok-4.3,
  챗지피티, 제미나이, 그록, 딥씽크, GPT한테, AI한테, AI 물어봐, AI한테 물어봐,
  heavy 모드, thinking 모드, pro 모드, expert 모드, extended effort, reasoning effort,
  ask chatgpt, ask gemini, ask grok, query AI, AI 리뷰, AI 검증, AI 조사,
```

#### After

```yaml
Ask AI web UIs (ChatGPT Chat and Work, Gemini, Grok) via standalone agbrowse browser automation.
Chat model-family/tier selection, Work Power submission, reasoning-effort control, session resume, file/context upload, polling, copy-markdown fallback, and response extraction.
Triggers: web-ai, agbrowse, ChatGPT, ChatGPT Work, work send, GPT, GPT-5.6, GPT-5.6 Sol, GPT Pro, GPT Thinking, GPT Instant, Extra High,
...
xhigh 모드, thinking 모드, pro 모드, expert 모드, reasoning effort,
```

`extended effort`는 현재 trigger에서 제거한다. legacy 입력 지원은 metadata가 아니라
§3.4의 `Legacy UI (before 2026-07-10)`에만 둔다.

### 3.2 polling timeout

#### Before (`skills/web-ai/SKILL.md:107-121`)

```markdown
## Polling Timeouts

`web-ai poll` and `web-ai query` accept `--timeout <seconds>`. When omitted,
the runtime uses these defaults so heavy reasoning models (ChatGPT Pro/Heavy,
Gemini Deep Think, Grok Expert/Heavy) have room to finish:

| Vendor | Default `--timeout` | Roughly |
| --- | ---: | --- |
| ChatGPT | 1200 | 20 minutes |
| Gemini | 1200 | 20 minutes |
| Grok | 600 | 10 minutes |

Pass `--timeout 1800` (30 min) or higher for unusually long Pro/Deep Think
runs. The provider tab and the agbrowse Chrome process stay open across a
poll timeout — only the polling loop gives up.
```

#### After

```markdown
`web-ai poll`, `web-ai query`, and `web-ai watch` accept `--timeout <seconds>`.
Timeout resolution is `explicit timeout → stored session deadline remainder → tier
default → vendor fallback`. A resumed poll therefore keeps the deadline created by
the original submit unless the caller explicitly overrides it.

| Long-running tier | Default `--timeout` | Roughly |
| --- | ---: | --- |
| `chatgpt-pro` | 5400 | 90 minutes |
| `grok-heavy` | 3600 | 60 minutes |
| `deep-research` | 3600 | 60 minutes |

| Vendor fallback when the tier is unknown | Default `--timeout` | Roughly |
| --- | ---: | --- |
| ChatGPT | 1200 | 20 minutes |
| Gemini | 1200 | 20 minutes |
| Grok | 600 | 10 minutes |

Do not equate ChatGPT's UI-side reasoning budget with the agbrowse poll deadline.
The roughly 40-minute Pro budget is a user report and was not present in the
2026-07-10 DOM. The 5400-second (90-minute) `chatgpt-pro` default is agbrowse
polling headroom; `grok-heavy` and `deep-research` remain independent 3600-second tiers.
The provider tab and agbrowse Chrome process remain open when polling times out.
```

기존 MCP session/retry 설명(`skills/web-ai/SKILL.md:123-129`)은 유지하되, 첫 문장에
“the same stored deadline”을 넣어 새 우선순위와 연결한다.

### 3.3 Work send CLI/MCP

`skills/web-ai/SKILL.md`의 Commands 목록에 `agbrowse web-ai work send`를 추가하고,
Chat 명령과 분리된 아래 사용법을 바로 설명한다.

````markdown
### ChatGPT Work

Use the dedicated Work entrypoint; Chat `send/query/poll/watch` and
`web_ai_submit_prompt` reject an active Work surface.

```bash
agbrowse web-ai work send --prompt "Analyze this repository" --power 4
```

`--power` is an integer from 1 through 6. The runtime follows the WP1-probed
Power-to-Model/Effort mapping; do not infer Terra/Luna or Chat family aliases.
For MCP clients, use `web_ai_work_send` with `prompt` and `power`. Do not add a
`surface` field to `web_ai_submit_prompt`.
````

### 3.4 현재 예시

#### Before (`skills/web-ai/SKILL.md:324-329`)

```bash
agbrowse web-ai query --vendor chatgpt --model thinking \
  --system "Extract every breaking change from the attached PDF and group by module." \
  --file ./spec.pdf \
  --prompt "Summarize the breaking changes."
```

#### After

```bash
agbrowse web-ai query --vendor chatgpt --model thinking --effort high --family gpt-5.6-sol \
  --system "Extract every breaking change from the attached PDF and group by module." \
  --file ./spec.pdf \
  --prompt "Summarize the breaking changes."
```

code-mode 예시 두 곳도 정식 effort로 바꾼다.

```diff
# skills/web-ai/SKILL.md:383-405
-  --model thinking \
-  --effort standard \
+  --model thinking \
+  --effort medium \
```

두 예시 모두 같은 치환을 적용한다. `skills/web-ai/SKILL.md:592-599`의 Deep
Research `--timeout 1800`은 유지한다.

### 3.5 alias 표와 EN/KO UI note

#### Before (`skills/web-ai/SKILL.md:655-697`)

```markdown
## Model Aliases

ChatGPT:

- `instant`, `fast`, `gpt-5.3`
- `thinking`, `think`, `gpt-5.5-thinking`
- `pro`, `gpt-5.5-pro`
- `--effort` / `--reasoning-effort` for ChatGPT:
  - Pro: `standard`, `extended`
  - Thinking: `light`, `standard`, `extended`, `heavy`

2026-05-03 ChatGPT UI note:

- The visible model opener can be a bottom composer pill such as `Pro`
  without the older top `model-switcher-dropdown-button`.
- Pro effort trigger: `[data-testid="model-switcher-gpt-5-5-pro-thinking-effort"]`
  with `Standard` and `Extended`.
- Thinking effort trigger:
  `[data-testid="model-switcher-gpt-5-5-thinking-thinking-effort"]`
  with `Light`, `Standard`, `Extended`, and `Heavy`.
- In the simplified Intelligence UI, Pro currently routes through `Pro Extended`
  because the plain `Pro` / `Pro Standard` row may be absent.

2026-06-11 ChatGPT Intelligence UI note:

- The visible picker may be the simplified `Intelligence` menu instead of the
  older model row plus separate effort submenu.
- `instant` and `thinking --effort light` select `Instant`.
- `thinking --effort standard` selects `Medium`.
- `thinking --effort extended` selects `High`.
- `thinking --effort heavy` selects `Extra High`.
- `pro --effort standard` selects `Pro Extended` when the simplified UI only exposes Pro Extended; if ChatGPT exposes a `Pro Standard` hover submenu, treat it as an optional refinement rather than a required selector.
- `pro --effort extended` selects `Pro Extended`.

2026-06-15 Korean ChatGPT Intelligence UI note:

- The composer model pill may show `중간` and open a `지능` menu.
- `instant` / `thinking --effort light` select `즉시`.
- `thinking --effort standard` selects `중간`.
- `thinking --effort extended` selects `높음`.
- `thinking --effort heavy` selects `매우 높음`.
- `pro --effort extended` selects `Pro 확장`.
- Pro effort trigger observed as `data-testid="composer-intelligence-pro-thinking-effort-trigger"`.
```

#### After

```markdown
## Model Aliases

ChatGPT current contract (2026-07-10):

| Input | Current resolution |
| --- | --- |
| `instant`, `fast` | GPT-5.5 `Instant`; no reasoning effort |
| `thinking`, `think` | selected family + thinking tier; defaults to `medium` |
| `pro` | selected family + flat `Pro`; omit `--effort` in new calls |
| `--family gpt-5.6-sol`, `--family gpt-5.5`, `--family gpt-5.4`, `--family gpt-5.3`, `--family o3` | Chat family aliases; combine a family with `--model instant|thinking|pro` and the tier-appropriate effort; omit `--family` to preserve the current UI family with zero submenu mutation |

Canonical ChatGPT thinking efforts:

| CLI effort | Visible Chat label |
| --- | --- |
| `medium` | `Medium` |
| `high` | `High` |
| `xhigh` | `Extra High` |

Compatibility input is normalized before browser mutation exactly as defined by
`02_core_contract_decisions.md` §2; this downstream table does not define new aliases:

| Legacy input | Current resolution |
| --- | --- |
| `light`, `low`, `standard`, `normal`, `regular`, `default` | `medium` |
| `extended` | `high` |
| `heavy`, `extra-high`, `extra_high`, `extra high` | `xhigh` |
| `gpt-5.5-thinking` | family `gpt-5.5` + thinking `medium` |
| `gpt-5.5-pro` | family `gpt-5.5` + flat `pro` |
| `pro --effort standard|extended` | flat `pro`; compatibility only |

`--effort extended` remaps to High and emits exactly one stderr warning such as
`extended is a legacy alias; selected High`. Legacy Pro `standard|extended` requests
resolve to flat Pro and emit the same one-line no-selection warning pattern.

2026-07-10 ChatGPT Intelligence UI note (current, English UI):

- Chat and Work are separate header surfaces. Chat commands reject Work; Work prompt
  submission uses only `web-ai work send --prompt ... --power N` or MCP
  `web_ai_work_send`.
- The Chat picker is a flat `Intelligence` radio list: `Instant` (badge `5.5`),
  `Medium`, `High`, `Extra High`, and `Pro`.
- The family submenu is a second axis. `Instant` stays on GPT-5.5; the other tiers
  use the selected family. Omitting `--family` leaves the current UI family untouched.
- Current menu rows have no `model-switcher-*` test ids. Runtime evidence must use
  the active Chat surface, the composer-scoped picker, exact labels, and checked state.
- `Pro` is a flat row. There is no current Pro effort submenu.

2026-07-10 ChatGPT Intelligence UI 메모 (한국어 안내):

- 이번 실측은 영어 UI에서 진행했다. 현재 라벨은 `Instant`, `Medium`, `High`,
  `Extra High`, `Pro`로 기록한다.
- 한국어 UI의 실제 라벨은 다시 확인하기 전까지 selector 계약에 넣지 않는다.
- 사용자가 알려 준 Pro 약 40분은 UI 쪽 추론 예산이며 DOM에서는 확인되지 않았다.
  agbrowse의 `chatgpt-pro` poll deadline 5400초(90분)와 섞어 쓰지 않는다.

### Legacy UI (before 2026-07-10)

The following labels and selectors describe compatibility paths observed before
2026-07-10, not the current ChatGPT UI:

- `model-switcher-gpt-5-5-*-thinking-effort`, `Standard`, `Extended`, `Heavy`,
  `Pro Standard`, `Pro Extended`, `Pro 확장`, and the older Korean
  `즉시`/`중간`/`높음`/`매우 높음` rows.
- Older simplified pickers mapped `light|standard|extended|heavy` to
  `Instant|Medium|High|Extra High` and routed Pro through `Pro Extended`.
- Keep these paths only for runtime backward compatibility. Do not use them in
  current examples or capability claims.
```

Gemini/Grok alias 문단(`skills/web-ai/SKILL.md:699` 이후)은 위치만 아래로 밀리고
내용은 바꾸지 않는다.

## 4. `README.md`

### 4.1 Work send CLI/MCP

`README.md`의 Web-AI command 목록과 ChatGPT 절에 전용 Work 진입점을 추가한다.

````markdown
### ChatGPT Work

ChatGPT Work submission is a separate command surface:

```bash
agbrowse web-ai work send --prompt "Analyze this repository" --power 4
```

`--power` accepts `1..6`. Chat `send/query/poll/watch` and MCP
`web_ai_submit_prompt` reject Work; MCP callers use the dedicated
`web_ai_work_send` tool with `prompt` and `power`.
````

command 목록에는 `agbrowse web-ai work send`를 한 행 추가한다. 기존 Chat 명령이나
`web_ai_submit_prompt`에 `surface=work` 예시는 추가하지 않는다.

### 4.2 첫 long-Pro 흐름

#### Before (`README.md:60-78`)

````markdown
For web-ai smoke tests after logging in to the provider:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --model pro \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Reply exactly AGBROWSE_OK"
```

For long Pro / Deep Think runs that should survive shell exit:

```bash
SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \
        --prompt "..." --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800
```
````

#### After

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --model pro \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Reply exactly AGBROWSE_OK"

SID=$(agbrowse web-ai send --vendor chatgpt --model pro --inline-only \
        --prompt "..." --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID"
```

poll에서 timeout을 생략하는 이유를 바로 아래에 적는다.

```markdown
The submit stores the `chatgpt-pro` deadline, so the later poll inherits the same
5400-second (90-minute) window. Pass `--timeout` only to override it explicitly.
```

`README.md:560-567`의 두 번째 long-Pro 예시에도 `--model pro`를 추가하고
`--timeout 1800`을 제거한다. comment는 `Long Pro run — fire-and-forget ...`으로
좁혀 Deep Think와 한 예시에서 섞지 않는다.

### 4.3 vendor 1200s 표와 tier 표

#### Before (`README.md:540-552`)

```markdown
`web-ai poll` / `query` / `watch` accept `--timeout <seconds>`. Default:

| Vendor | Default `--timeout` | Roughly |
| --- | ---: | --- |
| ChatGPT | 1200 | 20 minutes |
| Gemini  | 1200 | 20 minutes |
| Grok    | 600  | 10 minutes |

Pass `--timeout 1800` for unusually long Pro/Deep Think runs. The provider
tab and the agbrowse Chrome process stay open across a poll timeout —
only the polling loop gives up.
```

#### After

```markdown
`web-ai poll` / `query` / `watch` accept `--timeout <seconds>`. Resolution order
is explicit timeout, stored session deadline remainder, tier default, then vendor
fallback.

| Long-running tier | Default `--timeout` | Roughly |
| --- | ---: | --- |
| `chatgpt-pro` | 5400 | 90 minutes |
| `grok-heavy` | 3600 | 60 minutes |
| `deep-research` | 3600 | 60 minutes |

| Vendor fallback when the tier is unknown | Default `--timeout` | Roughly |
| --- | ---: | --- |
| ChatGPT | 1200 | 20 minutes |
| Gemini | 1200 | 20 minutes |
| Grok | 600 | 10 minutes |

ChatGPT's roughly 40-minute Pro reasoning budget is user-reported and was not
present in the inspected DOM. It is a UI-side budget, not agbrowse's 5400-second
(90-minute) `chatgpt-pro` poll deadline. `grok-heavy` and `deep-research` remain
separate 3600-second tiers. A poll timeout leaves the provider tab and Chrome process open.
```

### 4.4 ChatGPT alias 표

#### Before (`README.md:689-700`)

```markdown
Model aliases:

- `instant`, `fast`, `gpt-5.3`
- `thinking`, `think`, `gpt-5.5-thinking`
- `pro`, `gpt-5.5-pro`

Current headed ChatGPT UI may expose a simplified `Intelligence` picker instead
of the older model row plus separate effort submenu. The runtime maps
`thinking --effort light|standard|extended|heavy` to `Instant|Medium|High|Extra
High`, and maps Pro requests through `Pro Extended` when that is the visible Pro
entry. Legacy `model-switcher-*` rows and composer-pill fallbacks remain
supported.
```

#### After

```markdown
Model and family aliases:

| Input | Resolution |
| --- | --- |
| `instant`, `fast` | GPT-5.5 `Instant` |
| `thinking`, `think` | selected family + `medium` by default; accepts canonical effort `medium|high|xhigh` |
| `pro` | selected family + flat `Pro`; no effort is needed |
| `--family gpt-5.6-sol`, `--family gpt-5.5`, `--family gpt-5.4`, `--family gpt-5.3`, `--family o3` | Chat family aliases; omit the flag to preserve the current UI family without submenu mutation |

Legacy thinking efforts are remapped before browser mutation: `light|low|standard|
normal|regular|default → medium`, `extended → high`, and `heavy|extra-high|extra_high|
extra high → xhigh`. `extended` emits exactly one stderr warning after selecting High.
Legacy `pro --effort standard|extended` resolves to flat `pro` and emits a one-line
no-selection warning.

The 2026-07-10 Chat Intelligence picker is a flat `Instant (5.5) / Medium / High /
Extra High / Pro` list plus a separate family submenu. `Instant` stays on GPT-5.5;
the other tiers use the selected family. Work-only `gpt-5.6-terra` and
`gpt-5.6-luna` are not accepted by this Chat-only contract.

Legacy UI (before 2026-07-10): `model-switcher-*`, `Standard`, `Extended`,
`Pro Standard`, and `Pro Extended` remain compatibility-only labels.
```

### 4.5 code-mode 예시

`README.md:720-742`의 두 `--effort standard`를 `--effort medium`으로 바꾼다.
`README.md:928-935`의 Deep Research `--timeout 1800`은 유지한다.

## 5. `docs/index.html`

### 5.1 hero code-mode 예시

#### Before (`docs/index.html:272-277`)

```html
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Create a small CLI app with tests." \
  --output-zip ./result.zip
```

#### After

```html
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort medium \
  --prompt "Create a small CLI app with tests." \
  --output-zip ./result.zip
```

### 5.2 long-Pro 예시

#### Before (`docs/index.html:305-315`)

```html
SID=$(agbrowse web-ai send \
  --vendor chatgpt \
  --model pro \
  --inline-only \
  --prompt "Research and cite sources." \
  --json | jq -r .sessionId)

agbrowse web-ai poll \
  --vendor chatgpt \
  --session "$SID" \
  --timeout 1800
```

#### After

```html
SID=$(agbrowse web-ai send \
  --vendor chatgpt \
  --model pro \
  --inline-only \
  --prompt "Research and cite sources." \
  --json | jq -r .sessionId)

agbrowse web-ai poll \
  --vendor chatgpt \
  --session "$SID"
```

이 예시는 submit 때 저장된 `chatgpt-pro` 5400초(90분) deadline을 poll이 상속하는
흐름을 보여 준다.
같은 페이지의 두 번째 code-mode 예시도 `--effort standard`를 `--effort medium`으로
바꾼다 (`docs/index.html:325-330`).

### 5.3 Work send 예시

long-Pro 예시 다음에 Chat과 분리된 Work 진입점을 추가한다.

```html
<h2>ChatGPT Work</h2>
<pre><code>agbrowse web-ai work send --prompt "Analyze this repository" --power 4</code></pre>
<p>Work submission uses its own CLI command and MCP <code>web_ai_work_send</code> tool. Chat commands continue to reject an active Work surface.</p>
```

## 6. `docs/dev/` EN/KO 수동 HTML 쌍

### 6.1 `guides/web-ai.html`

#### Before EN (`docs/dev/guides/web-ai.html:1-2`)

```html
<h2>Send and poll</h2><pre><code>SID=$(agbrowse web-ai send --vendor chatgpt --inline-only --prompt "Analyze this" --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1200</code></pre>
```

```html
<h2>Provider boundaries</h2><p>ChatGPT, Gemini, and Grok each have separate model aliases and UI contracts. Check <code>agbrowse web-ai --help</code> before scripting.</p>
```

#### After EN

```html
<h2>Send and poll</h2><pre><code>SID=$(agbrowse web-ai send --vendor chatgpt --model pro --inline-only --prompt "Analyze this" --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID"</code></pre>
<p>The poll inherits the stored <code>chatgpt-pro</code> deadline: 5400 seconds (90 minutes) unless an explicit timeout overrides it.</p>
<table><thead><tr><th>Long-running tier</th><th>Default timeout</th></tr></thead><tbody>
<tr><td><code>chatgpt-pro</code></td><td>5400 seconds (90 minutes)</td></tr>
<tr><td><code>grok-heavy</code></td><td>3600 seconds</td></tr>
<tr><td><code>deep-research</code></td><td>3600 seconds</td></tr>
</tbody></table>
<h2>ChatGPT Work</h2><pre><code>agbrowse web-ai work send --prompt "Analyze this repository" --power 4</code></pre>
<p>Use MCP <code>web_ai_work_send</code> for the same Work-only operation. Chat commands and <code>web_ai_submit_prompt</code> reject Work.</p>
<h2>ChatGPT model contract</h2>
<table><thead><tr><th>Request</th><th>Current UI</th></tr></thead><tbody>
<tr><td><code>instant</code></td><td><code>Instant</code> on GPT-5.5</td></tr>
<tr><td><code>thinking --effort medium|high|xhigh</code></td><td><code>Medium|High|Extra High</code> on the selected family</td></tr>
<tr><td><code>pro</code></td><td>flat <code>Pro</code> on the selected family</td></tr>
<tr><td><code>--family &lt;gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3&gt;</code></td><td>family submenu; omission preserves the current UI family with zero submenu mutation</td></tr>
</tbody></table>
<p>Legacy efforts map to the current tiers: <code>light|standard → medium</code>, <code>extended → high</code>, and <code>heavy → xhigh</code>. Extended emits one stderr warning after remapping; legacy Pro effort emits the same one-line no-selection warning pattern. Extended-era labels describe only the UI before 2026-07-10.</p>
<p>The user-reported roughly 40-minute Pro budget belongs to the ChatGPT UI and was not found in the inspected DOM. It is separate from the agbrowse timeout.</p>
<h2>Provider boundaries</h2><p>ChatGPT, Gemini, and Grok each have separate model aliases and UI contracts. Check <code>agbrowse web-ai --help</code> before scripting.</p>
```

#### Before KO (`docs/dev/ko/guides/web-ai.html:1-2`)

```html
<h2>Send + poll</h2><pre><code>SID=$(agbrowse web-ai send --vendor chatgpt --inline-only --prompt "Analyze this" --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1200</code></pre>
```

```html
<p>ChatGPT, Gemini, Grok는 model alias와 UI 계약이 다릅니다. 스크립트 작성 전 <code>agbrowse web-ai --help</code>를 확인합니다.</p>
```

#### After KO

```html
<h2>보내고 이어서 받기</h2><pre><code>SID=$(agbrowse web-ai send --vendor chatgpt --model pro --inline-only --prompt "Analyze this" --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID"</code></pre>
<p>poll은 submit 때 저장한 <code>chatgpt-pro</code> deadline을 이어 쓴다. 직접 덮어쓰지 않으면 5400초(90분)다.</p>
<table><thead><tr><th>장기 tier</th><th>기본 timeout</th></tr></thead><tbody>
<tr><td><code>chatgpt-pro</code></td><td>5400초(90분)</td></tr>
<tr><td><code>grok-heavy</code></td><td>3600초</td></tr>
<tr><td><code>deep-research</code></td><td>3600초</td></tr>
</tbody></table>
<h2>ChatGPT Work</h2><pre><code>agbrowse web-ai work send --prompt "Analyze this repository" --power 4</code></pre>
<p>같은 Work 전용 작업을 MCP에서 실행할 때는 <code>web_ai_work_send</code>를 쓴다. Chat 명령과 <code>web_ai_submit_prompt</code>는 Work에서 중단한다.</p>
<h2>ChatGPT 모델 계약</h2>
<table><thead><tr><th>입력</th><th>현재 UI</th></tr></thead><tbody>
<tr><td><code>instant</code></td><td>GPT-5.5의 <code>Instant</code></td></tr>
<tr><td><code>thinking --effort medium|high|xhigh</code></td><td>선택한 family의 <code>Medium|High|Extra High</code></td></tr>
<tr><td><code>pro</code></td><td>선택한 family의 단일 <code>Pro</code> 행</td></tr>
<tr><td><code>--family &lt;gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3&gt;</code></td><td>family submenu를 선택한다. 생략하면 submenu를 건드리지 않고 현재 UI 선택을 유지한다.</td></tr>
</tbody></table>
<p>예전 effort는 현재 값으로 바뀐다. <code>light|standard → medium</code>, <code>extended → high</code>, <code>heavy → xhigh</code>다. extended는 High로 바꾼 뒤 stderr 경고 1줄을 내고, 예전 Pro effort도 선택 없음 경고 1줄을 낸다. Extended 계열 라벨은 2026-07-10 이전 UI 설명에만 남긴다.</p>
<p>사용자가 알려 준 Pro 약 40분은 ChatGPT UI 쪽 예산이며 이번 DOM에서는 확인되지 않았다. agbrowse timeout과는 별개다.</p>
<h2>Provider별 차이</h2><p>ChatGPT, Gemini, Grok는 모델 alias와 UI 계약이 다르다. 스크립트를 쓰기 전에 <code>agbrowse web-ai --help</code>를 확인한다.</p>
```

### 6.2 `reference/cli.html`

#### Before EN (`docs/dev/reference/cli.html:1-4`)

```html
<h2>Web-AI commands</h2><p><code>render</code>, <code>status</code>, <code>send</code>, <code>poll</code>, <code>query</code>, <code>code</code>, <code>code-extract</code>, <code>stop</code>, <code>watch</code>, <code>snapshot</code>, <code>sessions</code>, <code>project-sources</code>, <code>context-dry-run</code>, <code>context-render</code>, <code>doctor</code>, <code>claim-audit</code>.</p>
```

```html
<h2>Help checks</h2><pre><code>agbrowse --help
agbrowse web-ai --help
agbrowse web-ai code --help
agbrowse web-ai code-extract --help</code></pre>
```

#### After EN

Web-AI command 목록에 <code>work send</code>를 추가하고 Help checks에
`agbrowse web-ai work --help`를 추가한 뒤, 두 영역 사이에 아래 블록을 넣는다.

```html
<h2>ChatGPT Work</h2>
<pre><code>agbrowse web-ai work send --prompt "Analyze this repository" --power 4</code></pre>
<p><code>--power</code> accepts 1 through 6. MCP clients use <code>web_ai_work_send</code>. Chat commands and <code>web_ai_submit_prompt</code> reject Work; they do not accept <code>surface=work</code>.</p>
<h2>ChatGPT model inputs</h2>
<table><thead><tr><th>Tier or family</th><th>Contract</th></tr></thead><tbody>
<tr><td><code>instant</code></td><td>GPT-5.5 Instant</td></tr>
<tr><td><code>thinking</code></td><td><code>--effort medium|high|xhigh</code>; defaults to medium</td></tr>
<tr><td><code>pro</code></td><td>flat Pro; omit effort</td></tr>
<tr><td><code>--family &lt;gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3&gt;</code></td><td>Chat family aliases; omission preserves the current UI family with zero submenu mutation</td></tr>
</tbody></table>
<p>Legacy effort remapping: <code>light|low|standard|normal|regular|default → medium</code>, <code>extended → high</code>, <code>heavy|extra-high|extra_high|extra high → xhigh</code>. Extended emits exactly one stderr warning after selecting High. Legacy Pro effort resolves to flat Pro and emits the same one-line no-selection warning pattern.</p>
<h2>Timeout resolution</h2>
<table><thead><tr><th>Long-running tier</th><th>Default timeout</th></tr></thead><tbody>
<tr><td><code>chatgpt-pro</code></td><td>5400 seconds (90 minutes)</td></tr>
<tr><td><code>grok-heavy</code></td><td>3600 seconds</td></tr>
<tr><td><code>deep-research</code></td><td>3600 seconds</td></tr>
</tbody></table>
<p>Priority: explicit timeout, stored deadline remainder, tier default, vendor fallback. Unknown tiers fall back to ChatGPT 1200, Gemini 1200, or Grok 600 seconds.</p>
<p>The user-reported roughly 40-minute ChatGPT Pro budget was not present in the inspected DOM and is not the agbrowse timeout.</p>
```

#### Before KO (`docs/dev/ko/reference/cli.html:1-4`)

```html
<h2>Web-AI commands</h2><p><code>render</code>, <code>status</code>, <code>send</code>, <code>poll</code>, <code>query</code>, <code>code</code>, <code>code-extract</code>, <code>stop</code>, <code>watch</code>, <code>snapshot</code>, <code>sessions</code>, <code>project-sources</code>, <code>context-dry-run</code>, <code>context-render</code>, <code>doctor</code>, <code>claim-audit</code>.</p>
```

```html
<pre><code>agbrowse --help
agbrowse web-ai --help
agbrowse web-ai code --help
agbrowse web-ai code-extract --help</code></pre>
```

#### After KO

Web-AI command 목록에 <code>work send</code>를 추가하고 help 명령에
`agbrowse web-ai work --help`를 추가한 뒤, 두 영역 사이에 아래 블록을 넣는다.

```html
<h2>ChatGPT Work</h2>
<pre><code>agbrowse web-ai work send --prompt "Analyze this repository" --power 4</code></pre>
<p><code>--power</code>는 1부터 6까지 받는다. MCP에서는 <code>web_ai_work_send</code>를 쓴다. Chat 명령과 <code>web_ai_submit_prompt</code>는 Work에서 중단하며 <code>surface=work</code>를 받지 않는다.</p>
<h2>ChatGPT 모델 입력</h2>
<table><thead><tr><th>tier 또는 family</th><th>계약</th></tr></thead><tbody>
<tr><td><code>instant</code></td><td>GPT-5.5 Instant</td></tr>
<tr><td><code>thinking</code></td><td><code>--effort medium|high|xhigh</code>, 생략하면 medium</td></tr>
<tr><td><code>pro</code></td><td>단일 Pro 행, effort 불필요</td></tr>
<tr><td><code>--family &lt;gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3&gt;</code></td><td>Chat family alias, 생략하면 submenu를 건드리지 않고 현재 UI 선택을 유지</td></tr>
</tbody></table>
<p>예전 effort는 <code>light|low|standard|normal|regular|default → medium</code>, <code>extended → high</code>, <code>heavy|extra-high|extra_high|extra high → xhigh</code>로 바뀐다. extended는 High 선택 뒤 stderr 경고 1줄을 낸다. 예전 Pro effort 입력은 단일 Pro 행으로 처리하고 같은 형식의 선택 없음 경고 1줄을 낸다.</p>
<h2>timeout 적용 순서</h2>
<table><thead><tr><th>장기 tier</th><th>기본 timeout</th></tr></thead><tbody>
<tr><td><code>chatgpt-pro</code></td><td>5400초(90분)</td></tr>
<tr><td><code>grok-heavy</code></td><td>3600초</td></tr>
<tr><td><code>deep-research</code></td><td>3600초</td></tr>
</tbody></table>
<p>직접 지정한 timeout, 저장된 deadline의 남은 시간, tier 기본값, vendor fallback 순서다. tier를 알 수 없으면 ChatGPT 1200초, Gemini 1200초, Grok 600초를 쓴다.</p>
<p>사용자가 알려 준 ChatGPT Pro 약 40분은 이번 DOM에서 확인되지 않은 UI 쪽 예산이다. agbrowse timeout과는 별개다.</p>
<h2>help 확인</h2>
```

### 6.3 `index.html`

#### Before EN/KO (`docs/dev/index.html:3-8`, `docs/dev/ko/index.html:3-8`)

두 파일의 아래 substring은 byte-identical이다.

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Build a small MVP with tests." \
  --output-zip ./result.zip
```

#### After EN/KO

```diff
   --model thinking \
-  --effort standard \
+  --effort medium \
```

두 파일의 주변 제목과 링크는 유지한다. 한국어 파일의 prompt도 이 슬라이스에서는
번역하지 않아 EN/KO 명령 자체가 동일하게 복사 가능하도록 둔다.

### 6.4 `quickstart.html`

#### Before EN/KO (`docs/dev/quickstart.html:8-12`, `docs/dev/ko/quickstart.html:8-12`)

두 파일의 아래 substring은 byte-identical이다.

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Create a CLI todo app with tests." \
  --output-zip ./result.zip
```

#### After EN/KO

```diff
   --model thinking \
-  --effort standard \
+  --effort medium \
```

Web-AI query 예시는 model/effort를 지정하지 않으므로 그대로 둔다
(`docs/dev/quickstart.html:4-7`, `docs/dev/ko/quickstart.html:4-7`).

### 6.5 `guides/code-mode.html`

#### Before EN (`docs/dev/guides/code-mode.html:1-11`)

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Build the app described here." \
  --output-zip ./result.zip
```

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --multi-zip \
  --output-dir ./artifacts \
  --prompt "Create backend.zip and frontend.zip."
```

#### Before KO (`docs/dev/ko/guides/code-mode.html:1-11`)

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "여기에 설명한 앱을 만들어 주세요." \
  --output-zip ./result.zip
```

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --multi-zip \
  --output-dir ./artifacts \
  --prompt "backend.zip과 frontend.zip을 만들어 주세요."
```

#### After EN/KO

single은 `standard`를 `medium`으로 바꾸고, multi에는 `--effort medium`을 추가한다.

```html
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort medium \
  --prompt "<request>" \
  --output-zip ./result.zip
```

EN/KO 모두 같은 flag 순서를 사용한다. 설명 문단과 `code-extract` 예시는 건드리지
않는다.

## 7. changelog 신설 항목

### 7.1 English

#### Before (`docs/dev/changelog.html:1`)

```html
<h1>Recent documentation and code-mode surface changes.</h1><h2>2026-06-11</h2>
```

#### After

2026-06-11보다 앞에 아래 항목을 삽입한다.

```html
<h1>Recent documentation and code-mode surface changes.</h1>
<h2>2026-07-10</h2>
<ul>
<li>Updated the ChatGPT Chat contract for the flat <code>Instant (5.5) / Medium / High / Extra High / Pro</code> Intelligence picker and separate family aliases.</li>
<li>Added canonical thinking efforts <code>medium|high|xhigh</code>; legacy <code>extended</code> selects High and emits one stderr warning, while omitted <code>--family</code> preserves the current UI selection without mutation.</li>
<li>Split long-running timeout tiers into <code>chatgpt-pro=5400</code> (90 minutes), <code>grok-heavy=3600</code>, and <code>deep-research=3600</code>, separately from the user-reported, DOM-unconfirmed roughly 40-minute UI budget.</li>
<li>Added the dedicated <code>agbrowse web-ai work send --prompt "..." --power N</code> command and MCP <code>web_ai_work_send</code> tool. Chat commands continue to reject Work.</li>
</ul>
<h2>2026-06-11</h2>
```

### 7.2 한국어

#### Before (`docs/dev/ko/changelog.html:1`)

```html
<h1>최근 문서와 code-mode 표면 변경입니다.</h1><h2>2026-06-11</h2>
```

#### After

```html
<h1>최근 문서와 code-mode 표면 변경입니다.</h1>
<h2>2026-07-10</h2>
<ul>
<li>ChatGPT Chat 계약을 단일 <code>Instant (5.5) / Medium / High / Extra High / Pro</code> Intelligence 목록과 별도 family alias 구조에 맞췄습니다.</li>
<li>Thinking의 정식 effort를 <code>medium|high|xhigh</code>로 바꿨습니다. 예전 <code>extended</code>는 High로 바꾼 뒤 stderr 경고 1줄을 내며, <code>--family</code>를 생략하면 현재 UI 선택을 건드리지 않습니다.</li>
<li>장기 timeout tier를 <code>chatgpt-pro=5400</code>(90분), <code>grok-heavy=3600</code>, <code>deep-research=3600</code>으로 분리했습니다. 사용자가 알려 준 약 40분은 DOM에서 확인되지 않은 UI 쪽 예산입니다.</li>
<li>Work 전용 <code>agbrowse web-ai work send --prompt "..." --power N</code> 명령과 MCP <code>web_ai_work_send</code> 도구를 추가했습니다. Chat 명령은 계속 Work에서 중단합니다.</li>
</ul>
<h2>2026-06-11</h2>
```

## 8. 레거시 격리와 문구 금지선

### 8.1 `Extended` 허용 위치

`Extended`, `Pro Extended`, `Pro Standard`, `Pro 확장`, legacy
`model-switcher-*`는 `skills/web-ai/SKILL.md`의 정확한 제목
`Legacy UI (before 2026-07-10)`와 README의 한 줄짜리
`Legacy UI (before 2026-07-10)`에서만 현재 ChatGPT 관련 서술로 허용한다.
Gemini 등 다른 provider의 고유 용어는 이 규칙의 대상이 아니다.

HTML 가이드에서는 Extended를 현재 값으로 쓰지 않고, legacy remap을 설명하는
문장에만 소문자 입력값 `extended`를 허용한다. 현재 UI 라벨처럼 title case
`Extended`를 쓰지 않는다.

### 8.2 EN/KO 동등성

EN/KO 쌍은 번역 문장 수가 아니라 계약 항목이 같아야 한다.

| 확인 항목 | EN | KO |
| --- | --- | --- |
| Instant가 GPT-5.5 | 필수 | 필수 |
| thinking `medium|high|xhigh` | 필수 | 필수 |
| flat Pro | 필수 | 필수 |
| Chat family alias와 family 미지정 무조작 | 필수 | 필수 |
| Work `work send --prompt ... --power N`와 MCP `web_ai_work_send` | 필수 | 필수 |
| Chat 명령의 Work reject와 기존 MCP `surface=work` 금지 | 필수 | 필수 |
| timeout 우선순위와 `chatgpt-pro=5400`/`grok-heavy=3600`/`deep-research=3600` | 필수 | 필수 |
| 40분 사용자 보고/DOM 미확인/timeout과 별개 | 필수 | 필수 |
| `extended` High 재매핑 + stderr 경고 1줄, Pro 선택 없음 경고 | 필수 | 필수 |
| 2026-07-10 이전 Extended UI legacy | 필수 | 필수 |

한국어 문장은 `provider`, `prompt`, `model alias`를 무작정 음역하지 않는다. 문맥상
CLI 식별자인 `model`, `effort`, `family`, `timeout`, `deadline`, `poll`만 code로
남기고 나머지는 “보내기”, “이어 받기”, “현재 값으로 바뀐다”, “지원하지 않고
중단한다”처럼 자연스럽게 쓴다.

## 9. 검증 명령과 완료 조건

### 9.1 적용 전/후 diff 범위

```bash
git diff --check -- skills/browser/browser.mjs skills/web-ai/SKILL.md README.md docs/index.html docs/dev
git diff --name-only -- skills/browser/browser.mjs skills/web-ai/SKILL.md README.md docs/index.html docs/dev
```

두 번째 출력은 §2의 16개 MODIFY 파일만 포함해야 한다. 다른 워커 변경은 reset,
checkout, format하지 않는다.

### 9.2 현재 계약 문자열

```bash
rg -n -- 'gpt-5\.6-sol|medium\|high\|xhigh|Extra High|chatgpt-pro=5400|grok-heavy=3600|deep-research=3600|work send|web_ai_work_send|stored session deadline|저장된 deadline' \
  skills/browser/browser.mjs skills/web-ai/SKILL.md README.md docs/index.html docs/dev

rg -n -- '--effort standard|--timeout 1800|Pro Extended|Pro Standard|Pro 확장|model-switcher-' \
  skills/browser/browser.mjs skills/web-ai/SKILL.md README.md docs/index.html docs/dev

if rg -n -- '--model (gpt-5\.[0-9]|o3)' \
  skills/browser/browser.mjs skills/web-ai/SKILL.md README.md docs/index.html docs/dev; then
  echo 'FAIL: family aliases must use --family, never --model' >&2
  exit 1
fi

stale_pro='pro|프로'
stale_3600='3600'
if rg -n -i -- "(${stale_pro})=${stale_3600}|${stale_3600}[- ]second (agbrowse )?(${stale_pro})|(${stale_pro}) (poll )?deadline.{0,20}${stale_3600}|${stale_3600}.{0,20}(${stale_pro}) (poll )?deadline|${stale_3600} (${stale_pro})/deep research" \
  skills/browser/browser.mjs skills/web-ai/SKILL.md README.md docs/index.html docs/dev; then
  echo 'FAIL: stale chatgpt-pro timeout contract' >&2
  exit 1
fi
```

첫 명령은 root CLI help, SKILL, README, EN/KO guide/reference/changelog에서 3-tier와
Work CLI/MCP 계약을 찾아야 한다. `agbrowse web-ai work --help`도 `send`, `--prompt`,
`--power <1..6>`를 표시해야 하며, 이 subcommand help 구현은 04가 소유한다.
두 번째 명령은 수동 감사용이다. 허용 결과는 SKILL/README의 `before 2026-07-10`
legacy 섹션과 별도 Deep Research 1800 예시뿐이다. code-mode/quickstart/Pro 예시에서
`--effort standard`나 `--timeout 1800`이 나오면 실패다.

### 9.3 EN/KO 정적 확인

새 validator 파일은 만들지 않고, 일회성 Node assertion으로 쌍을 확인한다.

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';

const pairs = [
  ['docs/dev/guides/web-ai.html', 'docs/dev/ko/guides/web-ai.html'],
  ['docs/dev/reference/cli.html', 'docs/dev/ko/reference/cli.html'],
  ['docs/dev/changelog.html', 'docs/dev/ko/changelog.html'],
  ['docs/dev/index.html', 'docs/dev/ko/index.html'],
  ['docs/dev/quickstart.html', 'docs/dev/ko/quickstart.html'],
  ['docs/dev/guides/code-mode.html', 'docs/dev/ko/guides/code-mode.html'],
];
const needles = [
  'gpt-5.6-sol', 'medium', 'high', 'xhigh',
  'chatgpt-pro', '5400', 'grok-heavy', 'deep-research', '3600',
  'work send', 'web_ai_work_send', 'stderr',
];

for (const [enPath, koPath] of pairs) {
  const en = fs.readFileSync(enPath, 'utf8');
  const ko = fs.readFileSync(koPath, 'utf8');
  if (!en.endsWith('</html>\n') && !en.endsWith('</html>')) throw new Error(`${enPath}: missing closing html`);
  if (!ko.endsWith('</html>\n') && !ko.endsWith('</html>')) throw new Error(`${koPath}: missing closing html`);
  if (en.includes('--effort standard') || ko.includes('--effort standard')) throw new Error(`${enPath}: stale code example`);
  if (enPath.includes('web-ai') || enPath.includes('reference/cli')) {
    for (const needle of needles) {
      if (!en.includes(needle) || !ko.includes(needle)) throw new Error(`${enPath}: EN/KO missing ${needle}`);
    }
  }
}
console.log(`PASS ${pairs.length} EN/KO documentation pairs`);
NODE
```

changelog/index/quickstart/code-mode에는 모든 alias 표를 반복하지 않으므로 assertion은
guide/reference 쌍에만 전체 needle을 요구한다. 모든 쌍에는 closing HTML과 stale
`--effort standard` 부재를 요구한다.

### 9.4 저장소 게이트와 수동 HTML smoke

```bash
npm run docs:drift
python3 -m http.server 4173 --directory docs
```

브라우저에서 `/index.html`, `/dev/index.html`, `/dev/ko/index.html`,
`/dev/guides/web-ai.html`, `/dev/ko/guides/web-ai.html`, `/dev/reference/cli.html`,
`/dev/ko/reference/cli.html`, `/dev/changelog.html`, `/dev/ko/changelog.html`을 연다.
표가 sidebar 폭을 침범하지 않는지, code block이 잘리지 않는지, EN↔KO 링크가
왕복하는지 확인한다. 별도 Playwright/HTML generator를 설치하지 않는다.

### 9.5 완료 조건

- §2의 16개 파일만 수정됐다.
- root CLI help가 `work send --prompt ... --power N`, Chat family의 `--family`,
  canonical `medium|high|xhigh`, 3-tier timeout, 저장 deadline 상속 예시를 표시한다.
- SKILL, README, docs EN/KO가 Work CLI와 MCP `web_ai_work_send`를 함께 안내하며 Chat
  명령과 `web_ai_submit_prompt`의 Work reject를 유지한다.
- `--family` 미지정은 family submenu mutation 0회이고 현재 UI 선택을 보존한다고
  모든 Chat 계약 표면에 적힌다.
- 모든 현재 예시가 `medium|high|xhigh` 또는 flat `pro` 계약을 쓴다.
- Pro submit/poll 예시는 저장된 `chatgpt-pro` deadline 5400초(90분) 상속을 보여 주며 1800초를 강제하지
  않는다.
- timeout 표는 `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600`의 3행이며
  vendor 1200/1200/600은 “tier 미확인 fallback”으로만 남는다.
- 약 40분은 모든 표면에서 사용자 보고, DOM 미확인, UI 쪽 값으로만 적힌다.
- legacy `extended`는 High 재매핑 뒤 stderr 경고 1줄, legacy Pro effort는 flat Pro
  선택 없음 경고 1줄 계약을 담고, Extended UI 라벨은 이전 UI 설명에만 남는다.
- EN/KO 여섯 쌍이 같은 계약을 담고 한국어 문장이 번역투 없이 읽힌다.
- `git diff --check`, Node EN/KO assertion, `npm run docs:drift`, 정적 HTML smoke가 모두
  통과한다.
