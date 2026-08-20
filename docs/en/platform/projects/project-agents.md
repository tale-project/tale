---
title: Project agents
description: The Agents tab staffs a project with named agents — each with a harness, a model served by a provider you pick, equipment, and standing instructions — that work the project's tasks in an isolated sandbox.
---

A project's **Agents** tab is its crew: named agents you configure once and then assign work to, each combining a coding [harness](/platform/agents/harnesses), a model, skills and connectors, and standing instructions. Chat keeps running the built-in assistant — these agents exist for the board: assign one a task and it works in an isolated sandbox, then reports back for your review. Anyone with project edit access can manage them; a project holds up to 50.

<Frame caption="The Agents tab — the project's own agents, each row naming its harness, serving provider, and model.">

![The Agents tab of a project listing named agents, each with a harness label, the serving provider, the model id, and an equipped count.](/images/platform/project-agents-models.webp)

</Frame>

## Create an agent

<Steps>

<Step title="Open the tab and start one">

Open the project's **Agents** tab and click **New agent**. Give it a **Name** your team will recognize on task cards, and pick the **Agent type** — the coding harness the agent runs on.

</Step>

<Step title="Pick the model — and with it, the provider">

The **Model** list is searchable, and a model served by more than one provider appears once per provider, with the serving provider named under each entry. The pick is exact: the agent's runs call that model through that provider — and the spend lands on that provider's credential. When the picked provider can no longer serve the model, the run fails with the reason instead of quietly switching to another provider's bill.

Subscription-served entries — a Claude subscription, say — appear only while the **Agent type** is the harness that subscription drives, and a run on one authenticates with the vendor subscription instead of an organization API key.

</Step>

<Step title="Equip it and set its instructions">

**Skills, connectors & tools** decide what the agent can reach beyond its workspace; the list follows the project's team access, not your personal visibility. Skills stage reference bundles into the sandbox; connectors broker a connected service; **platform tools** let the agent read and write your organization's own data — find and read tasks, contacts, products, documents, and knowledge, and (when you grant a write tool) create tasks, comment, move them between columns, sync an external item to a task, or save a document. A write tool is marked _Writes data_: granting it is the authorization, so an agent equipped with `Create tasks` files real tasks with no further approval. Reads and writes both stay scoped to the project — an agent never sees another project's board.

**Secrets** hand the agent an API key as an environment variable — the escape hatch for a service that has no connector. Add one (a name like `GLITCHTIP_TOKEN` and the token), and the agent receives it in its shell and calls that service's API directly, reading the vendor's own docs. The value is stored encrypted and never shown again; store only low-privilege, rotatable tokens, because the running agent can read them. Secrets are owned by the organization, so the same one is reused across agents and rotated in one place.

**Instructions** ride along on every run as a standing instruction — what this agent owns, how it should work, and the boundaries it must respect.

</Step>

</Steps>

Click **Create agent**. The row lists the harness, the serving provider, the model, and the equipped count — the same summary teammates see when they assign it work.

## Put it to work

Assign a board task to the agent and click **Start agent** on the task. The run works in an isolated sandbox with a standing workspace that persists across the agent's tasks, posts its report back as a task comment, attaches produced files as deliverables, and parks the task **In review** — agents never complete work; a person does. Comment on the task and @mention the agent to steer a live run, or to start the next one — it reads your comment first and continues where the previous run left off. [Task automation](/platform/projects/task-automation) covers the board loop end to end.

## Change or remove one

Edits apply from the next run — a live run keeps the configuration it started with, so a mid-run edit never swaps the engine underneath it. Deleting an agent keeps every task's history; only the assignee slot empties.

## Chat assistant or project agent?

| Use…            | when the work is…                                                                 |
| --------------- | --------------------------------------------------------------------------------- |
| Chat            | a conversation — questions, drafts, retrieval; the built-in assistant handles it. |
| A project agent | a task — repo or file work on a harness, done by a standing, configured crew.     |

## Where this fits

The agent is the project-side package of choices other pages explain: the harness catalog and its capabilities live in [Harnesses](/platform/agents/harnesses), and which providers and credentials serve the models — stored keys on the metered gateway, or vendor subscriptions on the vendor's own account — is the [Providers](/platform/admin/providers) surface.
