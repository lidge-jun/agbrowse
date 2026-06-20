---
created: 2026-05-15
status: review
tags: [jawdev, agbrowse, adaptive-fetch, gpt-pro, validation]
---

# GPT Pro Validation Report

## Input

GPT Pro received:

- repo A: `https://github.com/lidge-jun/agbrowse`
- repo B: `https://github.com/fivetaku/insane-search`
- attachment: `/tmp/agbrowse_adaptive_fetch_plan_260515.zip`

Session:

```text
01KRKX6GWSAA9SK109P7FP3K1R
```

## Verdict

```text
NEEDS_FIX
```

The direction is approved, but the plan was not implementation-ready.

## Accepted Direction

GPT Pro agreed that agbrowse should copy the idea, not the aggressive upstream
implementation:

- do not port Python `curl_cffi` or stealth behavior as the default path;
- keep the feature in `skills/browser/`, not `web-ai/`;
- expose a clear `agbrowse fetch <url>` command;
- keep typed verdicts, validation, traceability, and public endpoint priority;
- keep no-site-name discipline from insane-search.

## Must Fix

1. **Browser session/cookie boundary**

   `--browser auto` can silently use the persistent agbrowse profile unless the
   plan says otherwise. Add:

   ```text
   --browser-session none|isolated|existing
   ```

   `existing` must be explicit opt-in.

2. **URL safety**

   Add SSRF/private-network protection:

   - `http`/`https` only;
   - reject `file:`, `data:`, `javascript:`;
   - reject credentials in URLs;
   - deny localhost/private/link-local by default;
   - re-check redirect targets;
   - redact tokens and signed query params.

3. **Third-party reader policy**

   Public endpoints and third-party readers are not the same thing. Jina or
   similar readers should require explicit opt-in:

   ```text
   --allow-third-party-reader
   ```

4. **Browser helper import**

   Do not import root `skills/browser/browser.mjs` from the library. Extract a
   small helper such as:

   ```text
   skills/browser/adaptive-fetch/browser-runtime.mjs
   ```

5. **Challenge detector**

   Add a first-class module:

   ```text
   skills/browser/adaptive-fetch/challenge-detector.mjs
   ```

   This keeps `challenge`, `auth_required`, `paywall`, `blocked`, and `weak_ok`
   classification consistent.

6. **Skill search wording**

   The current browser skill has a generic Google "Web Search" workflow. The
   adaptive fetch skill text must say:

   ```text
   broad search -> current agent/runtime search tool first
   URL/result/source/citation link -> agbrowse fetch
   ```

7. **Test matrix expansion**

   Add fixture coverage for:

   - `--browser never|auto|required`;
   - Chrome unavailable;
   - active tab preservation;
   - cookie/header redaction;
   - redirect-to-private-IP;
   - localhost/private URL;
   - binary MIME;
   - max-byte truncation;
   - third-party reader opt-in/off;
   - no-site-name bias gate.

## Boundary Clarification

GPT Pro warned against challenge/login/paywall crossing claims. The corrected
interpretation for agbrowse is not "stop early." It is:

```text
Try every public or user-authorized representation first.
Then return a boundary verdict only if the remaining path requires solving,
click-through, stealth, access-wall crossing, or private credentials.
```

This keeps agents from treating challenge words as an anti-pattern while still
avoiding unsafe actions.

## Plan Updates Applied

The plan was updated after GPT Pro's review to include:

- `--browser-session none|isolated|existing`;
- third-party reader opt-in;
- maximum public/non-browser/isolated-browser attempt coverage before final
  boundary verdict;
- `browser-runtime.mjs`;
- `challenge-detector.mjs`;
- URL safety requirements;
- stronger skill search routing.
