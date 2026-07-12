#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUT_DIR = resolve('test/fixtures/provider-dom');
const GENERATED_BY = 'scripts/derive-perplexity-adversarial-fixtures.mjs';
const REVIEWED_SOURCES = [
  'docs/superpowers/specs/2026-07-11-perplexity-live-dom-observation.md',
  'docs/superpowers/specs/2026-07-11-perplexity-web-ai-design.md',
];

const shell = (body, locale = 'en') => `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><title>Sanitized Perplexity fixture</title></head>
<body data-provider="perplexity">${body}</body></html>\n`;

const composer = ({ evalMarkers = true, id = 'ask-input' } = {}) => `
  <div class="composer-shell">
    <div id="${id}" role="textbox" contenteditable="true" aria-label="Ask a question"${evalMarkers ? ' data-eval-intent="composer.fill" data-eval-ref="p-composer"' : ''}></div>
    <button type="button" aria-label="Add files or tools"${evalMarkers ? ' data-eval-intent="upload.open" data-eval-ref="p-upload"' : ''}>Add files or tools</button>
    <button type="button" aria-label="Submit"${evalMarkers ? ' data-eval-intent="send.click" data-eval-ref="p-send"' : ''}>Submit</button>
  </div>`;

const response = ({ text = 'ANSWER_TOKEN', sources = 2, evalCopy = true, attrs = '' } = {}) => `
  <section class="perplexity-response" data-agbrowse-perplexity-response="committed" ${attrs}>
    <div data-answer-text>${text}</div>
    <footer>
      <button type="button" aria-label="Copy"${evalCopy ? ' data-eval-intent="copy.click" data-eval-ref="p-copy"' : ''}>Copy</button>
      <button type="button" aria-label="${sources} sources">${sources} sources</button>
      <button type="button">Share</button>
    </footer>
  </section>`;

const modelRows = ({ locale = 'en', thinking = 'off', locked = false, duplicateSwitch = false, detached = false } = {}) => {
  const thinkingLabel = locale === 'ko' ? '사고' : 'Thinking';
  const modelLabel = locale === 'ko' ? 'GPT-5.6 테라' : 'GPT-5.6 Terra';
  const state = (checked) => `aria-checked="${checked}" data-state="${checked ? 'checked' : 'unchecked'}"`;
  const radio = (alias, label, checked = false) => `<div role="menuitemradio" ${state(checked)} data-model-alias="${alias}">${label}</div>`;
  const lock = (alias, label) => `<div role="menuitem" data-model-alias="${alias}">${label}<svg aria-hidden="true"><use href="#pplx-icon-lock"></use></svg></div>`;
  return `
  <button type="button" aria-label="Model">Model</button>
  <div role="menu" data-perplexity-model-picker data-generation="${detached ? '2' : '1'}">
    ${radio('best', 'Best')}
    ${radio('sonar-2', 'Sonar 2')}
    ${radio('gpt-5.6-terra', modelLabel, true)}
    <div role="menuitemcheckbox" data-thinking-owner="gpt-5.6-terra">${thinkingLabel}<button role="switch" aria-label="Thinking" ${state(thinking === 'on')}></button>${duplicateSwitch ? `<button role="switch" aria-label="Thinking" ${state(false)}></button>` : ''}</div>
    ${radio('gemini-3.1-pro', 'Gemini 3.1 Pro')}
    ${radio('claude-sonnet-5', 'Claude Sonnet 5')}
    ${radio('glm-5.2', 'GLM 5.2')}
    ${radio('kimi-k2.6', 'Kimi K2.6')}
    ${radio('nemotron-3-ultra', 'Nemotron 3 Ultra')}
    ${lock('gpt-5.6-sol', 'GPT-5.6 Sol')}
    ${locked ? lock('claude-opus-4.8', 'Claude Opus 4.8') : ''}
  </div>`;
};

/** @type {Record<string,string>} */
const fixtures = {
  'perplexity-baseline.html': shell(`${composer()}${response({})}`),
  'perplexity-cosmetic-churn.html': shell(`
    <div class="renamed-shell cosmetic-only">${composer()}${response({ text: 'ANSWER_TOKEN' })}</div>`),
  'perplexity-structural-churn.html': shell(`
    <div><header>WRAPPER_TOKEN</header><main><div>${composer()}</div><div><div>${response({ text: 'ANSWER_TOKEN' })}</div></div></main></div>`),
  'perplexity-breaking.html': shell(`${composer({ evalMarkers: false, id: 'search-decoy' })}${response({ evalCopy: false, text: 'DECOY_RESPONSE' })}`),
  'perplexity-model-picker-en.html': shell(modelRows({ locale: 'en' })),
  'perplexity-model-picker-ko.html': shell(modelRows({ locale: 'ko' }), 'ko'),
  'perplexity-model-picker-close.html': shell(`${modelRows({ locale: 'en' })}<button type="button" data-picker-close="authenticated">Close</button>`),
  'perplexity-model-picker-locked.html': shell(modelRows({ locked: true })),
  'perplexity-model-picker-duplicate-switch.html': shell(modelRows({ duplicateSwitch: true })),
  'perplexity-thinking-on.html': shell(modelRows({ thinking: 'on' })),
  'perplexity-thinking-off.html': shell(modelRows({ thinking: 'off' })),
  'perplexity-thinking-adjacent-decoys.html': shell(`${modelRows({ thinking: 'on' })}<div><button role="switch" aria-label="Thinking" aria-checked="false"></button></div>`),
  'perplexity-thinking-detached-reopen.html': shell(modelRows({ thinking: 'on', detached: true })),
  'perplexity-streaming.html': shell(`${composer()}<section class="perplexity-response"><div data-answer-text>PARTIAL_TOKEN</div><button type="button">Stop response (Esc)</button></section>`),
  'perplexity-complete-citations.html': shell(`${composer()}${response({ sources: 3 })}<aside data-perplexity-sources-pane data-response-fingerprint="answer-1"><a data-source-url="https://example.test/a?q=1#fragment">Source A</a><a data-source-url="https://example.test/b">Source B</a></aside>`),
  'perplexity-copy-decoys.html': shell(`<button type="button">Copy</button>${response({ text: 'EARLIER', evalCopy: false })}<aside><button type="button">Copy</button></aside>${response({ text: 'CURRENT' })}`),
  'perplexity-attachment-preview.html': shell(`${composer()}<div data-attachment-preview><span>context.txt</span><button type="button">Remove</button></div>`),
  'perplexity-late-citation.html': shell(`${response({ sources: 0 })}<aside data-perplexity-sources-pane data-arrival="late"><a data-source-url="https://example.test/late">Late Source</a></aside>`),
  'perplexity-sources-pane-open.html': shell(`${response({})}<aside data-perplexity-sources-pane data-response-fingerprint="answer-1"><button type="button">Sources</button><a data-source-url="https://example.test/a">A</a></aside>`),
  'perplexity-sources-pane-stale.html': shell(`${response({ text: 'CURRENT' })}<aside data-perplexity-sources-pane data-response-fingerprint="old-answer"><a data-source-url="https://example.test/stale">Stale</a></aside>`),
  'perplexity-sources-pane-two-visible.html': shell(`${response({ text: 'CURRENT' })}<aside data-perplexity-sources-pane data-response-fingerprint="answer-1"><a data-source-url="https://example.test/a">A</a></aside><aside data-perplexity-sources-pane data-response-fingerprint="answer-2"><a data-source-url="https://example.test/b">B</a></aside>`),
  'perplexity-sources-pane-fingerprint-replacement.html': shell(`${response({ text: 'CURRENT' })}<aside data-perplexity-sources-pane data-response-fingerprint="answer-2"><a data-source-url="https://example.test/current">Current</a></aside>`),
  'perplexity-sources-pane-close.html': shell(`${response({})}<aside data-perplexity-sources-pane data-close-observation="not-observed"><button type="button">Sources</button></aside>`),
  'perplexity-new-thread.html': shell(`${composer()}<div data-provider-root-state="clean" data-committed-responses="0"></div>`),
};

async function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const provenance = {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    generatedBy: GENERATED_BY,
    sourceDocuments: REVIEWED_SOURCES,
    note: 'Sanitized deterministic fixtures derived from reviewed authenticated observation documents. They are not represented as fresh live captures.',
    overlay: { kind: 'not-observed', selector: null },
    modelCapabilities: { 'gpt-5.6-terra': { supportsThinking: true }, default: { supportsThinking: null } },
    entries: [],
  };
  for (const [name, html] of Object.entries(fixtures)) {
    const path = resolve(OUT_DIR, name);
    await writeFile(path, html, 'utf8');
    provenance.entries.push({
      file: name,
      kind: 'derived',
      derivedFrom: REVIEWED_SOURCES,
      parentSha256: null,
      sha256: await sha256Text(html),
      transform: name.includes('churn') || name.includes('breaking') ? name.replace(/^perplexity-|\.html$/g, '') : 'sanitized-reviewed-observation',
      generatedBy: GENERATED_BY,
      retainedScreenshot: false,
    });
  }
  await writeFile(resolve(OUT_DIR, 'perplexity-fixture-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  const baseline = await readFile(resolve(OUT_DIR, 'perplexity-baseline.html'), 'utf8');
  if (/\b(?:href|src|action|formaction)\s*=\s*["'](?:https?:|\/\/)/i.test(baseline)) {
    throw new Error('generated fixture contains an active external resource');
  }
  console.log(`wrote ${Object.keys(fixtures).length} Perplexity fixtures`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
}
