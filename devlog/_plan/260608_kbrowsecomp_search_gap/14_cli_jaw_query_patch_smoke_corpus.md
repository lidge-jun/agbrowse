# 14. cli-jaw Query Patch Smoke Corpus

## Purpose

The next cli-jaw patch should improve the way agents send Korean search
queries. This is deliberately narrower than implementing a new search backend
or a full fetch/browser research loop.

The prompt patch should make agents:

1. Rewrite Korean natural-language search requests into focused keyword
   queries.
2. Preserve source hints such as official domains, Naver, dates, and content
   type.
3. Treat search results as URL candidates, not final answers.
4. Decide when fetch or browse is needed after search.

## Patch Boundary

Patch target:

```text
/Users/jun/Developer/new/700_projects/cli-jaw/src/prompt/templates/a1-system.md
/Users/jun/Developer/new/700_projects/cli-jaw/src/prompt/templates/skills.md
```

Non-targets for the first patch:

- Do not patch generated instance prompts under
  `/Users/jun/.cli-jaw-3461/prompts/*`.
- Do not implement a new search API.
- Do not modify `cli-jaw browser fetch`.
- Do not change agbrowse runtime behavior.

The patch should be a source-template prompt change only. Generated prompts
should update through the normal build/deploy path.

## Smoke Corpus

The smoke set should include the two provider-probe queries plus 2-3
K-BrowseComp-shaped cases. These are smoke prompts, not gold-answer fixtures.
They test whether the agent chooses better search behavior.

### S1. Fresh Korean Public Policy

User prompt:

```text
2026년 한국 전기차 보조금 지자체별 차이 최신 기준 찾아봐
```

Expected query behavior:

- Do not rely on a synthesized search answer.
- Rewrite into official/source-aware variants such as:

```text
2026 전기차 보조금 지자체별 무공해차 통합누리집
site:ev.or.kr 2026 전기차 보조금 지자체 지원금
환경부 2026 전기차 구매보조금 지자체 보조금
```

Expected follow-up judgment:

- Treat search results as candidate URLs.
- Fetch readable official or policy pages when possible.
- If `ev.or.kr` is empty, truncated, timeout, or JS-only, escalate to browser
  browse.

Pass signal:

- The agent explicitly identifies official/source-aware query variants before
  final answer synthesis.

### S2. Naver Blog Original Evidence

User prompt:

```text
네이버 블로그 글에서 특정 후기 원문 확인이 필요한 경우 검색 결과만으로 충분한가
```

Expected query behavior:

- Recognize that this is an original-source verification problem.
- Avoid treating snippets as evidence.
- Rewrite toward Naver/source-specific discovery:

```text
site:blog.naver.com 후기 원문 확인
site:blog.naver.com "후기" "내돈내산" "원문"
네이버 블로그 PostView 원문 iframe 확인
```

Expected follow-up judgment:

- Search snippets are not enough for an original-review claim.
- Fetch PostView/canonical URLs if available.
- Use browse if `blog.naver.com` shell pages hide the body.

Pass signal:

- The agent refuses to treat snippet text as original review evidence and names
  fetch/browse as the verification step.

### S3. K-BrowseComp-Style Multi-Constraint Entity Query

User prompt shape:

```text
한국 영화 중 신인 감독상과 신인 여우상 조건이 모두 맞고, 뮤지컬화 여부와 네이버 영화 평점을 확인해야 하는 사례를 찾아봐
```

Expected query behavior:

- Do not search the full sentence once.
- Split into anchor/source queries:

```text
한국 영화 신인 감독상 신인 여우상 뮤지컬화
네이버 영화 평점 한국 영화 신인 감독상 신인 여우상
```

Expected follow-up judgment:

- Use search to discover candidates.
- Fetch/browse candidate pages to verify each condition.
- Preserve pending constraints instead of finalizing from one snippet.

Pass signal:

- The agent produces separate discovery and verification queries.

### S4. K-BrowseComp-Style Official Notice / Date Constraint

User prompt shape:

```text
2025년 6월 특정 공지사항에서 제목과 숫자 조건을 동시에 만족하는 항목을 찾아봐
```

Expected query behavior:

- Preserve date and official/source hint.
- Prefer source-restricted query when a domain or institution is known.
- If no domain is given, ask for the source or search broader official variants.

Example rewrite shape:

```text
2025년 6월 공지사항 제목 숫자 공식
site:<official-domain> 공지사항 2025년 6월 제목 숫자
```

Expected follow-up judgment:

- Search snippets are ranking hints.
- Fetch official notice pages.
- Use browse for tabbed notice lists, pagination, or JS-rendered search results.

Pass signal:

- The agent does not drop the date constraint and does not answer from a
  snippet-only result.

### S5. K-BrowseComp-Style Table/List/Ordinal Query

User prompt shape:

```text
어떤 한국어 페이지의 표나 목록에서 n번째 항목과 그 항목의 세부 값을 확인해야 하는 문제를 찾아봐
```

Expected query behavior:

- Recognize table/list/ordinal evidence as unsafe in snippets.
- Generate content-type-aware query variants:

```text
한국어 표 목록 n번째 항목 세부 값
site:<source-domain> 목록 표 n번째 항목
```

Expected follow-up judgment:

- Fetch only passes if the table/list structure is visible.
- Browser browse is needed for tabs, accordions, pagination, infinite scroll, or
  JS-rendered tables.

Pass signal:

- The agent says the final answer requires page/table evidence, not a search
  snippet.

## Manual Smoke Pass Criteria

The first pass criterion is behavior, not answer accuracy.

A smoke run passes when the agent:

1. Produces 1-3 focused Korean query rewrites.
2. Preserves source hints, date constraints, and content-type hints.
3. Treats search output as URL candidates.
4. Names fetch as the next step for readable pages.
5. Names browse/browser escalation for dynamic, empty, truncated, Naver, or
   JS-rendered pages.

A smoke run fails when the agent:

- Sends only the full Korean natural-language prompt as the search query.
- Answers from search synthesis/snippets without original-source verification.
- Drops date/source/table/list constraints.
- Treats Naver Blog snippets as original review evidence.
- Fails to mention fetch or browser escalation after weak search results.

## Patch Implication For cli-jaw

The prompt patch should add a compact Korean-search protocol near the existing
search intent guard:

```text
Korean search request
  -> classify external/current/source-sensitive intent
  -> rewrite into 1-3 focused keyword queries
  -> search for URL candidates
  -> fetch original URLs when possible
  -> browse when fetch cannot see the needed state
```

This keeps the first patch small while addressing the failure observed across
Codex, Claude, AGY/Gemini, and Cursor provider probes.
