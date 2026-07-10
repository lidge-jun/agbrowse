# WP1 live ChatGPT Work probe

Date: 2026-07-10 KST
Account/surface: logged-in ChatGPT Pro, English UI, web Work
Method: in-app Browser discovery; agbrowse CDP/profile audit; authenticated Chrome Computer Use mutation; Chrome DOM read-back
Prompt nonce: `WORK_PROBE_260710_0819`
Task URL: `https://chatgpt.com/c/6a50ae48-7b4c-83ee-bc86-5f3228cad8be`

## Safety envelope

- One submission only, Power 1 / Standard.
- The prompt explicitly prohibited browsing, apps, tools, files, repositories, projects, attachments, approvals, and external actions.
- No project, attachment, plugin, or app was selected.
- Only agent-created verification tabs were closed. The user's original ChatGPT tab was retained and Work was restored to Power 2 / Standard.

## Five base checks

| ID | Result | Evidence | Implementation consequence |
| --- | --- | --- | --- |
| W01 | PASS | Public Power 1..6 mapped to DOM 0..5: Terra Light; Sol Light; Sol Medium; Sol High; Sol Extra High; Sol Ultra. | Normalize public input to 1..6 and translate to zero-based slider state. |
| W02 | PASS | Model options Sol/Terra/Luna/5.5; Effort Light/Medium/High/Extra High/Max/Ultra; Speed Standard/Fast. High produced `5.6 Sol High, 4 of 6`; Fast did not change Power. | Power and speed are independent; Max is Advanced-only. |
| W03 | PASS | Chat retained Pro while Work retained Sol Light / Power 2 / Standard across Chat→Work→Chat→Work. | Omitted family/speed must preserve current UI state. |
| W04 | PASS | Commit state exposed user turn, `Thinking`, `Stop answering`, Task details, Outputs and Sources. Complete state exposed exact nonce and response actions with Stop absent. | Work needs a dedicated running/complete response adapter. |
| W05 | PASS | Exactly one open picker root was observed. Simple and Advanced view markers coexist in that root; Chat/Work radios are the authoritative surface discriminator. | Do not infer surface from shared picker testids alone. |

## Ten reverse-engineering checks

| ID | Result | Evidence | Implementation consequence |
| --- | --- | --- | --- |
| R01 | PASS | Active Work had one composer form, visible `#prompt-textarea` / `Chat with ChatGPT` textbox, one scoped send button, and `Work on anything` content. Switching surfaces replaced the active composer. | Resolve composer and send inside the active Work root only. |
| R02 | PASS | Root URL changed to `/c/6a50ae48-7b4c-83ee-bc86-5f3228cad8be`; the same URL restored after a fresh-tab reload. | Persist full task URL and path UUID with `surface:'work'`. |
| R03 | PASS | Immediately after submit, the user message, Copy message action, Task details panel, assistant `Thinking`, and Stop button were present. | Treat committed user turn plus running evidence as submit success, not completion. |
| R04 | PASS (bounded) | Required running and complete states were observed. Conditional blocked/failed/approval/retry states did not naturally occur and were not induced, exactly as the plan required; no selector is claimed for them. | Implement explicit known running/complete evidence; every other state is typed `unknown` and fails closed until activation evidence exists. |
| R05 | PASS | `Thinking` plus Stop preceded the final nonce. No acknowledgement was mistaken for completion. | Completion requires stable final output and Stop absence. |
| R06 | PASS | Final assistant output was a paragraph under `ChatGPT said:` with Copy response, Share, Switch model, and More actions. | Scope answer extraction to the Work assistant turn and prefer final response actions as completion evidence. |
| R07 | PASS (completed only) | Agent-created tab A loaded the completed task URL, was closed, and agent-created tab B reopened it; prompt, nonce, Work banner, Task details, Outputs and Sources returned. | Completed Work results can reattach by task URL. Running-task target loss/re-entry remains unverified and must fail closed. |
| R08 | PASS | Slider attributes: min 0, max 5; Left/Right changed one step; extra Right clamped at max; Home/End did not change value; picker reopen retained the selected value. | Use bounded Arrow transitions and verify every post-state; do not rely on Home/End. |
| R09 | PASS | Fast/Standard did not change Power. Advanced Effort High remapped compact Power to 4 of 6. | Speed mutation is independent; Advanced model/effort can deterministically rewrite the Power preset. |
| R10 | PASS (baseline/exclusion) | Choose project, Plugins, Add files, Create file or site, and Add sources were visible. The row's required no-project/no-attachment baseline was captured; excluded mutations were intentionally not exercised. | Exclude project/attachment/plugin activation from v1 and prevent these controls from matching composer/send selectors. |

## Method steering

`agbrowse doctor` and headed CDP startup succeeded, but the agbrowse profile was not authenticated and redirected to Google sign-in. After the user explicitly changed the method to agbrowse CDP plus Computer Use, the authenticated browser profile was operated through Computer Use and read back through the Chrome DOM. Public OpenAI sources were independently fetched through agbrowse. This is the formally amended authentication-profile split, not a CDP startup failure.

## Gate verdict

All 15 rows are PASS under their row-specific bounded claims. WP1 picker, submit, completion, identity, and completed-result re-entry contracts are sufficient to begin fixture-first implementation. Live blocked/failed selectors, running-task re-entry, and project/attachment/plugin identity effects remain explicitly outside the v1 happy-path contract and must fail closed rather than guess.
