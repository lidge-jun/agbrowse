# 13. Provider CLI Query Probe: Actual Korean Search Runs

## Why This Probe Exists

Docs 09-12 explain the structural problem in K-BrowseComp: search backends
collapse into URL/snippet providers, and the missing layer is query planning
plus page verification.

This document records a live, non-controlled provider probe run on 2026-06-08.
Four jaw employees using different CLI providers were given the same Korean
search task. The goal was not to produce a benchmark score. The goal was to
observe what each provider exposes:

- The query text passed to search tools.
- Whether internal query rewriting is visible.
- The returned result shape.
- Whether the provider reads original pages or stays at snippet/synthesis.
- Which prompt rules would make Korean search more reliable.

## Probe Setup

Employees:

| Employee | CLI/provider | Search surface observed |
|----------|--------------|-------------------------|
| Frontend | Codex | `web.search_query` + `web.open` |
| Backend | Claude | WebSearch + WebFetch |
| Data | AGY / Gemini | `search_web` |
| Docs | Cursor | WebSearch + WebFetch |

Probe queries:

```text
2026년 한국 전기차 보조금 지자체별 차이 최신 기준
```

```text
네이버 블로그 글에서 특정 후기 원문 확인이 필요한 경우 검색 결과만으로 충분한가
```

These were intentionally chosen to hit common Korean-search weaknesses:

- A freshness-sensitive public-policy question with an official dynamic site.
- A Naver original-source question where snippets are not valid evidence.

## Aggregate Result

Under an original-source verification standard, search-only success was:

```text
0 / 8
```

That is four providers times two queries. Some providers produced plausible
summaries or candidate URLs, but none should be treated as final evidence
without a follow-up fetch or browser read.

Common findings:

1. Internal query rewrite is mostly not exposed.
2. Search results are returned as title/URL/snippet, synthesized answers, or
   citations.
3. Search summaries often mention the right direction, but do not prove that
   the original page was read.
4. Fetch/open can verify some static pages and some Naver PostView URLs.
5. Dynamic, empty, truncated, timeout, or Naver shell pages require browser
   fallback.

## Provider Observations

### Codex

Observed tools:

- `web.search_query`
- `web.open`

Submitted queries included:

```text
2026년 한국 전기차 보조금 지자체별 차이 최신 기준
site:ev.or.kr 2026 전기차 보조금 지자체 지원금 무공해차 통합누리집
환경부 2026 전기차 구매보조금 개편안 지자체 보조금
네이버 블로그 글에서 특정 후기 원문 확인이 필요한 경우 검색 결과만으로 충분한가
네이버 블로그 특정 후기 원문 검색 결과 snippet 충분한가 원문 확인
site:blog.naver.com 네이버 블로그 맛집 후기 원문 확인
site:blog.naver.com "후기" "내돈내산" "원문"
```

Query rewrite exposure:

- Provider-internal rewrite: not exposed.
- Agent-authored rewrite: visible because the employee issued additional
  focused queries manually.

Result shape:

- Search returned title, URL, snippet, and some freshness metadata.
- Search acted like a URL candidate list, not a verified evidence source.

Fetch/open behavior:

- A policy briefing page opened and exposed page text.
- A Naver PostView URL opened and exposed original post text.
- `https://ev.or.kr/` returned an empty result (`Total lines: 0`), suggesting
  JS or dynamic-site handling is needed.

Patch implication:

- Prompting can improve the query stage by forcing source-aware rewrites before
  search.
- Search result summaries should not be accepted as final evidence.
- Empty official-site fetches should trigger browser escalation.

### Claude

Observed tools:

- WebSearch
- WebFetch

Submitted queries:

```text
2026년 한국 전기차 보조금 지자체별 차이 최신 기준
네이버 블로그 글에서 특정 후기 원문 확인이 필요한 경우 검색 결과만으로 충분한가
네이버 블로그 후기 원문 확인 방법 검색 결과 스니펫 한계
```

Query rewrite exposure:

- The exact Korean natural-language query was sent first.
- Internal rewrite was not exposed.
- A manual keyword rewrite was needed after the second query returned no
  useful result.

Result shape:

- WebSearch returned URL results plus an AI synthesis.
- Individual snippets were not always exposed as a raw result table.

Fetch/open behavior:

- Static blog content was fetchable.
- `ev.or.kr` content was not reliably readable through fetch and pointed toward
  browser fallback.
- The natural-language Naver meta-question had poor search recall until
  rewritten.

Patch implication:

- Korean natural-language questions should not be sent as one full query by
  default.
- The prompt should require 1-3 shorter keyword queries with source hints.
- Fetch failure modes such as truncated, empty, redirected, or shell-only pages
  should route to browser/browse.

### AGY / Gemini

Observed tool:

- `search_web`

Submitted queries:

```text
2026년 한국 전기차 보조금 지자체별 차이 최신 기준
네이버 블로그 글에서 특정 후기 원문 확인이 필요한 경우 검색 결과만으로 충분한가
```

Query rewrite exposure:

- The tool call exposed the original query string.
- Any grounding-level rewrite was not exposed.

Result shape:

- Generated Korean answer summary.
- Numbered citations in the answer.
- Source links, including provider redirect URLs.
- No raw original HTML or full page text.

Fetch/open behavior:

- The observed search tool behaved as snippet/synthesis only.
- It did not directly read the cited source pages in a way that exposed full
  original content to the agent.

Patch implication:

- Provider synthesis is especially risky for source-sensitive Korean tasks.
- The prompt must tell the agent to extract candidate URLs, then use a separate
  page reader when original evidence matters.

### Cursor

Observed tools:

- WebSearch
- WebFetch

Submitted queries:

```text
2026년 한국 전기차 보조금 지자체별 차이 최신 기준
네이버 블로그 글에서 특정 후기 원문 확인이 필요한 경우 검색 결과만으로 충분한가
```

Query rewrite exposure:

- Provider-internal rewrite was not exposed.
- The employee reported the input string was likely sent as-is.

Result shape:

- Search returned title, URL, excerpt, synthesis, and citations.
- Top results for the EV subsidy query leaned toward secondary summaries and
  blogs.
- Top results for the Naver query leaned toward technical posts about crawling,
  not actual review originals.

Fetch/open behavior:

- `ev.or.kr` fetch timed out.
- A secondary EV subsidy guide fetched successfully.
- `blog.naver.com` shell fetch did not expose original post content.
- A technical post explaining Naver iframe/PostView behavior fetched
  successfully.

Patch implication:

- Official or primary domains must be encoded into query rewrites when the task
  is policy/freshness-sensitive.
- Naver Blog evidence should not be accepted from generic search snippets.
- `blog.naver.com` shell pages need PostView conversion or browser fallback.

## Failure Modes Confirmed By The Probe

| Failure | Probe evidence | Prompt countermeasure |
|---------|----------------|-----------------------|
| Full Korean natural-language query is weak | Claude query 2 returned poor/no useful results until rewritten | Rewrite into anchor entity + source hint + rare constraint |
| Search synthesis sounds plausible without evidence | AGY/Gemini and Cursor returned summaries/citations | Treat synthesis as orientation only |
| Official dynamic site is not readable by fetch | Codex empty `ev.or.kr`, Cursor timeout, Claude dynamic/truncated behavior | Browse fallback for empty/truncated/timeout official pages |
| Naver original evidence is hidden behind shell/iframe | Cursor `blog.naver.com` shell, Codex PostView success | Try PostView/canonical URL; otherwise browse |
| Secondary summaries outrank primary sources | Cursor EV query top results included blogs/guides | Source-aware query rewrite with official domains |

## Design Conclusion

The immediate improvement target is not a new search engine. It is query
control:

```text
Korean user question
  -> compact source-aware query rewrites
  -> search provider returns URL candidates
  -> fetch original pages when possible
  -> browse dynamic/Naver/official shell pages
```

The first cli-jaw prompt patch should therefore focus on how the agent sends
queries:

- Do not send the full Korean problem as one query by default.
- Generate 1-3 keyword/source/date-aware rewrites.
- Prefer official/source-specific query variants when the question implies a
  source.
- Treat search results as candidate URLs.
- Use fetch/browse only as the downstream evidence path, not as the first patch
  implementation target.
