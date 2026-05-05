1. Pick

Hybrid: A-types, B-package-surface.

Use real .ts migration and tsc --noEmit strict checking, but do not adopt Plan Aâs dist/ repath as the migration default. Keep the current npm-facing surface stable: bin/agbrowse.mjs, bin/agbrowse-vision-click.mjs, and the published files manifest remain unchanged until a late, explicit packaging phase proves a runtime strategy.

2. Justification under 300 words

Plan B is safe for the package surface, but it optimizes for comment-heavy typing in a repo with 162 .mjs files and zero existing JSDoc @param/@type annotations. TypeScript can check JavaScript with allowJs plus checkJs, so B is technically viable, but it would require large JSDoc churn before reaching a strong internal type model. [Source: TypeScript checkJs docs] 
TypeScript

Plan A reaches real TypeScript faster, but its proposed dist/ publish repath is the wrong first move for an npm-published CLI whose current bins are exact .mjs entrypoints with shebangs. npm links or wraps the package.json bin target directly, so moving those targets is a publish-surface change, not just a build detail. [Source: npm package.json bin docs] 
npm Docs

The repo already has the decisive evidence: PR #179/P20 used the hybrid shapeâ.ts source, .mjs bin shims, tsx-style execution, tsc --noEmitâand all 78 P19/P20 files plus full vitest passed. [Source: provided repo facts] That should become the migration pattern, with one hard caveat: publishing .ts runtime under node>=18 is not automatically safe. Native Node TypeScript support arrived later, full support still points to third-party loaders such as tsx, and Nodeâs built-in type stripping refuses TypeScript inside node_modules. [Source: Node.js TypeScript modules docs] 
Node.js
+1

So: migrate with .ts plus noEmit now; decide runtime/publish build only after pack/install smoke gates.

3. Top 5 risks Plan A misses
#	Missed risk
1	ESM import-extension churn. Renaming .mjs to .ts and emitting JS requires import specifiers to match emitted extensions; TypeScriptâs Node ESM docs explicitly call out rewriting relative imports to emitted paths such as .js, while .mts emits .mjs. [Source: TypeScript 4.7 ESM docs] 
TypeScript

2	dist/ breaks asset-relative code. The package ships non-code directories such as skills/, web-ai/, benchmarks/, docs/, structure/, and devlog/; any import.meta.url or relative filesystem lookup may change when runtime code moves to dist/. [Source: provided repo facts]
3	Tests may validate source, not the package. The current 77 test files are .mjs under test/; if tests do not run against packed dist output, Plan A can pass vitest while shipping a broken CLI. [Source: provided repo facts]
4	Bin repath is a package contract change. npm links or wraps the exact bin target declared in package.json, including global and dependency installs. [Source: npm package.json bin docs] 
npm Docs

5	Deep-import consumers may break. Even if agbrowse is âa CLI,â the published files manifest exposes many paths; consumers may import internal .mjs files directly. A version bump does not replace an install-and-consumer audit.
4. Top 5 risks Plan B misses
#	Missed risk
1	Zero starting annotations means slow signal. With no current @param/@type annotations, strict checkJs will surface broad implicit-any and structural gaps before it provides useful design-level types. [Source: provided repo facts]
2	JSDoc verbosity becomes migration debt. 162 files of annotations can obscure logic and make refactors slower than native .ts types.
3	The âno d.tsâ con is self-imposed, not inherent. TypeScript can generate .d.ts from JavaScript using JSDoc with allowJs, declaration, and emitDeclarationOnly. [Source: TypeScript d.ts-from-JS docs] 
TypeScript

4	Advanced JSDoc limits are overstated but ergonomics still matter. TypeScriptâs JSDoc support can use most TypeScript syntax, including conditional types, but authoring and maintaining those in comments is still worse than .ts for a growing strict codebase. [Source: TypeScript JSDoc Reference] 
TypeScript

5	It defers the real endpoint. B preserves current runtime perfectly, but it does not produce the âreal strict TypeScript sourceâ end-state already proven in P20/PR #179. [Source: provided repo facts]
5. Top 5 risks the chosen hybrid must track
#	Risk
1	Published .ts runtime can fail under node>=18. Do not rely on native Node TypeScript for the package: built-in type stripping is v22-era, ignores tsconfig, and refuses TypeScript files inside node_modules. [Source: Node.js TypeScript modules docs] 
Node.js
+1

2	tsx-style runtime must be a deliberate dependency decision. If shims invoke tsx or node --import=tsx, that is a runtime/package policy choice, not only a dev-tooling choice. [Source: Node.js TypeScript modules docs] 
Node.js

3	Mixed .mjs/.ts import graph can drift. Every phase must prove that .mjs shims, .ts source, tests, and any generated declarations resolve the same graph.
4	NoEmit can hide publish failures. tsc --noEmit proves types, not packed installability; npm pack plus local/global install smoke must be mandatory before release.
5	Declaration strategy can lag behind implementation. If the package exposes importable modules, declarations must be generated or intentionally omitted with a documented CLI-only contract.
6. Final 20-phase outline
Phase file	Scope
03-P00.5-preflight-repo-shape.md	Freeze current repo shape: 162 .mjs, 0 .ts baseline, bin paths, manifest, vitest baseline, no source changes.
03-P00-strict-tooling-baseline.md	Normalize strict tsconfig, noEmit typecheck script, vitest run script, pack dry-run script, and migration invariants.
03-P01-jsdoc-bridge-and-type-inventory.md	Add only minimal JSDoc needed to unblock checkJs; inventory implicit-any and unsafe boundary hotspots.
03-P02-bin-shim-contract.md	Lock bin/agbrowse.mjs and bin/agbrowse-vision-click.mjs as stable shebang shims with executable and smoke coverage.
03-P03-module-graph-and-import-extensions.md	Map all .mjs imports and classify leaf modules safe for .ts conversion without runtime-surface drift.
03-P04-leaf-utils-to-ts.md	Convert leaf utility modules to .ts; preserve current .mjs-facing runtime behavior through shims or tests.
03-P05-config-and-cli-parser-types.md	Type argv, env, config, defaults, and option-normalization paths.
03-P06-filesystem-and-asset-types.md	Type filesystem, path, import.meta.url, and package asset-resolution boundaries.
03-P07-browser-session-types.md	Type browser/session lifecycle state and async resource ownership.
03-P08-action-command-types.md	Type command/action plans, execution results, and command validation.
03-P09-vision-click-types.md	Type vision-click pipeline, bin integration, and image/coordinate result shapes.
03-P10-skills-web-ai-types.md	Type skills/ and web-ai/ interfaces, serialized contracts, and public data objects.
03-P11-test-fixture-types.md	Type test helpers and fixtures while keeping .mjs tests unless conversion is necessary.
03-P12-error-event-result-types.md	Introduce typed errors, events, result unions, and logging payloads.
03-P13-strictness-ratchet.md	Ratchet stricter compiler options and remove temporary any/unknown suppressions.
03-P14-runtime-loader-or-build-decision.md	Decide publish runtime: declared loader dependency, generated same-path .mjs, or approved dist/ build.
03-P15-declaration-output-and-types-field.md	Generate and validate declarations for any supported import surface.
03-P16-npm-pack-install-smoke.md	Run npm pack, local install, global install, and bin smoke on supported Node versions.
03-P17-downstream-consumer-audit.md	Audit documented CLI use, possible deep imports, examples, and semver impact.
03-P18-release-go-no-go.md	Final full typecheck, vitest, pack, install smoke, changelog, version, and publish decision.

Global phase rule: Go only when typecheck, vitest, and package-surface invariants remain green. No-Go on bin path drift, unreviewed manifest drift, or unproven published runtime.

7. First 3 phase gates
P00.5 gate â preflight repo shape

Commands:

Bash
npm run -s typecheck -- --noEmit
npm run -s test -- --run

Exit conditions:

Status	Condition
GO	Both commands exit 0.
GO	No new .ts rename, dist/ output, bin repath, or files-manifest change occurs in this phase.
GO	Current bin entries remain bin/agbrowse.mjs and bin/agbrowse-vision-click.mjs.
NO-GO	typecheck script is missing, exits nonzero, or does not run tsc noEmit.
NO-GO	vitest fails or runs in watch mode instead of a finite CI-style run.
P00 gate â strict tooling baseline

Commands:

Bash
npm run -s typecheck -- --noEmit
npm run -s test -- --run
npm run -s pack:dry

Exit conditions:

Status	Condition
GO	All commands exit 0.
GO	typecheck covers current .mjs files plus any migrated .ts files included in the phase.
GO	pack:dry confirms the package still exposes the current manifest categories: README.md, bin/, skills/, web-ai/, benchmarks/, docs/, structure/, devlog/, vitest.config.mjs.
GO	pack:dry shows no unapproved dist/ runtime dependency and no bin target change.
NO-GO	Any script is missing after P00 changes.
NO-GO	The package requires a dist/ path, generated JS path, or loader dependency before P14 approval.
P01 gate â JSDoc bridge and type inventory

Commands:

Bash
npm run -s typecheck -- --noEmit
npm run -s test -- --run
npm run -s pack:dry
npm run -s smoke:bins

Exit conditions:

Status	Condition
GO	All commands exit 0.
GO	JSDoc additions are limited to unblockers and shared boundary typedefs; no mass 162-file comment migration starts here.
GO	smoke:bins proves both current .mjs bin shims still execute through the intended runtime path.
GO	Type inventory exists for the next conversion batch: leaf modules, boundary modules, and unsafe-any hotspots.
NO-GO	Any bin shim loses shebang behavior, executable behavior, or stable path behavior.
NO-GO	JSDoc becomes the long-term migration endpoint instead of a bridge to .ts.
8. Verdict

PASS, with this scope: Go for the hybrid migration now; No-Go for any publish-layout or dist/ repath until P14âP16 prove the runtime package.

Blockers: none for starting P00.5/P00/P01. The only hard release blocker is unresolved later: a node>=18-compatible published runtime must be proven by npm pack/install smoke before publishing.
