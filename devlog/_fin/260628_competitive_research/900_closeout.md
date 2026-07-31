# 900 — competitive research 유닛 종료 감사 (2026-07-31)

이 유닛은 리서치 산출물이고 구현 결정은 후속 유닛이 승계했다. 여기서는
`02_schema_bound_extraction.md:212-218`의 미해결 질문 5개를 각각 어떻게
처분했는지 확인한다.

## 승계 관계

`devlog/_plan/260705_gapclose/00_index.md:5-7`이 이 유닛을 명시적으로 후속으로
선언한다.

> 260628 competitive_research 두 문서(agent-browser 분석, schema-bound
> extraction 조사)의 후속이며, 그 문서들이 "무엇이 다른가"를 다뤘다면 이
> 시리즈는 "그래서 무엇을 하고 무엇을 안 하는가"를 결정한다.

다만 일반적 승계 선언만으로는 개별 질문의 처분을 알 수 없다. 아래가 그 대조다.

## 미해결 질문 disposition

| 질문 | 판정 | 근거 |
| --- | --- | --- |
| Ajv vs Zod: 의존성 크기, DX, TS 호환 | **해결** — 자체 validator 채택, Zod는 비목표 | `skills/browser/extract.mjs:38`이 `web-ai/extract-schema.mjs`의 자체 validator를 쓴다. `260705_gapclose/20_phase10_extract_impl.md:30`이 "Zod/TS 타입 추론"을 non-goal로 명시 |
| LLM DOM 전달 토큰 예산 | **해결** — HTML 12,000자로 제한 | `skills/browser/extract.mjs:496` `html.replace(...).slice(0, 12_000)` |
| 캐시 전략(같은 URL + schema) | **비목표** | `260705_gapclose/20_phase10_extract_impl.md:30`이 server cache를 non-goal로 명시 |
| web-ai 세션 기본값(ChatGPT vs Gemini) | **해결** — Grok | `skills/browser/extract.mjs:61` `vendor: { type: 'string', default: 'grok' }` |
| 다국어 instruction 지원 범위 | **deferred / 비목표** — 해결 아님 | 현재 CLI에 instruction 옵션 자체가 없다(`skills/browser/extract.mjs:53-64`). 질문이 사라진 게 아니라 그 전제가 아직 없다 |

마지막 행을 "해결"로 적지 않는다. 기능이 도입되면 그때 다시 판단할 질문이다.

## 미이행

다국어 instruction 하나. 다만 이것은 이 리서치 유닛이 답할 수 있는 질문이
아니라 기능 도입 시점의 설계 결정이다.

## 판정

**종료.** `_fin`으로 이관한다.

표현을 정확히 하면 "모든 질문이 해결됐다"가 아니라 **research superseded** —
연구는 끝났고 구현 선택은 `260705_gapclose`가 승계했으며, 미해결로 남은 하나는
전제가 없어 보류된 상태다.
