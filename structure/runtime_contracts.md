---
created: 2026-05-05
tags: [agbrowse, runtime-contract, safety-policy, mcp]
aliases: [agbrowse runtime contracts, agbrowse 런타임 계약, provider contract]
---

# agbrowse Runtime Contracts

`agbrowse`의 고급 기능은 command 이름보다 runtime contract가 더 중요하다. 같은 `query`라도 어떤 tab을 소유하는지, 어떤 session을 resume하는지, 실패할 때 mutation을 막는지, trace에 어떤 증거를 남기는지가 실제 품질을 결정한다.

이 문서는 README의 public claim과 devlog phase 계획 사이를 잇는다. README는 사용자가 보는 약속이고, devlog는 구현 계획과 비판 기록이다. `runtime_contracts.md`는 지금 코드가 지켜야 하는 안정성 계약을 적는다. 새 기능이 이 계약을 바꾸면 test, docs, skill, cli-jaw mirror까지 함께 바뀌어야 한다.

사용법은 간단하다. browser primitive, provider workflow, MCP tool, trace, policy, eval, release label을 고칠 때 이 문서에서 해당 계약을 먼저 확인한다. 계약이 바뀌면 `commands.md`, `release_gates.md`, 관련 `devlog/` phase 문서도 같이 맞춘다.

---

## Browser Runtime

| Contract | 현재 기준 |
| --- | --- |
| Home | `BROWSER_AGENT_HOME`, 기본 `~/.browser-agent` |
| CDP port | `CDP_PORT`, 기본 `9222` |
| Browser state | `browser-state.json`에 port, pid, target 상태 저장 |
| Snapshots | latest snapshot과 per-target snapshot을 `BROWSER_AGENT_HOME` 아래 저장 |
| Ref safety | navigation, reload, tab switch 이후 snapshot ref는 재관찰해야 한다 |
| Evaluation | `evaluate`는 기본 허용된다. custom policy에서 `allowEvaluate: false`로 끌 수 있고, `--unsafe-allow evaluate`는 explicit-deny 우회용 legacy opt-in으로 남긴다 |

## Runway Runtime

`agbrowse runway`는 generic `evaluate` command와 다르다. Runway provider
명령 자체가 안전한 read-only DOM evaluator를 사용해 Apps/Custom media
task-runner surface를 관찰한다.

| Contract | 현재 기준 |
| --- | --- |
| Surface scope | Deep automation focus는 `apps`, `custom-tools`; `agent`, `recents`, `workflow`, `characters`는 surface-only |
| Mutation scope | `selectors`, `status`, `open`, `preflight`, `poll`은 `Generate`, `Run all`, payment, destructive, submit-like controls를 클릭하지 않는다 |
| Poll timeout | Live generation smoke는 모델당 최대 10분 (`--timeout 600000`)을 기본으로 한다 |
| Queue cap | Runway Unlimited active queue cap은 2개로 취급한다 |
| Active signals | `In queue`, `Generating`, `Processing`, `loading animation`, right-rail `%` labels such as `18 50%` |
| Terminal result | Active progress signal이 사라지고 media/output artifact가 노출된 상태 |
| Queue full | Explicit `You're on a roll` / `Please wait for your last generation` / `Credits Mode` gate가 보일 때만 terminal `queue_full` |
| Two active jobs | `queue.full=true`일 수 있지만 `state=active`, `terminal=false`로 계속 poll한다 |

## Session and Tab Runtime

| Contract | 현재 기준 |
| --- | --- |
| Session store | `web-ai-sessions.json`에 `sessionId`, vendor, target, tab, deadline, status 저장 |
| Resume priority | explicit `--session`이 active target, vendor latest, legacy baseline보다 우선한다 |
| Tab ownership | provider send/query는 pooled 또는 새 provider tab을 소유하고 active command로 보호한다 |
| Active command | 같은 target에 병렬 mutation이 들어오면 fail-closed 하며 heartbeat로 장기 작업 소유권을 유지한다 |
| Session command lock | `web-ai-sessions.json.cmd.<session>.lock`은 PID/heartbeat/expiresAt 기반이며 dead PID lock은 stale로 회수한다 |
| Session doctor | `sessions doctor <id>`는 target, URL, lock, active command, recovery recommendation을 prompt/answer 없이 출력한다 |
| Lease cleanup | 완료된 provider tab은 warm lease이며 일정 시간 뒤 cleanup 대상이다 |
| Recovery | bound tab이 닫혔거나 다른 conversation으로 이동하면 session recovery 경로를 쓴다 |

## Provider Runtime

| Provider | Ready surface | Beta surface | Fail-closed 조건 |
| --- | --- | --- | --- |
| ChatGPT | render, session store, fixture eval, model alias contract, model selection evidence | live send/poll/query/upload/copy/generated image/project sources | composer/send/upload/copy resolver validation, provider DOM drift, account/plan state |
| Gemini | render, model alias contract, Deep Think gate, fixture eval | live send/poll/query/upload | mode picker, upload evidence, completion signal 미확인 |
| Grok | render, source-discipline prompt, fixture eval | live send/poll/query/source-audit | context pack hard gate, source quality 미달, copy evidence 미확인 |

Provider UI는 공식 API가 아니다. 따라서 live provider flow는 구현되어 있어도 account, plan, anti-bot, provider DOM change 영향을 받는다.

## Policy and Safety

| Contract | 현재 기준 |
| --- | --- |
| Policy schema | unknown key와 unsupported version은 reject |
| Mutation policy | denied origin, risky upload, clipboard read, unsafe eval은 mutation 전 차단 |
| Content boundary | webpage/context package content는 untrusted data로 표시 |
| JSON errors | `--json` 또는 `AGBROWSE_JSON_ERRORS=1`이면 parseable error envelope 출력 |
| Unsafe allowances | `--unsafe-allow`는 explicit opt-in이며 기본값이 아니다 |

## Trace and Evidence

| Contract | 현재 기준 |
| --- | --- |
| Trace output | `--trace-dir`가 있으면 command trace JSONL 기록 |
| Redaction | email, token, cookie, storage value, prompt/answer text는 trace에서 제거 |
| Offline report | trace report는 deterministic evidence summary를 만든다 |
| Eval evidence | fixture path, sha256, snapshot id, probe evidence, thresholds를 결과에 포함한다 |
| Answer artifact | provider poll success output includes `answerArtifact` from `web-ai/answer-artifact.mjs` |
| Model selection evidence | ChatGPT `send/query` stores `modelSelection` on the session, and `sessions show` prints the requested/resolved model evidence |
| Source audit | `--require-source-audit` fails completed poll/query answers that lack inline sources |

## MCP and AI SDK

| Contract | 현재 기준 |
| --- | --- |
| Server | `agbrowse web-ai mcp-server`는 stdio JSON-RPC MCP bridge다 |
| Schema source | `web-ai/tool-schema.mjs`가 MCP와 AI SDK schema source다 |
| Known tools | `browser_snapshot`, `browser_click_ref`, `web_ai_snapshot`, `web_ai_click_ref`, `web_ai_submit_prompt`, `web_ai_wait_response`, `web_ai_copy_markdown`, `web_ai_doctor`, `web_ai_session_resume` |
| MCP wait/resume | `web_ai_wait_response`와 `web_ai_session_resume`는 stored session lock/recovery를 사용한다. Provider poll timeout은 recoverable result로 반환될 수 있으며, host-side MCP request timeout은 client/runtime boundary로 남는다 |
| Stale ref | snapshot mismatch나 unknown ref는 mutation하지 않는다 |
| Snapshot scope | generic browser refs and provider web-AI refs use isolated latest snapshot state |
| Policy | MCP mutation도 policy enforcement를 통과해야 한다 |

## Eval and Release Readiness

| Contract | 현재 기준 |
| --- | --- |
| Fixture eval | offline, no durable browser/session/tab mutation, bounded concurrency |
| Contract drift | provider contracts and fixture thresholds are test-gated |
| Live smoke | manual or secret-gated only; default CI claim으로 쓰지 않는다 |
| Stability upgrade register | real operational weaknesses are tracked under `structure/stability-upgrade/`; speculative security lists are out of scope |
| Benchmark | `benchmarks/agbrowse/trajectory.mjs`와 `benchmarks/agbrowse/run-task.mjs`로 sanitized bundle만 기록하고 autonomous score claim은 금지한다 |
| Release labels | `ready`, `beta`, `experimental`은 [release_gates.md](release_gates.md)의 기준을 따른다 |

## Devlog Anchors

| Contract | Phase doc |
| --- | --- |
| Trace replay and evidence | `devlog/_fin/mvp/04_eval_trace/13_phase12_trace_replay.md` |
| Safety policy | `devlog/_fin/mvp/05_safety_ownership/14_phase13_safety_policy.md` |
| Active command ownership | `devlog/_fin/mvp/05_safety_ownership/15_phase14_active_command_ownership.md` |
| Browser primitive parity | `devlog/_fin/mvp/06_browser_primitives/16_phase15_browser_primitives.md` |
| Semantic resolver | `devlog/_fin/mvp/07_semantic_resolver/17_phase16_semantic_resolver.md` |
| ActionIntent target resolver | `devlog/_fin/mvp/07_semantic_resolver/29_action_intent_target_resolver.md` |
| ChatGPT composer resolver integration | `devlog/_fin/mvp/07_semantic_resolver/30_chatgpt_composer_resolver.md` |
| ChatGPT send resolver integration | `devlog/_fin/mvp/07_semantic_resolver/31_chatgpt_send_resolver.md` |
| ChatGPT upload resolver integration | `devlog/_fin/mvp/07_semantic_resolver/32_chatgpt_upload_resolver.md` |
| ChatGPT copy resolver integration | `devlog/_fin/mvp/07_semantic_resolver/33_chatgpt_copy_resolver.md` |
| ChatGPT send resolver trace | `devlog/_fin/mvp/07_semantic_resolver/34_chatgpt_send_resolver_trace.md` |
| ChatGPT copy resolver trace | `devlog/_fin/mvp/07_semantic_resolver/35_chatgpt_copy_resolver_trace.md` |
| ChatGPT reasoning effort resilience | `devlog/_fin/mvp/07_semantic_resolver/36_chatgpt_reasoning_effort_resilience.md` |
| Provider contracts and source audit | `devlog/_fin/mvp/08_provider_contracts/18_phase17_provider_contracts_source_audit.md` |
| Answer artifact and source audit foundation | `devlog/_fin/mvp/08_provider_contracts/25_answer_artifact_source_audit.md` |
| Provider answer artifacts | `devlog/_fin/mvp/08_provider_contracts/26_provider_answer_artifacts.md` |
| Source audit enforcement | `devlog/_fin/mvp/08_provider_contracts/28_source_audit_enforcement.md` |
| MCP and AI SDK hardening | `devlog/_fin/mvp/03_mcp_bridge/19_phase18_mcp_ai_sdk_hardening.md` |
| Benchmark trajectory | `devlog/_fin/mvp/09_benchmarks/21_phase20_benchmarks.md` |
| Release gates | `devlog/_fin/mvp/10_release_gates/22_phase21_release_gates.md` |

## 변경 기록

- 2026-05-14: ChatGPT model selection evidence가 session metadata와 `sessions show` human output에 저장/표시되는 계약으로 바뀌었고, 실제 작동 취약점 register를 `structure/stability-upgrade/`에 분리했다.
- 2026-05-27: Runway runtime 계약을 추가했다. Poll은 Playwright/CDP DOM read-only 기반이고, right-rail `%` progress를 active signal로 취급하며 explicit queue gate만 terminal `queue_full`로 판정한다.
- 2026-05-05: browser/session/provider/policy/trace/MCP/eval contract를 release claim과 devlog phase에 연결했다.
