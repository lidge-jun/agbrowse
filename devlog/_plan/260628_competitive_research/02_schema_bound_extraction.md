# Schema-Bound Extraction 조사 + agbrowse 구현 방향

Research date: 2026-06-28

## 1. 문제 정의

사용자가 **"이 페이지에서 가격표만 뽑아줘"** 하면 깔끔한 JSON이 나와야 하는데,
agbrowse는 현재 그렇게 못 한다. 경쟁 도구(Stagehand, AgentQL)는 이걸 핵심 기능으로
제공한다.

### agbrowse 현재 상태

`adaptive-fetch/structured-extractor.mjs`가 **HTML에서 table/heading/list/code/JSON-LD를
regex 기반으로 추출**하지만:

- 스키마 정의 불가 — "이런 모양의 JSON을 달라"고 못 함
- LLM 없이 순수 정규식 — 비정형 레이아웃(div grid, CSS table, flexbox 리스트)은 놓침
- natural language 지시 불가 — "price only" 같은 필터 없음

## 2. 경쟁 도구 분석

### 2.1 Stagehand (Browserbase) — Schema + LLM

```typescript
const data = await stagehand.extract(
  "extract product details",
  z.object({
    name: z.string(),
    price: z.number(),
    inStock: z.boolean(),
  })
);
```

**동작 원리:**
1. Zod 스키마(또는 JSON Schema)를 받음
2. 페이지 DOM을 LLM에 전달
3. LLM이 스키마에 맞는 JSON을 반환
4. Zod로 validate & type-safe 반환

**장점:**
- 타입 안전 (Zod 추론)
- `.describe()`로 추출 힌트 제공
- 네스티드 스키마, 배열, optional 지원
- 캐시 시스템 (Browserbase 환경에서 server-side cache)

**단점:**
- Browserbase 종속 (hosted browser)
- LLM API 호출 비용
- 로컬 전용 사용 어려움 (로컬 Chrome에서는 LLM만 필요)

**최신 변경 (2026):**
- v2 agent에서 Zod 문자열 평가(`new Function()`) → JSON Schema 변환으로 전환 (보안)
- `jsonSchemaToZod()` 함수로 safe 변환

### 2.2 AgentQL (TinyFish) — Query Language

```
{
  products[] {
    name
    price
    rating
  }
}
```

**동작 원리:**
1. 독자적 쿼리 언어 (GraphQL-like) 정의
2. AI가 페이지 구조를 분석해 해당 데이터 위치 찾음
3. 구조화된 JSON 반환
4. REST API 또는 Playwright SDK로 호출

**장점:**
- self-healing (UI 변경에도 동작)
- cross-site compatible (같은 쿼리가 여러 사이트에 작동)
- browserless mode (REST API로 URL만 주면 됨)
- natural language + 구조 정의 혼합

**단점:**
- 폐쇄적 API (유료 SaaS)
- 독자 쿼리 언어 학습 필요
- 로컬 자체 배포 불가

### 2.3 비교표

| 항목 | Stagehand | AgentQL | agbrowse (현재) |
|------|-----------|---------|-----------------|
| 스키마 정의 | Zod/JSON Schema | 독자 QL | 없음 (고정 형식) |
| LLM 사용 | ✅ (Claude/GPT) | ✅ (자체 AI) | ❌ |
| 로컬 전용 | ❌ (Browserbase) | ❌ (SaaS) | ✅ |
| 토큰 비용 | 높음 | 숨김 (SaaS) | 0 |
| 비정형 레이아웃 | ✅ | ✅ | ❌ (table/list only) |
| self-healing | ✅ | ✅ | ❌ |
| 타입 안전 | ✅ (Zod) | ❌ (JSON only) | ❌ |

## 3. agbrowse 구현 방향

### 3.1 설계 원칙

1. **로컬 퍼스트** — 외부 SaaS 의존 없이 동작해야 함
2. **LLM 선택적** — LLM 없이도 기본 추출, LLM으로 정밀 추출
3. **CLI 인터페이스** — 에이전트가 파이프로 사용 가능
4. **기존 모듈 재사용** — `structured-extractor.mjs` + `defuddle-extractor.mjs` 활용

### 3.2 제안 인터페이스

```bash
# JSON Schema 파일로 추출
agbrowse extract https://example.com/products \
  --schema '{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"}}}}'

# 자연어 지시 + schema
agbrowse extract https://example.com/products \
  --instruction "extract all product listings with name and price" \
  --schema products.schema.json

# schema 없이 자연어만 (LLM 필수)
agbrowse extract https://example.com/products \
  --instruction "extract the pricing table"

# 파이프 모드 (이전 snapshot HTML에서 추출)
agbrowse snapshot --html | agbrowse extract --stdin --schema '{...}'
```

### 3.3 2-tier 추출 아키텍처

```
Tier 1: Rule-based (LLM 불필요, 빠름, 무료)
├── JSON-LD extraction (이미 구현)
├── <table> / <thead> / <tbody> parsing (이미 구현)
├── Schema.org microdata extraction (신규)
├── Open Graph / meta tag extraction (신규)
├── CSS selector 기반 반복 패턴 탐지 (신규)
└── 출력: StructuredContent + schema match score

Tier 2: LLM-assisted (정밀, 비용 발생)
├── DOM chunk → LLM prompt + JSON Schema
├── schema validation (Zod 또는 Ajv)
├── retry on validation failure
└── 출력: typed JSON matching schema
```

**Tier 전환 로직:**
1. Tier 1 시도 → schema match score > 0.8 → Tier 1 결과 반환
2. Tier 1 score < 0.8 OR `--llm` 플래그 → Tier 2 에스컬레이션
3. `--no-llm` 플래그 → Tier 1만 사용 (비용 0 보장)

### 3.4 LLM Provider 선택

agbrowse의 독자적 강점인 **web-ai** 모듈을 활용:

| 모드 | Provider | 비용 |
|------|----------|------|
| Local LLM (선호) | Ollama / llama.cpp (JSON mode) | $0 |
| web-ai 경유 | ChatGPT / Gemini (이미 세션 있음) | 구독 내 |
| API 직접 | OpenAI / Anthropic API key | per-token |

**핵심 차별점**: Stagehand/AgentQL은 자체 LLM 비용을 숨기거나 SaaS로 번들.
agbrowse는 **사용자의 기존 web-ai 세션(ChatGPT Plus 등)을 재활용**해서 추가 비용 0.

### 3.5 JSON Schema Validation 전략

```mjs
// 후보 라이브러리
import Ajv from 'ajv';         // JSON Schema validator (200KB, 표준)
// 또는
import { z } from 'zod';      // Zod (TS 타입 추론, 더 큰 의존성)

// 추천: Ajv (JSON Schema 표준, 에이전트 호환성 높음, CLI-friendly)
```

Zod는 TypeScript 프로젝트에서 DX가 좋지만, agbrowse는 ESM/JS CLI이므로
**JSON Schema (Ajv)가 더 적합**:
- 에이전트가 JSON Schema를 이미 잘 생성함
- 파일로 저장/전달 용이
- Stagehand v2도 결국 JSON Schema로 전환함

### 3.6 구현 파일 구조 (예상)

```
skills/browser/
├── extract.mjs              # CLI 엔트리 (agbrowse extract)
├── adaptive-fetch/
│   ├── structured-extractor.mjs   # 기존 (Tier 1 백본)
│   ├── schema-matcher.mjs         # 신규: Tier 1 결과 → schema 매칭
│   └── llm-extractor.mjs          # 신규: Tier 2 LLM 추출
```

### 3.7 구현 우선순위

| 순서 | 항목 | 복잡도 | 영향 |
|------|------|--------|------|
| 1 | `agbrowse extract --schema` CLI 스켈레톤 | 낮음 | 인터페이스 확립 |
| 2 | Schema.org / microdata / OG 추출 (Tier 1 확장) | 중간 | 무료 추출 범위 확대 |
| 3 | CSS 반복 패턴 탐지 (product card 등) | 중간 | 비정형 레이아웃 커버 |
| 4 | Ajv schema validation + match scoring | 낮음 | Tier 전환 판단 |
| 5 | LLM extractor (web-ai 세션 재활용) | 높음 | 핵심 차별점 |
| 6 | Ollama/local LLM JSON mode 지원 | 중간 | 비용 0 옵션 |
| 7 | `--stdin` 파이프 모드 | 낮음 | 에이전트 워크플로우 통합 |

## 4. 경쟁 우위 요약

agbrowse의 schema-bound extraction이 Stagehand/AgentQL과 다른 점:

1. **로컬 퍼스트** — SaaS 불필요, 오프라인 동작 가능
2. **LLM 비용 0 옵션** — Tier 1으로 구조화된 페이지는 무료 추출
3. **기존 세션 재활용** — web-ai의 ChatGPT Plus 세션 경유, 추가 API 비용 없음
4. **CLI 파이프 호환** — stdin/stdout, JSON output, 에이전트 체이닝
5. **점진적 에스컬레이션** — rule → LLM fallback, 비용 제어 가능

## 5. 미해결 질문

- [ ] Ajv vs Zod: 의존성 크기, 에이전트 DX, TypeScript 프로젝트 호환
- [ ] LLM DOM 전달 시 토큰 예산: 전체 DOM vs snapshot text vs 선택 영역
- [ ] 캐시 전략: 같은 URL + 같은 schema → 결과 캐시 기간
- [ ] web-ai 세션 선택: extract에 ChatGPT vs Gemini 중 뭘 기본으로 쓸지
- [ ] 다국어 지시: "가격표 뽑아줘" 같은 한국어 instruction 지원 범위
