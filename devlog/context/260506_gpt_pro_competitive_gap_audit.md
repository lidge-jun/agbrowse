---
created: 2026-05-06
phase: post-mvp
tags: [agbrowse, gap-audit, vercel-agent-browser, stagehand, playwright-mcp, browser-use, gpt-pro]
source: ChatGPT Pro (gpt-5-pro) live web audit
session: 01KQXSXEK37JF2320QXB3EH81B
---

# 2026-05- GPT Pro competitive gap audit (post-Phase 22 MVP)06 

GPT Pro audited agbrowse Phase 22 closeout state against Vercel Labs
agent-browser, Stagehand, Playwright MCP, browser-use, AgentQL, and the
WebVoyager / WebArena / VisualWebArena / Mind2Web benchmark families. 11 gaps
returned (G01..G11) with a recommended file-and-ship order. **VERDICT:
READY_TO_FILE_ISSUES.**

Forbidden scope (kept out of every gap): hosted/cloud runtime, stealth/CAPTCHA
bypass, external CDP, leaderboard score claims, MCP scope unfreeze.

Recommended issue order:
1.  Cloud-runtime positioning gap (claim guardrails first)G10 
2.  MCP frozen-scope decision recordG04 
3.  observe()-style action candidate APIG02 
4.  Unified multimodal observation bundleG06 
5.  Generic action breadthG03 
6.  Local replay/observability timelineG11 
7.  Persistent action memory / repeatable cacheG07 
8.  First-party autonomous planner loopG01 
9.  Schema-bound page extractionG05 
10.  Model-adapter surface for planner/extractorG09 
11.  Reference benchmark adapters (no score claim)G08 

---

Live-source audit date: 2026-05-06. I treated the provided Phase 22 truth tables as the agbrowse/cli-jaw source of truth and used live competitor sources only for the landscape check. I am not recommending hosted/cloud runtime, stealth/CAPTCHA bypass, external CDP, leaderboard score claims, or unfrozen production MCP tools; those remain explicitly forbidden or deferred in the current agbrowse status tables. agbrowse’s own repo also presents narrow MCP, offline trajectory writing, and deferred hosted/cloud / remote-CDP / leaderboard claims as current release boundaries. 
GitHub
+1

Section A — Gap inventory
ID	Gap title	Severity	vs competitor	Category	One-line summary
G01	First-party autonomous planner loop	P0	Stagehand, browser-use	planner	agbrowse exposes primitives and provider send/poll flows, but not a local goal → observe → act → verify task runner.
G02	observe()-style action candidate API	P0	Stagehand, AgentQL	observation	agbrowse snapshots refs, but lacks a structured candidate-action layer with method/args/confidence.
G03	Generic action breadth	P0	Vercel agent-browser, Playwright MCP	actions	Core local CLI is narrower than competitor form, scroll, drag/drop, upload, wait, and multi-field action sets.
G04	MCP parity intentionally frozen below mainstream MCP	P0	Microsoft Playwright MCP	mcp	Playwright MCP exposes broad browser tools; agbrowse intentionally exposes only browser_snapshot and browser_click_ref.
G05	Schema-bound page extraction	P1	Stagehand, AgentQL	observation	text/get-dom and answer artifacts are not the same as active-page extraction into a validated JSON schema.
G06	Unified multimodal observation bundle	P1	Playwright MCP, VisualWebArena, Vercel agent-browser	observation	Screenshot, refs, boxes, DPR, viewport, URL, and text are not emitted as one replayable observation artifact.
G07	Persistent action memory / repeatable action cache	P1	Stagehand, AgentQL	reliability	agbrowse has resolver/self-heal pieces, but not a validated action cache keyed by page signature.
G08	Reference benchmark adapters without score claims	P1	WebVoyager, WebArena, VisualWebArena, Mind2Web, Browser Use Cloud	bench	agbrowse can write offline trajectories, but lacks adapters for the named benchmark task formats.
G09	Model-adapter surface for planner/extractor	P1	Stagehand, browser-use	provider-coverage	agbrowse web-AI is provider-UI oriented; competitors expose cleaner LLM/model adapter surfaces for agent loops.
G10	Cloud-runtime positioning gap, not an implementation gap	P1	Vercel Browserbase/Browser Use integrations, Browserbase, Browser Use Cloud	docs	Competitors market cloud sessions; agbrowse must explicitly position local-CDP only and gate against accidental cloud claims.
G11	Local replay/observability timeline	P1	Browserbase observability, Stagehand logging	dx	agbrowse trace evidence is ready, but competitor-style session replay/action timeline is still missing as a local artifact.
Section B — Per-gap detail blocks
G01 — First-party autonomous planner loop

Evidence (competitor side): URL: https://github.com/browserbase/stagehand — quote: “Use agent() for multi-step tasks.” Stagehand also frames agent() beside act() and extract() in its example workflow. 
GitHub

Evidence (agbrowse side): README.md:491-495 documents the manual “snapshot → act → snapshot → verify” loop; README.md:509-516 documents web-ai render/status/send/poll/query, but no first-party local planner command. 
GitHub
+1

Why this matters: Mainstream browser-agent users expect a single task-level loop, not just primitives. Without a planner loop, agbrowse is strong as a browser remote/control layer but weaker as an end-to-end web agent.
Proposed scope, respecting forbidden list:

web-ai/planner-loop.mjs — add an experimental local-only observe/act/verify loop with max-step, timeout, and stop-condition controls.

web-ai/planner-contract.mjs — define JSON schema for objective, observationId, candidateAction, expectedSignal, verification, and finalAnswer.

skills/browser/browser.mjs — add task-run --experimental --max-steps N --json, using only local CDP.

web-ai/policy/planner-policy.mjs — require policy checks before mutating actions and fail closed on destructive forms/uploads.

structure/commands.md — document the planner as experimental and explicitly not a hosted/cloud/stealth runtime.

structure/release_gates.md — add gate:planner-loop-local with fixture tasks and no external credentials.
Test surface: test/unit + test/integration + test/eval.
cli-jaw mirror impact: parity required if marketed cross-repo; otherwise parity optional while experimental.
Acceptance gate: keep gate:truth-table-fresh; add gate:planner-loop-local and gate:no-cloud-claims.
Estimate: L, 4+ days.

G02 — observe()-style action candidate API

Evidence (competitor side): URL: https://docs.stagehand.dev/v3/basics/observe — quote: “discovers actionable elements.” Stagehand says observe() returns structured actions that can be validated before execution. 
Stagehand

Evidence (agbrowse side): README.md:446-463 lists low-level observe/act commands; web-ai/browser-tool-schema.mjs:37-56 exposes browser_snapshot and browser_click_ref, not a candidate-action API. 
GitHub
+1

Why this matters: A planner needs more than a raw snapshot; it needs ranked possible actions with semantics, method, arguments, and risk flags. This is the gap between “browser remote” and “agent-ready observation.”
Proposed scope, respecting forbidden list:

web-ai/observe-actions.mjs — build candidate actions from accessibility snapshot, visible text, forms, and element roles.

web-ai/target-resolver.mjs — expose resolver confidence, matched signals, and failure reasons as structured metadata.

web-ai/action-intent.mjs — map natural-language intents to candidate action verbs and required fields.

skills/browser/browser.mjs — add observe-actions "<instruction>" --json.

structure/commands.md — document ActionCandidate[] schema with refs scoped to latest snapshot.

structure/release_gates.md — add gate:observe-actions-fixtures.
Test surface: test/unit + test/eval.
cli-jaw mirror impact: parity required, because target resolver/action-intent are mirrored surfaces.
Acceptance gate: keep gate:truth-table-fresh; add gate:observe-actions-fixtures.
Estimate: M, 2–3 days.

G03 — Generic action breadth

Evidence (competitor side): URL: https://github.com/vercel-labs/agent-browser — quote: “Actions: click, fill, type, hover, focus, check, uncheck.” Vercel’s CLI also documents drag, upload, scroll, wait, cookies, storage, and network commands. 
GitHub

Evidence (agbrowse side): README.md:456-463 lists click, type, press, hover, mouse-click, resize, and evaluate; the provided truth table marks broader MCP browser tools as deferred. 
GitHub
+1

Why this matters: Agent loops regularly hit selects, checkboxes, file inputs, scroll containers, dynamic waits, and drag/drop. Missing action breadth forces fragile JS evaluation or manual workarounds.
Proposed scope, respecting forbidden list:

skills/browser/browser.mjs — add local-CDP select, check, uncheck, scroll, wait-for, drag, and upload commands.

web-ai/action-intent.mjs — add semantic intents for select/check/scroll/wait/upload/drag.

web-ai/target-resolver.mjs — add diagnostics for selectable state, checkbox state, file input eligibility, and scrollability.

web-ai/policy/browser-action-policy.mjs — classify uploads and destructive form actions behind existing policy enforcement.

structure/commands.md — add a local browser primitive matrix, clearly separate from frozen MCP scope.

structure/release_gates.md — add gate:browser-primitives-complete.
Test surface: test/unit + test/integration.
cli-jaw mirror impact: parity required for any public cross-repo browser-primitive claim.
Acceptance gate: keep gate:mcp-scope-frozen; add gate:browser-primitives-complete.
Estimate: L, 4+ days.

G04 — MCP parity intentionally frozen below mainstream MCP

Evidence (competitor side): URL: https://github.com/microsoft/playwright-mcp — quote: “Core automation.” Playwright MCP lists tools including browser_click, browser_navigate, browser_snapshot, browser_type, browser_wait_for, tabs, network, storage, and screenshots. 
GitHub
+2
GitHub
+2

Evidence (agbrowse side): structure/phase_status.md:256-269 says MCP/AI SDK is partial and forbids production MCP claims beyond listed tools; web-ai/browser-tool-schema.mjs:37-56 registers only browser_snapshot and browser_click_ref. 
GitHub
+1

Why this matters: MCP-native clients will compare agbrowse directly with Playwright MCP and see the missing browser tools as a parity blocker. The current product rule is valid, but it needs crisp decision records and probe-safe failure behavior.
Proposed scope, respecting forbidden list:

structure/mcp_scope.md — add decision record: frozen tools, competitor diff, explicit unfreeze criteria, and non-goals.

web-ai/browser-tool-schema.mjs — export DEFERRED_BROWSER_TOOLS metadata with reason and CLI equivalent, but do not register them.

web-ai/mcp-server.mjs — return deterministic capability.unsupported envelopes for any probed deferred tool.

skills/browser/SKILL.md — add MCP-vs-CLI guidance for agents that want browser control.

structure/commands.md — add MCP-ready vs CLI-ready matrix.

structure/release_gates.md — keep gate:mcp-scope-frozen; add gate:mcp-deferred-metadata.
Test surface: test/unit + test/integration.
cli-jaw mirror impact: none, because cli-jaw does not expose browser MCP tools.
Acceptance gate: keep gate:mcp-scope-frozen; add gate:mcp-deferred-metadata.
Estimate: M, 2–3 days.

G05 — Schema-bound page extraction

Evidence (competitor side): URL: https://github.com/tinyfish-io/agentql — quote: “Structured output defined by the shape of your query.” AgentQL also documents SDKs, REST API, natural-language selectors, and browser debugger tooling. 
GitHub

Evidence (agbrowse side): README.md:446-454 provides text, text --format html, get-dom, console, and network; README.md:699-710 provides source audit for completed answers, not active-page schema extraction. 
GitHub
+1

Why this matters: Many browser-agent tasks are extraction tasks, not just click tasks. A schema contract lets tests assert exact output shape and prevents “looks plausible” scraping results.
Proposed scope, respecting forbidden list:

web-ai/extract-schema.mjs — add active-page extraction contract with JSON Schema/Zod-like shape validation.

web-ai/answer-artifact.mjs — add pageExtraction artifact type with URL, selector scope, schema, and validation result.

skills/browser/browser.mjs — add extract --schema <file> --selector <selector> --json.

web-ai/source-audit.mjs — allow extraction provenance from URL, selector, timestamp, and text span evidence.

structure/commands.md — document extract output and fail-closed schema errors.

structure/release_gates.md — add gate:extract-schema-fixtures.
Test surface: test/unit + test/eval.
cli-jaw mirror impact: parity optional until cli-jaw publicly claims page-extraction parity.
Acceptance gate: keep gate:truth-table-fresh; add gate:extract-schema-fixtures.
Estimate: M, 2–3 days.

G06 — Unified multimodal observation bundle

Evidence (competitor side): URL: https://github.com/web-arena-x/visualwebarena — quote: “visual tasks.” VisualWebArena targets multimodal agents, while Playwright MCP snapshots can include bounding boxes and screenshots. 
GitHub
+1

Evidence (agbrowse side): README.md:446-454 exposes snapshot, screenshot, text, DOM, console, and network separately; README.md:496-503 documents vision-click, but not one combined observation bundle. 
GitHub
+1

Why this matters: Visual and multimodal benchmarks require screenshot-grounded action decisions, not just a DOM snapshot. A bundle also makes failures reproducible because refs, boxes, DPR, and screenshot are captured together.
Proposed scope, respecting forbidden list:

web-ai/observation-bundle.mjs — emit URL, title, viewport, DPR, snapshot refs, bounding boxes, screenshot path, and text summary.

skills/browser/browser.mjs — add observe --bundle --screenshot --boxes --json.

web-ai/target-resolver.mjs — accept bundle refs and boxes for safe coordinate fallback.

web-ai/trace/observation-redactor.mjs — redact sensitive text from stored bundles according to existing trace policy.

structure/commands.md — define ObservationBundleV1.

structure/release_gates.md — add gate:observation-bundle-fixtures.
Test surface: test/unit + test/integration + test/eval.
cli-jaw mirror impact: parity optional unless cli-jaw claims observation-bundle parity.
Acceptance gate: keep trace redaction gates; add gate:observation-bundle-fixtures.
Estimate: M, 2–3 days.

G07 — Persistent action memory / repeatable action cache

Evidence (competitor side): URL: https://docs.stagehand.dev/v3/best-practices/caching — quote: “Cache actions automatically.” AgentQL also markets resilience to UI changes. 
Stagehand
+1

Evidence (agbrowse side): The truth table marks web-ai/self-heal.mjs ready, so the gap is not “no self-heal”; the gap is persistent replay/action memory. README.md:491-495 also says refs are scoped to the latest snapshot. 
GitHub

Why this matters: Repeat workflows should get faster and more reliable when the same page/action recurs. Without validated memory, every run pays the full observation and resolver cost again.
Proposed scope, respecting forbidden list:

web-ai/action-memory.mjs — store action intent, origin, DOM signature, target evidence, and last-good selector/ref.

web-ai/self-heal.mjs — consult memory only after signature validation; fall back to resolver on mismatch.

web-ai/target-resolver.mjs — emit cache hit/miss, validation signals, and replay reason codes.

skills/browser/browser.mjs — add action-memory list, action-memory clear, and --no-action-memory.

structure/commands.md — document cache as experimental and non-authoritative.

structure/release_gates.md — add gate:action-memory-safe-replay.
Test surface: test/unit + test/eval.
cli-jaw mirror impact: parity required if resolver/cache behavior is claimed cross-repo.
Acceptance gate: keep semantic resolver gates; add gate:action-memory-safe-replay.
Estimate: M, 2–3 days.

G08 — Reference benchmark adapters without score claims

Evidence (competitor side): URL: https://github.com/browser-use/online-mind2web — quote: “300 real-world web navigation tasks.” Browser Use publishes an Online-Mind2Web runner and results; WebVoyager, WebArena, VisualWebArena, and Mind2Web define widely referenced task formats. 
OSU NLP Group
+4
GitHub
+4
GitHub
+4

Evidence (agbrowse side): structure/phase_status.md:258 says Phase 20 is ready for trajectory bundles only; structure/phase_status.md:267-269 forbids leaderboard/competitor benchmark claims. 
GitHub

Why this matters: Bench adapters let agbrowse collect apples-to-apples trajectories before making any score claim. This creates a path to future evaluation without violating the current no-leaderboard rule.
Proposed scope, respecting forbidden list:

web-ai/eval-adapters/webvoyager.mjs — convert WebVoyager JSONL tasks into dry-run/local trajectory jobs.

web-ai/eval-adapters/webarena.mjs — add environment reset/trajectory hooks only; no score publication.

web-ai/eval-adapters/visualwebarena.mjs — require ObservationBundleV1 and fail closed without screenshots/boxes.

web-ai/eval-adapters/mind2web.mjs — map action-sequence tasks to trace replay/evidence format.

bin/agbrowse-eval — add --dry-run, --limit, --write-trajectory, and --no-score defaults.

structure/benchmarks.md — restate fixed model/planner/env/task-set prerequisites before any score claim.
Test surface: test/eval.
cli-jaw mirror impact: none; cli-jaw can consume trajectory bundles later.
Acceptance gate: keep benchmark trajectory gate; add gate:benchmark-adapters-no-score.
Estimate: L, 4+ days.

G09 — Model-adapter surface for planner/extractor

Evidence (competitor side): URL: https://github.com/browser-use/browser-use — quote: “Can I use custom tools with the agent? Yes.” Browser Use exposes custom tools and model choices, while Stagehand documents model configuration for agent/tool execution. 
GitHub
+1

Evidence (agbrowse side): README.md:517-524 documents provider UI coverage for ChatGPT, Gemini, and Grok; no separate local planner/extractor LLM adapter contract is listed. 
GitHub

Why this matters: A planner and extractor need a stable JSON-producing model interface independent of live provider web UIs. Without it, local agent loops remain coupled to browser-provider DOM churn.
Proposed scope, respecting forbidden list:

web-ai/model-adapters/index.mjs — define minimal generateJson() and generateText() contracts.

web-ai/model-adapters/openai-compatible.mjs — optional BYO endpoint adapter; no hosted browser or stealth behavior.

web-ai/planner-loop.mjs — accept --llm-adapter for planning only, with schema validation.

web-ai/extract-schema.mjs — accept adapter-backed extraction with strict JSON validation.

skills/browser/browser.mjs — expose --planner-model and --extract-model flags as experimental.

structure/providers.md — distinguish web-UI providers from model adapters and forbid account-access guarantees.
Test surface: test/unit + test/integration.
cli-jaw mirror impact: parity optional until cli-jaw exposes planner/extractor model flags.
Acceptance gate: add gate:model-adapter-contracts; keep provider fail-closed gates.
Estimate: L, 4+ days.

G10 — Cloud-runtime positioning gap, not an implementation gap

Evidence (competitor side): URL: https://github.com/vercel-labs/agent-browser — quote: “Browserbase session instead of launching a local browser.” Vercel also documents Browser Use cloud-session integration, while Browser Use markets a fully hosted cloud agent. 
GitHub
+1

Evidence (agbrowse side): README.md:347-352 marks hosted/cloud browser operation, remote external-CDP, broader MCP, and leaderboard claims as experimental/deferred; structure/phase_status.md:257-269 forbids hosted/cloud/external-CDP and benchmark-score claims. 
GitHub
+1

Why this matters: The market increasingly treats cloud browser infrastructure as table stakes, so agbrowse will look “behind” unless the non-goal is explicit. The right issue is positioning and claim enforcement, not adding cloud runtime.
Proposed scope, respecting forbidden list:

structure/comparison.md — add “local-CDP only” comparison against Browserbase, Browser Use Cloud, and Vercel provider flags.

structure/production_readiness.md — add deployment guidance for local/headed/CI use without remote CDP.

skills/browser/SKILL.md — add first-run note: no stealth, no CAPTCHA bypass, no hosted/cloud runtime.

web-ai/doctor.mjs — add --claim-audit checks for forbidden cloud/stealth/external-CDP phrasing.

bin/agbrowse — ensure --help includes “local CDP only” and points to comparison docs.

structure/release_gates.md — add gate:no-cloud-claims.
Test surface: test/unit.
cli-jaw mirror impact: parity required for claim text and skill-surface wording.
Acceptance gate: keep gate:truth-table-fresh; add gate:no-cloud-claims.
Estimate: S, 1 day.

G11 — Local replay/observability timeline

Evidence (competitor side): URL: https://docs.browserbase.com/platform/browser/observability/observability — quote: “Replay every session as a video recording.” Browserbase also surfaces events, network logs, console logs, and Stagehand-call details in session inspection. 
Browserbase Documentation

Evidence (agbrowse side): The truth table marks trace evidence ready, so the gap is not “no trace.” The gap is competitor-style local replay/timeline correlation across browser actions, observations, screenshots, console, and network; current README exposes those commands separately at README.md:446-454. 
GitHub

Why this matters: Debugging agent failures needs one timeline, not scattered command outputs. A local replay artifact also supports benchmark/eval review without claiming Browserbase-style cloud observability.
Proposed scope, respecting forbidden list:

web-ai/trace/action-timeline.mjs — record command, target, policy result, timestamp, URL, and outcome.

web-ai/trace/browser-snapshot-writer.mjs — attach redacted observation bundles and screenshots to trace IDs.

skills/browser/browser.mjs — add --trace-id support to observe and mutate commands.

web-ai/trace/render-html.mjs — render local HTML report with screenshots, console, network summaries, and redactions.

structure/trace_evidence.md — document local replay artifacts and retention rules.

structure/release_gates.md — add gate:trace-browser-actions.
Test surface: test/unit + test/integration.
cli-jaw mirror impact: none; cli-jaw does not mirror trace.
Acceptance gate: keep trace redaction gates; add gate:trace-browser-actions.
Estimate: M, 2–3 days.

Section C — Recommended issue order

G10 — Claim guardrails first, so later issues do not accidentally imply hosted/cloud, stealth, or external-CDP support.

G04 — Freeze-compatible MCP decision work next, because it prevents MCP parity confusion while other CLI work proceeds.

G02 — Candidate actions are the foundation for planner, cache, extraction, and benchmark adapters.

G06 — Observation bundles make G02 usable for visual tasks and produce better trace/eval evidence.

G03 — Broader local actions unlock practical task coverage once observation can identify targets.

G11 — Trace/replay timeline should land before planner and benchmark runs generate lots of artifacts.

G07 — Action memory depends on candidate actions, richer target metadata, and trace validation.

G01 — Planner loop depends on observe-actions, broader actions, policy gates, and trace evidence.

G05 — Schema extraction can reuse observation bundles and model-adapter contracts, but can ship independently after basics.

G09 — Model adapters are useful once planner/extractor contracts exist; keep experimental until validated.

G08 — Benchmark adapters come last because they should consume stable observation, action, planner, and trace formats without publishing scores.

Section D — VERDICT

READY_TO_FILE_ISSUES

Caveat for filing: G04 is not an implementation issue for broader MCP tools under the current Phase 22 frozen scope. File it as documentation, metadata, and fail-closed behavior only unless the project intentionally unfreezes MCP in the truth table first.