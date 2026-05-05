---
created: 2026-05-05
tags: [agbrowse, release, quality-gate, verification]
aliases: [agbrowse release gates, agbrowse 릴리즈 게이트, production readiness]
---

# agbrowse Release Gates

`agbrowse`의 public claim은 코드 존재만으로 올리지 않는다. 어떤 표면이 ready인지, 어떤 표면이 beta인지, 어떤 표면이 experimental인지 테스트와 문서가 같이 증명할 때만 라벨을 바꾼다. 이 문서는 Phase 21의 release gate 요구를 실제 repo 명령으로 바꾸는 기준이다.

사용자는 `agbrowse`를 agent runtime으로 설치한다. 그래서 release gate가 약하면 단순 테스트 실패보다 더 큰 문제가 생긴다. provider UI mutation, 파일 업로드, clipboard capture, MCP tool call은 실패할 때도 안전하게 실패해야 한다. 릴리즈 전 검증은 이 실패 방식을 확인하는 일이다.

릴리즈 전에는 아래 checklist를 위에서 아래로 실행한다. 실패한 항목이 있으면 publish나 public v1 messaging을 멈춘다. live provider 계정, subscription, CAPTCHA, Cloudflare 통과 여부는 이 프로젝트가 보장하지 않는다. 문서와 release note도 그 범위를 넘지 않는다.

---

## Support Labels

| 라벨 | 의미 | 현재 기준 |
| --- | --- | --- |
| `ready` | deterministic tests와 docs가 모두 뒷받침한다 | CLI primitive, session store, offline eval fixture, policy/trace schema |
| `beta` | 구현은 있으나 live provider UI와 계정 상태에 영향받는다 | ChatGPT/Gemini/Grok live send/poll/query |
| `experimental` | optional adapter, benchmark score, hosted/cloud claim 전 단계다 | external CDP는 deferred, benchmark score는 deferred, broader MCP production claim은 deferred |

## Public Claim Gate

| Claim | 필요한 근거 |
| --- | --- |
| Local web-AI production | Phase 11, 12, 13, 14, 16, 17 요구가 문서와 테스트에 반영됨 |
| General browser-agent CLI | Phase 15 primitive parity test 통과 |
| Production MCP bridge | Phase 18 protocol, stale-ref, policy, schema test 통과 |
| Hosted/cloud operation | Pending. Phase 19 external-CDP 또는 별도 provider adapter gate 통과 전까지 금지 |
| Benchmark comparison | Pending. Phase 20 trajectory bundle은 있어도 고정 model/planner/environment/task set 전까지 점수 주장 금지 |

## Release Checklist

- [ ] `git diff --check`
- [ ] `bash structure/check-doc-drift.sh`
- [ ] `bash structure/verify-counts.sh`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run test:eval`
- [ ] `npm run test:contract-drift`
- [ ] `npm run test:trace-policy`
- [ ] `npm run test:mcp`
- [ ] `npm run test:source-audit`
- [ ] `npm run test:release-gates`
- [ ] `npm run benchmark:trajectory -- --help`
- [ ] `npm pack --dry-run`
- [ ] `npm publish --dry-run --access public` 또는 preview면 `--tag preview`

## Script Coverage

| Script | 현재 역할 | Release gate 의미 |
| --- | --- | --- |
| `npm test` | 전체 Vitest suite | 기본 회귀 차단 |
| `npm run test:unit` | unit tests | deterministic module contract |
| `npm run test:integration` | integration tests | CLI/MCP/policy/provider fixture 통합 |
| `npm run test:eval` | eval 관련 unit suite | provider DOM churn eval harness |
| `npm run test:eval-fixtures` | offline fixture runner | fixture config와 JSON result 확인 |
| `npm run test:contract-drift` | contract audit unit test | provider contract drift 차단 |
| `npm run test:trace-policy` | trace와 policy tests | evidence와 mutation guard 확인 |
| `npm run test:mcp` | MCP protocol/schema/policy tests | Phase 18 ready claim이 실제 tool surface와 일치하는지 확인 |
| `npm run test:source-audit` | answer artifact + source audit tests | Phase 17 research/source claim 차단 |
| `npm run test:release-gates` | structure drift + count checks | Phase status, command, release claim drift 차단 |
| `npm run benchmark:trajectory` | offline trajectory bundle writer | score가 아니라 sanitized trajectory artifact 생성만 허용 |
| `npm run release` | latest release script | clean tree, install, audit, tests, structure gates, fixture evals, diff check, pack, publish dry-run, tag/publish |
| `npm run release:preview` | preview release script | preview version, audit, tests, structure gates, fixture evals, diff check, pack, publish dry-run, tag/publish |
| `bash structure/verify-counts.sh` | structure count verifier | source map line/file counts drift 차단 |

## 금지 Claim

| 금지 claim | 이유 |
| --- | --- |
| stealth browser 자동 우회 | 안전/계정 리스크가 크고 현재 scope가 아니다 |
| CAPTCHA 또는 Cloudflare bypass | 제공하지 않는 기능이다 |
| provider subscription entitlement 보장 | 계정과 plan 상태는 외부 조건이다 |
| leaderboard 점수 주장 | planner, model, browser environment를 고정한 공개 benchmark가 아직 아니다 |
| live provider API 안정성 보장 | provider web UI는 공식 API가 아니며 변경될 수 있다 |

## 변경 기록

- 2026-05-05: MCP/source-audit/release-gate named scripts를 release path에 추가해 public claim gate가 `npm test` 안에 묻히지 않게 했다.
- 2026-05-05: Phase 21 release gate 요구를 현재 npm scripts, package dry-run, support label 기준으로 정리했다.
