# ChatGPT Plugins directory live probe

Date: 2026-07-10 KST
Surface: `https://chatgpt.com/plugins`, logged-in ChatGPT Pro, English UI
Method: authenticated Chrome DOM inspection; no install, uninstall, connect, disconnect, upload, or workflow invocation
Official cross-check: [Plugins in ChatGPT and Codex](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex), opened with `agbrowse fetch`

## Directory contract

- Main navigation exposes `Plugins` and `Skills` tabs. The routes are `/plugins` and `/skills`.
- Plugins has heading `Plugins`, copy `Work with ChatGPT across your favorite tools.`, and textbox `Search plugins`.
- Category links use `/plugins?category=<slug>`; observed slugs include `featured`, `productivity`, `creativity`, `developer-tools`, `business-and-operations`, `data-and-analytics`, `communication`, `education-and-research`, `security`, `finance`, `healthcare`, `travel`, `entertainment`, and `other`.
- Cards are `article` containers with links named `Open <plugin>`, an image, title, and one-line capability summary. The same plugin can appear in multiple categories, so visible text is not globally unique.
- Detail href families observed:
  - workflow bundle: `/plugins/Plugin_<id>`
  - first-party connector bundle: `/plugins/plugin_connector_<id>`
  - Apps SDK bundle: `/plugins/plugin_asdk_app_<id>`
- No stable card/item `data-testid` was observed. Hidden/responsive duplicate tab nodes exist in raw DOM, so automation must scope to visible `main` controls and confirm uniqueness.

## Installed example: GitHub

Detail URL: `/plugins/plugin_connector_1p_1a69035c238881919c4190932b2df699`

- Heading/description: GitHub; `Triage PRs, issues, CI, and publish flows`.
- Primary controls: `Plugin actions`, `Try in chat`.
- `Plugin actions` menu: `Manage`, `Uninstall`.
- Included Apps:
  - GitHub: `Connected`; `Connector actions` menu exposes `Reconnect`, `Disconnect`.
  - GitHub Enterprise: `Disabled by admin`.
- Included Skills: Review Follow-up, CI Debug, GitHub, Publish Changes.
- Information: Capabilities `Interactive, Write`; Developer OpenAI; version `0.1.8-2841cf9749ae`; website/privacy/terms links.
- The workflow card links to:
  `/?surface=work&hints=plugin%3Aconnector_76869538009648d5b282a4bb21c3d157&prompt=...`
  This proves that a plugin workflow can enter Work with a plugin hint and prefilled prompt. It does not prove a stable public API for arbitrary plugin IDs.

## Uninstalled example: Notion

Detail URL: `/plugins/plugin_asdk_app_69c18c28f1188191bf5b8445c4ab0a2e`

- Initial asynchronous state was disabled `Loading`, then resolved to `Install plugin`.
- Included App: Notion.
- Included Skills: Knowledge Capture, Meeting Intelligence, Research & Documentation, Spec to Implementation.
- Information: Capabilities `Interactive, Read, Write`; Developer OpenAI; version `0.1.7`.
- Install was not clicked. OAuth/setup and post-install states were not exercised.

## Skills route

- `/skills` exposes heading `Skills`, copy `Instructions that extend ChatGPT's capabilities.`, and `Search Skills`.
- This account showed no listed personal skills.
- Icon button `Create` has `aria-haspopup=menu`, no testid, and menu items:
  `Create with chat`, `Create with editor`, `Upload from your computer`.
- No create/upload item was invoked.

## Official contract cross-check

The July 9 directory migration replaced the App directory with Plugins. A plugin may package skills, apps, and app templates. Apps remain the integrations that reach external data/actions; the plugin inherits each app's role access, read/write action controls, approvals, sync, domain restrictions, source-system permissions, and setup requirements. Directory visibility does not imply installability or usability.

Personal Work skills are documented for paid plans except Free and Go. Plugin install/use can additionally depend on plan, workspace, role, region, supported surface, required app enablement, OAuth, and admin policy.

## agbrowse consequence

`work send` v1 must not accept a plugin argument or synthesize the observed `hints=plugin:<id>` URL. A safe future plugin slice needs separate contracts for:

1. directory/detail detection and stable plugin identity;
2. installed versus visible versus enabled state;
3. required/optional app connection and OAuth handoff;
4. inherited read/write/approval policy;
5. workflow prompt/hint activation and post-activation verification;
6. destructive management actions (`Uninstall`, `Disconnect`) with explicit confirmation.

Until those contracts exist, the Work composer `Plugins` button and plugin hint URLs are exclusion evidence only.
