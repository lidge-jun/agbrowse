# WP0 Worker A - 05 timeout reconciliation evidence

Date: 2026-07-10
Target: `devlog/_plan/260710_gpt56_update/05_pro_timeout_budget.md`
Scope note: this receipt is required by the completion evidence hook; no additional product or plan file was modified.

## Checks

### Current `session.mjs` Before block is verbatim

Command:

```bash
diff -u \
  <(sed -n '388,442p' web-ai/session.mjs) \
  <(awk '/Tier table\/normalization Before/{seen=1; next} seen && /^```js$/{code=1; next} code && /^```$/{exit} code{print}' devlog/_plan/260710_gpt56_update/05_pro_timeout_budget.md)
```

Output:

```text
exit=0 (no diff)
```

Judgement: PASS. The documented Before block exactly matches `web-ai/session.mjs:388-442`.

### Legacy Pro-3600 canon wording is absent

Command:

```bash
rg -n '3600[^\n]*(유지|그대로)|유지[^\n]*3600|Pro 3600 SSOT|Pro=3600' devlog/_plan/260710_gpt56_update/05_pro_timeout_budget.md
```

Output:

```text
matches=0
```

Judgement: PASS. No residual "3600 유지" or equivalent legacy Pro canon wording remains.

### Required three-tier contracts are present

Command:

```bash
rg -n "'chatgpt-pro': 5400|'grok-heavy': 3600|'deep-research': 3600|CHATGPT_PRO_TIMEOUT_SEC|deriveTimeoutTier\('chatgpt'.*'chatgpt-pro'|deriveTimeoutTier\('grok'.*'grok-heavy'|Grok Heavy.*비혼입|Deep Think" devlog/_plan/260710_gpt56_update/05_pro_timeout_budget.md
```

Key output:

```text
193:    'chatgpt-pro': 5400,
194:    'grok-heavy': 3600,
195:    'deep-research': 3600,
199:export const CHATGPT_PRO_TIMEOUT_SEC = TIER_DEFAULT_TIMEOUT_SEC['chatgpt-pro'];
201:export const PRO_TIMEOUT_SEC = CHATGPT_PRO_TIMEOUT_SEC;
888:   `grok-heavy` 3600이며, Gemini Deep Think는 ...
944:1. ... deriveTimeoutTier('chatgpt', 'pro') === 'chatgpt-pro',
945:   deriveTimeoutTier('grok', 'heavy') === 'grok-heavy' ...
986:| Grok Heavy tier fallback ... `grok-heavy=3600` ... `chatgpt-pro` 비혼입 |
987:| Deep Research tier fallback ... `deep-research=3600` ... 다른 long tier 비혼입 |
```

Judgement: PASS. The table, normalization, compatibility export, and non-contamination regression specifications all exist.

### Stale expressions outside the verbatim Before block

Command:

```bash
awk 'NR < 122 || NR > 178' devlog/_plan/260710_gpt56_update/05_pro_timeout_budget.md \
  | rg -n 'TIER_DEFAULT_TIMEOUT_SEC\.pro|return .pro.;|Long-reasoning tiers \(pro|Pro default 3600|now\+3600|Pro=3600|1시간|한 시간' \
  | wc -l
```

Output:

```text
stale_matches_outside_verbatim_before=0
```

Judgement: PASS. Old tier names and one-hour Pro wording survive only inside the required verbatim Before evidence.

### Markdown structure

Command:

```bash
FENCES=$(rg -c '^```' devlog/_plan/260710_gpt56_update/05_pro_timeout_budget.md)
test $((FENCES % 2)) -eq 0
```

Output:

```text
fences=58 parity=0
```

Judgement: PASS. Code fences are balanced.

## Final judgement

PASS. The plan is reconciled to the three-tier canon while preserving timeout inheritance priority and owner design. No runtime tests were required because this work changes documentation only.
