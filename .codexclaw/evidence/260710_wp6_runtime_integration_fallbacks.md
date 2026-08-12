# WP6 Evidence: Runtime Integration Fallbacks

Date: 2026-07-10
Worker: C (WP6)
Branch: dev

## Verification Commands & Results

### 1. Scoped test run (10 relevant suites)

```
npx vitest run test/unit/web-ai-tab-inspect.test.mjs \
  test/unit/web-ai-observation-presets.test.mjs \
  test/unit/web-ai-capability-registry.test.mjs \
  test/unit/web-ai-doctor.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-gemini-contract.test.mjs \
  test/unit/web-ai-self-heal.test.mjs \
  test/unit/web-ai-session-doctor.test.mjs \
  test/unit/web-ai-provider-session.test.mjs \
  test/unit/web-ai-auto-start.test.mjs
```

**Result: Test Files 10 passed (10), Tests 126 passed (126)**

### 2. git diff --check (whitespace)

```
git diff --check HEAD -- web-ai/ test/unit/
```

**Result: EXIT 0, no issues**

### 3. Full unit suite

```
npx vitest run test/unit/
```

**Result: Test Files 1 failed | 138 passed (139), Tests 30 failed | 1132 passed (1162)**

The 30 failures are all in `test/unit/web-ai-chatgpt-model.test.mjs` (Worker A's file),
caused by `chatGptLegacyMenuRootOpenedByComposer` not yet being defined in Worker A's
in-flight `web-ai/chatgpt-model.mjs`. None of Worker C's files are involved.

## Files Changed (8 modified + 2 created)

| File | Change |
|------|--------|
| web-ai/capability-observation-presets.mjs | Replaced legacy model-switcher-* with composer-scoped Intelligence picker selectors as primary; legacy kept as fallbacks; updated textCandidates/activationPath/activeStateSignals/notes |
| web-ai/capability-registry.mjs:241 | Updated chatgpt-model-selection commandBehavior for 2-axis family+tier |
| web-ai/doctor.mjs:8,19-21 | Import observation presets + surface/work selectors; model-picker uses preset candidates; added work-surface feature |
| web-ai/tab-inspect.mjs:20,32-82,92-93,136,199 | Replaced modelEl with readChatGptTabModelSelection(); emits {surface,familyLabel,tierLabel,verified}; added to typedef/inspectTab/collectTabs stub |
| web-ai/vendor-editor-contract.mjs:116 | modelPicker names lead with exact tier/family labels; added excludeNames |
| web-ai/cli-sessions.mjs:292-296 | Added taskId/taskUrl/responseContract to evidence output line |
| test/unit/web-ai-doctor.test.mjs | Feature count 6->7, added work-surface to expected list |
| test/unit/web-ai-sessions-command.test.mjs | Updated expected evidence string with new fields |
| test/unit/web-ai-tab-inspect.test.mjs (NEW) | 13 tests: classifyTabState + INSPECT_EXPRESSION structural contract |
| test/unit/web-ai-observation-presets.test.mjs (NEW) | 14 tests: presets/registry/doctor/vendor-editor contract verification |

## Unmet Dependencies on Worker A Symbols

- `chatGptLegacyMenuRootOpenedByComposer` referenced in chatgpt-model.mjs:566 but not yet
  defined — causes 30 failures in Worker A's test file only, not our files.
- Section 2 (After 1/After 2) probe changes to chatgpt-model.mjs and chatgpt.mjs are
  Worker A's scope. Our observation/diagnostic/inspect/evidence consumers are wired and
  ready for those probe-level changes.

## Plan Compliance (06 Completion Conditions)

| Condition | Status | Evidence |
|-----------|--------|----------|
| (a) 5.6 family+tier Chat probe ok without legacy testids | DEFERRED to Worker A (probe in chatgpt-model.mjs) | Observation presets + inspect wired |
| (b) Chat cmd toggle+Work/ambiguous/unverified = fail | DEFERRED to Worker A (probe logic) | Tab inspect + doctor surface detection wired |
| (c) Work send preflight ok distinct from Chat fail | DEFERRED to Worker A (probe logic) | Session evidence format ready with taskId/taskUrl/responseContract |
| (d) Toggle-absent legacy = warn+warning | DEFERRED to Worker A (probe logic) | Legacy fallback selectors preserved in presets and tab-inspect |
| (e) Closed-menu tab inspect: no family synthesis, verified=false | PASS | readChatGptTabModelSelection: surface=null when no toggle, verified=false when family/tier absent |
| (f) Session output: surface/family/tier/taskId/taskUrl/responseContract | PASS | formatBrowserEvidenceLines updated, test assertion verified |
| (g) Legacy 5.5 session + selector backward compat | PASS | legacy fallback test in sessions-command, legacy selectors in presets |

## Judgement

All 06-owned source changes are applied. All 126 scoped tests pass. The 30 full-suite
failures are Worker A's in-flight edits (chatGptLegacyMenuRootOpenedByComposer undefined).
06 completion conditions (e), (f), (g) are fully verified. Conditions (a)-(d) depend on
Worker A's probe implementation in chatgpt-model.mjs/chatgpt.mjs — our consumer side is
wired and ready.
