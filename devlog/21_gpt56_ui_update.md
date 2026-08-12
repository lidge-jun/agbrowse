# GPT-5.6 UI 업데이트 대응

2026-07-10. ChatGPT 웹 UI가 GPT-5.6 계열로 전면 개편되면서 agbrowse web-ai의
모델/effort 피커 계약 전체가 파손됐다. 같은 날 라이브 프로브 → 계약 재설계 →
병렬 패치 → 전수 회귀까지 완료했다.

## UI 파손 내역

- **Intelligence 플랫 라디오**: 기존 모델 피커 드롭다운이 Instant / Medium /
  High / Extra High / Pro 5단 라디오로 교체됐다.
- **Extended 소멸**: `Extended`와 `Pro Extended` 라벨이 UI에서 완전히 사라졌다.
  `--effort extended`는 High로 재매핑하고 legacy 경고 1줄을 방출한다.
- **testid 붕괴**: `model-switcher-*` menuitemradio 기반 data-testid 체계가
  전멸했다. 신규 testid는 컨테이너/보조 요소 층위에만 존재한다
  (`composer-intelligence-picker-content`, `composer-model-picker-slider-*` 등).
- **Chat / Work 분리**: 헤더에 Chat / Work 세그먼트 토글(role=radio)이 생겼다.
  Work 표면은 별도 컴포저와 Power 슬라이더(6단계), Advanced(Model / Effort /
  Speed) 구조를 갖는다.

## 계약 결정

### family 플래그 5종

Chat surface에서 `--family`로 선택 가능한 canonical 값은 다섯 개로 닫았다.

| `family` | DOM 라벨 |
| --- | --- |
| `gpt-5.6-sol` | GPT-5.6 Sol |
| `gpt-5.5` | GPT-5.5 |
| `gpt-5.4` | GPT-5.4 |
| `gpt-5.3` | GPT-5.3 |
| `o3` | o3 |

Terra와 Luna는 Work Model 서브메뉴에서만 실측됐으므로 Chat family에서 제외했다.
`--family` 생략 시 family submenu를 열지 않고 현재 UI 선택을 그대로 존중한다.

### effort 정규화

canonical effort는 `medium` / `high` / `xhigh` 3종이다. 14개 legacy alias를
정규화한다.

| alias | 정규화 결과 |
| --- | --- |
| `medium`, `standard`, `normal`, `regular`, `default`, `light`, `low` | medium |
| `high`, `extended` | high |
| `xhigh`, `extra-high`, `extra_high`, `extra high`, `heavy` | xhigh |

`extended → high` 재매핑 시 stderr로 `extended is a legacy alias; selected High`
경고를 방출한다.

### timeout tier 3분리

기존 단일 Pro 3600s를 세 tier로 분리했다.

| tier key | 기본 timeout | 용도 |
| --- | --- | --- |
| `chatgpt-pro` | 5400s (90분) | ChatGPT Pro |
| `grok-heavy` | 3600s | Grok heavy reasoning |
| `deep-research` | 3600s | Deep Research |

`deriveTimeoutTier`가 vendor+model 조합으로 올바른 tier key를 반환하며,
교차 오염은 테스트에서 검증한다.

### Work send v1

Chat 명령(`send` / `query` / `poll` / `watch`, MCP `web_ai_submit_prompt`)은
Work 표면에서 hard-error를 유지한다. Work mutation의 진입점은 두 가지다.

- CLI: `web-ai work send --prompt <text> --power <1..6> [--speed standard|fast] [--timeout <seconds>]`
- MCP: `web_ai_work_send` (prompt, power required; speed, timeout optional;
  `additionalProperties: false`)

## Power 매핑 (라이브 실측)

WP1 인앱 브라우저 프로브로 Power 1..6과 내부 모델/effort 조합을 확정했다.

| Power | DOM slider | Model | Effort |
| --- | --- | --- | --- |
| 1 | 0 | Terra | Light |
| 2 | 1 | Sol | Light |
| 3 (기본) | 2 | Sol | Medium |
| 4 | 3 | Sol | High |
| 5 | 4 | Sol | Extra High |
| 6 | 5 | Sol | Ultra |

Speed(Standard / Fast)는 Power와 독립이며, Advanced Effort 변경은 compact
Power 프리셋을 결정론적으로 재설정한다.

## Work send / poll 수리

### Round 1: global send-button fallback + keyboard Enter leak

`submitPromptFromComposer`(chatgpt-composer.mjs)를 Work에 그대로 쓰자 두 가지
결함이 발생했다. send 버튼 탐색이 `document` 전역으로 fallback하면서 잘못된
요소를 클릭했고, 버튼 실패 시 `page.keyboard.press('Enter')` fallback이 Korean
IME ProseMirror에서 합성 문자를 삽입했다. 수정: Work 전용
`submitWorkPrompt`를 신설해 `form button[data-testid="send-button"]`로 composer
form 안에서만 send 버튼을 찾고, keyboard Enter fallback을 제거했다. 커밋 검증
(user turn visible + running indicator 출현)을 통과해야 세션을 생성한다.

### Round 2: premature taskUrl capture + wrong-tab recovery rebinding

커밋 직후 URL 전이(`/c/<uuid>`)를 캡처하는 시점이 너무 이르러 taskUrl이 빈
상태로 저장됐고, poll 라우팅에서 4개 진입점(cli poll, cli-sessions resume,
mcp wait/resume, watcher tick)이 Work 세션을 Chat `pollWebAi`로 보내
timeout 됐다. 동일 유닛 내 후속 수리 워커가 `isWorkSession` predicate 신설과
`pollWorkSession` 라우팅을 적용했다. 상세 증거:
`.codexclaw/evidence/260710_work_poll_routing_and_send_fix.md`.

## 최종 검증

| 항목 | 결과 |
| --- | --- |
| 유닛 테스트 | 141 files / 1261 tests, 전 PASS (vitest 55.8s) |
| doc-drift | 164/164 PASS (`structure/check-doc-drift.sh`) |
| 적대 리뷰 | VERDICT: PASS (contract drift·timeout tier·Work safety·zero-touch·dead symbol·test honesty·docs spot-check 전 항목 green) |

## 증거 원장

`.codexclaw/evidence/260710_*.md` 아래 40여 건. 주요 파일:

- `260710_wp1_live_work_probe.md` — WP1 15-row 라이브 프로브 결과
- `260710_wp1_audit_pass.md` — WP1 3-round 감사 PASS
- `260710_final_adversarial_review.md` — 최종 적대 리뷰 VERDICT: PASS
- `260710_work_poll_routing_and_send_fix.md` — Work send/poll 수리 round 2
- `260710_wp0_reconciliation_canon.md` — WP0 정합화 캐논 13개 결정

## 계획 문서

`devlog/_fin/260710_gpt56_update/` (00~10, 11 파일 + assets).
