# Perplexity Plan Dual-Model Final Review

## Review Runs

### ChatGPT 5.6 High

- Surface: ChatGPT web UI through `agbrowse web-ai`
- Mode evidence: `thinking`, `reasoning effort selected: high`
- Session: `01KX8TCWGJN4CMMHEF73GWHW6S`
- Conversation: `https://chatgpt.com/c/6a5257ab-8cec-83ee-b9b6-e635840339ca`
- Reviewed commit: `0d846a0d8a33e414e06681f4f51c688de2b9d66c`
- Verdict before this revision: `REJECT`

### Grok-4.5

- Surface: native Codex subagent
- Model: `xai/grok-4.5`
- Reasoning effort: `max`
- Agent: `019f51a6-9601-7510-8746-3db632b0c602`
- Reviewed checkout: `0d846a0d8a33e414e06681f4f51c688de2b9d66c`
- Verdict before this revision: `REJECT`

## Common Findings Applied

Both reviews identified incomplete cross-host recovery/acquisition behavior and
an incomplete model-selection result shape. The plan now:

- supplies concrete vendor-aware navigation, recovery, readiness, and reattach
  call sites;
- reacquires and returns final `resolvedLabel`, `locked`, and verified model
  evidence;
- preserves canonical live conversation URLs after redirects.

## ChatGPT-Only Findings Applied

- canonicalizes Perplexity host aliases inside the durable lease store, not
  only lifecycle cleanup;
- makes overlay handling conditional on live evidence;
- specifies guarded fresh-thread root navigation and postconditions;
- makes citation close failure non-terminal and resets on response drift;
- makes option-conflict errors provider-aware before serialization;
- adds an executable smoke evidence writer and local-only screenshot policy.

## Grok-Only Findings Applied

- passes resolved effort into CLI timeout injection;
- expands the current CLI vendor/model/effort gates for Perplexity;
- fixes the exact pre-headed-browser validation call site;
- adds guarded broad-catch recovery and provider-specific readiness;
- expands the ChatGPT-only reattach gate to Perplexity;
- separates invalid effort syntax from unavailable Thinking controls;
- synchronizes the top fixture map with Task 5.

## Synthesis Decision

There was no substantive conflict between the two reviews. ChatGPT traced the
host alias problem into durable lease ownership, while Grok traced it through
CLI acquisition and recovery; both layers are required. The plan incorporates
the union of verified findings.

This document records review disposition, not a post-edit external acceptance.
The reviewed revision was rejected; implementation approval should rely on the
updated plan's executable gates or a later focused acceptance pass.
