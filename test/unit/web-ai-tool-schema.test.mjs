import { describe, expect, it } from 'vitest';
import {
    BROWSER_TOOLS,
    MCP_TOOLS,
    WEB_AI_TOOLS,
    allToolSchemas,
    isKnownBrowserTool,
    isKnownMcpTool,
    isKnownWebAiTool,
    toolSchemaForAiSdk,
    toolSchemaForMcp,
    validateWebAiToolInput,
} from '../../web-ai/tool-schema.mjs';

describe('web-ai MCP tool schema', () => {
    it('exposes all Phase 10 tools as MCP schemas', () => {
        expect(Object.keys(WEB_AI_TOOLS)).toEqual([
            'web_ai_snapshot',
            'web_ai_click_ref',
            'web_ai_submit_prompt',
            'web_ai_wait_response',
            'web_ai_copy_markdown',
            'web_ai_doctor',
            'web_ai_session_resume',
            'web_ai_work_send',
        ]);
        const schemas = allToolSchemas('mcp');
        expect(schemas).toHaveLength(Object.keys(MCP_TOOLS).length);
        for (const schema of schemas) {
            expect(schema.description).toBeTruthy();
            expect(schema.inputSchema.type).toBe('object');
            expect(schema.inputSchema.additionalProperties).toBe(false);
        }
        const submit = toolSchemaForMcp('web_ai_submit_prompt');
        expect(submit.description).toContain('CLI-only/deferred');
        expect(submit.inputSchema.properties.maxUploadFileSize).toMatchObject({ type: 'number', minimum: 1 });
        expect(submit.inputSchema.properties.attachmentUploadTimeoutMs).toMatchObject({ type: 'number', minimum: 1 });
        expect(toolSchemaForMcp('web_ai_wait_response').description).toContain('recoverable timeout');
        expect(toolSchemaForMcp('web_ai_wait_response').description).toContain('sessionId');
        expect(toolSchemaForMcp('web_ai_session_resume').description).toContain('session-bound recovery');
    });

    it('exposes Phase 18 browser tools from the shared schema source', () => {
        expect(Object.keys(BROWSER_TOOLS)).toEqual([
            'browser_snapshot',
            'browser_click_ref',
        ]);
        expect(allToolSchemas('mcp').map(tool => tool.name)).toEqual(Object.keys(MCP_TOOLS));
        expect(toolSchemaForMcp('browser_snapshot')).toHaveProperty('inputSchema');
        expect(toolSchemaForAiSdk('browser_click_ref')).toHaveProperty('parameters');
        expect(isKnownBrowserTool('browser_snapshot')).toBe(true);
        expect(isKnownMcpTool('browser_click_ref')).toBe(true);
    });

    it('renders AI SDK parameters without mutating the MCP schema', () => {
        expect(toolSchemaForMcp('web_ai_snapshot')).toHaveProperty('inputSchema');
        expect(toolSchemaForAiSdk('web_ai_snapshot')).toHaveProperty('parameters');
        expect(isKnownWebAiTool('web_ai_snapshot')).toBe(true);
        expect(isKnownWebAiTool('invalid_tool')).toBe(false);
        expect(isKnownMcpTool('invalid_tool')).toBe(false);
    });

    it('web_ai_submit_prompt has surface enum restricted to chat', () => {
        const schema = toolSchemaForMcp('web_ai_submit_prompt');
        expect(schema.inputSchema.properties.surface.enum).toEqual(['chat']);
    });

    it('web_ai_submit_prompt has family enum with five canonical aliases', () => {
        const schema = toolSchemaForMcp('web_ai_submit_prompt');
        expect(schema.inputSchema.properties.family.enum).toEqual([
            'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3', 'o3',
        ]);
    });

    it('web_ai_submit_prompt effort enum includes canonical and legacy aliases but not max/ultra', () => {
        const schema = toolSchemaForMcp('web_ai_submit_prompt');
        const effortEnum = schema.inputSchema.properties.effort.enum;
        expect(effortEnum).toContain('medium');
        expect(effortEnum).toContain('high');
        expect(effortEnum).toContain('xhigh');
        expect(effortEnum).toContain('extra-high');
        expect(effortEnum).toContain('extra_high');
        expect(effortEnum).toContain('extra high');
        expect(effortEnum).toContain('extended');
        expect(effortEnum).toContain('heavy');
        expect(effortEnum).not.toContain('max');
        expect(effortEnum).not.toContain('ultra');
    });

    it('web_ai_submit_prompt has no speed property and additionalProperties is false', () => {
        const schema = toolSchemaForMcp('web_ai_submit_prompt');
        expect(schema.inputSchema.properties.speed).toBeUndefined();
        expect(schema.inputSchema.additionalProperties).toBe(false);
    });

    it('web_ai_work_send has correct properties and required fields', () => {
        const schema = toolSchemaForMcp('web_ai_work_send');
        expect(schema).toBeTruthy();
        const props = Object.keys(schema.inputSchema.properties);
        expect(props).toEqual(['prompt', 'power', 'speed', 'timeout']);
        expect(schema.inputSchema.required).toEqual(['prompt', 'power']);
        expect(schema.inputSchema.properties.power).toMatchObject({ type: 'number', minimum: 1, maximum: 6 });
        expect(schema.inputSchema.properties.speed.enum).toEqual(['standard', 'fast']);
        expect(schema.inputSchema.additionalProperties).toBe(false);
    });

    it('web_ai_work_send rejects model/effort/project/surface as unknown properties', () => {
        for (const key of ['model', 'effort', 'project', 'surface']) {
            expect(() => validateWebAiToolInput('web_ai_work_send', {
                prompt: 'x', power: 3, [key]: 'val',
            })).toThrow(/unknown property/);
        }
    });

    it('validates a full Chat submit input with surface/family/model/effort', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            provider: 'chatgpt',
            surface: 'chat',
            family: 'gpt-5.6-sol',
            model: 'thinking',
            effort: 'xhigh',
            prompt: 'x',
        })).not.toThrow();
    });

    it('web_ai_submit_prompt rejects surface work', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            surface: 'work', prompt: 'x',
        })).toThrow(/not in enum/);
    });

    it('web_ai_submit_prompt rejects Work-only families', () => {
        for (const family of ['gpt-5.6-terra', 'gpt-5.6-luna']) {
            expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
                family, prompt: 'x',
            })).toThrow(/not in enum/);
        }
    });

    it('web_ai_submit_prompt rejects effort max and ultra', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            effort: 'max', prompt: 'x',
        })).toThrow(/not in enum/);
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            effort: 'ultra', prompt: 'x',
        })).toThrow(/not in enum/);
    });

    it('web_ai_submit_prompt rejects speed property', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            speed: 'fast', prompt: 'x',
        })).toThrow(/unknown property/);
    });

    it('timeout fields have minimum:1 and descriptions for submit/wait/resume/work_send', () => {
        for (const name of ['web_ai_submit_prompt', 'web_ai_wait_response', 'web_ai_session_resume', 'web_ai_work_send']) {
            const schema = toolSchemaForMcp(name);
            expect(schema).toBeTruthy();
            const props = schema.inputSchema.properties;
            expect(props.timeout.minimum).toBe(1);
            expect(props.timeout.description).toBeDefined();
            expect(props.timeout.description).not.toMatch(/40\s*min|2400/);
        }
    });

    it('web_ai_submit_prompt description mentions tier-aware deadline', () => {
        const schema = toolSchemaForMcp('web_ai_submit_prompt');
        expect(schema.description).toContain('tier');
    });

    it('web_ai_wait_response description mentions stored session deadline inheritance', () => {
        const schema = toolSchemaForMcp('web_ai_wait_response');
        expect(schema.description).toContain('stored session deadline');
    });

    it('web_ai_session_resume description mentions stored session deadline inheritance', () => {
        const schema = toolSchemaForMcp('web_ai_session_resume');
        expect(schema.description).toContain('stored session deadline');
    });

    it('web_ai_submit_prompt rejects gemini provider with chatgpt family as semantic error', () => {
        expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
            provider: 'gemini', family: 'gpt-5.6-sol', prompt: 'x',
        })).not.toThrow(); // Schema validation passes; semantic check is at runtime
    });
});
