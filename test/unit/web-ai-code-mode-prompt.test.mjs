import { describe, expect, it } from 'vitest';
import {
    ARTIFACT_EXCLUSIONS,
    CODE_ARTIFACT_PATH,
    HUMAN_DOWNLOAD_PREFIX,
    MACHINE_PATH_PREFIX,
    PLAN_FILE_REQUIREMENT,
    PLAN_TOOL_REQUIREMENT,
    TODO_TOOL_REQUIREMENT,
    buildCodeModePrompt,
    checkContractCompliance,
} from '../../web-ai/code-mode-prompt.mjs';

describe('buildCodeModePrompt', () => {
    it('embeds the requirements and every contract clause', () => {
        const prompt = buildCodeModePrompt('Node.js Express ping API MVP');
        expect(prompt).toContain('Node.js Express ping API MVP');
        expect(prompt).toContain('/mnt/data/workdir');
        expect(prompt).toContain(PLAN_TOOL_REQUIREMENT);
        expect(prompt).toContain(TODO_TOOL_REQUIREMENT);
        expect(prompt).toContain(PLAN_FILE_REQUIREMENT);
        expect(prompt).toContain('turn_plan.update_turn_plan');
        expect(prompt).toContain('PLAN.md 또는 00_plan.md');
        expect(prompt).toContain('가능하면 8개');
        expect(prompt).toContain('응답 종료 후 사라질 수 있으므로');
        expect(prompt).toContain('도구가 없으면 절대 사용했다고 말하지 말고');
        expect(prompt).toContain(`container.exec 로 단 하나의 ${CODE_ARTIFACT_PATH}`);
        expect(prompt).toContain('find /mnt/data -maxdepth 1 -name "*.zip" -print');
        expect(prompt).toContain(`${HUMAN_DOWNLOAD_PREFIX} [result.zip](sandbox:${CODE_ARTIFACT_PATH})`);
        expect(prompt).toContain(`${MACHINE_PATH_PREFIX} ${CODE_ARTIFACT_PATH}`);
        expect(prompt).toContain('중간 확인 질문 금지');
        for (const exclusion of ARTIFACT_EXCLUSIONS) {
            expect(prompt).toContain(exclusion);
        }
    });

    it('rejects empty requirements', () => {
        expect(() => buildCodeModePrompt('   ')).toThrow(/must not be empty/);
    });

    it('emits a multi-zip contract when multiZip is set', () => {
        const prompt = buildCodeModePrompt('FastAPI backend + React frontend', { multiZip: true });
        expect(prompt).toContain('MULTI-ZIP');
        expect(prompt).toContain('frontend.zip');
        expect(prompt).toContain('zip마다 정확히 두 줄');
        expect(prompt).toContain('DOWNLOAD: [<zip basename>](sandbox:/mnt/data/<zip basename>)');
        expect(prompt).toContain('MACHINE: /mnt/data/<zip basename>');
        expect(prompt).toContain(PLAN_TOOL_REQUIREMENT);
        expect(prompt).toContain(TODO_TOOL_REQUIREMENT);
        expect(prompt).toContain(PLAN_FILE_REQUIREMENT);
        expect(prompt).toContain('turn_plan.update_turn_plan');
        expect(prompt).toContain('각 코드 zip 안에 PLAN.md 또는 00_plan.md');
        // the single-zip "exactly one result.zip" clause must NOT appear
        expect(prompt).not.toContain('단 하나의 /mnt/data/result.zip');
    });
});

describe('checkContractCompliance', () => {
    it('accepts the plain path and bracket-wrapped variants seen live', () => {
        expect(checkContractCompliance('/mnt/data/result.zip').compliant).toBe(true);
        // Live run answered with a JSON-ish wrap: ["/mnt/data/result.zip"]
        expect(checkContractCompliance('["/mnt/data/result.zip"]').compliant).toBe(true);
        expect(checkContractCompliance('  /mnt/data/result.zip\n').compliant).toBe(true);
    });

    it('accepts the human download plus machine path format', () => {
        const answer = [
            'DOWNLOAD: [result.zip](sandbox:/mnt/data/result.zip)',
            'MACHINE: /mnt/data/result.zip',
        ].join('\n');
        const result = checkContractCompliance(answer);
        expect(result.compliant).toBe(true);
        expect(result.mentionsPath).toBe(true);
    });

    it('accepts the rendered ChatGPT button text plus machine path format', () => {
        const answer = [
            'DOWNLOAD: result.zip',
            'MACHINE: /mnt/data/result.zip',
        ].join('\n');
        const result = checkContractCompliance(answer);
        expect(result.compliant).toBe(true);
        expect(result.mentionsPath).toBe(true);
    });

    it('flags non-compliant answers while noting path mentions', () => {
        const chatty = checkContractCompliance('Done! Your zip is at /mnt/data/result.zip — enjoy.');
        expect(chatty.compliant).toBe(false);
        expect(chatty.mentionsPath).toBe(true);
        const missing = checkContractCompliance('Here is the code inline:\n```js\n1\n```');
        expect(missing.compliant).toBe(false);
        expect(missing.mentionsPath).toBe(false);
    });
});
