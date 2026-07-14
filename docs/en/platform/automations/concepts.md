---
title: Automation concepts
description: An automation is the installable bundle of integrations, agents, skills, a workflow, and builtin views — and the workflow inside it is how it runs. This page names the pieces, the runtime around them, and when to reach for an automation instead of a lone agent.
---

An automation is the unit Tale reaches for when a job needs more than one moving part wired together — an integration credential, one or more agents, a workflow, sometimes a page of its own — and you want all of it installed and connected in one action instead of assembled by hand. Owners, Admins, and Developers install automations from the Automations catalog; once installed, Editors and Members use whatever it shipped — an Inbox tab, a Backlog entry, a chat agent — without needing to know what's underneath. This page names the pieces an automation bundles, the workflow that makes it run, and when an automation is the right unit instead of a single agent.

## What an automation bundles

An automation's manifest names up to five kinds of pieces, and most automations only use some of them.

**Integrations** are the credentials its steps and agents call — Gmail, GitHub, a SQL database. An automation never stores its own copy of a credential; it names which integration it requires, and the org connects that integration once, the same connection every other automation and agent shares.

**Agents** are the chat or task agents the automation installs — a triager, a PR reviewer, a summariser. Once installed they're ordinary agents: mentionable in chat, assignable on a project board, editable in the agent editor.

**A workflow** is the automation's one bundled trigger-and-steps definition — the thing that actually runs on a schedule, a webhook, or a manual click. Not every automation ships one: the email automations covered on [Built-in automations](/platform/automations/builtin) have none, because reading and replying to mail is a page, not a scheduled run.

**Builtin views** are pages the automation registers into the platform's shared view registry, like Inbox — the platform renders the page itself; the automation only names which one and what it's scoped to.

**Configuration** is not a separate settings file. An automation that needs an operator value reads it from an integration's credential or from a workflow trigger or node variable; the automation's Configuration tab is a read-only summary of the pieces above, not a place to add new settings.

## The workflow inside

There is no standalone workflow surface in Tale — a workflow lives and runs inside its automation, and the automation's **Editor** tab is where you meet it. The definition is a graph of typed steps: **LLM** steps call an agent or model, **Action** steps do concrete work such as calling an integration or creating and updating tasks on the project board, **Condition** steps branch the graph on a yes or no, **Loop** steps repeat over a set, and **Sandbox** steps run code. Every save snapshots a version you can restore from **History**. [The workflow editor](/platform/automations/editor) is the operating manual for that surface.

**Triggers** decide when the workflow runs. Three kinds attach on the **Triggers** tab: **Schedules** (cron), **Webhooks** (an external POST), and **Events** (something happens inside Tale, such as `task.created`) — and you can always fire a run by hand from the editor's **Test workflow** panel. The [triggers reference](/platform/automations/triggers) covers each.

**Executions** are the run history. Every run writes a record — status, timing, the input it received, and a per-step journal of what each step consumed and produced. The **Executions** tab is the audit trail and the debugging surface in one place; [Execution logs](/platform/automations/execution-logs) reads one end to end.

## Where humans fit

Automations run without you, but they change and start only with you: the AI editor's proposed changes to a workflow land as approval cards before they apply, an agent that wants to run a workflow needs your approval first, and a run that needs an answer pauses as **Waiting for input**. [Approvals in workflows](/platform/automations/approvals-in-workflows) covers all three. A loop that re-enters the same review gate — a task sent back for another pass — opens a fresh request each round rather than reusing the resolved card.

## Bundles and hidden automations

A bundle groups several automations that only make sense installed together. [Resolve GitHub issues](/platform/automations/builtin) installs four automations — a triager, a syncer, a PR creator, and a PR reviewer — through one aggregated wizard, bound to the project you choose. Most of a bundle's members are hidden: they never appear as their own card in the catalog, because installing one alone would be meaningless without its siblings. Hidden doesn't mean gone — the [Automation assistant](/platform/automations/assistant) can still find and explain them; only the catalog's grid hides them.

## Putting it together — two combinations

**Sync Gmail emails** combines the smallest possible set: one integration (Gmail) and one builtin view (Inbox) — no agent, no workflow. Connect Gmail, and the Inbox tab is the whole automation.

**Resolve GitHub issues** combines nearly every piece at once: one integration (GitHub), two agents (a PR creator and a PR reviewer, each owned by one of its four hidden members), four workflows, and no builtin view — it works through the project's existing Board and Backlog instead of a page of its own. Installing the bundle wires all four in one aggregated wizard, bound to the project you pick.

## When to reach for it

| Use … when                                                             | Automation | Agent | Agent webhook |
| ---------------------------------------------------------------------- | ---------- | ----- | ------------- |
| You want a ready-integrated feature installed in one action            | ✓          |       |               |
| The work has multiple steps, branches, schedules, or approvals between | ✓          |       |               |
| The same question just recurs in chat, no external system involved     |            | ✓     |               |
| One agent reply per incoming POST is enough                            |            |       | ✓             |

Check the catalog before building anything — the automation you need may already ship. When nothing shipped fits, you still build an automation: describe the workflow to the [AI editor](/platform/automations/editor) or upload a package, rather than assembling loose pieces. An [agent webhook](/platform/agents/webhook-triggers) is the one seam outside this model — reach for it when a single agent reply per incoming payload is all the job needs.

## Build one

An automation is the whole bundle a real feature needs — the integration it calls, the agents that do the work, the workflow that runs it, the view it renders — wired together and installed in one action, with the workflow's runtime (triggers, executions, approvals) living on the automation's own tabs. The natural next read is [Browse and install](/platform/automations/catalog) — it walks the catalog, the side panel, and the install wizard end to end; [The workflow editor](/platform/automations/editor) picks up from there for the surface where the automation's engine gets built and tuned.
