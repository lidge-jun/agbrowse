# P21 — skills/browser/profile-lock.mjs

VERDICT-B per-file `// @ts-check` annotation. True leaf (only Node built-ins: fs/path/os/crypto). 104 lines.

## Annotations
- `ProfileLock` typedef + `AcquiredProfileLock` intersection (`ProfileLock & { path: string }`).
- JSDoc on all 7 exported functions.
- Inline expression cast for `JSON.parse(...)` → `/** @type {ProfileLock} */`.
- Inline expression cast for `catch (e)` → `/** @type {{ code?: string }} */ (e).code === 'EPERM'`.

## Runtime
Zero runtime changes. Original truthy guards (`if (!pid || typeof pid !== 'number')`, `if (!ref) return true;`, `if (Number.isNaN(elapsed)) return true;`) preserved. No `Boolean(...)`/`String(...)`/`Number(...)` wrappers added.

## Gates
- `npm run typecheck` ✓
- `npx tsc --noEmit -p tsconfig.checkjs.json` ✓ (50 entries)
- `npm run smoke:bins` ✓
- `npm test` ✓
