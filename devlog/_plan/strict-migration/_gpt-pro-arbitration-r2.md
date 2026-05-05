1

PASS

2

None.

3

First real .ts ESM module may expose package-boundary assumptions. Under module: "NodeNext", .ts files are interpreted using Node-style package rules; a project of .ts files emits CommonJS by default unless an enclosing package.json has "type": "module" or the files use .mts. That is not a blocker for this substrate PR, but P03 should explicitly confirm the first leaf .ts module is under an ESM package boundary or use .mts. [Source: TypeScript Modules Reference] 
TypeScript

allowJs:false means .ts files cannot freely depend on existing .mjs implementation without declarations. That is acceptable for a strict migration, but P03/P04 need boundary declarations or conversion ordering so new TS does not fall into implicit-any module imports. TypeScript documents allowJs as the switch that allows JS files to be imported into a TS project, and checkJs as JS error reporting when JS is included. [Source: TypeScript TSConfig Reference] 
TypeScript

The zero-floor ratchet is intentionally strict and may reject temporary phase-local debt. Counting any/@strict-debt against frozen per-directory floors is merge-safe, but contributors must either keep every phase exit at zero or consciously update the baseline only as a reviewed migration event. This is a workflow risk, not a correctness blocker.

The bin smoke is a good early-warning signal but not a full packaging/install proof. Running both bin shims with --help, checking executable bits, and preserving bin/files gives meaningful coverage; however, packed-tarball install behavior and generated Windows .cmd launchers are still outside this smoke. npmâs bin field is what causes global installs to link or generate command wrappers, and npmâs files field controls packed package contents. [Source: npm package.json docs] 
npm Docs

noEmit:true keeps this PR safe but delays emit/runtime validation. This is appropriate for P00.5+P00+P01 because TypeScript can be used as a source type-checker without emitting JS, but later phases must still prove import specifiers, extension choices, and runtime packaging once source TS begins replacing implementation. [Source: TypeScript TSConfig Reference] 
TypeScript

4

Approved to commit and push the substrate.

Approved to open a PR for P00.5 + P00 + P01 alone. Do not bundle P03 leaf-utils into this PR; keeping the substrate separate is the right granularity.
