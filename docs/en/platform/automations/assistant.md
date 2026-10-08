---
title: Choose how to author an automation
description: Change an automation's fields in the editor, or have a coding agent build and change it through MCP.
---

Change an automation's fields directly in the editor, or have a coding agent such as Claude Code, Codex or Cursor build and change it through MCP. Both routes save versions of the same workflow and use the same validation and deployment rules. You need Developer-level permission to author and deploy automations.

## Make a change in the editor

Open **Automations** and select the workflow. Select a node to inspect its input, model, code, or other configuration, and change the field you need. Save the change with a version message, run a test, and deploy the intended version when its checks pass. The canvas arranges itself from the references between nodes; you don't add nodes or draw connections on it.

<Frame caption="Selecting a node opens its configuration beside the workflow graph.">

![The automation editor shows the workflow between Start and End and the selected node’s fields in a side panel.](/images/platform/automation-editor-canvas.webp)

</Frame>

[The workflow editor](/platform/automations/editor) covers these steps in detail, including reading the canvas, inspecting a run and returning to an earlier version. The canvas does not include a conversational assistant panel.

## Change it with your coding agent

**Edit with your coding agent**, the last button at the top right of the editor's canvas, is the way in. Its dialog shows the automation's name to give the agent, **Set up MCP**, which opens **Settings > API > MCP**, and a link to the guide for connecting a coding agent. Configure your client with that endpoint and an appropriate organization API key. Give it the desired inputs, output, and the systems the workflow may change, and ask it to inspect existing automations and available capabilities before creating another one.

The [MCP endpoint](/develop/mcp-endpoint) provides documentation, validation, save, test, and deploy tools. A version the agent saves appears on the canvas while you look at the automation. Review the resulting workflow and its test output before deployment. A successful save creates a version; it does not make that version live.

## Keep runtime decisions separate

An agent node inside an automation performs work during a run. It is separate from the coding agent you use to write the workflow. Similarly, an [approval](/platform/approvals/concepts) authorizes one pending operation during execution; it does not approve a proposed edit to the workflow definition.

Choose [the editor](/platform/automations/editor) for a change you want to make directly, or [MCP](/develop/mcp-endpoint) for authoring with your coding agent. Start from [an existing automation](/platform/automations/catalog) when a suitable one is already available.
