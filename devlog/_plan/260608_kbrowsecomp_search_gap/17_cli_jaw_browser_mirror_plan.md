# 17. cli-jaw Browser Mirror Plan

## Why This Must Be In Scope

The K-BrowseComp improvement path is not an agbrowse-only feature. cli-jaw is
the orchestrator that dispatches employees and decides when to search, fetch,
or browse. agbrowse is the standalone browser/runtime surface that should carry
the same browser capabilities.

Therefore the plan cannot be only:

```text
agbrowse research plan -> better query rewrites
```

It must be:

```text
cli-jaw search/browse prompt policy
  -> agbrowse mirrored browser commands
  -> agbrowse research planning
  -> search backend URL candidates
  -> agbrowse fetch/browser verification
  -> cli-jaw employees consume the same trajectory contract
```

If cli-jaw has browse commands that agbrowse does not mirror, agents will learn
one workflow inside cli-jaw and lose it when using standalone agbrowse skills.
That breaks the shared mental model.

## Current Parity Snapshot

Observed on 2026-06-09 from:

```text
cli-jaw browser --help
node bin/agbrowse.mjs --help
```

### Already Mirrored Enough For K-BrowseComp

| Capability | cli-jaw browser | agbrowse | Status |
|------------|-----------------|----------|--------|
| lifecycle | `start`, `stop`, `status`, `doctor`, `reset` | same core commands | enough |
| observe | `snapshot`, `screenshot`, `text`, `get-dom` | same core commands | enough |
| adaptive URL read | `fetch <url>` | `fetch <url>` | enough |
| navigation | `navigate`, `open`, `reload`, `resize`, `tabs`, `tab-switch`, `scroll` | mostly mirrored | enough |
| interaction | `click`, `type`, `press`, `hover`, `select`, `drag`, mouse commands | mostly mirrored | enough |
| web-ai core | `render`, `status`, `send`, `poll`, `query`, `stop` | same core commands | enough |

### Mirror Gaps To Close

| Capability | cli-jaw browser | agbrowse state | Why it matters |
|------------|-----------------|----------------|----------------|
| explicit new tab | `new-tab <url> [--no-activate]` | not in help | parallel research and avoiding active-tab drift |
| explicit tab close | `tab-close <targetId>` | not in help | cleanup after multi-candidate browse runs |
| active tab contract | `active-tab --json` | not in help | employee handoff needs target-id truth |
| vision-click surface | `vision-click <target>` | separate agbrowse bin/skill, not mirrored in main help | no-ref Korean portal/iframe fallback |
| cleanup-runtimes | `cleanup-runtimes` | not mirrored | lower priority; jaw-owned runtime cleanup is cli-jaw-specific |
| web-ai watcher ops | `watch`, `watchers`, `sessions`, `notifications`, `capabilities`, `diagnose` | partially different | lower priority for K-BrowseComp, higher for web-ai parity |

## Planning Change

The K-BrowseComp implementation order should be revised from "research CLI
first" to "browser parity + research CLI together":

1. Mirror the missing P0 cli-jaw browser commands in agbrowse where they are
   not cli-jaw-server-specific.
2. Expose `agbrowse research plan --query ... --json` using the P0 modules.
3. Update agbrowse `browser` and `web-ai` skills to document the same search
   trajectory that cli-jaw prompts now require.
4. Update cli-jaw source templates/skills to say: when agbrowse is available,
   use `agbrowse research plan` before broad Korean search and then use
   `agbrowse fetch` / browser commands for verification.
5. Add smoke tests that run the same Korean task through:
   - cli-jaw employee prompt behavior,
   - agbrowse research plan output,
   - agbrowse fetch/browser escalation contract.

## P0 Mirror Set

These should be patched before or alongside `research plan` CLI exposure:

```text
agbrowse new-tab <url> [--no-activate] [--json]
agbrowse tab-close <targetId> [--json]
agbrowse active-tab --json
agbrowse vision-click <target> [--provider codex] [--double]
```

`vision-click` may remain implemented by the existing standalone binary, but
the main help/skill surface should route to it so agents do not need a separate
mental model.

## Non-Goal

Do not mirror cli-jaw-server-only implementation details blindly:

- jaw-owned runtime record cleanup
- notification event stores
- dashboard/heartbeat surfaces

The mirror target is the agent-visible browser workflow, not cli-jaw's server
internals.

## Success Criteria

The next K-BrowseComp phase is complete only when:

- The devlog and skills describe cli-jaw and agbrowse as one shared browse
  workflow.
- The missing P0 browser commands above are either implemented in agbrowse or
  explicitly marked cli-jaw-only with reason.
- `agbrowse research plan` can produce query/constraint/browse decisions.
- cli-jaw prompts/skills tell employees how to connect query planning to
  agbrowse fetch/browser verification.
- A smoke case can show one Korean problem moving through both layers without
  relying on search snippets as final evidence.
