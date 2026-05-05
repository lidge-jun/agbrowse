import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), '..', '..');

/**
 * P02 — bin shim contract
 *
 * Locks the npm `bin` surface so future strict-migration phases cannot
 * accidentally break the publish contract.
 *
 *   • Both bin entries are referenced by package.json#bin and resolve to a
 *     real file under bin/.
 *   • Each shim begins with `#!/usr/bin/env node`.
 *   • Each shim is a single ESM `import` line that delegates to a `.mjs`
 *     skill entry — no logic, no .ts, no transpile dependency.
 *   • Each shim has the executable bit set on the owner.
 *   • The skill entry path that the shim imports actually exists.
 *
 * This contract is the binding constraint for P03–P13: the bin surface MUST
 * stay byte-identical until P14 explicitly proposes a runtime/publish
 * change.
 */

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

describe('P02 — bin shim contract', () => {
    it('package.json#bin lists exactly the expected entries', () => {
        expect(pkg.bin).toEqual({
            agbrowse: 'bin/agbrowse.mjs',
            'agbrowse-vision-click': 'bin/agbrowse-vision-click.mjs',
        });
    });

    for (const [name, rel] of Object.entries(pkg.bin)) {
        describe(name, () => {
            const abs = resolve(root, rel);
            const src = readFileSync(abs, 'utf8');
            const lines = src.split(/\r?\n/);

            it('has shebang on line 1', () => {
                expect(lines[0]).toBe('#!/usr/bin/env node');
            });

            it('is a thin shim: shebang + single relative import', () => {
                const code = lines.slice(1).filter((l) => l.trim().length > 0);
                expect(code).toHaveLength(1);
                expect(code[0]).toMatch(/^import ['"](\.\.\/skills\/[^'"]+\.mjs)['"];?$/);
            });

            it('owner-executable bit is set', () => {
                const mode = statSync(abs).mode & 0o777;
                expect(mode & 0o100).toBe(0o100);
                expect(() => accessSync(abs, constants.X_OK)).not.toThrow();
            });

            it('imports a real .mjs entry', () => {
                const code = lines.slice(1).find((l) => l.trim().startsWith('import'));
                const m = code.match(/['"]([^'"]+)['"]/);
                const target = resolve(dirname(abs), m[1]);
                expect(target.endsWith('.mjs')).toBe(true);
                expect(() => statSync(target)).not.toThrow();
            });
        });
    }

    it('package.json#files manifest matches frozen substrate (P00 invariant)', () => {
        // Frozen at substrate PR (#1). Any change here must be approved at
        // P14 (runtime/publish layout) and cited in the PR body.
        expect(pkg.files.sort()).toEqual([
            'README.md',
            'benchmarks/',
            'bin/',
            'devlog/',
            'docs/',
            'skills/',
            'structure/',
            'vitest.config.mjs',
            'web-ai/',
        ].sort());
    });
});
