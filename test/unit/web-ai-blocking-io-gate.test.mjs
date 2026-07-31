import { describe, expect, it } from 'vitest';
import { evaluateBlockingIoGate, runBlockingIoGate, scanSource } from '../../scripts/blocking-io-gate.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The gate is exercised through in-memory sources, never by editing checked-in
 * files: mutating the real tree to test a gate would corrupt whatever else is
 * in progress in the working copy.
 *
 * @param {Record<string, string>} files
 * @param {any} baseline
 */
function evaluate(files, baseline) {
    return evaluateBlockingIoGate({ sources: new Map(Object.entries(files)), baseline });
}

const oneCallBaseline = {
    files: { 'web-ai/a.mjs': { sync: 1, cdp: 0, nonLiteralSend: 0 } },
    totals: { sync: 1, cdp: 0 },
};

describe('blocking IO ratchet gate (#88 G3)', () => {
    it('W1: the real tree passes against its committed manifest', async () => {
        const result = await runBlockingIoGate(repoRoot);
        expect(result).toMatchObject({ ok: true });
        expect(result.detail).toMatch(/blocking IO \d+\/\d+/);
    });

    it('W2: an added synchronous call fails and names the file', () => {
        const result = evaluate({
            'web-ai/a.mjs': 'readFileSync(p);\nwriteFileSync(q, v);',
        }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('web-ai/a.mjs');
        expect(result.detail).toContain('2 > allowed 1');
    });

    it('W2b: a brand-new file cannot carry blocking IO', () => {
        // Absent from the manifest means a limit of zero. Walking the manifest
        // instead of the tree would skip new files entirely.
        const result = evaluate({
            'web-ai/a.mjs': 'readFileSync(p);',
            'web-ai/brand-new.mjs': 'writeFileSync(q, v);',
        }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('web-ai/brand-new.mjs');
    });

    it('W3: moving a call between files fails even though the total is unchanged', () => {
        const baseline = {
            files: {
                'web-ai/a.mjs': { sync: 1, cdp: 0, nonLiteralSend: 0 },
                'web-ai/b.mjs': { sync: 0, cdp: 0, nonLiteralSend: 0 },
            },
            totals: { sync: 1, cdp: 0 },
        };
        const result = evaluate({
            'web-ai/a.mjs': '// moved away',
            'web-ai/b.mjs': 'readFileSync(p);',
        }, baseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('web-ai/b.mjs');
    });

    it('W4: removing a call passes and reports the lower count', () => {
        const result = evaluate({ 'web-ai/a.mjs': '// nothing here' }, oneCallBaseline);
        expect(result.ok).toBe(true);
        expect(result.detail).toContain('reduced');
        expect(result.detail).toContain('--write-baseline');
    });

    it('W5: an added CDP command fails', () => {
        const result = evaluate({
            'web-ai/a.mjs': "readFileSync(p);\nawait cdp.send('Runtime.evaluate', {});",
        }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('CDP commands 1 > allowed 0');
    });

    it('W5b: a non-literal CDP command fails', () => {
        // Counting only literals would let `send(method)` through.
        const result = evaluate({
            'web-ai/a.mjs': 'readFileSync(p);\nawait cdp.send(method, {});',
        }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('non-literal .send()');
    });

    it('W5c: an existing non-CDP send stays allowed by file, not by receiver name', () => {
        // Allowing the *name* `ws` would let a CDP session be renamed to dodge
        // the gate, so the allowance is pinned per file.
        const baseline = {
            files: { 'web-ai/a.mjs': { sync: 1, cdp: 0, nonLiteralSend: 1 } },
            totals: { sync: 1, cdp: 0 },
        };
        const result = evaluate({ 'web-ai/a.mjs': 'readFileSync(p);\nws.send(payload);' }, baseline);
        expect(result.ok).toBe(true);
    });

    it('W5d: computed and bound sends fail closed', () => {
        for (const body of ["cdp['send']('Runtime.evaluate');", 'const s = cdp.send.bind(cdp);']) {
            const result = evaluate({ 'web-ai/a.mjs': `readFileSync(p);\n${body}` }, oneCallBaseline);
            expect(result.ok).toBe(false);
            expect(result.detail).toMatch(/computed-send|bound-send|computed-member-call/);
        }
    });

    it('W7: a computed member call fails closed because it cannot be counted', () => {
        const result = evaluate({ 'web-ai/a.mjs': 'readFileSync(p);\nfs[name](path);' }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('computed-member-call');
    });

    it('W8/W8b/W8c: aliasing a Sync binding fails, whatever the node module', () => {
        const cases = [
            "import { readFileSync as read } from 'node:fs';",
            "export { readFileSync as read } from 'node:fs';",
            "import { inflateRawSync as inflate } from 'node:zlib';",
        ];
        for (const body of cases) {
            const result = evaluate({ 'web-ai/a.mjs': `${body}\nreadFileSync(p);` }, oneCallBaseline);
            expect(result.ok).toBe(false);
            expect(result.detail).toContain('sync-binding-alias');
        }
    });

    it('W8d: aliasing a non-Sync binding is fine', () => {
        // These exist in the tree today and are all legitimate; banning aliasing
        // outright would fail W1. The rule is about the ORIGINAL name.
        const body = [
            "import { promises as fs } from 'node:fs';",
            "import { execFile as execFileCallback } from 'node:child_process';",
            "import { setTimeout as sleep } from 'node:timers/promises';",
        ].join('\n');
        const result = evaluate({ 'web-ai/a.mjs': `${body}\nreadFileSync(p);` }, oneCallBaseline);
        expect(result.ok).toBe(true);
    });

    it('W8e: a local value alias of a Sync binding fails', () => {
        // No `as` in the import and no `readFileSync(` at the call site, so every
        // other rule here misses it.
        const result = evaluate({
            'web-ai/a.mjs': "import { readFileSync } from 'node:fs';\nconst read = readFileSync;\nread(p);",
        }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('sync-value-alias');
    });

    it('W9: async filesystem APIs are not counted', () => {
        // Intentional: they do not block the loop. Their deadlines belong to the
        // budget contract, not to this gate.
        const result = evaluate({
            'web-ai/a.mjs': 'readFileSync(p);\nawait fs.promises.readFile(q);\nawait readFile(r);',
        }, oneCallBaseline);
        expect(result.ok).toBe(true);
    });

    it('counts Atomics.wait, which blocks without a Sync suffix', () => {
        expect(scanSource('Atomics.wait(view, 0, 0, 25);').sync).toBe(1);
    });
});
