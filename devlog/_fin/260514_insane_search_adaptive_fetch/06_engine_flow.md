---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, engine-flow]
---

# Engine Flow

## Upstream Flow

`insane-search` exposes one main entrypoint:

```python
from engine import fetch

result = fetch(
    "https://example.com/path",
    success_selectors=["article"],
    device_class="auto",
    user_hint=None,
    timeout=25,
    max_attempts=12,
)
```

Internally, it records every attempt and flows through:

```text
probe
  initial curl_cffi attempt with a conservative browser identity

validate
  classify response as strong_ok, weak_ok, challenge, blocked, unknown

detect
  rank WAF product profiles from cookies, headers, server, and body markers

plan
  build transform x TLS impersonation x referer grid from top profiles

execute
  exhaust bounded grid; do not exit just because status is 200

fallback
  choose Playwright MCP or local Chrome template based on required capabilities

report
  return FetchResult with trace and summary
```

## Validation Model

Upstream validation uses four layers:

1. challenge markers such as WAF product strings;
2. known bad body-size fingerprints;
3. unresolved sensor cookies such as Akamai `_abck`;
4. caller-provided success selectors as positive proof.

The key design point is not the exact marker list. The key is that validation is
typed, inspectable, and separate from transport.

## WAF Product Profiles

`waf_profiles.yaml` does not contain site names. It contains product profiles:

- `akamai_bot_manager`
- `cloudflare_turnstile`
- `f5_big_ip`
- `aws_waf`
- `datadome_probable`
- `perimeterx_human`
- `unknown_challenge`

Each profile describes:

- detector signals;
- required capabilities;
- preferred TLS impersonation candidates;
- referer strategy order;
- URL transform order;
- fallback executors.

For cli-jaw, this profile idea is useful even if v1 does not implement TLS
impersonation. A TypeScript profile can still guide:

- whether browser rendering is likely needed;
- whether network inspection is worth running;
- whether mobile URL transforms are useful;
- whether to stop at `auth_required`.

## URL Transform Grid

Upstream implements generic transforms:

| Transform | Example | Purpose |
| --- | --- | --- |
| `original` | unchanged | baseline |
| `mobile_subdomain` | `www.example.com` to `m.example.com` | mobile SSR variant |
| `am_prefix` | `example.com` to `m.example.com` | apex-to-mobile variant |
| `drop_www` | `www.example.com` to `example.com` | host variant |

cli-jaw can adopt this, but with strict allow/deny rules:

- transforms must be domain-agnostic;
- no repeated high-volume probing;
- bounded attempt count;
- trace output must show the transformed URL.

## Browser Escalation

Upstream uses Playwright MCP or local Chrome templates when the profile says JS
or a real browser stack is needed.

agbrowse already has a CDP browser runtime:

- `agbrowse navigate`
- `snapshot`
- `text`
- `get-dom`
- `network`
- `evaluate`
- `wait-for-selector`

So agbrowse should not add a new browser control stack for v1. It should call
the existing browser helpers or extract a small shared helper if direct imports
would create a circular dependency.

## R7 API-First Branch

The upstream skill contains an important optimization: if early attempts show a
known WAF profile and the user asks for list/collection data, run a browser once,
inspect network requests, identify JSON endpoints, and refetch the API URL.

This is especially relevant to agbrowse because `agbrowse network` already
captures browser network activity. A safe version can:

1. navigate once with existing CDP browser;
2. collect recent XHR/fetch requests;
3. filter likely public JSON endpoints;
4. ask the user before repeated collection;
5. fetch only the discovered endpoint if it does not require credentials.
