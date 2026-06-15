import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveChatGptComposerToolRequests, selectChatGptComposerTools } from '../../web-ai/chatgpt-tools.mjs';

const chatgptSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');
const chatgptToolsSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-tools.mjs'), 'utf8');

describe('web-ai ChatGPT composer tool resolver', () => {
    it('does not touch ChatGPT composer menus without explicit tool requests', async () => {
        const page = new Proxy({}, {
            get() {
                throw new Error('page should not be touched without tool requests');
            },
        });

        await expect(selectChatGptComposerTools(page)).resolves.toBeNull();
        await expect(selectChatGptComposerTools(page, { prompt: '최신 뉴스를 요약해줘' })).resolves.toBeNull();
    });

    it('selects composer tools only after the composer is ready', () => {
        const readyIndex = chatgptSrc.indexOf('await readinessAdapter.waitForReady();');
        const toolsIndex = chatgptSrc.indexOf('const selectedTools = await selectChatGptComposerTools(page, input);');

        expect(readyIndex).toBeGreaterThan(-1);
        expect(toolsIndex).toBeGreaterThan(readyIndex);
    });

    it('does not clear selected composer tools with a second Escape', () => {
        expect(chatgptToolsSrc).toContain('Search, click to remove');
        expect(chatgptToolsSrc).not.toContain('for (let i = 0; i < 2; i += 1)');
    });

    it('normalizes explicit tool and plugin aliases', () => {
        expect(resolveChatGptComposerToolRequests({
            tools: ['web-search', '이미지 만들기'],
            plugins: ['GitHub', 'google drive', 'Supabase'],
        })).toMatchObject({
            tools: ['web-search', 'image'],
            plugins: ['github', 'google-drive', 'supabase'],
        });
    });

    it('maps command flags to composer tools', () => {
        expect(resolveChatGptComposerToolRequests({ webSearch: true })).toMatchObject({
            tools: ['web-search'],
            reasons: ['flag:web-search'],
        });
        expect(resolveChatGptComposerToolRequests({ outputImage: './out.png' })).toMatchObject({
            tools: ['image'],
            reasons: ['flag:output-image'],
        });
        expect(resolveChatGptComposerToolRequests({ research: 'deep' })).toMatchObject({
            tools: ['deep-research'],
            reasons: ['flag:research-deep'],
        });
    });

    it('infers obvious tools and plugins from Korean and English prompts', () => {
        expect(resolveChatGptComposerToolRequests({
            autoTools: true,
            prompt: '최신 GitHub repo 상태를 웹에서 확인해줘',
        })).toMatchObject({
            tools: ['web-search'],
            plugins: ['github'],
            reasons: ['auto:web-search-intent', 'auto:github-intent'],
        });

        expect(resolveChatGptComposerToolRequests({
            autoTools: true,
            prompt: 'MINDECODE 일러스트 이미지를 만들어줘',
        })).toMatchObject({
            tools: ['image'],
            plugins: [],
            reasons: ['auto:image-intent'],
        });

        expect(resolveChatGptComposerToolRequests({
            autoTools: true,
            prompt: 'Supabase RLS migration을 심층 리서치해줘',
        })).toMatchObject({
            tools: ['deep-research'],
            plugins: ['supabase'],
            reasons: ['auto:deep-research-intent', 'auto:supabase-intent'],
        });
    });
});
