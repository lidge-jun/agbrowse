---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, upstream-inventory]
upstream: https://github.com/fivetaku/insane-search
upstream_commit: b4ab9384399a8df58503268764ba43ed5520156d
---

# Upstream Inventory

## Source Snapshot

Repository inspected:

```text
https://github.com/fivetaku/insane-search.git
commit b4ab9384399a8df58503268764ba43ed5520156d
```

GitHub described the project as an auto-bypass plugin for blocked websites in
Claude Code with a Phase 0 to Phase 3 adaptive scheduler and no API keys. The
README presents the high-level chain as public endpoint index, lightweight
probes, TLS impersonation, and full browser escalation.

## File Structure

```text
README.md
README.ko.md
CHANGELOG.md
LICENSE
.claude-plugin/plugin.json
skills/insane-search/SKILL.md
skills/insane-search/engine/
skills/insane-search/engine/__main__.py
skills/insane-search/engine/fetch_chain.py
skills/insane-search/engine/executor.py
skills/insane-search/engine/validators.py
skills/insane-search/engine/waf_detector.py
skills/insane-search/engine/waf_profiles.yaml
skills/insane-search/engine/url_transforms.py
skills/insane-search/engine/bias_check.py
skills/insane-search/engine/tests/test_smoke.py
skills/insane-search/engine/templates/*.js
skills/insane-search/references/*.md
```

## Important Upstream Components

| Component | Lines | Role |
| --- | ---: | --- |
| `SKILL.md` | 332 | Claude skill instructions, phase rules, platform index, no-site-name rule. |
| `fetch_chain.py` | 428 | Main fetch scheduler and `FetchResult`/`Attempt` schema. |
| `validators.py` | 216 | Success/challenge verdict logic. |
| `waf_detector.py` | 214 | WAF product detection and ranked profile selection. |
| `waf_profiles.yaml` | 162 | Product profiles for Akamai, Cloudflare, F5, AWS WAF, DataDome, PerimeterX, fallback. |
| `executor.py` | 192 | Capability-matched Playwright fallback chooser. |
| `url_transforms.py` | 98 | Domain-agnostic URL transforms such as `www.` to `m.`. |
| `bias_check.py` | 174 | Linter that blocks site-specific hardcoding in engine paths. |
| `engine/tests/test_smoke.py` | 152 | Validator, profile, transform, and light online smoke tests. |

## Reference Files

The reference folder is the knowledge base. It is intentionally separate from
the generic engine.

| File | Topic |
| --- | --- |
| `fallback.md` | Phase escalation and failure/success rules. |
| `jina.md` | `r.jina.ai` reader path. |
| `json-api.md` | Public JSON endpoints such as Reddit, HN, Wikipedia, npm, PyPI. |
| `public-api.md` | Bluesky, Mastodon, arXiv, Stack Exchange, GitHub, Wayback, CrossRef. |
| `media.md` | `yt-dlp` metadata/subtitle workflows. |
| `twitter.md` | X/Twitter syndication, oEmbed, and search indirection. |
| `naver.md` | Naver search/blog/finance patterns. |
| `rss.md` | RSS discovery and feed parsing. |
| `tls-impersonate.md` | `curl_cffi` TLS impersonation details. |
| `playwright.md` | Browser fallback and network inspection. |
| `cache-archive.md` | Wayback/archive/AMP cache alternatives. |
| `metadata.md` | OGP, JSON-LD, Schema.org, Next.js payload extraction. |

## What Is Portable To cli-jaw

Portable as-is conceptually:

- `Attempt` / `FetchResult` trace schema.
- Multi-verdict validation rather than binary success/failure.
- Phase 0 public endpoint index.
- Domain-agnostic URL transforms.
- WAF product profile model.
- Bias/no-site-name checker.
- Browser network inspection as an escalation path.

Needs adaptation:

- Python engine should become TypeScript or a clearly optional sidecar.
- Playwright MCP assumptions should map to cli-jaw's existing CDP browser routes.
- Auto-install behavior should be removed or turned into explicit doctor output.
- Risky TLS/identity spoofing should not be default.

Not suitable for default cli-jaw behavior:

- Silent `pip install`.
- Broad "unblock anything" product claims.
- CAPTCHA, login wall, paywall, or credential bypass claims.
- Site-specific scraping rules hidden in engine code.

