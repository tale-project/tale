---
title: Agent folders
description: How agents are grouped — folders derived from the agent's id, how automation-installed agents file themselves, and where the permission boundary actually lives.
---

Agents are grouped by folders, and a folder comes from the agent's id: an agent whose id is `github/review-pull-requests/pr-reviewer` files under a `github/review-pull-requests` folder wherever agents are listed. Folders sort a long list; they draw no permission boundary. Who can reach an agent is its **visibility** on the **General** tab, and that answer does not change with where the agent is filed.

## File an agent into a folder

Foldered ids come from the platform, not from the create dialog. The dialog's **Name** field takes a flat id — lowercase letters, numbers, hyphens, and underscores, no `/` — so an agent you create there lands unfiled at the top level. The folder prefix (`chat/`, `github/review-pull-requests/`) is reserved for agents the platform ships or installs: built-ins arrive pre-filed, and installing an [automation](/platform/automations/concepts) files its agents under the folder their id names. An id cannot change later, so the folder is settled when the agent is created. The display name is independent — rename the agent freely without moving it.

In the **Agents** list, folders render as collapsed rows with an agent count. Click one to expand it, and the breadcrumb tracks where you are. The built-in agents ship pre-filed, with the general assistants under `chat`.

## Agents that arrive with an automation

Installing an [automation](/platform/automations/concepts) files its agents like any others — the PR Creator and PR Reviewer from the Resolve GitHub issues bundle land in the same list, in the folder their id names. There is no separate agent store to browse: the [Automations catalog](/platform/automations/catalog) is where bundled agents come from, and the list is where they live afterwards.

<Note>

The composer does not group by folder. Its picker is a searchable list with two sections — **Models** for an ordinary turn and **Sandbox agents** for one that runs inside a coding-agent harness — and nothing is picked on your behalf.

</Note>

## When to reach for it

| Use folders when…                               | Use visibility when…                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| The agents list is getting long and needs order | An agent should stay reachable only by the person building it |
| Departments each own a set of agents            | You are drawing a permission boundary, not a directory        |

## Where this fits

Folders are the lightest grouping available for agents — they sort the list and the catalog, and they do nothing else. Larger separations live elsewhere: [Project agents](/platform/projects/project-agents) scope an agent to a Project, and [Policies and limits](/platform/admin/governance/policies-and-limits) govern what any agent may spend or do.
