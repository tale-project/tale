---
title: Automation concepts
description: An automation is the installable bundle of integrations, agents, skills, a workflow, and builtin views the Automations catalog installs in one action. This page names the pieces and when to reach for one instead of a lone agent or workflow.
---

An automation is the unit Tale reaches for when a job needs more than one moving part wired together — an integration credential, one or more agents, a workflow, sometimes a page of its own — and you want all of it installed and connected in one action instead of assembled by hand. Owners, Admins, and Developers install automations from the Automations catalog; once installed, Editors and Members use whatever it shipped — an Inbox tab, a Backlog entry, a chat agent — without needing to know what's underneath. This page names the pieces an automation bundles, how a bundle groups several automations together, and when an automation is the right unit instead of a single agent or a single workflow.

## The pieces

An automation's manifest names up to five kinds of pieces, and most automations only use some of them.

**Integrations** are the credentials its steps and agents call — Gmail, GitHub, a SQL database. An automation never stores its own copy of a credential; it names which integration it requires, and the org connects that integration once, the same connection every other automation and agent shares.

**Agents** are the chat or task agents the automation installs — a triager, a PR reviewer, a summariser. Once installed they're ordinary agents: mentionable in chat, assignable on a project board, editable in the agent editor.

**A workflow** is the automation's one bundled trigger-and-steps definition — the thing that actually runs on a schedule, a webhook, or a manual click. Not every automation ships one: the email automations covered on [Built-in automations](/platform/automations/builtin) have none, because reading and replying to mail is a page, not a scheduled run.

**Builtin views** are pages the automation registers into the platform's shared view registry, like Inbox — the platform renders the page itself; the automation only names which one and what it's scoped to.

**Configuration** is not a separate settings file. An automation that needs an operator value reads it from an integration's credential or from a workflow trigger or node variable; the automation's Configuration tab is a read-only summary of the pieces above, not a place to add new settings.

## Bundles and hidden automations

A bundle groups several automations that only make sense installed together. [Resolve GitHub issues](/platform/automations/builtin) installs four automations — a triager, a syncer, a PR creator, and a PR reviewer — through one aggregated wizard, bound to the project you choose. Most of a bundle's members are hidden: they never appear as their own card in the catalog, because installing one alone would be meaningless without its siblings. Hidden doesn't mean gone — the [Automation assistant](/platform/automations/assistant) can still find and explain them; only the catalog's grid hides them.

## Putting it together — two combinations

**Reply to Gmail emails** combines the smallest possible set: one integration (Gmail) and one builtin view (Inbox) — no agent, no workflow. Connect Gmail, and the Inbox tab is the whole automation.

**Resolve GitHub issues** combines nearly every piece at once: one integration (GitHub), two agents (a PR creator and a PR reviewer, each owned by one of its four hidden members), four workflows, and no builtin view — it works through the project's existing Board and Backlog instead of a page of its own. Installing the bundle wires all four in one aggregated wizard, bound to the project you pick.

## When to reach for it

| Use … when                                                                    | Automation | Agent | Workflow |
| ----------------------------------------------------------------------------- | ---------- | ----- | -------- |
| You want a ready-integrated feature installed in one action                   | ✓          |       |          |
| The same question just recurs in chat, no external system involved            |            | ✓     |          |
| You're wiring a brand-new integration and trigger yourself                    |            |       | ✓        |
| You need approvals or scheduling between steps and nothing off-the-shelf fits |            |       | ✓        |

Reach for an automation first — check the catalog before building the pieces yourself. Reach for a lone agent or workflow when the job is genuinely new and nothing shipped covers it.

## Build one

An automation is the whole bundle a real feature needs — the integration it calls, the agents and workflow that do the work, the view it renders — wired together and installed in one action; reach for a lone agent or workflow only when you're building the piece yourself. The natural next read is [Browse and install](/platform/automations/catalog) — it walks the catalog, the side panel, and the install wizard end to end.
