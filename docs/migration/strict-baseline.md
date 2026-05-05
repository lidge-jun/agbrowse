# strict-baseline floor (frozen at P00)

Frozen counts of `\bany\b` and `@strict-debt` markers across tracked TypeScript directories. Updated only when a phase explicitly lowers the floor.

## frozen floor

| dir | any | debt | allow |
|-----|----:|-----:|------:|
| bin | 0 | 0 | 0 |
| web-ai | 0 | 0 | 0 |
| skills | 0 | 0 | 0 |
| scripts | 0 | 0 | 0 |
| benchmarks | 0 | 0 | 0 |
| types | 0 | 0 | 0 |

> All tracked directories start at 0 because the migration begins with **zero** `.ts` source files. Counts are measured against `**/*.{ts,mts,cts}` only — `.mjs` is structurally unchecked until each file is converted in its own phase.

## rules

- Floors only ratchet **down**. A phase may not raise an `any` count.
- New `.ts` files that introduce `any` must declare a per-file budget in the phase doc and raise the corresponding row by that amount (and the phase must lower it before exit).
- `@strict-debt` markers are temporary; every phase must remove markers it added before that phase's exit gate.
