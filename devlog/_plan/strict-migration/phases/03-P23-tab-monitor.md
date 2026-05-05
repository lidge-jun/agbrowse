# P23 — skills/browser/tab-monitor.mjs

VERDICT-B per-file `// @ts-check` annotation. 113-line `EventEmitter` class wrapping `tab-manager.isTabAlive`. Deps already P18-annotated.

## Annotations
- `MonitorEntry` (uses `ReturnType<typeof setInterval>` for cross-platform `Timeout|number` polymorphism), `HealthEntry` typedefs.
- `HealthEntry.error` widened to `string|null|undefined` to accommodate both clear-on-success (null), uninstrumented (undefined from `(error).message` cast on unknown `.message?: string`), and explicit string assignment paths.
- JSDoc on constructor + 6 methods + `createTabMonitor` factory.
- Inline expression cast `/** @type {{ message?: string }} */ (error).message` for unknown caught-error.
- Field types `Map<string, MonitorEntry>` and `Map<string, HealthEntry>` in constructor.

## Runtime
Zero runtime changes. No `Boolean()`/`String()`/`Number()` wrappers, no `?.` introduced over original `(error).message`, no `instanceof Error`. Unused import `getTabInfo` left intact (matches pre-migration source).

## Gates
- `npm run typecheck` ✓
- `npx tsc --noEmit -p tsconfig.checkjs.json` ✓ (52 entries)
- `npm run smoke:bins` ✓
- `npm test` ✓
