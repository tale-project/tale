---
title: Your first day running a workspace
description: The admin journey — create the workspace, connect an AI provider, bring in the team, and know where governance lives.
---

This journey is for the person accountable for the workspace. In fifteen minutes you create the organization, connect the provider that makes chat answer, bring in your first teammates, and learn where the governance controls live before you need them.

You need an account on a running instance ([quickstart](/get-started/quickstart)); on a brand-new instance the first account is automatically the **Owner**, which carries every permission below.

<Steps>

<Step title="Create the workspace">

If you arrived via the quickstart, your organization already exists — skip to connecting a provider. A fresh sign-in without one lands on the creation wizard: the **Organization name** is the display name your team sees in the corner of every page — pick something that survives a rebrand. The wizard then offers to connect an AI provider and finishes on the dashboard.

<Frame caption="The workspace step of the creation wizard.">

![The create-organization wizard on its workspace step, with Northlight Labs typed into the Organization name field and the Next button enabled.](/images/get-started/org-create-wizard.webp)

</Frame>

</Step>

<Step title="Connect an AI provider">

Nothing answers until a provider is connected. If you skipped the wizard's provider step, open **Settings > AI providers** and click **Add credential** on a connector — an [OpenRouter](https://openrouter.ai) key reaches the widest model catalog, and every direct vendor ships its own connector beside it. A credential is usable the moment it is saved; from then on every agent in the workspace can answer with any model that connector exposes.

<Frame caption="A connected provider with its model catalog.">

![The AI providers settings page listing one connected provider, OpenRouter, with its base URL and a count of 52 models.](/images/get-started/settings-providers.webp)

</Frame>

</Step>

<Step title="Bring in the team">

To add people, open **Settings > Organization**, scroll to the **Members** section, and click **Add member**. Each person lands with a role that bounds what they can do: **Member** reads and chats, **Editor** builds agents and knowledge, **Developer** wires up workflows, automations, and API access, **Admin** runs the workspace. Start people low — raising a role later is one click, and un-leaking access is not.

<Frame caption="The Members section — every account and its role.">

![The Organization settings page with its Members section listing the workspace owner Alex Rivera and an Add member button.](/images/get-started/settings-organization-members.webp)

</Frame>

<Check>

A teammate who signs in and gets an answer in chat proves the whole chain — account, role, provider — without you standing next to them.

</Check>

</Step>

<Step title="Know where governance lives">

You will not need policies on day one, but you should know the door: **Settings > Governance** holds audit logs, usage analytics, content policies, guardrails, and retention. The one habit worth starting today is skimming [audit logs](/platform/admin/governance/audit-logs) after the first week — it shows you what your workspace actually does.

</Step>

</Steps>

## Where you are now

The workspace stands: a provider answers, the team is in with bounded roles, and you know where the controls live. The full permission matrix is [Members and roles](/platform/admin/members-and-roles); [Admin overview](/platform/admin/overview) maps every pane you now own; and when compliance asks, [governance](/platform/admin/governance/audit-logs) is the section you show them.
