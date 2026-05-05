#!/usr/bin/env node
// @ts-check
import { parseArgs } from 'node:util';
import { renderTraceReport } from '../web-ai/trace/report.mjs';

const { positionals } = parseArgs({ allowPositionals: true });
const tracePath = positionals[0];
if (!tracePath) {
    console.error('usage: node scripts/render-trace-report.mjs <trace.jsonl>');
    process.exitCode = 1;
} else {
    renderTraceReport(tracePath)
        .then(report => console.log(report))
        .catch(error => {
            console.error(error?.message || String(error));
            process.exitCode = 1;
        });
}
