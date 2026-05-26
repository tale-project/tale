---
title: Project agents
description: Project-scoped agents versus org agents — when to reach for each, how Project agents shadow org agents in the picker, and how publishing works inside a Project.
---

A Project agent is an agent that only exists inside the Project. It appears in the chat agent picker for members of the Project, never elsewhere; it inherits the Project's Files and Instructions automatically; deleting the Project deletes it. Reach for Project agents when an agent needs Project-specific instructions a generic org agent should not carry.

This page covers the difference between Project agents and org agents, the shadow rule that decides which one shows up when both share a name, and how publishing changes between the two scopes.

## Project agents versus org agents

An **org agent** lives in the org's [Agents](/platform/admin/agents) list and shows up in any chat the user has access to. A **Project agent** lives only in the Project; outside the Project, it does not exist. The shapes are the same — same instructions, knowledge, tools, model — only the visibility differs.

## The shadow rule

Project agents and org agents can share a name. When they do, inside the Project the **Project agent wins** — it shadows the org agent in the picker. Outside the Project, the org agent is what shows. This lets a team take an org-wide agent ("Sales assistant") and override it for a specific account with extra instructions, without naming it differently.

## Publishing into a Project

Creating an agent from inside the Project produces a Project agent automatically. Creating one from the org **Agents** list produces an org agent that any Project can opt into. To move an org agent into a Project, duplicate it into the Project's Agents tab — the original stays org-wide; the duplicate becomes a Project agent that the team can edit without affecting the org-wide copy.

## Permissions

Project agents follow Project membership. Members of the Project can run them; Editors of the Project can edit them; the Project owner can delete them. Org-level Editor and Developer roles do not automatically have access to a Project's agents — Project membership is the only path in.

## When to reach for each

| Use … when                                            | Project agent | Org agent |
| ----------------------------------------------------- | ------------- | --------- |
| Instructions are specific to this Project's data      | ✓             |           |
| The same prompt would be useful to every team         |               | ✓         |
| You need a one-off variation of an existing org agent | ✓             |           |
| You want to share an agent across many Projects       |               | ✓         |

## Where this fits

Project agents are the answer to "we love this agent but it needs to behave differently for this customer". The wider [Agents](/platform/agents/concepts) section is org-wide; reach for that when the audience is everyone. The natural follow-up is [Use projects](/tutorials/member/use-projects), which walks a Project that ends with a Project agent doing real work.
