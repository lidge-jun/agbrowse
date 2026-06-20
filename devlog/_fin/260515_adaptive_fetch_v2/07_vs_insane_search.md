---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, comparison, insane-search]
---

# Comparison: agbrowse v2 vs insane-search

## Capabilities We Adopt

| insane-search feature | agbrowse v2 implementation |
|---|---|
| Adaptive retry with escalation | 6-phase ladder (broader than upstream) |
| Content validation beyond HTTP 200 | Multi-signal content scoring |
| WAF product-based detection | Product profiles (cloudflare, akamai, datadome, etc.) |
| URL transforms (mobile, www) | Generic transform grid, max 4 variants |
| Browser rendering | Native CDP via existing agbrowse Chrome runtime |
| Network API discovery | Browser network tab inspection |
| Referer/header strategies | Browser-grade Sec-Fetch-* and Referer headers |
| Cookie warming | Homepage fetch before article (bounded to 1) |
| Attempt tracing | First-class --trace output |

## Capabilities We Do Differently

| Feature | insane-search | agbrowse v2 |
|---|---|---|
| TLS fingerprinting | curl_cffi fakes Chrome TLS | Real Chrome via CDP — no fake needed |
| CAPTCHA handling | Claims some automated bypass | Human solves, tool reads result |
| Login wall | Claims identity spoofing | Human's own authenticated session |
| Cookie strategy | Auto-managed, opaque | Explicit session modes, visible in trace |
| Browser engine | Playwright MCP (external) | Native CDP (already built in agbrowse) |
| Dependency install | Auto pip install | Doctor check + explicit instructions |
| Site-specific code | Some hostname branches | Product-based profiles only |
| Operation mode | Autonomous | Human-supervised |

## Capabilities We Do Not Adopt

| Feature | Reason |
|---|---|
| curl_cffi TLS impersonation | Real Chrome available — fake not needed |
| Automated CAPTCHA solving | Human solves instead |
| Credential injection | User's own session instead |
| Identity spoofing for login walls | User is already logged in |
| Stealth / anti-detection library | Real Chrome IS a real browser |
| Auto pip install | Violates fail-fast policy |
| Unbounded retry grids | Max 4 URL variants, bounded attempts |

## Surface Coverage Comparison

### insane-search paths

```
curl_cffi (5 TLS identities)
  × URL transforms (original, mobile, drop-www)
  × referer strategies (none, google, self)
  → Playwright MCP browser
```

Total: ~45 combinations → browser fallback

### agbrowse v2 paths

```
Phase 0: public API endpoints (8+ platform resolvers) + RSS/Atom
Phase 1: browser-grade HTTP × URL transforms (4 variants)
Phase 2: reader services (Jina, archive)
Phase 3: isolated Chrome render + network API discovery
Phase 4: user's authenticated browser session
Phase 5: human-in-the-loop challenge resolution
```

### Why v2 Sees More

Paths agbrowse v2 has that insane-search does not:
- Official public API endpoints (GitHub REST, Reddit JSON, HN Firebase, etc.)
- RSS/Atom feed discovery and reading
- Third-party reader services (Jina Reader)
- Archive fallback (Wayback, Google Cache)
- User's own authenticated session
- Human-in-the-loop challenge resolution
- Network API endpoint discovery from browser

Paths insane-search has that v2 does not need:
- curl_cffi TLS fingerprint spoofing (replaced by real Chrome)
- CAPTCHA solver (replaced by human)
- Login wall identity spoofing (replaced by user's own session)

### Net Result

insane-search tries to autonomously force through. It has many HTTP-level tricks
but hits a hard wall at interactive challenges and authentication.

agbrowse v2 tries every legitimate path first, then brings in the human when
needed. The human already has challenge clearance, login access, and
subscriptions — the tool just reads what they can see.

More surfaces. More transparency. No bypass.
