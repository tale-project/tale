---
title: Agent folders
description: How agents are grouped — folders derived from the agent's id, how automation-installed agents file themselves, and where the permission boundary actually lives.
---

Agents are grouped by folders, and a folder comes from the agent's id: an agent whose id is `github/pull-request-reviewer` files under a `github` folder wherever agents are listed. Folders are an organisational sorting tool, not a permission boundary — who can use an agent is the **Access** section on its **General** page, unchanged by where it is filed.

<Frame caption="The agents list with the chat folder expanded — the folder is the slug's prefix, the rows are its agents.">

![The agents list showing the chat folder's agents — Assistant and Automation Assistant — each with a Type badge, default model, and tool count.](/images/platform/agents-list-expanded.webp)

</Frame>

## File an agent into a folder

Foldered ids come from the platform, not the create dialog. The dialog's **Name** field takes a flat id — lowercase letters, numbers, hyphens, and underscores, no `/` — so an agent you create there lands unfiled at the top level. The folder prefix (`chat/`, `github/`) is reserved for agents the platform ships or installs: builtins arrive pre-filed, and installing an [automation](/platform/automations/concepts) files its agents under the folder their id names. An id can't change later, so the folder is fixed when the agent is created. The display name is independent; rename the agent freely without moving it.

In the **Agents** list, folders render as collapsed rows with an agent count — click one to expand it, and the breadcrumb tracks where you are. The builtin agents ship pre-filed: the general assistants under `chat`, the GitHub agents under `github`.

## Agents that arrive with an automation

Installing an [automation](/platform/automations/concepts) files its agents like any others — the PR Creator and PR Reviewer from the Resolve GitHub issues bundle land in the same list, in the folder their id names. There is no separate agent store to browse: the [Automations catalog](/platform/automations/catalog) is where bundled agents come from, and the list is where they live afterwards.

<Note>

The chat picker does not group by folder — it is a searchable list with **Auto** on top, showing every agent that is enabled and visible in chat, with coding agents under their own **Coding agents** section.

</Note>

## When to reach for it

| Use folders when…                               | Use team access when…                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| The agents list is getting long and needs order | An agent must only be usable by one team               |
| Departments each own a set of agents            | You are drawing a permission boundary, not a directory |

## Where this fits

Folders are the lightest available grouping for agents — they sort the list and the catalog, nothing more. Larger separations live elsewhere: [Project agents](/platform/projects/project-agents) scope an agent to a Project, and [Policies and limits](/platform/admin/governance/policies-and-limits) govern what any agent may spend or do.
