---
title: Choose how to author an automation
description: Use the visual editor for direct changes, or have your coding agent edit automations through Tale’s MCP endpoint.
---

Edit an automation directly on its canvas, or let your coding agent edit it through Tale’s MCP endpoint. Tale has no AI assistant inside the editor: a coding agent such as Claude Code or Codex, connected with your API key, is how you work on automations with AI. Both routes save versions of the same workflow and use the same validation and deployment rules. Authoring and deploying automations take the Owner, Admin or Developer role.

## Make a change in the visual editor

Open **Automations** and select the workflow. Select a node to inspect its input, model, code, or other configuration. Save the change with a version message, run a test, and deploy the intended version when its checks pass.

<Frame caption="Selecting a node opens its configuration beside the workflow graph.">

![The automation editor shows a workflow graph and the selected node’s input fields in a side panel.](/images/platform/automation-editor-canvas.webp)

</Frame>

[The workflow editor](/platform/automations/editor) covers these steps in detail, including inspecting a run and returning to an earlier version. The canvas does not include a conversational assistant panel.

## Use an external assistant through MCP

Connect your coding agent with the endpoint under **Settings > API > MCP** and your personal API key; [Use Tale from your editor or a script](/develop/use-tale-from-your-editor) has ready configurations. Tell it what the automation should take in, what it should produce, and which systems it may change. Ask it to look at the existing automations and at what your organization has before it creates another one.

Your agent works on an automation the way you do in the editor. It reads the reference and the current version, validates its change, runs it on the mocks and runs the automation’s tests, then saves a new version that names the version it started from. If someone saved a newer version in the meantime, Tale refuses the save, and the agent reads that version and merges its change first. When it starts a saved version on the mocks, the run appears in the automation’s **Runs** tab as a **Test** run, **Started by you (API)**, so you can open what it ran.

Saving creates a version; it does not make it live. Before your agent deploys, deletes, sets a trigger or installs an automation in projects, a client that honors Tale’s marking for these tools, such as Claude Code, asks for your yes, even when you let the agent run other tools without asking. Review the version and its test results before you agree. Every change your agent makes is in the [audit log](/platform/admin/governance/audit-logs) with **Source** Coding agent, and the [MCP endpoint](/develop/mcp-endpoint) lists every tool it can use.

## Keep runtime decisions separate

An agent node inside an automation performs work during a run. It is separate from the coding agent you use to write the workflow. Similarly, an [approval](/platform/approvals/concepts) authorizes one pending operation during execution; it does not approve a proposed edit to the workflow definition. Your coding agent never decides an approval: a run it starts that needs one waits until a person decides in Tale.

Choose [the editor](/platform/automations/editor) for a change you want to make directly, or [MCP](/develop/mcp-endpoint) for authoring from your own client. Start from [an existing automation](/platform/automations/catalog) when a suitable one is already available.
