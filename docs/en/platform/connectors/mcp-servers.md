---
title: Connect an external client with MCP
description: Find Tale’s MCP endpoint and understand how external clients use it to work with Tale.
---

Tale exposes an MCP endpoint that lets an external coding assistant or other MCP client work with your organization. Use it to discover capabilities, author automations, and inspect runs through the client’s tools. Access follows the permissions of the person behind the connection: the holder of the API key, or the person who signed the agent in.

## Find your endpoint

Open **Settings > API > MCP**. Where agents may sign in, the page starts with **Connect a coding agent**: the commands for Claude Code and Codex, a line that says when your agent has signed in, and a first prompt to give it. Below, it shows the deployment’s endpoint URL, the organization slug, available tool groups, and a request you can copy to check connectivity. A coding agent signs itself in once it has this address ([Connected agents](/platform/admin/connected-agents) shows and ends those connections); otherwise create a suitable key under **Settings > API**.

<Frame caption="The MCP settings page connects a coding agent and provides the endpoint, organization context, and available tools.">

![The MCP settings page starts with Connect a coding agent: the Claude Code, Codex and Other tabs, the two commands that add Tale and sign in, a line that waits for the agent to sign in, and a first prompt to copy. Below it, the MCP endpoint section shows an endpoint URL ending in /api/v1/mcp.](/images/platform/settings-mcp-endpoint.webp)

</Frame>

Follow [MCP endpoint](/develop/mcp-endpoint) for client configuration, authentication, and permission requirements. Store the key in the client’s credential settings; do not put it in a prompt or a shared document.

## Choose the direction of the connection

Tale’s MCP endpoint accepts connections from external clients. Tale does not provide a settings form for registering an external MCP server as equipment for its own project agents.

For an agent inside Tale that needs another service, check the [connector catalog](/platform/connectors/overview). When there is no suitable connector, a [project agent](/platform/projects/project-agents) can use an appropriately scoped secret to call a service from its sandbox. That grants the running agent access to the secret, so choose the scope for the specific job.

## Verify access before authoring

Start with the connectivity request on the MCP page and confirm that the client can list the tools. Then read the tool’s required permission before trying a write. Saving an automation and deploying it are separate operations; connecting a client does not bypass the deploy gate or approval rules.

Use [API keys](/platform/admin/api-keys) for key rotation and revocation, and [Automation concepts](/platform/automations/concepts) for the save, test, and deploy lifecycle.
