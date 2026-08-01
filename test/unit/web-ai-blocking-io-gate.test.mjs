import { describe, expect, it } from 'vitest';
import { evaluateBlockingIoGate, readRuntimeSources, runBlockingIoGate, scanSource } from '../../scripts/blocking-io-gate.mjs';
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

    it('W2c: a new caller of the blocking store lock is refused', () => {
        // The lock contains no `Sync` primitive at the call site, so the
        // patterns above see nothing when a new caller takes it — the case this
        // gate's own notes list as uncovered. It stops the event loop for the
        // whole wait, so every new caller is another place a deadline is not
        // counted.
        const result = evaluate({
            'web-ai/a.mjs': 'readFileSync(p);\nwithStoreLock(() => 1);',
        }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('blocking withStoreLock 1 > allowed 0');
        // The message has to name the replacement, or the reader has to guess.
        expect(result.detail).toContain('withStoreLockAsync');
    });

    it('W2d: the awaited lock is not counted', () => {
        // The paired case. Counting the async form too would make the gate
        // block the very migration it exists to push toward.
        const result = evaluate({
            'web-ai/a.mjs': 'readFileSync(p);\nawait withStoreLockAsync(() => 1);',
        }, oneCallBaseline);
        expect(result.ok).toBe(true);
    });

    it.each([
        ['optional call', 'withStoreLock?.(() => 1);'],
        ['parenthesised', '(withStoreLock)(() => 1);'],
        ['value alias', 'const lock = withStoreLock;\nlock(() => 1);'],
        ['import alias', "import { withStoreLock as lock } from './s.mjs';"],
        ['computed member', "store['withStoreLock'](() => 1);"],
    ])('W2e: %s cannot smuggle the blocking lock past the ratchet', (_label, snippet) => {
        // Counting only `withStoreLock(` left every one of these passing. They
        // are rejected rather than counted: a manifest cannot ratchet a name it
        // cannot predict.
        const result = evaluate({
            'web-ai/a.mjs': `readFileSync(p);\n${snippet}`,
        }, oneCallBaseline);
        expect(result.ok).toBe(false);
        expect(result.detail).toMatch(/store-lock/);
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

    it('W10: call-syntax variants do not slip past the counter', () => {
        // Every one of these is ordinary JavaScript, not obfuscation, and every
        // one passed while the rule matched `name(` instead of the reference.
        const variants = [
            'readFileSync?.(p);',
            '(readFileSync)(p);',
            "(fs)['readFileSync'](p);",
            'const read = fs.readFileSync;\nread(p);',
        ];
        for (const body of variants) {
            const result = evaluate({ 'web-ai/a.mjs': body }, { files: {}, totals: { sync: 0, cdp: 0 } });
            expect(result.ok, `should have been caught: ${body}`).toBe(false);
        }
    });

    it('W10b: unrelated dynamic dispatch is not flagged', () => {
        // Rejecting every `obj[i](…)` would fail on plain array and handler
        // lookups, so the computed rule is scoped to filesystem receivers.
        const result = evaluate({
            'web-ai/a.mjs': 'arr[i](value);\nconst h = handlers[key];\nh(payload);',
        }, { files: {}, totals: { sync: 0, cdp: 0 } });
        expect(result.ok).toBe(true);
    });

    it('W11: the real tree is scanned with only the bundle exempt', async () => {
        const sources = await readRuntimeSources(repoRoot);
        const scanned = [...sources.keys()];
        expect(scanned.every(f => /\.(mjs|js|cjs)$/.test(f))).toBe(true);
        // Only the browser-injected bundle is exempt, not the directory: asking
        // for no `/vendor/` at all would contradict W11b, which requires a
        // `vendor/runtime.mjs` to be scanned.
        expect(scanned).not.toContain('skills/browser/adaptive-fetch/vendor/defuddle.iife.min.js');
        // Whatever exists today must still satisfy the manifest.
        await expect(runBlockingIoGate(repoRoot)).resolves.toMatchObject({ ok: true });
    });

    it('W12: Atomics and CDP send resist the same call-shape tricks', () => {
        // `*Sync` moved to reference counting but these two were still matched
        // by call shape, so the identical dodges worked on them.
        const variants = [
            "Atomics['wait'](view, 0, 0, 25);",
            'Atomics.wait?.(view, 0, 0, 25);',
            "cdp.send.call(cdp, 'Runtime.evaluate', {});",
            "Reflect.apply(cdp.send, cdp, ['Runtime.evaluate', {}]);",
        ];
        for (const body of variants) {
            const result = evaluate({ 'web-ai/a.mjs': body }, { files: {}, totals: { sync: 0, cdp: 0 } });
            expect(result.ok, `should have been caught: ${body}`).toBe(false);
        }
    });
});

/**
 * The walker is exercised against a real temporary tree. The assertions above
 * can only observe what happens to exist in this repo, so they cannot show that
 * a `.js` file is picked up or that a symlink is refused — there are none.
 */
describe('blocking IO gate source walker', () => {
    it('W11b: reads .js/.cjs, excludes only the vendor bundle, refuses symlinks', async () => {
        const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const root = mkdtempSync(path.join(tmpdir(), 'agbrowse-gate-walk-'));
        try {
            mkdirSync(path.join(root, 'web-ai/nested'), { recursive: true });
            mkdirSync(path.join(root, 'skills/browser/adaptive-fetch/vendor'), { recursive: true });
            writeFileSync(path.join(root, 'web-ai/a.mjs'), 'export const a = 1;');
            writeFileSync(path.join(root, 'web-ai/nested/b.js'), 'export const b = 2;');
            writeFileSync(path.join(root, 'web-ai/c.cjs'), 'module.exports = 3;');
            writeFileSync(path.join(root, 'skills/browser/adaptive-fetch/vendor/defuddle.iife.min.js'), 'readFileSync(x);');
            // A runtime module parked in vendor/ must NOT inherit the bundle's exemption.
            writeFileSync(path.join(root, 'skills/browser/adaptive-fetch/vendor/runtime.mjs'), 'readFileSync(x);');

            const scanned = [...(await readRuntimeSources(root)).keys()];
            expect(scanned).toContain('web-ai/nested/b.js');
            expect(scanned).toContain('web-ai/c.cjs');
            expect(scanned).toContain('skills/browser/adaptive-fetch/vendor/runtime.mjs');
            expect(scanned).not.toContain('skills/browser/adaptive-fetch/vendor/defuddle.iife.min.js');

            symlinkSync(path.join(root, 'web-ai/nested'), path.join(root, 'web-ai/linked'));
            await expect(readRuntimeSources(root)).rejects.toThrow(/symlink/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
