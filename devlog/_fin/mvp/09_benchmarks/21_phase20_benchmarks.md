# Phase 20 — Benchmarks and trajectory format

Optional but strategically important. This phase creates evidence without
pretending agbrowse is already an autonomous planner.

## PR 20.1 — Trajectory format

### Diff

- NEW `benchmarks/agbrowse/trajectory.mjs`
- NEW `benchmarks/agbrowse/run-task.mjs`
- NEW `docs/benchmarks.md`
- NEW `test/unit/benchmark-trajectory.test.mjs`

### Trajectory output

```js
{
  trajectoryVersion: 1,
  taskId: 'provider-copy-001',
  gitCommit: 'abc123',
  model: 'external-planner-name',
  browserEnvironment: 'local-chrome',
  maxSteps: 20,
  steps: [],
  finalAnswer: '',
  verdict: null,
  tracePath: '...'
}
```

### PASS

- Every benchmark run writes `trajectory.json`, trace, final answer, and
  verdict placeholder.
- Output can convert to WebVoyager/MolmoWeb-style judge input.

## PR 20.2 — Internal provider workflow benchmark

### Task set

- 5 ChatGPT send/poll/copy tasks.
- 5 ChatGPT upload/context tasks.
- 5 Gemini model/tool/upload tasks.
- 5 Grok source-audit tasks.
- 5 multi-tab/session-resume tasks.
- 5 negative/fail-closed tasks.

### PASS

- At least 90% success over 3 consecutive local runs.
- Negative tasks fail closed 100%.
- All failures include trace and error envelope.

## PR 20.3 — External benchmark adapter spike

### PASS

- A small custom task JSON can run against agbrowse.
- Report distinguishes "agbrowse tool substrate + external planner" from
  "agbrowse autonomous agent".
- No headline WebVoyager-style score is published until planner/model/browser
  environment is fixed.

## Not now

- No leaderboard claims.
- No cherry-picked benchmark numbers.

## cli-jaw mirror

- Reuse the trajectory schema.
- cli-jaw benchmark runs must label whether agbrowse CLI, cli-jaw HTTP, or an
  external planner drove the browser.
- Do not compare scores unless the model, planner, browser environment, and
  max-step budget match.
