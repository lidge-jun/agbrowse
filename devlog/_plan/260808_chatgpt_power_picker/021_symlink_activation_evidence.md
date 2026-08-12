# WP2 symlink activation evidence

Date: 2026-08-08 KST

## Executable and checkout anchors

- `command -v agbrowse`: `/Users/jun/.local/bin/agbrowse`
- `readlink` and `realpath`: `/Users/jun/Developer/new/700_projects/agbrowse/bin/agbrowse.mjs`
- checkout: `/Users/jun/Developer/new/700_projects/agbrowse`
- branch: `dev`
- tested HEAD: `a2171c32a3b79ee072cfb75ccfc95e32aa13d56e`
- `origin/dev`: `6cb58681771e273221a3b65089a3cf3a433890bf`
- scoped commits ahead: `8970ca2`, `ea3eb34`, `a2171c3`

## Symlinked runtime result

1. Initial owned tab was one `about:blank` target (`88177DFC5562621321428A4A41C5DD8B`).
2. `agbrowse navigate https://chatgpt.com/` succeeded.
3. `agbrowse web-ai status --vendor chatgpt --url https://chatgpt.com/ --json` returned `ok:true`, `status:"ready"`, active-tab verification `ok`, and composer-visible `ok` at `#prompt-textarea`.
4. The interactive snapshot showed `Log in` and `Sign up for free`; the model opener was the unauthenticated generic `Model selector`. A cookie dialog was rejected with the root `agbrowse snapshot -i`/`agbrowse click e54` path.
5. Because the owned profile was not authenticated, no family/model/effort mutation and no prompt send occurred. Cookies were not copied from the independently authenticated Chrome-plugin session.
6. `agbrowse navigate about:blank` restored the exact pre-test URL. Final `agbrowse tabs --json` showed the same sole target at `about:blank`.

Classification: `NEEDS_HUMAN_LOGIN` for the authenticated symlink send/poll criterion; executable, navigation, active-tab preflight, composer detection, ref resolution, and restoration paths are live-verified.

## Independent authenticated UI evidence

The user's existing Chrome session and Computer Use AX inspection independently showed the current authenticated Chat picker before implementation:

- composer pill `Extra High`;
- top open `Power` menu with slider range `0..4` and current value `3`;
- exact `Model\nGPT-5.6 Sol` and `Effort\nExtra High` submenu rows;
- family rows `GPT-5.6 Sol`, `GPT-5.5`, `o3`;
- effort rows `Instant`, `Medium`, `High`, `Extra High`, `Pro`;
- keyboard probe mapped all five slider values and restored `Extra High`.

This is DOM/AX contract evidence, not proof that the unauthenticated agbrowse-owned profile can select or send.
