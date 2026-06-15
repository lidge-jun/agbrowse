import { describe, expect, it } from 'vitest';

import { resolveChatGptComposerToolRequests } from '../../web-ai/chatgpt-tools.mjs';

describe('web-ai ChatGPT composer tool resolver', () => {
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
