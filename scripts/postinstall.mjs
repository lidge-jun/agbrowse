#!/usr/bin/env node
/**
 * star prompt — one-time GitHub star prompt, shown on the first interactive
 * agbrowse CLI run.
 *
 * History: this file used to be wired as the npm `postinstall` lifecycle
 * hook. npm >= 11.16 prints an `allow-scripts` warning for any unapproved
 * lifecycle script during global installs (a preview of npm 12, which skips
 * them by default), so the hook produced scary install output and is not a
 * reliable trigger going forward. The hook was removed (package.json ships
 * zero lifecycle scripts); the CLI (skills/browser/browser.mjs) now calls
 * maybeRunStarPrompt() on first run. Direct execution
 * (`node scripts/postinstall.mjs`) still works and is used by the release.yml
 * package smoke.
 *
 * Behavior:
 *   - TTY-only (skips CI / piped installs / agents' spawned processes)
 *   - Skips machine surfaces: --json, --help, AGBROWSE_JSON_ERRORS=1,
 *     MCP stdio, CI, help-class and unknown commands
 *   - Requires an installed and authenticated `gh` CLI
 *   - Asks with an explicit Yes/No selector (arrow keys, `y`/`n`, Enter)
 *   - When an agent drives the terminal, relays the question on stderr
 *     instead of answering
 *   - Prompts once; records state in ~/.agbrowse/state/star-prompt.json
 *   - Never breaks the CLI (all errors swallowed; AGBROWSE_STAR_PROMPT=0
 *     opts out)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { isAgentDriven } from "./agent-driven.mjs";
import { interactiveConfirm } from "./interactive-confirm.mjs";
import { KNOWN_ROOT_COMMANDS, SKIP_COMMANDS } from "../skills/browser/update-check.mjs";

const REPO = "lidge-jun/agbrowse";
const STATE_DIR = join(homedir(), ".agbrowse", "state");
const STATE_FILE = join(STATE_DIR, "star-prompt.json");

async function hasBeenPrompted(stateFile = STATE_FILE) {
  if (!existsSync(stateFile)) return false;
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    return typeof state.prompted_at === "string";
  } catch {
    return false;
  }
}

async function markPrompted(stateFile = STATE_FILE) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify({ prompted_at: new Date().toISOString() }, null, 2),
  );
}

/**
 * Whether `gh` is both installed and logged in. Starring goes through the
 * user's own `gh` auth, so an unauthenticated CLI cannot fulfil a "Yes" — in
 * that case the prompt stays silent instead of asking for something it would
 * then fail to do.
 */
function isGhInstalled() {
  const version = spawnSync("gh", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 3000,
    windowsHide: true,
  });
  if (version.error || version.status !== 0) return false;
  const auth = spawnSync("gh", ["auth", "status"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 5000,
    windowsHide: true,
  });
  return !auth.error && auth.status === 0;
}

function starRepo() {
  const result = spawnSync(
    "gh",
    ["api", "-X", "PUT", `/user/starred/${REPO}`],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
      windowsHide: true,
    },
  );
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || "").trim();
    return { ok: false, error: msg || `gh exited ${result.status}` };
  }
  return { ok: true };
}

/**
 * Shown on stderr when an agent drives an interactive terminal. The agent
 * reads this as its instruction: it must not answer, it must ask the person.
 * Never stdout — prose must not pollute machine-readable output.
 */
function printAgentDeferral(stream = process.stderr) {
  stream.write(
    `\n[agbrowse] agbrowse isn't starred on GitHub yet.\n` +
    `[agbrowse] Agent: do not answer this yourself — it uses the user's GitHub identity.\n` +
    `[agbrowse] Ask the user whether to star ${REPO}, and only run\n` +
    `[agbrowse] \`gh api -X PUT /user/starred/${REPO}\` if they say yes.\n`,
  );
}

/**
 * True when this invocation must not see the star prompt: machine output
 * modes (--json, --help, AGBROWSE_JSON_ERRORS=1), MCP stdio, CI, help-class
 * or unknown commands, non-interactive streams, or explicit opt-out. Mirrors
 * the update-check notice policy (shouldSkipUpdateNotice) so every surface
 * that is protected from the update notice is protected from this prompt.
 *
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv, stdin?: object, stdout?: object }} opts
 * @returns {boolean}
 */
export function shouldSkipStarPrompt({
  argv = [],
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (env.AGBROWSE_STAR_PROMPT === "0") return true;
  if (argv.includes("--json")) return true;
  if (argv.includes("--help")) return true;
  if (env.AGBROWSE_JSON_ERRORS === "1") return true;
  if (!stdin.isTTY || !stdout.isTTY) return true;
  const command = argv[0] || "";
  if (!command || command.startsWith("-")) return true;
  if (SKIP_COMMANDS.has(command)) return true;
  // MCP stdio servers own stdout for JSON-RPC frames.
  if (command === "web-ai" && argv[1] === "mcp-server") return true;
  const forced = env.AGBROWSE_STAR_PROMPT === "1";
  if (!forced && env.CI) return true;
  if (!KNOWN_ROOT_COMMANDS.has(command)) return true;
  return false;
}

/**
 * Run the one-time star prompt when the invocation allows it. Never throws.
 * Every dependency is injectable so tests need no PTY, no gh, and no real
 * HOME; the defaults are the real CLI behavior.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.argv]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {object} [opts.stdin]
 * @param {object} [opts.stdout]
 * @param {object} [opts.stderr]
 * @param {string} [opts.stateFile]
 * @param {() => boolean} [opts.ghInstalled]
 * @param {typeof interactiveConfirm} [opts.confirm]
 * @param {() => { ok: boolean, error?: string }} [opts.star]
 * @returns {Promise<boolean>} true when the prompt flow actually ran
 */
export async function maybeRunStarPrompt({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  stateFile = STATE_FILE,
  ghInstalled = isGhInstalled,
  confirm = interactiveConfirm,
  star = starRepo,
} = {}) {
  try {
    if (shouldSkipStarPrompt({ argv, env, stdin, stdout })) return false;
    if (await hasBeenPrompted(stateFile)) return false;
    if (!ghInstalled()) return false;

    // An agent would answer this on the user's behalf, using the user's
    // GitHub identity. Hand the question to the agent to relay, and leave
    // the state unwritten so the user still gets the real prompt on their
    // own terminal.
    if (isAgentDriven()) {
      printAgentDeferral(stderr);
      return false;
    }

    await markPrompted(stateFile);

    const approved = await confirm({
      question: "\n[agbrowse] Enjoying agbrowse? Star it on GitHub (via gh)?",
      defaultYes: true,
      input: stdin,
      output: stdout,
    });
    if (!approved) return true;

    const result = star();
    if (result.ok) {
      stdout.write("[agbrowse] Thanks for the ⭐!\n");
    } else {
      stderr.write(
        `[agbrowse] Could not star automatically: ${result.error}\n`,
      );
    }
    return true;
  } catch {
    return false; // never break the CLI
  }
}

// Direct execution (`node scripts/postinstall.mjs`) keeps working for the
// release.yml package smoke; imports (the CLI path) must not auto-run.
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) &&
      import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  maybeRunStarPrompt().catch(() => {
    /* never fail */
  });
}
