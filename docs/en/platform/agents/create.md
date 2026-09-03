---
title: Create an agent
description: The agent create dialog and editor are not part of this version — agents you create in the UI are project agents, and chat personas are configuration files.
---

This page used to walk an agent editor tab by tab: a create dialog, **General**, **Instructions**, **Tools**, **Skills**, **Knowledge**, and a **History** button. That editor is not part of this version of Tale, and neither is an agent picker in the chat composer. Two things are real and this page points you at them: project agents, which you do create in the UI, and agent personas, which are configuration files.

<Note>

The agent editor is not available in this version. There is no agents entry in the sidebar and no create dialog for chat personas.

</Note>

## Create a project agent instead

The agents you create in the UI belong to a project and work its board tasks. Open the project's **Agents** tab, click **New agent**, give it a **Name**, pick its **Agent type** — the coding harness it runs on — and its **Model**, equip it under **Skills, connectors & tools**, add **Secrets** when it must call a service that has no connector, write its **Instructions**, and click **Create agent**. Assign it a task and click **Start agent** to put it to work. [Project agents](/platform/projects/project-agents) walks every field; [Harnesses](/platform/agents/harnesses) explains the runtimes you pick from.

## Personas stay configuration

A persona — a name, instructions, a tools and a skills allowlist, a knowledge scope, and a visibility of private or shared — exists in this version as a YAML file in the organization's configuration, seeded with `coding-agent`. No screen creates or edits one, and chat does not offer one to pick: the chat assistant answers with a fixed set of retrieval tools. [Agent concepts](/platform/agents/concepts) explains what a persona carries, [Agents (admin view)](/platform/admin/agents) who may change one and how, and [AI-assisted development](/develop/ai-assisted-development) where the files live.

## Where this fits

Creating an agent in this version means staffing a project: a named agent on a harness, equipped for the work, started from a task and reviewed by a person. Walk [Project agents](/platform/projects/project-agents) to build one, and [Task automation](/platform/projects/task-automation) to see what happens once it is assigned.
