---
title: Automation assistant
description: A chat agent scoped to one automation is not part of this version — you edit an automation on its own page, and a model authors one through the MCP endpoint.
---

This page used to describe the **Automation assistant**: a chat agent scoped to one automation, with that automation's document, agents, skills, and connectors in context, able to edit nodes, save versions, and run mocks on your behalf. It does not exist in this version of Tale. Chat has no agent scoped to anything — the chat assistant carries three read-only retrieval tools and cannot read or edit an automation — and the canvas has no assistant panel. What remains is the two ways an automation actually gets built and understood: its own page, and the MCP endpoint.

<Note>

The Automation assistant is not available in this version. There is no chat agent bound to an automation and no agent editor for it to hand JSON to; the agent side of an automation is its **agent** node, edited in the node inspector like any other node.

</Note>

## Understand and edit an automation today

Open the automation from **Automations**. Its canvas shows the whole graph at once — the trigger, the nodes, and the edges between them — and selecting a node opens its configuration in the side panel; you edit there, **Save** a version with a message, run it against mocks with **Test run**, and promote it with **Deploy this version** when it is right. [The workflow editor](/platform/automations/editor) is the operating manual for that page, including the deploy gate an automation's own tests form. The pieces the old assistant drafted for you are edited where they live: a credential under **Settings > Connectors** ([Connector credentials](/platform/admin/connectors)), a trigger on the automation's own page ([Automation triggers](/platform/automations/triggers)).

## Let a model author one

The model-facing way in is the [MCP endpoint](/develop/mcp-endpoint): point a coding agent, an IDE, or your own loop at it with an organization API key and it holds the authoring tools the assistant used to carry — `get_docs` for the grammar, `validate_automation`, `save_automation`, `run_automation` against the mocks, `test_automation`, and `deploy_automation` — plus `list_automations` and `search_capabilities` to find what already exists before building a duplicate. Saving through the endpoint appends a version exactly as the page does, and nothing goes live until something deploys it. What a key may save and deploy follows its holder's role: Developer capability, the same as on the page.

## Where this fits

An automation in this version is read and changed in two places — its page for people, the MCP endpoint for models — and neither is a chat. [Automation concepts](/platform/automations/concepts) is the vocabulary both assume; [Add automations to your organization](/platform/automations/catalog) is where the shipped packs, drafts, and uploads come from.
