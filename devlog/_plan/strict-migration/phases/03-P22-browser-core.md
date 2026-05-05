# P22 — skills/browser/browser-core.mjs

VERDICT-B per-file `// @ts-check`. Pure-function leaf (no internal imports, no node built-ins). 65 lines.

## Annotations
- 6 typedefs: `AriaYamlNode`, generic `CdpAxValue<T=unknown>`, `CdpAxNode`, `ParsedAxNode`, `AnnotatedAxNode`, `HttpRequestRecord`.
- JSDoc on all 5 exported functions.
- `annotateNodeOccurrences` typed as generic `<T extends { role, name? }>` returning `Omit<T, 'occurrence'> & { occurrence: number }`.
- Inline locals: `Map<string, number>`, `Set<string>`, `Record<string, number>` for module state widening.

## Runtime
Zero runtime changes. All `|| ''`, `|| 'unknown'`, `?? 0`, `?? ''` already present in original — preserved verbatim.

## Gates
- `npm run typecheck` ✓
- `npx tsc --noEmit -p tsconfig.checkjs.json` ✓ (51 entries)
- `npm run smoke:bins` ✓
- `npm test` ✓
