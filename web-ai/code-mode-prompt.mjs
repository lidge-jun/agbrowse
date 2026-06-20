// @ts-check
// Code-mode prompt contract (Phase 11 of devlog/_fin/260611_webai_gpt_code_mode).
// The contract text was settled by interrogating GPT (thinking/standard) and
// verified end-to-end: GPT used container.exec, built exactly one
// /mnt/data/result.zip, and answered with a machine-readable path. The hardening
// clauses (no mid-confirmation, artifact exclusions, forced find self-check)
// came from GPT's own large-codebase failure-mode answers — see
// 01_prompt_contract.md for the verbatim Q&A.

export const CODE_ARTIFACT_PATH = '/mnt/data/result.zip';
export const HUMAN_DOWNLOAD_PREFIX = 'DOWNLOAD:';
export const MACHINE_PATH_PREFIX = 'MACHINE:';

export const ARTIFACT_EXCLUSIONS = [
    'node_modules/', '.venv/', 'venv/', 'dist/', 'build/', '.next/',
    'coverage/', '.turbo/', '__pycache__/', '.pytest_cache/', '.git/',
];

export const PLAN_TOOL_REQUIREMENT = '- 가능하면 첫 액션으로 plan 도구를 사용해 구현/검증/패키징 계획을 세운 뒤 코드 작성에 들어간다. 도구가 없다면 가장하지 말고 PLAN.md 또는 00_plan.md 에 계획을 작성한다.';

export const TODO_TOOL_REQUIREMENT = '- turn_plan.update_turn_plan 같은 visible todo/checklist 도구가 실제로 사용 가능하면 첫 코드 작성 전에 최대 8개 top-level 항목으로 만든다. 더 많은 단계가 필요한 복잡한 작업도 visible todo 는 8개를 넘기지 말고, 추가 세부 단계는 PLAN.md 또는 00_plan.md 의 텍스트 단계 지침에 작성한다. 구현/검증/패키징 진행 중 상태를 갱신한다. 이 visible todo UI 는 응답 종료 후 사라질 수 있으므로 최종 검증 산출물로 요구하지 않는다. 도구가 없으면 절대 사용했다고 말하지 말고 PLAN.md 또는 00_plan.md 의 체크리스트를 durable todo 로 삼는다. 실제로 완료한 항목은 최종 패키징 전에 plan 파일에서도 [x] 로 갱신한다.';

export const PLAN_FILE_REQUIREMENT = '- 각 코드 zip 루트에는 반드시 PLAN.md 또는 00_plan.md 를 포함한다. 이 파일에는 Linux sandbox 전제, 최대 8개 top-level 체크리스트, 필요 시 추가 텍스트 단계 지침, 구현 계획, 실행한 검증 명령, 패키징 기준을 적는다. 완료된 체크리스트 항목은 최종 zip 생성 전에 [x] 로 표시한다.';

/**
 * Build the strict code-mode prompt around the caller's requirements.
 *
 * Single-zip (default): exactly one /mnt/data/result.zip, final answer includes
 * both a human sandbox link and a machine-readable plain path.
 * Multi-zip (`opts.multiZip`): several named archives under /mnt/data are
 * allowed (e.g. frontend.zip + backend.zip); the answer repeats the two-line
 * human+machine block for each path. The self-check still forbids stray/cache
 * artifacts.
 *
 * @param {string} requirements - what to build (language, stack, features)
 * @param {{ multiZip?: boolean }} [opts]
 * @returns {string}
 */
export function buildCodeModePrompt(requirements, opts = {}) {
    const spec = String(requirements || '').trim();
    if (!spec) throw new Error('code-mode requirements must not be empty');
    const exclusions = `- zip에는 사람이 작성한 소스·설정·README만 포함한다. ${ARTIFACT_EXCLUSIONS.join(' ')} 및 캐시/빌드 산출물은 절대 포함하지 않는다. 의존성은 매니페스트(package.json, requirements.txt, pyproject.toml 등)로만 표현한다.`;
    if (opts.multiZip) {
        return [
            '[CODE MODE (MULTI-ZIP) — 자동화 파이프라인. 아래 계약을 정확히 지켜라.]',
            '',
            '목표:',
            spec,
            '',
            '빌드/패키징 계약:',
            PLAN_TOOL_REQUIREMENT,
            TODO_TOOL_REQUIREMENT,
            PLAN_FILE_REQUIREMENT,
            '- 모든 소스를 먼저 /mnt/data/workdir 아래에 작성한다.',
            '- 패키징 전 기존 /mnt/data/*.zip 을 모두 삭제한다.',
            '- 논리적으로 분리된 산출물마다 의미 있는 이름의 zip 을 /mnt/data 바로 아래에 생성한다 (예: /mnt/data/frontend.zip, /mnt/data/backend.zip). 모든 zip 은 /mnt/data 직속이어야 한다.',
            exclusions,
            '- 모든 zip 생성 후 반드시 find /mnt/data -maxdepth 1 -name "*.zip" -print 를 실제 실행하라. 의도한 zip 외에 다른 파일이 있으면 정리하라. 각 코드 zip 안에 PLAN.md 또는 00_plan.md 가 없으면 다시 패키징하라. 이 검증 전에는 최종 응답을 하지 말라.',
            '- 중간 확인 질문 금지. 현재 응답 안에서 작성→생성→검증까지 끝낸다.',
            '- 최종 assistant 메시지는 zip마다 정확히 두 줄을 출력한다:',
            '  DOWNLOAD: [<zip basename>](sandbox:/mnt/data/<zip basename>)',
            '  MACHINE: /mnt/data/<zip basename>',
            '- 위 두 줄 형식 외 설명, 코드블록, 인라인 코드, bullet, JSON, 추가 문장 금지.',
        ].join('\n');
    }
    return [
        '[CODE MODE — 자동화 파이프라인. 아래 계약을 정확히 지켜라.]',
        '',
        '목표:',
        spec,
        '',
        '빌드/패키징 계약:',
        PLAN_TOOL_REQUIREMENT,
        TODO_TOOL_REQUIREMENT,
        PLAN_FILE_REQUIREMENT,
        '- 모든 소스를 먼저 /mnt/data/workdir 아래에 작성한다.',
        '- 패키징 전 기존 /mnt/data/*.zip 을 모두 삭제한다.',
        `- container.exec 로 단 하나의 ${CODE_ARTIFACT_PATH} 을 생성한다.`,
        exclusions,
        '- zip 생성 후 반드시 find /mnt/data -maxdepth 1 -name "*.zip" -print 를 실제 실행하라. 출력이 1개가 아니거나 경로가 ' + CODE_ARTIFACT_PATH + ' 이 아니면 기존 zip을 모두 삭제하고 다시 생성하라. zip 안에 PLAN.md 또는 00_plan.md 가 없으면 다시 패키징하라. 이 검증이 성공하기 전에는 최종 응답을 하지 말라.',
        '- 중간 확인 질문 금지. 불완전하더라도 현재 응답 안에서 작성→생성→검증까지 끝내라. 실패 시에도 가능한 최소 완성본을 zip으로 만들어라.',
        '- 최종 assistant 메시지는 정확히 아래 두 줄만 출력한다:',
        `  ${HUMAN_DOWNLOAD_PREFIX} [result.zip](sandbox:${CODE_ARTIFACT_PATH})`,
        `  ${MACHINE_PATH_PREFIX} ${CODE_ARTIFACT_PATH}`,
        '- 위 두 줄 외 설명, 코드블록, 인라인 코드, bullet, JSON, 추가 문장 금지.',
    ].join('\n');
}

/**
 * Check whether a completed assistant answer honored the contract's final-line
 * rule. Tolerates surrounding whitespace, accidental wrapping, and the rendered
 * ChatGPT form where a sandbox markdown link becomes button text. The artifact
 * path must still be present; anything else signals contract drift worth a
 * warning (retrieval may still succeed via the conversation scan).
 *
 * @param {string} answerText
 * @returns {{ compliant: boolean, mentionsPath: boolean }}
 */
export function checkContractCompliance(answerText) {
    const text = String(answerText || '').trim();
    const mentionsPath = text.includes(CODE_ARTIFACT_PATH);
    const stripped = text.replace(/^[\["'`]+|[\]"'`]+$/g, '').trim();
    const machineLine = `${MACHINE_PATH_PREFIX} ${CODE_ARTIFACT_PATH}`;
    const rawDownloadLine = `${HUMAN_DOWNLOAD_PREFIX} [result.zip](sandbox:${CODE_ARTIFACT_PATH})`;
    const renderedDownloadLine = `${HUMAN_DOWNLOAD_PREFIX} result.zip`;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const hybridCompliant = lines.length === 2
        && (lines[0] === rawDownloadLine || lines[0] === renderedDownloadLine)
        && lines[1] === machineLine;
    return { compliant: stripped === CODE_ARTIFACT_PATH || hybridCompliant, mentionsPath };
}
