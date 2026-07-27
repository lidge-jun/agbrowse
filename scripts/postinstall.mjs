#!/usr/bin/env node
/**
 * postinstall — one-time GitHub star prompt during `npm install -g agbrowse`.
 *
 * Behavior:
 *   - TTY-only (skips CI / piped installs)
 *   - Requires an installed and authenticated `gh` CLI
 *   - Asks with an explicit Yes/No selector (arrow keys, `y`/`n`, Enter)
 *   - When an agent drives the install, relays the question instead of answering
 *   - Prompts once; records state in ~/.agbrowse/state/star-prompt.json
 *   - Never blocks install (all errors silently caught)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { isAgentDriven } from "./agent-driven.mjs";
import { interactiveConfirm } from "./interactive-confirm.mjs";

const REPO = "lidge-jun/agbrowse";
const STATE_DIR = join(homedir(), ".agbrowse", "state");
const STATE_FILE = join(STATE_DIR, "star-prompt.json");

async function hasBeenPrompted() {
  if (!existsSync(STATE_FILE)) return false;
  try {
    const state = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return typeof state.prompted_at === "string";
  } catch {
    return false;
  }
}

async function markPrompted() {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    STATE_FILE,
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
 * Shown instead of the prompt when an agent is driving the install. The agent
 * reads this as its instruction: it must not answer, it must ask the person.
 */
function printAgentDeferral() {
  console.log(
    `\n[agbrowse] agbrowse isn't starred on GitHub yet.\n` +
    `[agbrowse] Agent: do not answer this yourself — it uses the user's GitHub identity.\n` +
    `[agbrowse] Ask the user whether to star ${REPO}, and only run\n` +
    `[agbrowse] \`gh api -X PUT /user/starred/${REPO}\` if they say yes.\n`,
  );
}

async function main() {
  // Skip in non-interactive environments (CI, piped, etc.)
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  if (await hasBeenPrompted()) return;
  if (!isGhInstalled()) return;

  // An agent would answer this on the user's behalf, using the user's GitHub
  // identity. Hand the question to the agent to relay, and leave the state
  // unwritten so the user still gets the real prompt on their own install.
  if (isAgentDriven()) {
    printAgentDeferral();
    return;
  }

  await markPrompted();

  const approved = await interactiveConfirm({
    question: "\n[agbrowse] Enjoying agbrowse? Star it on GitHub (via gh)?",
    defaultYes: true,
  });
  if (!approved) return;

  const result = starRepo();
  if (result.ok) {
    console.log("[agbrowse] Thanks for the ⭐!");
  } else {
    console.warn(
      `[agbrowse] Could not star automatically: ${result.error}`,
    );
  }
}

main().catch(() => {
  /* never fail the install */
});
