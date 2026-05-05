// @ts-check
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.mjs'],
        testTimeout: 30000,
        hookTimeout: 30000,
        fileParallelism: false,
        reporters: 'verbose',
    },
});
