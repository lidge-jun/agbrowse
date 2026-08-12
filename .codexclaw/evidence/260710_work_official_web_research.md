# ChatGPT Work official web-capability research

Cutoff: 2026-07-10 KST
Method: cxc-search Tier 3, three independent GPT-5.6 Sol/medium lanes plus one disconfirmation wave. Search snippets were discovery-only. Claims below were verified against opened official OpenAI originals; key pages were also fetched through `agbrowse fetch`.

## Date verdict

The launch post and GPT-5.6 post are dated **2026-07-09**. OpenAI's RSS timestamp for the launch is 10:00 UTC, or 19:00 KST. The feature was therefore not published on July 10 in Seoul. Help Center pages were updated during July 10 KST and rollout was still progressing.

## Capability ledger

| Capability | Web Work contract | Boundary | Primary source |
| --- | --- | --- | --- |
| Long, multi-step work | Research, analysis, workflows, and finished documents, spreadsheets, presentations, reports, and Sites; users can follow, steer, answer questions, and approve actions. | Work and Codex share agentic usage/credits; duration and consumption vary by task. | [Launch post](https://openai.com/index/chatgpt-for-your-most-ambitious-work/), [Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) |
| Cloud browser | Opens public websites, gathers current information, compares options, inspects interactive pages, and takes supported website actions. Task details exposes browser progress/screenshots/replay. | Isolated from the device browser; public signed-out sites only; no credentials, device tabs/history/extensions/passwords; CAPTCHA and automation blocks may stop it. | [Browser for web](https://learn.chatgpt.com/docs/browser?surface=web) |
| Web search | Searches current public information and returns citations/source links. | Retrieval only; availability and workspace settings apply. | [Web search](https://learn.chatgpt.com/docs/web-search?surface=web), [ChatGPT Search](https://help.openai.com/en/articles/9237897-chatgpt-search) |
| Connected apps/plugins | Reads/searches/syncs external data and may create or update records, files, messages, permissions, purchases, or other app-defined resources. | Default `Important actions` permits reads and asks for meaningful, sensitive, or difficult-to-reverse actions; admins can require more approvals or restrict actions/parameters. Some high-risk actions are blocked. | [Apps in ChatGPT](https://help.openai.com/en/articles/11487775-apps-in-chatgpt), [Plugins](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex) |
| Files and native office artifacts | Creates and edits documents, sheets, slides, reports, analyses, and PDFs. With enabled Google Workspace apps, can create/edit native Docs, Sheets, and Slides. | Format, app, role, plan, workspace and file limits apply; external writes follow app approval policy. | [Creating files with Work](https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work) |
| Sites | Creates, previews, refines, deploys, shares, publishes, updates, restricts, and deletes interactive sites/lightweight apps at production URLs. | Public beta; paid plans except Free/Go; EEA, Switzerland and UK excluded at launch; Enterprise public publishing off by default. | [ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites) |
| Scheduled work | Runs once, recurs, reacts to triggers, or monitors changes; can use enabled apps/browser and notify users. | This is the documented deferred/background contract. It may pause for approval, inactivity or deleted context, and runs at most hourly. Published plan/active-task details contain contradictions, so in-product limits win. | [Scheduled Tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt) |

## Surface resolution

| Surface | Authentication position | Local access | Entitlement conclusion |
| --- | --- | --- | --- |
| Work web/mobile | Isolated cloud browser, signed-out public sites | No device tabs, history, passwords, extensions or local files | Paid plans; Free/Go excluded; rollout/workspace policy applies |
| Work desktop built-in browser | Separate browser profile; user may sign in directly | Local files/apps only with permission | Launch post says every plan including Free; workspace policy still applies |
| Chrome extension | Existing Chrome profile and signed-in sessions | Existing tabs/profile; extension permissions apply | Availability not fully enumerated in reviewed launch material |
| Connected app | App OAuth/connection rather than browser login | App-scoped data/actions only | Plan, region, role, app and admin policy apply |

## Contradictions resolved for implementation

1. Work availability is not one account-level boolean. Detect web availability from the live Work radio and model entitlement as `{surface, plan, workspacePolicy, rollout}`.
2. Do not equate web cloud Work with logged-in Chrome/CDP automation. The former is signed-out and isolated; desktop built-in browser and the Chrome extension have different auth/local-access contracts.
3. Ordinary Work may run for hours, but only Scheduled Tasks have an explicit deferred/background contract. agbrowse polling must not promise survival after browser/app/device shutdown.
4. Official sources define Sol/Terra/Luna, effort, max and ultra, but do not define the six-step UI control named Power. `--power 1..6` is therefore an agbrowse adapter over a live UI observation, not an OpenAI API or durable product taxonomy.
5. `max` means more single-agent reasoning time than xhigh; `ultra` is orchestration and coordinates four agents by default. They must remain distinct.

## Implementation decision

The v1 CLI/MCP stays deliberately narrow: prompt + required Power 1..6, optional speed and timeout. It does not expose project, attachment, app, site publishing, browser permission, scheduled-task, model or effort controls. Those capabilities exist in the product, but each needs its own approval, persistence, and surface contract before automation.
