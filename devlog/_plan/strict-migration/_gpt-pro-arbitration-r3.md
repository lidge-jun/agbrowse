---
created: 2026-05-05
phase: P02+P03
round: 3
verdict: NEEDS_FIX
---
# GPT Pro arbitration - P02+P03 round 3

## URL
https://chatgpt.com/c/69f9f9f7-857c-83a5-9da6-69d8e7728c87

## Answer

Blocker: change the P03 boundary-declaration rule from sibling .d.ts to sibling .d.mts for existing .mjs targets. TypeScript’s extension substitution for a runtime /mod.mjs lookup is /mod.mts, then /mod.d.mts, then /mod.mjs; /mod.d.ts is not the sibling declaration TypeScript will prefer for an explicit .mjs import. Keep .d.ts only for .js ESM files governed by "type": "module". 
TypeScript
+1

Blocker: make check-module-graph.mjs parse all static module specifier forms, not only from '...'. import "module-name" is a valid side-effect import form, and Node also treats specifiers in export from and import() as module specifiers; a graph that misses side-effect imports can undercount fan-out, mislabel leaves, and make “zero cycles” less trustworthy. 
MDN Web Docs
+1

Risk A: Medium as written; Low after blocker #1. The “.mjs may not import .ts directly” rule is correct for this substrate. Node can now strip erasable TypeScript, but that is not full TS support: it performs no type checking, ignores tsconfig.json, and only supports syntax that does not require code generation unless experimental transforms are used. Do not introduce a build step in P04 just to relax this boundary. 
Node.js
+1

Risk B: Low. The exact files array assertion is intentionally brittle and appropriate as a publish-contract trip-wire: npm’s files field defines what enters the packed/installable package, while bin entries are installation-facing executables and npm specifically requires the Node shebang for those files. Reorder churn is acceptable if the frozen substrate treats manifest order as reviewed contract surface. 
npm Docs
+1

Risk C: Medium-High. Defer errors.mjs from the first rename-to-.ts batch. Fan-in 19 makes it a high-blast-radius boundary test, and it should not be the first proof of the .mjs/.d.mts strategy. Start with low-fan-in leaves, then promote hubs once declaration resolution and runtime boundaries are proven.

VERDICT: NEEDS_FIX
