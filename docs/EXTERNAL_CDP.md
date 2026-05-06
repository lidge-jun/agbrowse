---
created: 2026-05-05
phase: 22
status: deferred
tags: [agbrowse, external-cdp, deferred, experimental]
---

# External / Remote CDP Adapter — Deferred (Experimental)

## Status

**Deferred. Not for production use.**

There is no production-ready external/remote CDP provider in `agbrowse`
today. Any code, branch, or sketch labeled `external-cdp`, `remote-cdp`, or
"hosted browser" is **experimental** until this document is replaced with a
release note that lists:

- a stable connection contract (URL, auth, version negotiation),
- a session-lifecycle owner (who creates / tears down remote tabs),
- a policy boundary (allow/deny origins, downloads, clipboard, file access),
- a trace-evidence guarantee equal to the local-CDP path,
- and a test suite covering disconnect, slow network, and origin spoofing.

Until that lands, do **not** describe `agbrowse` as supporting hosted, cloud,
or SaaS browser operation in:

- `README.md`
- `docs/production-readiness.md`
- release notes / changelog
- `structure/CAPABILITY_TRUTH_TABLE.md` "ready" rows
- public marketing or comparison tables

## Why deferred

The local-CDP path (`skills/browser/`, `web-ai/`) is the supported runtime.
It has:

- deterministic `browser doctor` cleanup,
- accessibility snapshot + ref registry,
- web-AI provider safety policy,
- trace evidence and source-audit contracts.

A remote/external CDP adapter changes the trust boundary (the browser
process is not on the user's machine), the failure mode (network partition
becomes a normal operating condition), and the policy surface (cross-origin
data egress now happens on a remote box). None of those have a tested,
versioned contract yet.

Calling such a path "ready" without that contract would mislead users about
what `agbrowse` guarantees in production.

## How experimental code must be marked

Any commit that introduces or modifies external/remote-CDP code paths must:

1. Carry an `// EXPERIMENTAL: not for production use` marker at the top of
   each affected source file.
2. Be guarded by an opt-in flag (env var or `--experimental-external-cdp`)
   that defaults to off.
3. Update `structure/CAPABILITY_TRUTH_TABLE.md` to keep External CDP in the
   `deferred (experimental)` row.
4. Avoid any user-facing claim of readiness in `README.md` /
   `docs/production-readiness.md` / release notes.

## Lifting the deferral

Replace this document with `docs/external-cdp.md` describing the production
contract once all of the following are true:

- Connection / auth / version contract is documented and tested.
- Policy and trace-evidence parity with local CDP is proven by tests.
- Truth table row moves to `ready (experimental)` then `ready` only after
  field validation.
- A release note explicitly announces the change.

Until then, this file governs.
