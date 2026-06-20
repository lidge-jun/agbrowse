---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, eli5, visual]
---

# ELI5 Visual Explanation

## agbrowse Mirror Note

In agbrowse, the command in the pictures is:

```bash
agbrowse fetch <url>
```

If cli-jaw mirrors the feature later, `cli-jaw browser fetch` should return the
same kind of result while keeping the same "search first, fetch URL second"
boundary.

## Tiny Explanation

Imagine the internet is a library.

The normal search tool finds book addresses.

`agbrowse fetch` is the helper that goes to one book address and tries to read
the book safely.

If the front door is locked, it checks whether the library has another official
desk:

- public API desk;
- RSS shelf;
- JSON drawer;
- clean reader copy;
- metadata card;
- browser reading room.

If the book needs a private membership card, CAPTCHA, or payment, the helper
stops and says so.

## Search Versus Browser Fetch

```mermaid
flowchart TD
    A[User asks broad search] --> B[Native CLI search]
    B --> C[Candidate URLs]
    C --> D[agbrowse fetch]
    E[User gives URL] --> D
    D --> F[Validated content]
    D --> G[Boundary: login or CAPTCHA]
```

Search finds candidate doors. Browser fetch checks one door and tries safe ways
to read what is behind it.

## The Ladder

```mermaid
flowchart TD
    A[URL exists] --> B[Public API or RSS]
    B -->|works| Z[Return content]
    B -->|weak| C[Normal fetch]
    C -->|works| Z
    C -->|weak| D[Jina or metadata]
    D -->|works| Z
    D -->|weak| E[Browser render]
    E -->|works| Z
    E -->|finds JSON| F[Network API]
    F -->|works| Z
    E -->|login/CAPTCHA| X[Stop clearly]
```

The important part is not trying many things randomly. The important part is
checking each result and keeping a trace.

## Skill Routing Picture

```mermaid
flowchart LR
    A[Skill frontmatter] --> B{Is there a URL?}
    B -->|No| C[Use native search]
    C --> D[Pick result URL]
    B -->|Yes| E[browser fetch]
    D --> E
    E --> F[Traceable result]
```

The word "search" alone should not trigger browser fetch. "Search result URL" can
trigger browser fetch.

## Playground Example

User:

```text
이 검색 결과 링크 본문 뽑아줘
```

Agent:

```text
URL exists → use agbrowse fetch
```

User:

```text
요즘 AI 뉴스 검색해줘
```

Agent:

```text
No URL yet → native search first → then browser fetch selected links
```

## One Sentence

`agbrowse fetch` is not the search engine. It is the careful reader that opens a
chosen URL, checks whether the content is real, and tries safe alternate doors
when the first door is blocked.
