// @ts-check
export const CONTEXT_PACKAGE_REFERENCE = {
    package: 'agbrowse',
    version: '0.1.3',
    license: 'MIT',
    note: 'Context packaging behavior is implemented locally by agbrowse web-ai.',
};

export const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000;
export const DEFAULT_INLINE_CHAR_LIMIT = 50_000;
export const DEFAULT_BROWSER_INLINE_CHAR_BUDGET = 60_000;
export const DEFAULT_TOKEN_WARNING_RATIO = 0.85;

export const DEFAULT_MODEL_INPUT_BUDGETS = {
    chatgpt: {
        instant: 196_000,
        thinking: 196_000,
        pro: 196_000,
        default: 196_000,
    },
    gemini: {
        default: 200_000,
        deepThink: 200_000,
    },
};

export const DEFAULT_EXCLUDES = [
    '.git/**',
    'node_modules/**',
    'dist/**',
    'build/**',
    '.next/**',
    'coverage/**',
    '.env',
    '.env.*',
    '**/*.pem',
    '**/*.key',
    '**/*token*',
    '**/*secret*',
];
