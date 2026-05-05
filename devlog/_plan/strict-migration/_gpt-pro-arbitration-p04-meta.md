---
phase: P04 (meta)
gpt-pro-verdict: PASS — option B
date: 2026-05-05
sessionId: 01KQW97PPDWZQQBNGH34AJ2T7P
conversationUrl: https://chatgpt.com/c/69fa00fe-8d68-83a3-8b17-4cc0f6022e5b
---
# P04 readiness — GPT Pro arbitration

## Question

See `/tmp/agbrowse-p04-meta.md`.

## Pro answer (verbatim)

I pick B.

Physical rename is not valid in P04 under the approved invariants. Existing from './foo.mjs' specifiers name an exact relative ESM path; Node requires file extensions for relative/absolute ESM imports, and noEmit:true means TypeScript will not create a replacement .mjs file. That would violate runtime compatibility for bin/*.mjs and likely npm test, while also crossing the “no generated output/no dist” boundary. 
Node.js
+1

A is therefore out. Rewriting importers to ./foo.ts can work only by adopting a TypeScript runtime mechanism: current Node can run erasable .ts syntax without a flag in v22.18+ and required --experimental-strip-types on earlier v22 lines, while userland runners/loaders are another runtime choice. Either way, that is a P14 decision moved into P04; Node’s TS support also ignores tsconfig.json, so tsc --noEmit is not the runtime mechanism. 
Node.js
+1

C is out for the same reason, plus an emit conflict. .mts is TypeScript-native ESM; TypeScript documents that .mts emits to .mjs and .d.mts, but with noEmit:true there is no emitted .mjs, so C requires either Node/type-stripping at runtime or noEmit:false/generated files. That violates the P04 invariants and advances P14. 
TypeScript
+1

B preserves the invariants. Keep the .mjs files, import specifiers, bin/*.mjs, package.json#bin, and package.json#files manifest unchanged; add // @ts-check plus JSDoc to each P04 leaf. TypeScript supports JS type-checking via checkJs or per-file // @ts-check, so this gives selected-leaf checking without flipping global checkJs:false or changing runtime behavior. 
TypeScript
+1

The sibling .d.mts is the correct structural-type companion, not a runtime artifact. TypeScript treats .mjs/.d.mts as ESM and, for a runtime /mod.mjs lookup, can look for /mod.mts, then /mod.d.mts, then /mod.mjs; declaration files are type-only and do not produce JS output. Implementation note: ensure the checked .mjs leaf itself remains included in the TS program, because the .d.mts alone does not check the implementation body. 
TypeScript
+1

D has no conforming runtime escape hatch here. Any wrapper/dual-source alternative either still requires .ts/.mts execution, creates generated/duplicate runtime source outside the approved plan, or fails to increase implementation-body coverage. The round-4 PASS still holds when P04 is interpreted as “JSDoc + per-file @ts-check + sibling .d.mts for leaf .mjs files”, with true .mjs → .ts/.mts renames deferred to P14.

VERDICT: B

## Resolution

- VERDICT: B — JSDoc + per-file `// @ts-check` + sibling `.d.mts` for cross-module structural types.
- True `.mjs → .ts/.mts` rename deferred to **P14** (runtime/build decision).
- Implementation note from Pro: ensure the checked `.mjs` leaf remains included in the TS program; `.d.mts` alone does NOT check the implementation body.
- This preserves all hard invariants (P00.5 → P13) without violating no-dist/ and bin/*.mjs.
- Round-4 PASS verdict remains intact under this interpretation.
