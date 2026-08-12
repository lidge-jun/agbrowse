# WP0 Reconciliation Review Round 1 Synthesis

Date: 2026-07-10
Reviewer: Sol agent `019f4afe-5362-74c1-845e-34cb1a14451d`
Verdict: FAIL (9 accepted findings; 5 high, 4 medium)

## Root causes and dispositions

1. The fixture-first sequence named phases but omitted the dependency bootstrap. Accept:
   add `npm ci` before WP2 verification and again at WP7 closeout.
2. Several phase docs still assumed a zero-error global checkjs tree. Accept: both
   checkjs projects run explicitly, retain the 24/124 baseline, and require zero new
   diagnostics in touched files. `typecheck` and `gate:all` remain separate exit-zero gates.
3. The `extended` warning contract had no count assertion. Accept: 02 owns exact one-line
   stderr proof at the CLI boundary; 03 owns exactly one structured warning entry at the
   selector boundary.
4. WP1's five original checks and ten reverse-engineering checks were described in different
   owners. Accept: WP1 always means 01 section 5.1 plus 04 sections 7.1 and 7.2, and it gates
   all Work automation.
5. Runtime SoT mixed contract readiness with live mutation maturity. Accept: strict CLI/MCP
   schema, guards, and fixture evaluation are Ready; live picker/submit/task polling remains
   Beta until the authenticated smoke passes.
6. The final matrix overgeneralized the active-Work error. Accept: only Chat commands fail on
   active Work; ambiguous fails for both command families; Work send succeeds on verified Work.
7. The interview retained an already-resolved MCP name assumption. Accept: remove it from the
   residual assumptions and keep `web_ai_work_send` fixed.
8. External research left omitted Power open after v1 made it required. Accept: omission is a
   preflight error with zero mutation; no default/no-op branch exists in v1.
9. A consumer table confused Chat model values with provider timeout tier keys. Accept:
   `deriveTimeoutTier` maps model/provider inputs to `chatgpt-pro`, `grok-heavy`, or
   `deep-research`.

No finding is rebutted. Round 2 must use the same reviewer context and verify only these
closures plus any contradiction introduced by the repairs.
