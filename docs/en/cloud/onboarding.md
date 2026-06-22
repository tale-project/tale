---
title: Cloud onboarding
description: Sign-up to a production-ready organization in under an hour — create the org, invite the first admin, add a model provider, publish an agent, open chat.
---

This tutorial walks from sign-up to a production-ready Cloud org with one working agent in under an hour. The result is an org where your team can sign in, pick a working agent, and ask it something useful — nothing fancy yet, just the foundation everything else builds on.

You need a working email address and the ability to verify it. The walk assumes no prior Tale knowledge; if anything below references a concept you have not met, the linked page introduces it. About half the time is in step 3 (adding the model provider) — the rest is mostly clicks.

## Before you begin

Pin down three things:

- An email address for the first Owner of the org. This account will hold the highest role; pick someone who will not leave the team next week.
- API credentials for at least one model provider (OpenAI, Anthropic, Azure, or a compatible local). The provider's portal shows where these live.
- The region you want your data pinned to. Cloud offers Switzerland and the EU; pick once, switching later is a real migration.

## Step 1 — Create your organization

Visit `tale.dev` and click **Sign up**. The form asks for your name, email, and a password; verify the email link when it arrives. The next screen asks for the **Organization name** — the display name your team will see in the corner of every page. Pick something that survives a rebrand.

The first user becomes the org's **Owner** automatically. You can see your role under **Settings > People** later if you forget.

## Step 2 — Invite the first admin

Open **Settings > People** and click **Invite member**. Enter the admin's email and assign the **Admin** role. The invitee receives an email with a magic link; they sign up and land in the org with the role you assigned. The "at least 2 Admins" safety rule means an org cannot accidentally lock itself out by removing its only Admin — invite a second admin before doing anything that requires it.

For the role matrix (who can do what), see [Members and roles](/platform/admin/members-and-roles).

## Step 3 — Add a model provider

Open **Settings > Providers** and click **Add provider**. Pick the provider you have credentials for and paste the API key. Save. Tale validates the key in the background; a tick on the provider row means the key works. If validation fails, the row shows the error verbatim — the most common cause is whitespace around the key.

This step is where most onboarding sessions stall. The provider portal is usually a different login, and the team has to dig for the key. If validation hangs for more than a minute, refresh the page — the key is saved as soon as **Save** confirms, the row just sometimes needs a reload to update.

## Step 4 — Publish your first agent

Open **Agents** and click **Create agent**. Pick the model you just added. Write a one-paragraph instructions block — the voice the agent should answer in, the domain it knows, the cases it refuses. Save. Flip **Visible in chat** on. The agent is now reachable from any chat in the org.

For a deeper walk on what makes an agent good, see [Create an agent](/platform/agents/create).

## Step 5 — Open chat

Click **New chat** in the sidebar. Pick the agent from the picker, type a question the agent's domain covers, send. The reply streams back; if it lands the way you wrote the instructions to land, the org is done with onboarding.

Three follow-ups worth doing now while everything is fresh:

- Open **Settings > Branding** and upload the org logo.
- Set the org's default language under **Settings > Organization**.
- Skim [Trust and compliance](/cloud/trust-and-compliance) so you know what to show an auditor before one asks.

## Troubleshooting

- **Invite email never arrives.** Check the invitee's spam folder. Tale sends from `noreply@tale.dev`; some corporate filters quarantine it.
- **Provider validation fails with "invalid key".** Re-copy the key from the provider portal — copying often grabs a leading or trailing space.
- **Agent does not show in the chat picker.** Confirm **Visible in chat** is on for the agent.

## Where this gets used

You now have an org with one working agent and one admin besides yourself. The natural next walk is [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end) — same shape, but builds an agent that does real domain work with knowledge bindings. If you came here to evaluate Cloud against self-hosted, [Migrate to self-hosted](/cloud/migrate-to-self-hosted) is the reverse walk.
