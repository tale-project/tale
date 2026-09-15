---
title: Choose how to author an automation
description: Use the visual editor for direct changes or connect an external assistant to Tale through MCP.
---

Edit an automation directly on its canvas, or connect an external assistant through MCP to author it with Tale’s tools. Both routes save versions of the same workflow and use the same validation and deployment rules. You need Developer-level permission to author and deploy automations.

## Make a change in the visual editor

Open **Automations** and select the workflow. Select a node to inspect its input, model, code, or other configuration. Save the change with a version message, run a test, and deploy the intended version when its checks pass.

<Frame caption="Selecting a node opens its configuration beside the workflow graph.">

![The automation editor shows a workflow graph and the selected node’s input fields in a side panel.](/images/platform/automation-editor-canvas.webp)

</Frame>

[The workflow editor](/platform/automations/editor) covers these steps in detail, including inspecting a run and returning to an earlier version. The canvas does not include a conversational assistant panel.

## Use an external assistant through MCP

Configure your client with the endpoint under **Settings > API > MCP** and an appropriate organization API key. Give it the desired inputs, output, and the systems the workflow may change. Ask it to inspect existing automations and available capabilities before creating another one.

The [MCP endpoint](/develop/mcp-endpoint) provides documentation, validation, save, test, and deploy tools. Review the resulting workflow and its test output before deployment. A successful save creates a version; it does not make that version live.

## Keep runtime decisions separate

An agent node inside an automation performs work during a run. It is separate from the client you use to write the workflow. Similarly, an [approval](/platform/approvals/concepts) authorizes one pending operation during execution; it does not approve a proposed edit to the workflow definition.

Choose [the editor](/platform/automations/editor) for a change you want to make directly, or [MCP](/develop/mcp-endpoint) for authoring from your own client. Start from [an existing automation](/platform/automations/catalog) when a suitable one is already available.
