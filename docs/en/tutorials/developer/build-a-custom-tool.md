---
title: Build a custom tool
description: Package a custom function as a tool that agents can call, then attach it to an agent and watch it appear in tool calls during a chat.
---

A custom tool is a function you write that an agent's model can call by name. You declare the input schema and the return shape; Tale handles serialisation, the tool-call card in the chat, and the result hand-back to the model. This walk takes a fresh custom tool from "I have a function in mind" to "the agent calls it from a chat" on a single instance.

You need a Developer role in the org and access to the **Settings > Custom tools** panel; everything else is in the UI. The underlying concept lives in [Agent tools](/platform/agents/tools); the developer-facing surface — schemas, transport, errors — is the focus here.

## Before you begin

Confirm two things. First, your role is at least Developer — the panel is hidden below that. Second, you have an agent you can edit; if not, create one through [Create an agent](/platform/agents/create) before continuing. The walk uses a single-input, single-output tool called `lookup_order` that takes an order ID and returns a status string — the smallest shape that exercises the schema, the call, and the result rendering.

## Step 1 — Define the tool in Custom tools

The first move is registering the tool name and its JSON Schema. The schema is what the model sees; without a schema the model has no idea what arguments to emit, and the call never happens.

Open **Settings > Custom tools** and click **New tool**. Give it a name (`lookup_order`), a one-sentence description (`Look up the status of an order by ID`), and a JSON Schema for the input:

```json
{
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "description": "The order ID, e.g. ORD-12345"
    }
  },
  "required": ["orderId"]
}
```

Save. The tool is now registered in the org's custom-tool registry; no agent uses it yet.

## Step 2 — Wire the implementation

A registered tool with no implementation returns an error to the model. Tale exposes two implementation modes: an inline sandbox script (Python or JavaScript, run inside Tale's sandbox), and an outbound HTTPS call (Tale POSTs the arguments to your endpoint, you return JSON).

Pick the HTTPS mode for this walk — it is the shape you reach for in production. In the tool's detail panel, set:

- **Endpoint URL** — `https://your-api.example.com/lookup-order`
- **Method** — `POST`
- **Auth header** — a bearer token from your secrets manager

Tale POSTs `{ "orderId": "..." }` to your endpoint; your endpoint returns `{ "status": "shipped", "carrier": "DHL", "eta": "2026-06-01" }`. Save. The custom tool is wired.

## Step 3 — Attach the tool to an agent

A wired tool is invisible to agents until one of them is given permission to call it. Open the agent you want to extend, click **Tools**, scroll to **Custom tools**, and toggle `lookup_order` on. Save the agent.

Open a chat with the agent and ask "what is the status of order ORD-12345". The chat shows a collapsed `lookup_order` tool-call card between your message and the reply; expanding it shows the arguments the model emitted (`{ "orderId": "ORD-12345" }`) and the JSON your endpoint returned. The model then writes the reply using the tool result.

## Where this fits

A custom tool is the seam between an agent and your domain — order lookup, internal search, calculator, anything an off-the-shelf connector does not cover. The schema is what the model uses to decide whether to call, so spend the time to write a tight description and only the fields you need.

For tools you want to share across orgs, see [MCP servers from scratch](/tutorials/developer/mcp-server-from-scratch) — MCP is the protocol for "one tool, many Tale instances". For the conceptual side of what tools do inside an agent, see [Agent tools](/platform/agents/tools).
