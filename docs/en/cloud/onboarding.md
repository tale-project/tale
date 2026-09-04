---
title: Cloud onboarding
description: From demo request to a production-ready organization — get your own instance from the Tale team, create the org, invite the first admin, add a model provider, staff a first project agent, open chat.
---

<!--
  Internal, for agents editing this page: Tale Cloud has no self-serve sign-up — tale.dev
  ships no sign-up route. A Cloud customer fills in the demo request form
  (https://tale.dev/request-demo — /de/ and /fr/ localized), and the Tale team sets up a
  dedicated demo instance for them. The journey below only starts once that instance exists;
  from there it deliberately mirrors normal first-run onboarding (sign-up on the customer's
  own instance, org wizard, providers). Keep "Request your instance" as the first step and
  do not change the entry point back to a tale.dev sign-up.
-->

This journey walks from demo request to a production-ready Cloud org with one working agent. The result is an org where your team can sign in, ask the chat assistant something useful, and hand a project agent its first task — nothing fancy yet, just the foundation everything else builds on.

You need a working email address and the ability to verify it. The walk assumes no prior Tale knowledge; if anything below references a concept you have not met, the linked page introduces it. Once your instance is ready, the hands-on part takes under an hour — about half of it in the provider step, the rest mostly clicks.

## Before you begin

Pin down three things:

- An email address for the first Owner of the org. This account will hold the highest role; pick someone who will not leave the team next week.
- API credentials for at least one model provider (OpenAI, Anthropic, Azure, or a compatible local). The provider's portal shows where these live.
- The region you want your data pinned to. Cloud offers Switzerland and the EU; the choice is part of the instance setup, and switching later is a real migration.

## From demo request to a working agent

<Steps>

<Step title="Request your instance">

Tale Cloud is not self-serve — every Cloud org runs on its own instance, set up for you by the Tale team. Fill in the demo request form at [tale.dev/request-demo](https://tale.dev/request-demo); name and email are enough, though your company and a line on what your agents should do help the team tailor the setup. The team then sets up your own demo instance — a dedicated environment, not a shared trial — and gets back to you when it is ready.

</Step>

<Step title="Create your organization">

Open your instance and sign up. The form asks for your name, email, and a password; verify the email link when it arrives. The next screen asks for the **Organization name** — the display name your team will see in the corner of every page. Pick something that survives a rebrand.

<Frame caption="The workspace step — the name your team sees everywhere.">

![The create-organization wizard on its workspace step, with Northlight Labs typed into the Organization name field and the Next button enabled.](/images/get-started/org-create-wizard.webp)

</Frame>

The first user becomes the org's **Owner** automatically. You can see your role under **Settings > Members** later if you forget.

</Step>

<Step title="Invite the first admin">

Open **Settings > Members** and click **Add member**. Enter the admin's name and email, assign the **Admin** role, and set a password — Tale creates the account directly and shows the sign-in credentials once, so save them and relay them to the new admin out of band (there is no invite email). They land in the org with the role you assigned. The "at least 2 Admins" safety rule means an org cannot accidentally lock itself out by removing its only Admin — add a second admin before doing anything that requires it.

For the role matrix (who can do what), see [Members and roles](/platform/admin/members-and-roles).

</Step>

<Step title="Add a model provider">

Open **Settings > AI providers**, find the connector you hold a key for, and click **Add credential**. Name the credential so a later reader knows which key it is, pick **API key** as the authentication method, and paste the key. The credential is stored encrypted and becomes the connector's default when it is the first one; a second credential on the same connector is fine, and you choose which is the default. The most common reason a key is rejected is whitespace around it.

<Frame caption="The connected provider — from here every agent can answer.">

![The AI providers settings page listing one connected provider, OpenRouter, with its base URL and a count of 52 models.](/images/get-started/settings-providers.webp)

</Frame>

<Note>

This step is where most onboarding sessions stall — the provider portal is usually a different login, and the team has to dig for the key. If validation hangs for more than a minute, refresh the page; the key is saved as soon as **Save** confirms — the row sometimes needs a reload to show it.

</Note>

</Step>

<Step title="Create your first project agent">

Open a project's **Agents** tab and click **New agent**. Pick the **Agent type** — the coding harness the agent runs on — and, under **Model**, the model you just added. Write a one-paragraph instructions block — the voice the agent should answer in, the domain it knows, the cases it refuses — and click **Create agent**. Assign it a board task and click **Start agent**; the result comes back at **In review** for a person to accept. There is no publish step and no agent picker in chat — agents in this version work board tasks.

For the dialog field by field, see [Project agents](/platform/projects/project-agents); for what makes an agent good, [Agent concepts](/platform/agents/concepts).

</Step>

<Step title="Open chat">

Click **New chat** in the sidebar. The composer's model picker opens on **Auto** — Tale picks a model from the provider you connected — so type a question your team's domain covers, and send.

<Check>

The reply streams back and records which model answered — the org is done with onboarding.

</Check>

Three follow-ups worth doing now while everything is fresh:

- Open **Settings > Branding** and upload the org logo.
- Set the org's default language under **Settings > Organization**.
- Skim [Trust and compliance](/cloud/trust-and-compliance) so you know what to show an auditor before one asks.

</Step>

</Steps>

## Troubleshooting

- **The Model list is empty when you create the agent.** The provider step has not landed — a model must exist under **Settings > AI providers** before the agent dialog can pick one.
- **Provider validation fails with "invalid key".** Re-copy the key from the provider portal — copying often grabs a leading or trailing space.
- **Start agent fails with a provider reason.** The provider you picked can no longer serve that model — fix it under **Settings > AI providers** and start the agent again.

## Where this gets used

You now have an org with one working agent and one admin besides yourself. The natural next walk is [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end) — same shape, but puts a project agent to work on a real task and reviews what comes back. If you came here to evaluate Cloud against self-hosted, [Migrate to self-hosted](/cloud/migrate-to-self-hosted) is the reverse walk.
