# 260710 gpt56_update — GPT-5.6 UI 업데이트 대응 인덱스

## 실행 결과 (2026-07-10)

이 유닛은 계획 당일에 전량 실행 완료했다.

- **WP0** 플랜 정합화: 인터뷰 확정 결정(10_patch_interview.md)을 02~09에 역주입, 8기 워커(A~H) 병렬 처리.
- **WP1** 라이브 프로브: 인앱 브라우저 실측 15/15 PASS (base 5 + reverse-engineering 10). Power 1..6 매핑 확정.
- **WP2~WP7** 02~09 패치 전수 적용: 병렬 워커가 fixture·계약·selector·Work send·timeout·fallback·docs·gate를 일괄 반영.
- **최종 전수 회귀**: 141 test files / 1261 tests 전 PASS, doc-drift 164건 green.
- **Work send/poll 수리**: round 1 global send-button fallback + keyboard Enter leak 수정, round 2 premature taskUrl capture + wrong-tab recovery rebinding 수정(동일 유닛 내 후속 워커 처리).
- **최종 적대 리뷰**: VERDICT: PASS (cross-integration 8-worker audit, blocker 0).

증거 원장: `.codexclaw/evidence/260710_*.md` (40+ 파일).
구현 devlog: `devlog/21_gpt56_ui_update.md`.

2026-07-10, ChatGPT 웹 UI가 GPT-5.6 계열로 개편되면서 agbrowse web-ai의
ChatGPT 모델/effort 피커 계약이 대규모로 어긋났다. 이 유닛은 (1) 새 UI를
라이브 프로브로 실측 고정하고, (2) 코드·테스트·문서 전 표면을 전수 분석해,
(3) 01~09 diff-level 패치 준비 문서로 남긴다. **이 유닛의 범위는 패치 준비까지** —
실제 소스 패치는 다음 유닛이 02~09를 실행한다(01은 증거 입력, 10은 인터뷰 기록).

핵심 실측 요약 (근거: `01_ui_contract_evidence.md`):

- Chat 표면 피커가 "Intelligence" 플랫 라디오(`Instant(5.5)/Medium/High/Extra High/Pro`)로
  바뀌었고 **`Extended`/`Pro Extended` 라벨은 소멸**했다.
- 메뉴 항목(menuitemradio) 단위의 `model-switcher-*` data-testid 체계가
  **완전히 사라졌다.** 신규 관측 testid는 컨테이너/보조 요소 층위에만 존재:
  `composer-intelligence-picker-content`,
  `composer-model-picker-slider-{simple,advanced}-view`,
  `menu-item-submenu-chevron`, `composer-plus-btn` (01 §2·§3 전체 목록).
- 헤더에 **Chat/Work 세그먼트 토글**(role=radio)이 생겼고, Work 표면은
  별도 컴포저 + **Power 슬라이더(6단계)** + Advanced(Model/Effort/Speed) 구조다.
- Work Model 서브메뉴: `GPT-5.6 Sol / GPT-5.6 Terra / GPT-5.6 Luna / GPT-5.5`.
- Work Effort 서브메뉴: `Light/Medium/High/Extra High/Max/Ultra` (6단계).
- 결합 의미(사용자 확인): Chat에서 **Instant만 GPT-5.5**, 나머지 티어는
  선택된 패밀리(GPT-5.6 Sol)로 실행.
- ChatGPT Pro 자동화 시간 예산은 `chatgpt-pro=5400s(90분)` SSOT를 사용한다. 사용자
  보고의 "기본 추론 40분"은 DOM 미확인 관측이며 timeout 상수 근거로 사용하지 않는다.

## 문서 목록

| # | 문서 | 성격 | 대상 표면 |
| --- | --- | --- | --- |
| 00 | 이 인덱스 | 네비게이터 | — |
| 01 | `01_ui_contract_evidence.md` | 실측 증거 | 2026-07-10 라이브 프로브 DOM/스크린샷 |
| 02 | `02_core_contract_decisions.md` | 계약 결정 (M) | 2축 공개 입력 모델(surface/family/tier/effort — **Chat 표면 한정**), legacy alias 정책(`thinking/light/high/extended` 재매핑), `modelSelection` 증거 스키마, Chat/Work 공유 testid에 대한 surface discriminator + composer-scoped picker root. 기존 Chat 명령과 `web_ai_submit_prompt`는 Work 표면을 스키마/가드 단계에서 reject하며, 기존 도구에 `surface=work`를 확장하지 않는다. Work 전용 `power/speed/Max/Ultra`의 시행과 전용 CLI/MCP 진입점은 04 소유다. 소유: `web-ai/chatgpt-model.mjs:6-7` typedef, `web-ai/cli.mjs:1647-1674` alias 행렬, `web-ai/tool-schema.mjs:49-75` (MCP 스키마 SSOT — `mcp-server.mjs:204-210`은 전달자), `web-ai/chatgpt.mjs:111,178-199` 증거 배선. **+ 02 자기 테스트 소유**: CLI alias 행렬(`test/integration/web-ai-cli-contract.test.mjs`), MCP 스키마(`test/unit/web-ai-tool-schema.test.mjs`), 2축 evidence 계약(`test/unit/web-ai-sessions-command.test.mjs` 확장) |
| 03 | `03_chat_picker_selector_patch.md` | 패치 준비 (M) | 02 계약을 구현하는 Chat 피커 셀렉터/메뉴 판정 diff — `chatgpt-model.mjs` 라벨 테이블·`isModelMenuOpen`·`requiredEffortMenuLabels`·pill 판독 + **해당 unit 테스트**(`test/unit/web-ai-chatgpt-model.test.mjs`) |
| 04 | `04_work_surface_support.md` | 패치 준비 (M) | Work 감지·Chat 오발 방지 가드와 **Work 자동화**를 소유한다. Work mutation의 유일한 진입점은 최상위 CLI `web-ai work send --prompt ... --power N`(project-sources 선례의 2단 파서)과 MCP `web_ai_work_send`; 기존 Chat `send/query/poll/watch` 및 `web_ai_submit_prompt`는 Work 표면에서 hard-error를 유지한다. Power/Model/Effort/Speed 조작과 Work 제출/poll/session 재사용은 WP1 라이브 재프로브 및 공식 Power 매핑 검증 증거를 소비해 구현·검증한다. |
| 05 | `05_pro_timeout_budget.md` | 패치 준비 (M) | 타임아웃 상속 — 40분 상수 신설 금지, tier를 `chatgpt-pro=5400s(90분)` / `grok-heavy=3600s` / `deep-research=3600s`로 3분리하고 비혼입을 검증한다. **우선순위 명세: explicit timeout → 저장된 세션 deadline 잔여 시간 → tier default — 단, 저장 deadline이 상속 우선권을 가지므로 deadline "생성" 경로가 tier-aware여야 한다.** **최초 submit deadline resolver도 05 소유**: timeout 미지정 MCP `web_ai_submit_prompt(model=pro)`가 `mcp-server.mjs:204`에서 그대로 전달돼 `chatgpt.mjs:194`가 `session.mjs:372-379` vendor 기본 1200s로 deadline을 저장하는 경로를 tier default(`deriveTimeoutTier`) 경유로 교정 + 해당 회귀 테스트. 실행 소유자 전수: 최초 deadline 생성 `chatgpt.mjs:194`/`session.mjs:372-402`, 단일 poll fallback `chatgpt.mjs:327`, watch 덮어쓰기 `watcher.mjs:71,314`, 일반 resume `cli-sessions.mjs:111-126`, DR resume 20분 상수 `chatgpt-deep-research.mjs:403-405`, CLI 기본 주입 `cli.mjs:651-656`, MCP 전달 `mcp-server.mjs:204,241-265`, 스키마 서술 `tool-schema.mjs` + 타임아웃 테스트(`test/unit/web-ai-timeout-default.test.mjs` 확장, MCP submit 회귀 포함) |
| 06 | `06_runtime_integration_fallbacks.md` | 패치 준비 (M) | capability probe·`capability-observation-presets.mjs`·`capability-registry.mjs:237-248`·`doctor.mjs:18-24`·`tab-inspect.mjs:24-43`·`vendor-editor-contract.mjs:111-120`·`cli-sessions.mjs:275-285` 증거 출력 + 통합 테스트 |
| 07 | `07_tests_fixtures.md` | 패치 준비 (S) | Part 1 공유 5.6 sanitized DOM fixture(WP2 선행) + Part 2 최종 회귀 매트릭스(WP7; 각 표면 테스트는 02~06이 소유) |
| 08 | `08_docs_skill_sync.md` | 패치 준비 (M) | SKILL.md/README/docs HTML EN·KO |
| 09 | `09_structure_sot_gates.md` | 패치 준비 (S) | structure/ SoT + doc-drift/release 게이트 + 클로즈아웃 |

실행 순서(fixture-first): **WP1 Work 라이브 재프로브**(01 §5.1의 5항목 +
04 §7.2의 역설계 10항목 + 공식 Power 매핑
`1=Terra Light, 2=Sol Light, 3=Sol Medium(기본), 4=Sol High, 5=Sol xHigh,
6=Sol Ultra` 검증) → **`npm ci`로 lockfile 의존성/Vitest 3.2.6 복원** →
**WP2 07 Part 1 fixture + 02** → **WP3 03** →
**WP4 04**(Work send CLI + MCP `web_ai_work_send`, WP1 증거 소비) → **WP5 05** →
**WP6 06** → **WP7 08 + 09 + 07 Part 2 최종 회귀**. 각 phase P에서 문서 앵커를
stale-check한다. 02~06은 WP2 fixture 선행을 전제로 각자 소유 테스트를 포함해 독립 검증
가능해야 한다(PHASE-SPLIT-01).

## 리서치 방법

- 라이브 프로브: 인앱 브라우저(로그인된 사용자 세션)로 chatgpt.com 직접 조작.
  agbrowse 자체 CDP 레인은 headed 기동이 macOS Chrome 싱글턴에 흡수되고
  헤드리스는 Cloudflare 챌린지 + 비로그인 프로필로 모델 피커 도달 불가 —
  사유 기록 후 네이티브 티어로 폴백 (SEARCH-BROWSE-01).
- 표면 분석: sol(gpt-5.6-sol/xhigh) explorer 4레인 병렬 팬아웃 —
  코드 계약 / 타임아웃 / 문서 SoT / 테스트. 각 레인 검색 로그는 해당
  패치 문서에 인용.
- goalplan: `.codexclaw/goalplans/agbrowse-gpt-5-6-ui-devlog-plan-260710-gpt56-upd/`.
