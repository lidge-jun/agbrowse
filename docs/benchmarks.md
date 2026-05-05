---
created: 2026-05-05
tags: [agbrowse, benchmarks, trajectory]
---

# Benchmark Trajectories

Phase 20 currently provides a sanitized trajectory bundle format and offline
bundle writer. It does not publish benchmark scores or competitor leaderboard
claims.

## What Exists

| Artifact | Purpose |
| --- | --- |
| `benchmarks/agbrowse/trajectory.mjs` | Versioned trajectory builder |
| `benchmarks/agbrowse/run-task.mjs` | Offline JSON-to-trajectory bundle writer |
| `test/unit/benchmark-trajectory.test.mjs` | Redaction and CLI bundle tests |

## What the Format Stores

- task id
- model/planner/driver labels
- browser environment label
- bounded max-step budget
- command names and statuses
- trace ids
- hashed observations
- hashed final answer
- verdict metadata

Raw page observations are not stored. Final answer text is kept for human
inspection, with `finalAnswerHash` for integrity checks.

## Usage

```bash
npm run benchmark:trajectory -- \
  --input ./task.json \
  --output-dir ./benchmark-output \
  --json
```

Input shape:

```json
{
  "taskId": "example",
  "model": "fixture",
  "planner": "external",
  "driver": "agbrowse",
  "browserEnvironment": "local-chrome",
  "steps": [
    {
      "command": "agbrowse snapshot",
      "observation": "raw observation text to hash"
    }
  ],
  "finalAnswer": "done",
  "verdict": { "status": "pass" }
}
```

## Claim Boundary

- Allowed: "agbrowse can emit sanitized trajectory bundles."
- Not allowed: "agbrowse beats another browser agent."
- Not allowed: "agbrowse has a public benchmark score."
- Not allowed: "agbrowse is an autonomous planner."

Benchmark comparison requires a fixed model, planner, environment, task set,
scoring rubric, and published trajectory artifacts.
