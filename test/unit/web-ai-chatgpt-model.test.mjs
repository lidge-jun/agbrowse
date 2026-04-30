import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const modelSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-model.mjs'), 'utf8');

describe('web-ai ChatGPT model selector policy', () => {
    it('supports the observed Heavy/Pro effort UI', () => {
        expect(modelSrc).toContain('model-switcher-gpt-5-5-pro-thinking-effort');
        expect(modelSrc).toContain('model-switcher-gpt-5-5-thinking-thinking-effort');
        expect(modelSrc).toContain('Instant|Fast|Thinking|Pro|Heavy');
        expect(modelSrc).toContain('Heavy');
        expect(modelSrc).toContain('readActiveModelPill');
    });
});
