// @ts-check
import { describe, expect, it } from 'vitest';
import { loadFixtureContract, findDuplicateKeys, parseEvalKeyRecords } from '../helpers/provider-dom-contract.mjs';
import { assertScrubbedSafe } from '../../web-ai/eval/scrub-dom.mjs';
import { rejectNetworkFixtureHtml } from '../../web-ai/eval-runner.mjs';

describe('GPT-5.6 Chat fixture contract', () => {
    /** @type {Awaited<ReturnType<typeof loadFixtureContract>>} */
    let chat;
    it('loads without error', async () => {
        chat = await loadFixtureContract('chatgpt-gpt56-chat.html');
        expect(chat.records.length).toBeGreaterThan(0);
    });

    it('passes scrub safety', () => {
        assertScrubbedSafe(chat.html);
    });

    it('passes network gate', () => {
        rejectNetworkFixtureHtml(chat.html);
    });

    it('has no duplicate data-eval-key values', () => {
        expect(findDuplicateKeys(chat.records)).toEqual([]);
    });

    it('has surface.chat and surface.work radio buttons', () => {
        const chatRadio = chat.recordsByKey.get('surface.chat');
        const workRadio = chat.recordsByKey.get('surface.work');
        expect(chatRadio).toBeDefined();
        expect(workRadio).toBeDefined();
        expect(chatRadio?.role).toBe('radio');
        expect(workRadio?.role).toBe('radio');
        expect(chatRadio?.ariaChecked).toBe('true');
        expect(workRadio?.ariaChecked).toBe('false');
        expect(chatRadio?.label).toBe('Chat');
        expect(workRadio?.label).toBe('Work');
    });

    it('has the current Power shell without the retired Intelligence testid', () => {
        expect(chat.html).not.toContain('data-testid="composer-intelligence-picker-content"');
        expect(chat.recordsByKey.get('chat.power-shell')).toBeDefined();
        expect(chat.recordsByKey.get('chat.power-label')?.label).toBe('Power');
    });

    it('has Power slider value 3 on the observed 0..4 range', () => {
        const slider = chat.recordsByKey.get('chat.power-slider');
        expect(slider?.role).toBe('slider');
        expect(chat.html).toContain('aria-valuemin="0"');
        expect(chat.html).toContain('aria-valuemax="4"');
        expect(chat.html).toContain('aria-valuenow="3"');
    });

    it('has Effort submenu tiers: Instant, Medium, High, Extra High, Pro', () => {
        const tiers = ['instant', 'medium', 'high', 'extra-high', 'pro'];
        const labels = ['Instant', 'Medium', 'High', 'Extra High', 'Pro'];
        for (let i = 0; i < tiers.length; i++) {
            const rec = chat.recordsByKey.get(`chat.tier.${tiers[i]}`);
            expect(rec, `missing tier ${tiers[i]}`).toBeDefined();
            expect(rec?.role).toBe('menuitemradio');
            expect(rec?.label).toBe(labels[i]);
        }
    });

    it('Extra High tier is checked by default', () => {
        const xhigh = chat.recordsByKey.get('chat.tier.extra-high');
        expect(xhigh?.ariaChecked).toBe('true');
    });

    it('has exact multiline Model and Effort submenu triggers', () => {
        const trigger = chat.recordsByKey.get('chat.family-trigger');
        const effort = chat.recordsByKey.get('chat.effort-trigger');
        expect(trigger?.label).toBe('Model&#10;GPT-5.6 Sol');
        expect(effort?.label).toBe('Effort&#10;Extra High');
        expect(trigger?.role).toBe('menuitem');
        expect(effort?.role).toBe('menuitem');
    });

    it('has family submenu in inert template with only Sol/5.5/o3', () => {
        expect(chat.html).toContain('data-eval-state="family-submenu-open"');
        const families = ['gpt-5.6-sol', 'gpt-5.5', 'o3'];
        for (const fam of families) {
            expect(chat.recordsByKey.get(`chat.family.${fam}`), `missing family ${fam}`).toBeDefined();
        }
        expect(chat.recordsByKey.get('chat.family.gpt-5.4')).toBeUndefined();
        expect(chat.recordsByKey.get('chat.family.gpt-5.3')).toBeUndefined();
    });

    it('does NOT contain legacy testids or labels', () => {
        expect(chat.html).not.toContain('model-switcher-');
        expect(chat.html).not.toContain('Thinking');
        expect(chat.html).not.toContain('Pro Standard');
        expect(chat.html).not.toContain('Pro Extended');
    });

    it('has composer.fill, upload.open, send.click eval intents', () => {
        expect(chat.html).toContain('data-eval-intent="composer.fill"');
        expect(chat.html).toContain('data-eval-intent="upload.open"');
        expect(chat.html).toContain('data-eval-intent="send.click"');
    });

    it('has picker trigger with aria-haspopup=menu inside form', () => {
        expect(chat.html).toContain('aria-haspopup="menu"');
        const trigger = chat.recordsByKey.get('chat.picker-trigger');
        expect(trigger).toBeDefined();
        expect(trigger?.label).toBe('High');
    });
});

describe('GPT-5.6 Work fixture contract', () => {
    /** @type {Awaited<ReturnType<typeof loadFixtureContract>>} */
    let work;
    it('loads without error', async () => {
        work = await loadFixtureContract('chatgpt-gpt56-work.html');
        expect(work.records.length).toBeGreaterThan(0);
    });

    it('passes scrub safety', () => {
        assertScrubbedSafe(work.html);
    });

    it('passes network gate', () => {
        rejectNetworkFixtureHtml(work.html);
    });

    it('has no duplicate data-eval-key values', () => {
        expect(findDuplicateKeys(work.records)).toEqual([]);
    });

    it('has Work radio checked and Chat unchecked', () => {
        const chatRadio = work.recordsByKey.get('surface.chat');
        const workRadio = work.recordsByKey.get('surface.work');
        expect(chatRadio?.ariaChecked).toBe('false');
        expect(workRadio?.ariaChecked).toBe('true');
    });

    it('has Work composer with "Work on anything" placeholder', () => {
        expect(work.html).toContain('placeholder="Work on anything"');
    });

    it('has picker trigger with 5.6 Sol Light label', () => {
        const trigger = work.recordsByKey.get('work.picker-trigger');
        expect(trigger).toBeDefined();
        expect(trigger?.label).toBe('5.6 Sol Light');
    });

    it('has simple-view and advanced-view testids', () => {
        expect(work.html).toContain('data-testid="composer-model-picker-slider-simple-view"');
        expect(work.html).toContain('data-testid="composer-model-picker-slider-advanced-view"');
    });

    it('has Power slider with 0-based min/max', () => {
        const slider = work.recordsByKey.get('work.power-slider');
        expect(slider).toBeDefined();
        expect(slider?.role).toBe('slider');
    });

    it('has Advanced Model/Effort/Speed rows', () => {
        const model = work.recordsByKey.get('work.advanced.model');
        const effort = work.recordsByKey.get('work.advanced.effort');
        const speed = work.recordsByKey.get('work.advanced.speed');
        expect(model?.label).toBe('GPT-5.6 Sol');
        expect(effort?.label).toBe('Light');
        expect(speed?.label).toBe('Standard');
    });

    it('has official 6-step Power mapping in inert template', () => {
        expect(work.html).toContain('data-eval-state="work-power-mapping"');
        const expectedLabels = [
            '5.6 Terra Light',
            '5.6 Sol Light',
            '5.6 Sol Medium',
            '5.6 Sol High',
            '5.6 Sol Extra High',
            '5.6 Sol Ultra',
        ];
        for (const label of expectedLabels) {
            expect(work.html, `missing Power label: ${label}`).toContain(label);
        }
    });

    it('has Work Model submenu with Terra/Luna (Work-only families)', () => {
        expect(work.recordsByKey.get('work.model.gpt-5.6-terra')).toBeDefined();
        expect(work.recordsByKey.get('work.model.gpt-5.6-luna')).toBeDefined();
    });

    it('has Effort submenu: Light/Medium/High/Extra High/Max/Ultra', () => {
        const efforts = ['light', 'medium', 'high', 'extra-high', 'max', 'ultra'];
        for (const e of efforts) {
            expect(work.recordsByKey.get(`work.effort.${e}`), `missing effort ${e}`).toBeDefined();
        }
    });

    it('has Speed submenu: Standard/Fast', () => {
        expect(work.recordsByKey.get('work.speed.standard')).toBeDefined();
        expect(work.recordsByKey.get('work.speed.fast')).toBeDefined();
    });

    it('does NOT contain legacy testids or labels', () => {
        expect(work.html).not.toContain('model-switcher-');
        expect(work.html).not.toContain('Pro Standard');
        expect(work.html).not.toContain('Pro Extended');
    });

    it('has composer.fill eval intent but not send.click or copy.click', () => {
        expect(work.html).toContain('data-eval-intent="composer.fill"');
        expect(work.html).not.toContain('data-eval-intent="send.click"');
        expect(work.html).not.toContain('data-eval-intent="copy.click"');
    });
});
