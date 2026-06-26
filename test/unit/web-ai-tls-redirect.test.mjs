import { describe, expect, it } from 'vitest';
import { selectProfile } from '../../skills/browser/adaptive-fetch/tls-fetch.mjs';

describe('R3+R4: TLS fetch redirect security', () => {
    it('selectProfile is deterministic for the same hostname', () => {
        const p1 = selectProfile('https://example.com/a');
        const p2 = selectProfile('https://example.com/b');
        expect(p1).toBe(p2);
    });

    it('selectProfile returns a valid profile', () => {
        const valid = ['chrome131', 'safari18_0', 'firefox133'];
        expect(valid).toContain(selectProfile('https://test.com'));
    });
});
