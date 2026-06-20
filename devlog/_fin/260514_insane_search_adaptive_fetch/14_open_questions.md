---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, decisions]
---

# Open Questions

## 1. Command Name

Decision on 2026-05-14:

```bash
cli-jaw browser fetch <url>
```

Reason:

- keeps the feature in the existing browser capability family;
- reuses browser help/docs/API mental model;
- avoids adding a new top-level command before the behavior is proven;
- still allows the implementation to try public APIs/RSS/fetch before opening
  Chrome.

Remaining detail: whether to expose a server endpoint as `POST /api/browser/fetch`
in v1 or keep the first build CLI-only.

## 2. Jina Reader Default

Should `r.jina.ai` be enabled by default?

Pros:

- very useful for public docs/blog/news pages;
- no API key;
- returns clean text/markdown.

Cons:

- third-party service;
- freshness and availability vary;
- may not be acceptable for private/sensitive URLs.

Recommendation: default on for public URLs unless `--no-third-party-readers` is
set; always disable for localhost/private network URLs.

## 3. Archive Fallback

Should Wayback/archive fallback be automatic?

Recommendation: no for v1. Make it explicit with `--allow-archive`, because
archives can be stale and may surprise users.

## 4. Media Metadata

Should `yt-dlp` be part of v1?

Recommendation: detect only. If missing, print install guidance. Do not install.

## 5. Browser Session Use

Should the command use the user's existing browser cookies?

Recommendation: only with an explicit `--allow-browser-session` or similar flag.
The default browser path can render public pages, but should avoid implying that
private/authenticated content is fair game.

## 6. Python Sidecar

Should upstream's Python engine be vendored?

Recommendation: no for first build. Port concepts to TypeScript. Revisit only if
we prove TypeScript fetch/browser paths cannot cover the needed use cases.

## 7. GitHub Issue

Should this plan get a tracking GitHub issue?

Recommendation: yes before implementation, because it touches CLI surface,
browser behavior, safety policy, tests, and docs. Suggested title:

```text
Add traceable adaptive web fetch for blocked/empty pages
```

## 8. Skill Frontmatter Routing

Decision direction:

- connect through browser-family skill frontmatter;
- include search-adjacent Korean/English trigger phrases;
- do not trigger on generic "search" alone.

Suggested trigger language:

```yaml
description: >
  Use when a URL or search result URL needs adaptive reading, normal fetch is
  blocked, page content is empty, 402/403 appears, or public API/RSS/metadata/
  browser-network inspection is needed. Do not use for generic web search before
  candidate URLs exist.
```
