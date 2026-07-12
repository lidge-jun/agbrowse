#!/usr/bin/env node
// @ts-check
import { chromium } from 'playwright-core';
import { parseArgs } from 'node:util';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SURFACES = new Set(['picker-ko','picker-en','picker-locked','picker-close','thinking-on','thinking-off','attachment','baseline','streaming','complete-citations','sources-pane-open','sources-pane-close','new-thread','overlay']);

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    surface: { type: 'string' }, output: { type: 'string' },
    'screenshot-output': { type: 'string' }, force: { type: 'boolean', default: false },
    'cdp-url': { type: 'string', default: process.env.BROWSER_AGENT_CDP_URL || 'http://127.0.0.1:9222' },
  }});
  if (!values.surface || !SURFACES.has(values.surface)) throw new Error(`unsupported --surface: ${values.surface || ''}`);
  if (!values.output) throw new Error('--output is required');
  if (!values['screenshot-output']) throw new Error('--screenshot-output is required');
  const output = resolve(values.output);
  const screenshotOutput = resolve(values['screenshot-output']);
  if (!values.force) {
    for (const path of [output, screenshotOutput]) {
      try { await access(path); throw new Error(`refusing to overwrite ${path}; pass --force`); } catch (error) {
        if (String(error?.message || '').startsWith('refusing to overwrite')) throw error;
      }
    }
  }
  const browser = await chromium.connectOverCDP(values['cdp-url']);
  try {
    const pages = browser.contexts().flatMap((context) => context.pages()).filter((page) => {
      try { return ['perplexity.ai', 'www.perplexity.ai'].includes(new URL(page.url()).hostname); } catch { return false; }
    });
    if (pages.length !== 1) throw new Error(`expected exactly one Perplexity page, found ${pages.length}`);
    const page = pages[0];
    const roots = surfaceCandidates(page, values.surface);
    if (await roots.count() !== 1) throw new Error(`surface ${values.surface} resolved ${await roots.count()} candidates; refusing capture`);
    const root = roots.first();
    const html = await root.evaluate((node) => {
      const clone = node.cloneNode(true);
      for (const el of clone.querySelectorAll('script,style,[data-account],[data-history]')) el.remove();
      for (const el of clone.querySelectorAll('a[href],img[src],form[action],[formaction]')) {
        for (const attr of ['href','src','action','formaction']) if (el.hasAttribute(attr)) el.setAttribute(`data-original-${attr}`, 'REDACTED');
      }
      for (const el of clone.querySelectorAll('[contenteditable="true"],textarea,input')) {
        if ('value' in el) el.value = '';
        el.textContent = '';
      }
      return `<!doctype html><html><head><meta charset="utf-8"></head><body>${clone.outerHTML}</body></html>\n`;
    });
    await mkdir(dirname(output), { recursive: true });
    await mkdir(dirname(screenshotOutput), { recursive: true });
    await writeFile(output, html, 'utf8');
    await root.screenshot({ path: screenshotOutput });
    console.log(JSON.stringify({ surface: values.surface, output, screenshotOutput, retained: false }, null, 2));
  } finally {
    await browser.close();
  }
}

function surfaceCandidates(page, surface) {
  const map = {
    'baseline': '#ask-input', 'new-thread': '#ask-input',
    'picker-ko': '[role="menuitemradio"]', 'picker-en': '[role="menuitemradio"]',
    'picker-locked': 'pplx-icon-lock', 'picker-close': '[data-picker-close], button:has-text("Close")',
    'thinking-on': '[role="switch"][aria-checked="true"]', 'thinking-off': '[role="switch"][aria-checked="false"]',
    'attachment': 'input[type="file"]', 'streaming': 'button:has-text("Stop response (Esc)")',
    'complete-citations': 'button:has-text("sources")', 'sources-pane-open': '[data-perplexity-sources-pane]',
    'sources-pane-close': '[data-authenticated-close]', 'overlay': '[aria-modal="true"]',
  };
  const marker = map[surface];
  const candidate = page.locator(marker);
  if (surface.startsWith('picker-')) return candidate.first().locator('xpath=ancestor::*[self::div or self::section][1]');
  return candidate;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
}
