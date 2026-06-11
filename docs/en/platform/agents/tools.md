---
title: Agent tools
description: The built-in tool families an agent can use beyond text generation, how the agent selects which to call, and how tool calls render in the reply.
---

Tools are what an agent can do beyond producing text. The model decides which tool to call from a list the agent's author has enabled; Tale runs the tool, hands the result back, and the model continues. This page lists the built-in tool families and the rules around how they appear in a reply.

The full catalogue lives in the agent's **Tools** tab — toggle a tool on and the agent can call it; toggle it off and the agent forgets it exists. The point of this page is the shape and trust model, not an exhaustive flag-by-flag tour.

## A worked tool call

The user asks "what is the weather in Zurich today". The agent has the web tool toggled on. The model emits a tool call against the web tool with the query "weather Zurich today"; Tale fetches the result and hands it back to the model; the model writes the reply using the result and cites the source. From the user's side, the chat shows a collapsed "Fetching web content" tool call between the user's message and the reply.

## Built-in tool families

- **Web** — fetches and reads URLs the model decides are useful.
- **Files** — reads attachments and files in the active Project.
- **RAG** — searches knowledge sources bound to the agent and returns chunks with citations. Name a folder in your request ("search only in Contracts/2024") and the agent scopes retrieval to that folder and its subfolders.
- **Run code** — runs Python, Node, or shell scripts in a sandbox. Gated by the org's [run-code policy](/platform/admin/governance/run-code-policy).
- **Sub-agents** — delegates to another agent the org has marked sub-agent-callable. Loop prevention rules live on [Delegation](/platform/agents/delegation).
- **Workflows** — invokes a Tale workflow as a tool. The workflow's outputs come back as the tool result.
- **MCP** — calls tools exposed by registered [MCP servers](/platform/integrations/mcp-servers).
- **Integrations** — calls a third-party integration the org has connected.
- **Human input** — pauses the agent and asks the user (or an approver pool) a question; the answer becomes the tool result.
- **Update todos** — maintains the agent's running todo list inside a [research plan](/platform/agents/concepts).

## Adding tools to an agent

Open the agent's **Tools** tab. Each family is a toggle; some expose sub-toggles (e.g. which integration, which MCP server). Toggling a family on adds its tools to the model's tool list at request time. There is no per-tool fine-tuning beyond the toggle — agents are intended to be configured at the family level.

## Tool-call streaming

Tool calls render in the chat as collapsed cards between the user's message and the reply. Expanding a card reveals the tool name, the inputs the model emitted, and the result Tale returned. A failed tool call shows the error and lets the user see what the agent tried; the model usually retries with a different shape on the next turn.

## Where this fits

Tools widen what an agent can do; they also widen the trust boundary, since the agent can now read, write, or call things on the user's behalf. Pair this page with [Run-code policy](/platform/admin/governance/run-code-policy) if the agent will execute code, and with [MCP servers](/platform/integrations/mcp-servers) if it will reach out via MCP. The agent's instructions stay the place where the **policy** lives; the **Tools** tab is the place where the **surface** lives.
