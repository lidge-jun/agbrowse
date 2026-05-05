// @ts-check
import { parseArgs } from 'node:util';
import {
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export const INSTALLABLE_SKILLS = Object.freeze(['browser', 'web-ai', 'vision-click']);
/** @type {Readonly<Record<string, string>>} */
export const SKILL_DESCRIPTIONS = Object.freeze({
    browser: 'Chrome/CDP browser control: navigate, inspect, click, type, screenshot, logs, and network.',
    'web-ai': 'Browser web-ai workflow for ChatGPT, Gemini, and Grok: send, poll, upload files, and capture answers.',
    'vision-click': 'Screenshot-to-coordinate click helper for targets with no reliable DOM ref.',
});

export const SKILLS_USAGE = [
    'Usage: agbrowse skills <command> [args] [--flags]',
    '',
    'Agent-first skill commands. Use these before guessing browser workflows.',
    '',
    'Commands:',
    '  list [--json]                         List bundled skills',
    '  get core [--full]                     Print the recommended agent operating guide',
    '  get <browser|web-ai|vision-click>     Print one bundled SKILL.md',
    '  path [skill]                          Print the package skills path or one skill path',
    '  install --target <skills-dir> [opts]  Install bundled skills into an agent skill root',
    '',
    'Install options:',
    '  --target <dir>  Required destination skill root, e.g. ~/.cli-jaw-3460/skills',
    '  --link          Create symlinks to the npm package instead of copying files',
    '  --force         Replace existing target skill directories',
    '  --json          Print machine-readable results',
    '',
    'Examples:',
    '  agbrowse skills list',
    '  agbrowse skills get core --full',
    '  agbrowse skills get web-ai',
    '  agbrowse skills path browser',
    '  agbrowse skills install --target ~/.cli-jaw-3460/skills',
    '  agbrowse skills install --target ~/.codex/skills --link',
].join('\n');

export const CORE_SKILL_GUIDE = [
    '# agbrowse Core Guide',
    '',
    'Use this guide when an AI agent only has CLI output and must decide the next action.',
    '',
    '## Decision Loop',
    '1. Check runtime: `agbrowse status`.',
    '2. If not running: `agbrowse start --headed` for visible local work or `agbrowse start --headless` for CI.',
    '3. Open or reuse a page: `agbrowse navigate <url>` or `agbrowse tabs` then `agbrowse tab-switch <target>`.',
    '4. Observe before acting: `agbrowse snapshot --interactive --max-nodes 120`.',
    '5. Prefer refs: `agbrowse click e3`, `agbrowse type e5 "text" --submit`.',
    '6. Re-observe after each state-changing action.',
    '7. For missing DOM refs, use screenshot/coordinates only after observation: `agbrowse screenshot --json` then `agbrowse mouse-click <x> <y>`.',
    '8. For provider workflows, prefer `agbrowse web-ai query ... --json` over hand-driving the page.',
    '',
    '## Failure Policy',
    '- Do not guess after an error. Read the error, inspect state, then choose the narrow next command.',
    '- Ref ids are snapshot-local. Re-run `snapshot` after navigation, reload, or major DOM changes.',
    '- Keep provider logins in headed Chrome. Do not automate captcha or account verification.',
    '',
    '## Skill Install',
    '- Bundled skills ship inside the npm package.',
    '- Install them explicitly with `agbrowse skills install --target <skills-dir>`.',
    '- Inspect installable skills with `agbrowse skills list` and `agbrowse skills path`.',
].join('\n');
export const INSTALL_SKILLS_USAGE = [
    'Usage: agbrowse install-skills --target <skills-dir> [--link] [--force] [--json]',
    '',
    'Installs the bundled agbrowse skills into an explicit agent skill root.',
    '',
    'Installed skills:',
    '  browser       Chrome/CDP browser control skill',
    '  web-ai        ChatGPT, Gemini, and Grok browser web-ai workflow skill',
    '  vision-click  Screenshot-to-coordinate click helper skill',
    '',
    'Options:',
    '  --target <dir>  Required destination skill root, e.g. ~/.cli-jaw-3460/skills',
    '  --link          Create symlinks to the npm package instead of copying files',
    '  --force         Replace existing target skill directories',
    '  --json          Print machine-readable install results',
    '  --help          Show this help',
    '',
    'Examples:',
    '  agbrowse install-skills --target ~/.cli-jaw-3460/skills',
    '  agbrowse install-skills --target ~/.codex/skills --link',
    '  agbrowse install-skills --target ./tmp-skills --force --json',
    '',
    'Safety:',
    '  Existing target skills are not overwritten unless --force is passed.',
    '  The installer never guesses a target path; --target is always required.',
].join('\n');

/**
 * @typedef {Object} ParsedInstallHelp
 * @property {true} help
 * @property {boolean | undefined} json
 */

/**
 * @typedef {Object} ParsedInstallOptions
 * @property {string} targetRoot
 * @property {boolean} link
 * @property {boolean} force
 * @property {boolean | undefined} json
 * @property {undefined} [help]
 */

/**
 * @param {string[]} [args]
 * @returns {ParsedInstallHelp | ParsedInstallOptions}
 */
export function parseInstallSkillsArgs(args = []) {
    const { values } = parseArgs({
        args,
        options: {
            target: { type: 'string' },
            link: { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
            help: { type: 'boolean', default: false },
        },
        strict: true,
    });

    if (values.help) {
        return { help: true, json: values.json };
    }

    if (!values.target) {
        throw new Error(INSTALL_SKILLS_USAGE);
    }

    return {
        targetRoot: values.target,
        link: values.link,
        force: values.force,
        json: values.json,
    };
}

/**
 * @typedef {Object} InstallBundledSkillsOptions
 * @property {string} sourceRoot
 * @property {string} targetRoot
 * @property {boolean} [link]
 * @property {boolean} [force]
 */

/**
 * @typedef {Object} InstalledSkillEntry
 * @property {string} name
 * @property {'linked' | 'copied'} action
 * @property {string} path
 */

/**
 * @typedef {Object} InstallBundledSkillsResult
 * @property {string} targetRoot
 * @property {'link' | 'copy'} mode
 * @property {InstalledSkillEntry[]} installed
 */

/**
 * @param {InstallBundledSkillsOptions} options
 * @returns {InstallBundledSkillsResult}
 */
export function installBundledSkills(options) {
    const sourceRoot = resolve(options.sourceRoot);
    const targetRoot = resolve(options.targetRoot);
    const link = Boolean(options.link);
    const force = Boolean(options.force);

    if (sourceRoot === targetRoot) {
        throw new Error('target must not be the package skills directory');
    }

    mkdirSync(targetRoot, { recursive: true });

    /** @type {InstalledSkillEntry[]} */
    const installed = [];
    for (const name of INSTALLABLE_SKILLS) {
        const source = join(sourceRoot, name);
        const destination = join(targetRoot, name);

        if (!existsSync(source)) {
            throw new Error(`bundled skill missing: ${source}`);
        }

        const sourceSkill = join(source, 'SKILL.md');
        if (!existsSync(sourceSkill)) {
            throw new Error(`bundled skill has no SKILL.md: ${source}`);
        }

        if (existsSync(destination)) {
            if (!force) {
                throw new Error(`target skill already exists: ${destination} (use --force to replace)`);
            }
            rmSync(destination, { recursive: true, force: true });
        }

        if (link) {
            symlinkSync(source, destination, 'dir');
            installed.push({ name, action: 'linked', path: destination });
        } else {
            cpSync(source, destination, { recursive: true, errorOnExist: true });
            installed.push({ name, action: 'copied', path: destination });
        }
    }

    return {
        targetRoot,
        mode: link ? 'link' : 'copy',
        installed,
    };
}

/**
 * @param {string[]} [args]
 * @param {{ sourceRoot?: string }} [options]
 * @returns {{ help: true, usage: string, json: boolean | undefined } | (InstallBundledSkillsResult & { json: boolean | undefined })}
 */
export function runInstallSkillsCli(args = [], options = {}) {
    const parsed = parseInstallSkillsArgs(args);
    if (parsed.help) {
        return { help: true, usage: INSTALL_SKILLS_USAGE, json: parsed.json };
    }
    const result = installBundledSkills({
        sourceRoot: /** @type {string} */ (options.sourceRoot),
        targetRoot: parsed.targetRoot,
        link: parsed.link,
        force: parsed.force,
    });
    return { ...result, json: parsed.json };
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isLinkedSkill(path) {
    return existsSync(path) && lstatSync(path).isSymbolicLink() && Boolean(readlinkSync(path));
}

/**
 * @typedef {Object} BundledSkillEntry
 * @property {string} name
 * @property {string | undefined} description
 * @property {string} path
 * @property {boolean} available
 */

/**
 * @param {string} sourceRoot
 * @returns {BundledSkillEntry[]}
 */
export function listBundledSkills(sourceRoot) {
    return INSTALLABLE_SKILLS.map(name => {
        const path = join(resolve(sourceRoot), name);
        return {
            name,
            description: SKILL_DESCRIPTIONS[name],
            path,
            available: existsSync(join(path, 'SKILL.md')),
        };
    });
}

/**
 * @param {string} sourceRoot
 * @param {string} name
 * @param {{ full?: boolean }} [options]
 * @returns {string}
 */
export function readBundledSkill(sourceRoot, name, options = {}) {
    if (name === 'core') {
        if (!options.full) return CORE_SKILL_GUIDE;
        const docs = INSTALLABLE_SKILLS.map(skillName => {
            return [
                '',
                `--- ${skillName}/SKILL.md ---`,
                readBundledSkill(sourceRoot, skillName),
            ].join('\n');
        });
        return [CORE_SKILL_GUIDE, ...docs].join('\n');
    }

    if (!INSTALLABLE_SKILLS.includes(name)) {
        throw new Error(`unknown skill: ${name}. Run "agbrowse skills list".`);
    }

    const skillPath = join(resolve(sourceRoot), name, 'SKILL.md');
    if (!existsSync(skillPath)) {
        throw new Error(`bundled skill missing: ${skillPath}`);
    }
    return readFileSync(skillPath, 'utf8');
}

/**
 * @param {string} sourceRoot
 * @param {string} [name]
 * @returns {string}
 */
export function resolveSkillPath(sourceRoot, name) {
    const root = resolve(sourceRoot);
    if (!name) return root;
    if (!INSTALLABLE_SKILLS.includes(name)) {
        throw new Error(`unknown skill: ${name}. Run "agbrowse skills list".`);
    }
    return join(root, name);
}

/**
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'list' | 'json', skills: BundledSkillEntry[] }
 *   | { type: 'install', result: ReturnType<typeof runInstallSkillsCli> }
 * } RunSkillsCliResult
 */

/**
 * @param {string[]} [args]
 * @param {{ sourceRoot?: string }} [options]
 * @returns {RunSkillsCliResult}
 */
export function runSkillsCli(args = [], options = {}) {
    const command = args[0] || 'help';
    if (command === '--help' || command === '-h' || command === 'help') {
        return { type: 'text', text: SKILLS_USAGE };
    }

    if (command === 'list') {
        const json = args.includes('--json');
        return {
            type: json ? 'json' : 'list',
            skills: listBundledSkills(/** @type {string} */ (options.sourceRoot)),
        };
    }

    if (command === 'get') {
        const name = args[1];
        if (!name) throw new Error('Usage: agbrowse skills get <core|browser|web-ai|vision-click> [--full]');
        return {
            type: 'text',
            text: readBundledSkill(/** @type {string} */ (options.sourceRoot), name, { full: args.includes('--full') }),
        };
    }

    if (command === 'path') {
        return {
            type: 'text',
            text: resolveSkillPath(/** @type {string} */ (options.sourceRoot), args[1]),
        };
    }

    if (command === 'install') {
        return {
            type: 'install',
            result: runInstallSkillsCli(args.slice(1), options),
        };
    }

    throw new Error(`${SKILLS_USAGE}\n\nUnknown skills command: ${command}`);
}
