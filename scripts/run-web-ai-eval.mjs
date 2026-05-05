#!/usr/bin/env node
// @ts-check
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runWebAiEval } from '../web-ai/eval-runner.mjs';

/**
 * @param {string[]} [argv]
 * @returns {Promise<any>}
 */
export async function main(argv = process.argv.slice(2)) {
    const { values } = parseArgs({
        args: argv,
        options: {
            config: { type: 'string' },
            vendor: { type: 'string', default: 'chatgpt' },
            fixtures: { type: 'string', default: 'test/fixtures/provider-dom' },
            variant: { type: 'string', multiple: true },
            concurrency: { type: 'string' },
            json: { type: 'boolean', default: false },
            'update-golden': { type: 'boolean', default: false },
        },
    });
    const result = await runWebAiEval({
        config: values.config,
        vendor: values.vendor,
        fixtures: values.fixtures,
        variants: values.variant,
        concurrency: /** @type {any} */ (values.concurrency),
    });
    if (values['update-golden']) {
        if ((values.vendor || 'chatgpt') !== 'chatgpt' || values.config) {
            throw new Error('--update-golden currently supports only --vendor chatgpt without --config');
        }
        await fs.writeFile('test/golden/web-ai-eval-baseline.chatgpt.json', `${JSON.stringify(result, null, 2)}\n`);
    }
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
    if (!result.ok) process.exitCode = 1;
    return result;
}

/**
 * @param {any} result
 */
function printHuman(result) {
    console.log(`web-ai eval ${result.status}: ${result.summary.passCount}/${result.summary.total} fixtures passed`);
    for (const regression of result.regressions) {
        console.log(`regression ${regression.provider}/${regression.variant} ${regression.metric}: ${regression.value} < ${regression.threshold}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error?.message || String(error));
        process.exitCode = 1;
    });
}
