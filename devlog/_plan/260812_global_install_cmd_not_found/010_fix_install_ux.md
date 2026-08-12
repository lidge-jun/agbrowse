# 010 — Fix: drop the lifecycle hook, move the star prompt to first CLI run

> DIFFLEVEL-ROADMAP-01: diff-level precision below. v4 after A-round-3 FAIL
> (test-helper/env-scrub/stateFile-dir/positive-assertion/hard-check fixes).
> v3 folded round-2 PTY+staging blockers; v2 folded round-1 blockers 2/3/4/5.

## Audit synthesis (round 3)

| # | Blocker | Decision |
| --- | --- | --- |
| 1 | `await markPrompted(stateFile)` breaks the exact-string `indexOf('await markPrompted()')` assertion | accept -> amend that ONE assertion to `indexOf('await markPrompted(')` and say so explicitly; the claim "existing tests pass unmodified" is corrected to "one relaxed lookup line" |
| 2 | `makeTty()` never sets `isTTY`; `isAgentDriven()` reads real env (CODEX_CI/CI/GITHUB_ACTIONS present in CI) | accept -> new `makeInteractiveTty()` helper sets `isTTY = true` on both streams; human-path tests snapshot+delete+restore ALL eleven AGENT_ENV_VARS in try/finally |
| 3 | Group A negative-only assertions can false-pass on a dead CLI | accept -> every spawned case gets a positive assertion first (JSON parse / error envelope / help banner / MCP initialize response), THEN the no-star-prose assertion |
| 4 | `markPrompted(stateFile)` must create `dirname(stateFile)`, not the fixed STATE_DIR | accept -> `mkdir(dirname(stateFile), { recursive: true })`; test uses a nested nonexistent parent |
| 5 | 020 version/hook checks printed but never enforced | accept -> hard `[ ... ] || exit 1` comparisons |

## Audit synthesis (round 2)

| # | Blocker | Decision |
| --- | --- | --- |
| 1 | `script` merges child stdout+stderr into one PTY stream — stream-ownership claims unprovable through it (verified by reviewer probe) | accept -> drop the `script` harness for behavior proofs; `maybeRunStarPrompt` gains injectable streams/probes (stdin/stdout/stderr/stateFile/ghInstalled/confirm/star); deferral + prompt paint through injected streams, so tests prove ownership deterministically |
| 2 | Human PTY setup self-suppresses (HOME override breaks gh auth; inherited CODEX_* env trips isAgentDriven) | accept -> primary human activation proof is injected-stream (no gh, no real HOME, no PTY); supplementary real-PTY smoke keeps `GH_CONFIG_DIR`, uses tmp HOME, scrubs agent env, and is explicitly optional |
| 3 | 020 staged before regenerating -> regenerated files omitted from merge commit | accept -> regenerate FIRST, then `git add -A`, assert no unmerged entries + clean tree post-commit |
| 4 | `npx --prefix <wt>` does not chdir — vitest would test the wrong tree (verified) | accept -> all preflight runs inside `(cd <wt> && ...)` |
| + | Picker main-worktree is stale/prunable | accept -> 020 precondition: `git worktree prune` + fresh `git worktree add` |

## Audit synthesis (REVIEW-SYNTHESIS-01, round 1)

| # | Blocker | Decision |
| --- | --- | --- |
| 1 | Merge conflict inventory incomplete | accept -> 020 rewritten with full 10-file inventory (analyst subagent) |
| 2 | Machine-output gating weaker than update-check contract | accept -> gate now mirrors `shouldSkipUpdateNotice` (JSON_ERRORS, CI, known-command sets imported from update-check.mjs); agent deferral moved to **stderr** (decided: prose never touches stdout; agents read stderr) |
| 3 | "npm 11.18 blocks/never runs the hook" is false | accept -> verified by probe: npm 11.18.0 **warns and still runs** postinstall (marker file written); npm 11.16+ preview-warns, **npm 12 will default-deny** (npm v11/v12 changelogs, GitHub changelog 2026-06-09). All wording fixed to "warning + future-proofing" |
| 4 | Install verification written as comments | accept -> executable grep assertions in 010 C-proof and 020 steps |
| 5 | module-graph edge is deterministic, not conditional | accept -> unconditional MODIFY + edge verification |
| 6 | Release stop/contradiction semantics | accept -> 020 requires BOTH runs + BOTH smokes; no blanket "prefer dev" |
| + | Reviewer note: `isGhInstalled()` can cost up to 3s+5s on first interactive run before state exists | accept -> documented; gate order puts state-file check before the gh probe |

## Loop-spec

- Loop archetype: spec-satisfaction repair (gates + install proof define done)
- Trigger: user-visible install UX failure (allow-scripts warning +
  command-not-found report on npm 11.18/zsh)
- Goal: `npm install -g agbrowse` emits zero script warnings on npm 11.x and
  keeps working when npm 12 default-denies lifecycle scripts; the star prompt
  is preserved as a once-only, TTY-gated, first-run CLI flow that never
  touches machine-readable stdout
- Non-goals: bin layout, frozen `files` manifest, browser features, renaming
  `scripts/postinstall.mjs` (path kept: frozen-manifest test + release.yml
  smoke reference it)
- Verifier: targeted vitest, full `npm test`, `test:release-gates`,
  `gate:all`, packed-tarball install proof with grep assertions
- Stop condition: all criteria green; 2 failed repairs of one failure ->
  root-cause mode
- Escalation: unexpected gate failure from unrelated dirty-tree state ->
  report, never widen scope

## MODIFY / NEW / DELETE map

### 1. MODIFY `package.json`

```diff
   "scripts": {
-    "postinstall": "node scripts/postinstall.mjs",
     "test": "vitest run --reporter=verbose",
```

Nothing else. `files` keeps shipping `scripts/postinstall.mjs`.

### 2. MODIFY `skills/browser/update-check.mjs`

Export the two command-policy sets so the star-prompt gate shares one source
of truth (lines 11 and 18):

```diff
-const SKIP_COMMANDS = new Set([
+export const SKIP_COMMANDS = new Set([
-const KNOWN_ROOT_COMMANDS = new Set([
+export const KNOWN_ROOT_COMMANDS = new Set([
```

No behavior change; existing exports untouched.

### 3. MODIFY `scripts/postinstall.mjs` (path kept on purpose)

a) Header comment rewrite (accurate npm story):

```
 * star prompt — one-time GitHub star prompt, shown on the first interactive
 * agbrowse CLI run.
 *
 * History: this file used to be wired as the npm `postinstall` lifecycle
 * hook. npm >= 11.16 prints an `allow-scripts` warning for any unapproved
 * lifecycle script during global installs (a preview of npm 12, which skips
 * them by default), so the hook produced scary install output and is not a
 * reliable trigger going forward. The hook was removed; the CLI
 * (skills/browser/browser.mjs) now calls maybeRunStarPrompt() on first run.
 * Direct execution (`node scripts/postinstall.mjs`) still works and is used
 * by the release.yml package smoke.
```

b) Imports: add `pathToFileURL` from `node:url` and the policy sets:

```js
import { pathToFileURL } from "node:url";
import { KNOWN_ROOT_COMMANDS, SKIP_COMMANDS } from "../skills/browser/update-check.mjs";
```

(Resolves inside the installed package: `skills/` is shipped wholesale.)

c) NEW exported gate — mirrors `shouldSkipUpdateNotice` plus TTY:

```js
/**
 * True when this invocation must not see the star prompt: machine output
 * modes (--json, --help, AGBROWSE_JSON_ERRORS=1), MCP stdio, CI, unknown or
 * help-class commands, non-interactive streams, or explicit opt-out.
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
```

d) `printAgentDeferral()` moves its `console.log` to `console.error`
(decision: the deferral is prose for the agent to relay, never data; stdout
stays machine-clean even on agent-driven PTYs). String contents unchanged.

e) `main()` becomes exported `maybeRunStarPrompt(opts = {})`, never throws,
with injectable seams so tests need no PTY, no gh, and no real HOME:

```js
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
    if (await hasBeenPrompted(stateFile)) return false; // state BEFORE the gh probe
    if (!ghInstalled()) return false;                   // <=3s+5s, first interactive run only

    // (agent-deferral comment kept verbatim)
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
      stderr.write(`[agbrowse] Could not star automatically: ${result.error}\n`);
    }
    return true;
  } catch {
    return false; // never break the CLI
  }
}
```

Supporting signature changes: `hasBeenPrompted(stateFile = STATE_FILE)`,
`markPrompted(stateFile = STATE_FILE)` — which creates
`await mkdir(dirname(stateFile), { recursive: true })` (add `dirname` to the
`node:path` import) so injected nested state paths work — and
`printAgentDeferral(stream = process.stderr)` (uses `stream.write`; the
`console.log` goes away). `isAgentDriven()` keeps reading real `process.env`
so the guard-order assertion keeps its exact string; tests drive the branches
by mutating `process.env` (see 6b).

Preserved source patterns: `if (isAgentDriven()) {`, `interactiveConfirm`,
`defaultYes: true`, `Star it on GitHub (via gh)?`,
`do not answer this yourself`, `"auth", "status"` all keep passing UNCHANGED.
ONE existing assertion is relaxed and the diff says so:
`source.indexOf('await markPrompted()')` -> `source.indexOf('await
markPrompted(')` (the call gains a `stateFile` argument); the
guard-before-state-write ordering check it feeds is unchanged in meaning.

f) Tail: direct-run guard replaces unconditional `main().catch(...)`:

```js
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) &&
      import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  maybeRunStarPrompt().catch(() => { /* never fail */ });
}
```

### 4. MODIFY `skills/browser/browser.mjs`

a) import beside line ~91:

```js
import { maybeRunStarPrompt } from '../../scripts/postinstall.mjs';
```

b) call immediately after `await maybeEmitUpdateNotice({...})`, before the
`switch (sub)` dispatch:

```js
    await maybeRunStarPrompt({ argv: process.argv.slice(2) });
```

Cost profile: non-TTY/`--json`/CI/unknown-command invocations exit at the
pure gate (no I/O). Interactive humans pay one state-file read; only
first-run interactive humans with no state file pay the gh probe (<=8s worst
case, once ever).

### 5. MODIFY `test/unit/star-prompt-confirm.test.mjs`

Existing describes untouched. NEW imports: `spawnSync` from
`node:child_process`, `shouldSkipStarPrompt` from `../../scripts/postinstall.mjs`
(import is side-effect-free after 3f). NEW describes:

- `shouldSkipStarPrompt` — non-TTY -> true; `--json`/`--help` on TTY -> true;
  `AGBROWSE_JSON_ERRORS: '1'` -> true; `AGBROWSE_STAR_PROMPT: '0'` -> true;
  `CI: 'true'` -> true unless `AGBROWSE_STAR_PROMPT: '1'`; `['web-ai','mcp-server']`
  -> true; `['help']`, `['skills']`, `['research','plan']`, `[]`, `['--version']`,
  `['not-a-command']` -> true; `{ argv: ['start'], env: {}, TTY fakes }` -> false.
- `postinstall direct execution` — `spawnSync(process.execPath,
  [postinstallPath], { stdio: 'pipe', env: { ...process.env, CI: '1' },
  timeout: 10000 })` -> status 0, stdout `''` (release.yml smoke stays green).

### 6. NEW `test/integration/star-prompt-cli.test.mjs`

Group A — spawned machine-surface proofs (piped, no PTY; deterministic).
Every case has a POSITIVE assertion first (proves the CLI actually reached
its surface), then the negative star-prose assertion:

| Case | Setup | Positive assertion | Negative assertion |
| --- | --- | --- | --- |
| JSON machine surface | `node bin/agbrowse.mjs status --json`, piped | exit 0; `JSON.parse(stdout)` has a boolean `running` field (verified at audit: prints `{"running":...}`) | stdout matches no `/Star it on GitHub|Enjoying agbrowse/` |
| JSON-errors surface | `AGBROWSE_JSON_ERRORS=1 node bin/agbrowse.mjs research plan --json` (no `--query` — pinned at audit: exit 1, `error.errorCode === "input.invalid-arguments"`) | stdout parses as the `{ ok:false, status:"error", error:{...} }` envelope | no star prose |
| Unknown command | piped `not-a-command` | exit 0 AND stdout contains the `agbrowse <command>` help banner (verified at audit: unknown commands print help, exit 0) | no star prose |
| MCP stdio | piped `web-ai mcp-server`; write a `{"jsonrpc":"2.0","id":1,"method":"initialize",...}` frame to stdin, read one stdout line | the line parses as a JSON-RPC response with `id:1` and a `result` | no star prose; then SIGKILL |

Group B — supplementary real-PTY activation smoke (explicitly optional; skips
when `gh auth status` fails or `script(1)` is unavailable): force
`AGBROWSE_STAR_PROMPT=1`, `HOME=<tmp>` BUT keep `GH_CONFIG_DIR` pointing at
the real gh config, scrub every var from `agent-driven.mjs`'s AGENT_ENV_VARS
list, allocate a PTY via `script -q /dev/null env ... node bin/agbrowse.mjs
status` (darwin) / `script -qec ... /dev/null` (linux), feed `n`; assert the
merged PTY output contains `Star it on GitHub (via gh)?` — this proves the
end-to-end trigger fires under a real terminal. Stream-ownership claims are
NOT made here (PTY merges streams by construction).

### 6b. MODIFY `test/unit/star-prompt-confirm.test.mjs` — injected-stream behavior proofs (primary)

NEW helper `makeInteractiveTty()`: same PassThrough pair as `makeTty()` PLUS
`input.isTTY = true; output.isTTY = true` (the existing helper never sets
these, and `shouldSkipStarPrompt` gates on them — round-3 blocker 2).

Env discipline for human-path tests: snapshot, delete, and restore ALL eleven
vars from `scripts/agent-driven.mjs`'s AGENT_ENV_VARS (CLAUDECODE,
CLAUDE_CODE_ENTRYPOINT, CODEX_THREAD_ID, CODEX_SHELL, CODEX_CI,
CURSOR_TRACE_ID, CURSOR_SESSION_TOKEN, AIDER_CHAT, REPL_ID, CI,
GITHUB_ACTIONS) in try/finally — vitest isolates test FILES per worker
process, so process-local mutation cannot leak into sibling files.

NEW describe `maybeRunStarPrompt (injected streams)` with
`stateFile: <tmp>/nested/state/star-prompt.json` (nested nonexistent parent —
round-3 blocker 4) and `ghInstalled: () => true`:

| Case | Setup | Assertion |
| --- | --- | --- |
| agent-driven TTY defers to stderr | `process.env.CODEX_THREAD_ID` set for the call; `makeInteractiveTty()` streams + recording stderr | returns false; stdout frames EMPTY; stderr contains `do not answer this yourself`; stateFile NOT created |
| human first run prompts once | eleven agent vars scrubbed; feed `n` | returns true; output frames contain `Star it on GitHub (via gh)?`; stateFile EXISTS (nested parent created); immediate second call returns false with zero new frames |
| human yes stars | scrubbed env; feed `y`; `star: () => ({ ok: true })` | output contains `Thanks for the`; star called once |
| non-TTY / `--json` / opted-out | matching argv/env/stream combos | return false with zero frames on both streams |

The human-first-run row is the C-ACTIVATION-GROUNDING proof that the prompt
path still fires after the refactor.

### 7. MODIFY `test/integration/bin-shim-contract.test.mjs`

```js
it('ships no npm lifecycle install scripts (npm >= 11.16 warns; npm 12 default-denies)', () => {
    for (const hook of ['preinstall', 'install', 'postinstall', 'preuninstall', 'postuninstall']) {
        expect(pkg.scripts?.[hook], `scripts.${hook} must not exist`).toBeUndefined();
    }
});
```

### 8. MODIFY `README.md`

a) `## Install CLI`, after the update-notice paragraph:

```md
`agbrowse` ships no npm lifecycle scripts (`postinstall` and friends), so
`npm install -g` never prints npm's `allow-scripts` warnings and keeps working
as npm tightens script defaults. On your first interactive run the CLI may
ask once whether to star the GitHub repo; agents, pipes, CI, and `--json`
runs never see it. Set `AGBROWSE_STAR_PROMPT=0` to opt out.
```

b) `## Troubleshooting` table, new row:

```md
| `command not found: agbrowse` right after install | the shell session predates the install, or npm's global bin dir is not on `PATH` | open a new terminal tab (or run `rehash`); confirm the shim with `ls "$(npm prefix -g)/bin/agbrowse"` and make sure that bin dir is on `PATH` |
```

### 9. MODIFY `docs/migration/module-graph.json` (unconditional)

`npm run check:module-graph` regenerates it in B. New edges to verify in the
artifact: `skills/browser/browser.mjs -> scripts/postinstall.mjs` and
`scripts/postinstall.mjs -> skills/browser/update-check.mjs`
(fan-in of postinstall.mjs 0 -> 1, of update-check.mjs +1).

## Verifiers (all baselined at P)

- `npx vitest run test/unit/star-prompt-confirm.test.mjs test/integration/bin-shim-contract.test.mjs`
  — baseline 22/22 green; reads targets directly.
- `npx vitest run test/integration/star-prompt-cli.test.mjs` — new; reads the
  change target by construction.
- `npm test`, `npm run test:release-gates`, `npm run gate:all` — CI parity.
- `npm run typecheck` — exit 0 baseline; tsconfig excludes `**/*.mjs`, so it
  does NOT observe this unit (recorded; vitest covers the .mjs surface).
- C1 packed-tarball proof (executable, not comments):

```bash
T=$(mktemp -d); npm pack --pack-destination "$T" >/dev/null
OUT=$(npm install -g "$T"/agbrowse-*.tgz --prefix "$T/prefix" 2>&1); RC=$?
[ $RC -eq 0 ] || { echo "install failed"; exit 1; }
printf '%s' "$OUT" | grep -qiE 'allow-scripts|install-scripts|install scripts not yet covered' \
  && { echo "FAIL: script warning present"; printf '%s\n' "$OUT"; exit 1; }
AGBROWSE_UPDATE_CHECK=0 "$T/prefix/bin/agbrowse" --help >/dev/null || exit 1
node "$T/prefix/lib/node_modules/agbrowse/scripts/postinstall.mjs"  # exit 0, silent
echo C1-ok
```

## Accept criteria

- c1: tarball proof above exits 0 with `C1-ok`.
- c2: targeted vitest files green incl. all new tests.
- c3: `npm test`, `test:release-gates`, `gate:all` exit 0.
- c4: prompt behavior preserved: once-only, human-TTY, agent-deferral strings
  intact, deferral on stderr; existing source-pattern tests pass with exactly
  one relaxed lookup line (`await markPrompted()` -> `await markPrompted(`),
  acknowledged in section 3.

## Out of scope

Browser features, docs-site HTML, `files` manifest, release.yml content (its
`node scripts/postinstall.mjs` smoke keeps working via the direct-run guard),
unrelated dirty-tree files (.codexclaw, agb-*.spike.mjs, shot-*.mjs).
