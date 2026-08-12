# Evidence Receipt - 02 Discriminator Residue Repair

- Checked at: `2026-07-10 12:58:09 KST`
- Target: `devlog/_plan/260710_gpt56_update/02_core_contract_decisions.md`
- Scope: docs-only repair of the toggle-absent discriminator contract

## Verification Command

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';

const file = 'devlog/_plan/260710_gpt56_update/02_core_contract_decisions.md';
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');
const expected = 'header discriminator 부재면 legacy selector 경로 + warning으로 진행, 모순이면 fail closed';
const obsoletePatterns = [
  /header discriminator 부재\/모순이면 fail closed/i,
  /toggle 부재\s*(?:=|이면).*fail[- ]?closed/i,
  /toggle(?: 자체가)? 없으면[^\n]*fail[- ]?closed/i,
  /discriminator (?:missing|absent)[^\n]*fail[- ]?closed/i,
];
const obsoleteMatches = obsoletePatterns.flatMap((pattern) => text.match(pattern) ?? []);
const canonicalChecks = {
  toggleAbsentIsLegacy: text.includes('toggle이 없으면\n네 번째 오류 상태로 만들지 않고 legacy UI로 판정한다.'),
  tableLegacyPathAndWarning: text.includes('| Chat/Work toggle 부재 | legacy UI 판정, legacy selector 경로 진행 + warning 기록 |'),
  proseLegacyPathAndWarning: text.includes("toggle 자체가 없으면\n`surface-discriminator-absent: legacy UI selector path` warning을 남기고 기존"),
  repairedOpenDecision: lines[1139]?.includes(expected) === true,
};
const result = { file, line1140: lines[1139], obsoleteContradictions: obsoleteMatches, canonicalChecks };
console.log(JSON.stringify(result, null, 2));
if (obsoleteMatches.length || Object.values(canonicalChecks).includes(false)) process.exit(1);
NODE
```

## Output

```json
{
  "file": "devlog/_plan/260710_gpt56_update/02_core_contract_decisions.md",
  "line1140": "| **OPEN DECISION** | 무료/Plus 계정의 header/picker shape | header discriminator 부재면 legacy selector 경로 + warning으로 진행, 모순이면 fail closed | 계정별 probe + sanitized fixture 후 03/04 |",
  "obsoleteContradictions": [],
  "canonicalChecks": {
    "toggleAbsentIsLegacy": true,
    "tableLegacyPathAndWarning": true,
    "proseLegacyPathAndWarning": true,
    "repairedOpenDecision": true
  }
}
```

Exit code: `0`

## Judgement

PASS. The stale contract at line 1140 now distinguishes absence from ambiguity:
an absent toggle continues through the legacy selector path with a warning, while an
ambiguous present toggle remains fail-closed. The whole-document contradiction scan
found zero obsolete matches, and all four canonical discriminator contexts agree.
No build or runtime test applies to this documentation-only wording repair.
