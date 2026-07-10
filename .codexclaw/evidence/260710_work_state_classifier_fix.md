# Work state classifier fix (round 3, coordinator)

Date: 2026-07-10 KST
Live session: 01KX64ZVHW6W983XK9K2GCEA8B (task /c/6a50f9cc-c958-83e8-b820-d0d0ca5d83eb)

## Bug
readWorkTaskState matched running-state indicators page-wide:
- getByText('Thinking', { exact: false }) matched the sidebar history title
  "SMOKE_C3_THINKING_OK" (case-insensitive substring), classifying a completed
  task as running forever (work-poll-timeout at 240s and 60s).
- Verified live: main area had no Thinking text and zero Stop buttons while
  Copy response/Share/Switch model/Task details/Outputs were all present.

## Fix
Scope stop/thinking/copy/assistant-turn lookups to the main conversation
region (page.locator('main')), with a fallback to the page object when the
region lacks sub-locator support (unit-test fakes). Thinking match tightened
to exact.

## Verification
- Unit: test/unit/web-ai-chatgpt-work-picker.test.mjs 51/51 green.
- Live: poll --session 01KX64ZVHW6W983XK9K2GCEA8B returned
  {status: "complete", answerText: "SMOKE_C2_ROUND3_OK"} immediately.
