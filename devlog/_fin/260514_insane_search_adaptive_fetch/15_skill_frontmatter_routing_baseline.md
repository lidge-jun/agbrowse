---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, browser, skill-frontmatter, routing]
---

# Skill Frontmatter Routing

## agbrowse Mirror Note

This copied plan keeps the cli-jaw target below for parity, but the first
implementation target in this repository is:

```bash
agbrowse fetch <url>
```

The skill guidance should teach agents that agbrowse fetch is a search-tool
helper after a candidate URL exists. It should not teach agents to use adaptive
fetch as the first step for broad search.

## Decision

Attach adaptive fetch to the existing browser capability family:

```bash
cli-jaw browser fetch <url>
```

Then expose it to agents through browser-family skill frontmatter. The
frontmatter should mention search-adjacent cases, but it must not hijack generic
web search.

## Why Frontmatter Helps

Skill frontmatter is the "when should I think of this skill?" hook. It is not
the implementation. The implementation is the command and TypeScript module.

```text
frontmatter trigger
  → agent selects browser-fetch guidance
  → agent calls agbrowse fetch
  → command returns traceable result
```

This gives every CLI family member the same fallback tool after native search or
native fetch is weak.

## Proposed Skill Frontmatter

agbrowse version:

```yaml
---
name: browser
description: >
  Chrome browser control and traceable URL reading through agbrowse. Use for
  opening pages, snapshots, clicking, typing, screenshots, network inspection,
  and adaptive fetch when a user provides a URL, a search result URL needs
  extraction, normal fetch returns 402/403/blocked, a page renders as an empty
  SPA shell, or public API/RSS/metadata/browser-network inspection is needed.
  Do not use adaptive fetch for generic web search before candidate URLs exist.
---
```

cli-jaw mirror version:

```yaml
---
name: browser-fetch
description: >
  Adaptive URL reading through cli-jaw browser fetch. Use when a user provides a
  URL, a search result URL needs extraction, normal fetch/WebFetch returns
  402/403/blocked, a page renders as an empty SPA shell, content looks like a
  challenge/login wall, or public API/RSS/metadata/browser-network inspection is
  needed. Do NOT use for generic web search before candidate URLs exist.
---
```

## Good Trigger Phrases

Korean:

- "이 URL 읽어줘"
- "검색 결과 링크 본문 뽑아줘"
- "링크가 403이야"
- "본문이 안 읽혀"
- "빈 페이지만 나와"
- "차단된 페이지 읽어봐"
- "Reddit/GitHub/YouTube/RSS URL 분석해줘"

English:

- "read this URL"
- "extract this search result"
- "fetch is blocked"
- "403/402"
- "empty page"
- "SPA shell"
- "inspect network JSON"
- "summarize this Reddit/GitHub/YouTube link"

## Bad Trigger Phrases

Do not use browser fetch for these before candidate URLs exist:

- "검색해줘"
- "find news about X"
- "latest posts about X"
- "what are people saying about X"
- "search the web"

Those should use each CLI's native search tool first. Once a URL exists, browser
fetch can read and validate it.

## Routing Matrix

| User intent | First action | Browser fetch? |
| --- | --- | --- |
| No URL, broad topic search | Native CLI search | Later, after candidate URLs exist |
| URL provided | `agbrowse fetch` | Yes |
| Search result link provided | `agbrowse fetch` | Yes |
| Native fetch returned 403/402 | `agbrowse fetch` | Yes |
| Native fetch returned empty HTML | `agbrowse fetch` | Yes |
| Page requires login/CAPTCHA | Stop with boundary verdict | No bypass |
| Bulk crawl request | Ask/require explicit scope | Not automatic |

## Prompt Rule To Add Later

Suggested browser skill guidance:

```text
When a user asks for generic web search with no URL, use the current CLI's native
search capability first. When a URL exists, or when native fetch/WebFetch fails,
returns a block page, or returns an empty/weak page, call:

  agbrowse fetch "<url>" --json --trace

Read the trace before retrying. Stop at login, CAPTCHA, paywall, or credential
boundaries. Do not silently install optional dependencies.
```

## Why Not Trigger On Generic Search

If "search" alone activates browser fetch, the agent will try to fetch before it
has a URL. That creates wrong behavior:

```text
search query → browser fetch with no target → confused fallback chain
```

Correct behavior:

```text
search query → native search → candidate URLs → browser fetch selected URLs
```

## agbrowse Skill Status — 2026-05-15

`skills/browser/SKILL.md` now reflects the agbrowse v1 surface.

Active command examples:

```bash
agbrowse fetch "https://example.com"
agbrowse fetch "https://example.com" --json --trace
agbrowse fetch "https://example.com" --browser never
agbrowse fetch "https://example.com" --browser required --browser-session isolated
agbrowse fetch "https://example.com" --allow-third-party-reader
```

The active skill wording now routes these cases toward adaptive fetch:

- a URL is already present;
- a search-result URL needs extraction;
- a normal fetch produced 402/403, blocked content, or an empty shell;
- public API, RSS, metadata, JSON-LD, or browser-network evidence is needed;
- the user asks to inspect a specific Reddit, GitHub, YouTube, RSS, source, or
  citation URL.

The active skill wording still keeps these out of adaptive fetch until a URL
exists:

- broad topic search;
- "latest news" style requests;
- "what are people saying" style research;
- general discovery without candidate links.

Boundary wording is intentionally phrased as "keep trying legitimate
representations" rather than "stop as soon as a CAPTCHA/login/paywall marker is
seen". The implementation may continue through public endpoint, RSS, metadata,
neutral fetch, and non-auth browser rendering. It must not solve challenges,
cross login/paywall boundaries, claim stealth behavior, or use existing profile
state unless the user explicitly selects that path.

This means future agents should not treat CAPTCHA/login/paywall words in the
skill as an anti-pattern that forbids all work. Those words mark the boundary
where the result must become explicit and evidence-based.
