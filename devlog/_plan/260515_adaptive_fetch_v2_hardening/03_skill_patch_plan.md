---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, skill-plan]
---

# Skill Patch Plan

## Primary File

MODIFY:

- `skills/browser/SKILL.md`

Secondary docs:

- `README.md`
- `structure/commands.md`
- `structure/CAPABILITY_TRUTH_TABLE.md`

## Behavior To Teach

Agents should use `agbrowse fetch <url>` as a URL reader, not as generic search.
The skill should explicitly route:

1. Use search tools to discover candidate URLs.
2. Use `agbrowse fetch <url> --json --trace --browser never` for HTTP-only
   reading.
3. If content is weak/blocked, inspect the trace before escalating.
4. Use public endpoints, RSS/Atom, oEmbed, metadata, and direct fetch before any
   browser step.
5. Use `--allow-third-party-reader` only when the user or task allows a public
   third-party reader.
6. Use `--browser auto --browser-session isolated` for JS-rendered pages and
   challenge-like pages when a browser is needed.
7. Use `--browser-session user` or `interactive` only for the user's own
   authenticated browser state and human-supervised challenge handling.
8. Report boundaries plainly: blocked, auth required, paywall, challenge, or
   browser required.

## Wording To Avoid

Do not write:

- "CAPTCHA/login/paywall means stop immediately."
- "Use browser session to bypass paywalls."
- "Solve Cloudflare/CAPTCHA automatically."
- "Stealth mode."
- "Use user cookies silently."

Use instead:

- "Continue the legitimate ladder before final boundary verdict."
- "User session is explicit opt-in and uses the user's own browser state."
- "Human challenge resolution is user-supervised; no solver."
- "Report the boundary when content remains unavailable."

## JSON Contract Guidance

The skill must say that `--json` is machine-readable and valid by contract. If
content is clipped, the result should include:

- `contentTruncated`
- `contentBytes`
- `contentLimitBytes`
- trace evidence explaining why the selected source won

Agents should not scrape raw stdout with regex. They should parse JSON and read
the schema fields.

## Live Smoke Guidance

Add a short hard-smoke example set:

```bash
node bin/agbrowse.mjs fetch https://www.nytimes.com/ --json --trace --browser never
node bin/agbrowse.mjs fetch https://github.com/lidge-jun/agbrowse --json --trace --browser never
node bin/agbrowse.mjs fetch https://www.reddit.com/ --json --trace --browser never
node bin/agbrowse.mjs fetch https://medium.com/ --json --trace --browser auto --browser-session isolated
node bin/agbrowse.mjs fetch https://www.wsj.com/ --json --trace --browser auto --browser-session user
```

The docs must frame these as live observations that can vary by date, network,
and site policy. Tests should assert schema and boundary behavior, not exact
site outcomes.

