#!/usr/bin/env node
/**
 * postinstall — one-time GitHub star prompt during `npm install -g agbrowse`.
 *
 * Behavior:
 *   - TTY-only (skips CI / piped installs)
 *   - Requires `gh` CLI with auth
 *   - Prompts once; records state in ~/.agbrowse/state/star-prompt.json
 *   - Never blocks install (all errors silently caught)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";

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

function isGhInstalled() {
  const result = spawnSync("gh", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 3000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
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

async function askYesNo(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  // Skip in non-interactive environments (CI, piped, etc.)
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  if (await hasBeenPrompted()) return;
  if (!isGhInstalled()) return;

  await markPrompted();

  const approved = await askYesNo(
    "[agbrowse] Enjoying agbrowse? Star it on GitHub? [Y/n] ",
  );
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
