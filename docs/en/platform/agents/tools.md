---
title: Agent tools
description: The per-tool permissions an agent carries beyond text generation — the tool categories, web access as a tool, and connectors and automations as capabilities.
---

Tools are what an agent can do beyond producing text. The model decides which tool to call from the list the agent's author has granted; Tale runs the tool, hands the result back, and the model continues. The agent's **Tools** tab is that list — a searchable catalog of per-tool switches, grouped into category cards.

<Frame caption="The tool catalog — one card per category, each counting how many of its tools the agent has been granted.">

![The agent editor's Tools tab scrolled to the category cards, with Knowledge at three of four tools checked and Files at seven of seven, while Conversations, Discussions, Analytics, and Tasks & projects have none granted.](/images/platform/agent-editor-tools.webp)

</Frame>

## Granting tools one by one

Check a tool and the agent can call it from the next request; uncheck it and the agent forgets it exists. **Search tools…** filters the catalog by name or category, each tool row carries a one-line description of what it grants, and a category's header checkbox enables the whole group at once — the count beside it shows how many of the group's tools are on. The categories map to the platform's surfaces: **Contacts**, **Products**, **Vendors**, and **Websites** expose read and update tools over structured records; **Conversations** lets the agent read and reply; **Knowledge** covers document search and writing; **Tasks & projects** includes the agent's own to-do list; **Automations** lets it create and run the organization's automations; **Web** holds search over the sites your organization has added; **Files** covers the agent's file operations; **System** holds **Run code**, **Ask a human**, and the other runtime tools. Grant the smallest set that does the job — every enabled tool widens what the agent can read or change on your behalf.

**Run code**, in the **System** group, is the widest of these: it runs Python, Node, or bash in the chat's own sandbox, over the files the chat already holds rather than a blank box. A call runs a snippet directly, runs a script the agent staged under `/agent/code/`, or installs packages only — declared packages install first and persist for the rest of the turn, and whatever the run writes under `/agent/output/` comes back as a file in the chat. Files and folders you pin with `@` arrive in that sandbox under `/agent/uploads/`, so the code opens the real bytes, not a retrieval snippet.

<Note>

An agent spawns a focused **worker** for a sub-task on its own — it is not a tool you toggle here. See [Agent workers](/platform/agents/delegation) for when that is the right move and how a worker inherits a bounded subset of the agent's own capabilities.

</Note>

## Web access is a tool, not a mode

Web search sits in the catalog like everything else. Grant it and the agent can search when it judges that it should; leave it off and it cannot search at all. There is no separate mode to configure and no automatic injection of results into a reply — the agent reaches for search the way it reaches for any other tool. What it searches is the material your organization has added rather than an open crawl, so manage the sources under [Websites](/platform/knowledge/crawling).

## Connectors and automations are capabilities too

A connected connector and a published automation reach the agent through this same list. There is no second binding surface underneath it: name the capability in the agent's allowlist and the agent can call it without having to quote the connector or the automation id itself. Connected [MCP servers](/platform/connectors/mcp-servers) arrive the same way, through the organization's connectors.

An automation that only an event can start is listed but not callable. The agent sees that it exists and is told plainly that it runs when its event fires rather than on request — an agent that cannot see the organization's automations invents workarounds instead of pointing at the one that already does the job.

## How tool calls render

Tool calls appear in the chat as collapsed cards between the user's message and the reply. Expanding a card reveals the tool name, the inputs the model emitted, and the result Tale returned. A failed tool call shows the error; the model usually retries with a different shape on the next turn.

## When to reach for it

| Use Tools when…                                | Use Knowledge when…                        |
| ---------------------------------------------- | ------------------------------------------ |
| The agent must act — query, update, run, reply | The agent must cite documents it retrieved |
| The data is structured records or live systems | The data is uploaded or crawled content    |

## Where this fits

Tools widen what an agent can do; they also widen the trust boundary, since the agent can now read, write, or call things on the user's behalf. Pair this page with [Run-code policy](/platform/admin/governance/run-code-policy) if the agent will execute code. The agent's instructions stay the place where the **policy** lives; the **Tools** tab is the place where the **surface** lives.
