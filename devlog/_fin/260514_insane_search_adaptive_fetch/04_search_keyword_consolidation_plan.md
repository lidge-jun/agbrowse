---
created: 2026-05-14
status: planning
tags: [jawdev, agbrowse, adaptive-fetch, search-keywords, skill-routing]
---

# Search Keyword Consolidation Plan

## Goal

Make the browser skill react to search-adjacent language without hijacking broad
search tasks.

The routing rule is:

```text
search keyword alone -> native search first
search keyword + URL/result/blocked/empty signal -> agbrowse fetch
```

This gives agents a stronger memory hook for search workflows while preserving
the product boundary that `agbrowse fetch` reads URLs and does not discover the
web by itself.

## Keyword Buckets

### Bucket A — Native Search First

These words should remind agents that URLs are needed first:

Korean:

- 검색
- 찾아줘
- 최신
- 요즘
- 반응
- 뉴스
- 자료 찾아
- 출처 찾아
- 웹에서 찾아

English:

- search
- find
- latest
- recent
- news
- reactions
- sources
- web search
- look up

Routing:

```text
No URL exists -> use native search tool -> collect candidate URLs -> then agbrowse fetch selected URLs
```

### Bucket B — Fetch Candidate URL

These words should trigger `agbrowse fetch` when a URL or search-result link is
present:

Korean:

- 이 링크 읽어줘
- 이 URL 읽어줘
- 검색 결과 링크
- 결과 링크 본문
- 본문 뽑아줘
- 출처 검증
- 링크 내용 확인
- 레퍼런스 확인
- 인용 링크 확인

English:

- read this URL
- read this link
- search result link
- extract result body
- source verification
- citation URL
- reference link
- inspect this result
- summarize this page

Routing:

```text
URL exists -> agbrowse fetch "<url>" --json --trace
```

### Bucket C — Escalate Weak Native Fetch

These words should trigger `agbrowse fetch` after a native fetch/WebFetch result
is weak:

Korean:

- 403
- 402
- 막힘
- 차단
- 빈 페이지만 나와
- 본문이 안 읽힘
- SPA 껍데기
- 로그인 벽
- 캡차
- paywall
- network JSON
- RSS
- metadata

English:

- 403
- 402
- blocked
- empty page
- empty shell
- SPA shell
- no body
- login wall
- CAPTCHA
- paywall
- network JSON
- RSS
- metadata
- public endpoint

Routing:

```text
Weak or blocked read -> agbrowse fetch "<url>" --json --trace
Boundary marker found -> continue allowed public/non-browser attempts -> final boundary only if no legitimate path remains
```

Boundary nuance:

```text
CAPTCHA/challenge terms should not become an anti-pattern that stops the agent.
They should trigger maximum safe attempts: public endpoint, RSS, metadata,
non-browser fetch, isolated browser render, and network-candidate discovery. The
final boundary verdict is only for cases where the remaining route requires
solving, click-through, private credentials, or stealth.
```

## Frontmatter Phrase To Add

Add search-adjacent wording to the browser skill description without making
generic search a direct trigger:

```yaml
description: >
  Chrome browser control and traceable URL reading through agbrowse. Use for
  browser actions, snapshots, screenshots, network inspection, and adaptive
  fetch for provided URLs, search result links, citation/reference URLs, blocked
  or empty native fetch results, SPA shells, and public API/RSS/metadata/network
  inspection. For broad search, use the current search tool first to obtain
  candidate URLs, then use agbrowse fetch on selected URLs.
```

## Operational Skill Rule

Add this near the browser skill workflow section:

```text
Search-adjacent routing:
- If the user asks to search/find/latest/news/reactions and gives no URL, use
  native search first.
- If the user gives a URL, search result URL, source URL, citation URL, or says a
  fetched page is blocked/empty/weak, use `agbrowse fetch "<url>" --json --trace`.
- Read the trace before retrying. Login, CAPTCHA, paywall, credential, or
  private membership markers should trigger more allowed representation checks,
  then a final boundary verdict only if no legitimate path remains.
- If a CAPTCHA/challenge is detected, keep trying allowed public endpoint, RSS,
  metadata, non-browser, isolated-browser, and network-candidate paths before
  returning a final boundary verdict.
```

## Examples For Skill Docs

Good:

```text
User: 이 검색 결과 링크 본문 뽑아줘: https://example.com/a
Agent: agbrowse fetch "https://example.com/a" --json --trace
```

Good:

```text
User: 이 출처 링크가 403이야. 본문 읽을 수 있는지 확인해봐: https://example.com/a
Agent: agbrowse fetch "https://example.com/a" --json --trace
```

Not direct fetch:

```text
User: 요즘 AI 브라우저 자동화 뉴스 찾아줘
Agent: native search first, then agbrowse fetch selected result URLs
```

## Acceptance Criteria

- Browser skill frontmatter includes search-result, citation, reference, blocked,
  empty, SPA, RSS, metadata, and network inspection trigger phrases.
- Browser skill explicitly says broad search with no URL starts with the native
  search tool.
- Browser skill examples cover Korean and English search-adjacent phrases.
- `agbrowse fetch` remains URL-only.
- No wording suggests boundary words are stop signs by themselves.
- Wording explicitly pushes maximum allowed attempts before a final boundary
  verdict.

## Verification

After implementation:

```bash
rg -n "search result|candidate URLs|citation|reference|검색 결과|출처|agbrowse fetch" skills/browser/SKILL.md README.md structure
npm test -- test/integration/browser-fetch-command.test.mjs
```
