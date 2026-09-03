---
title: Environment variables & secrets
description: Your personal store of variables and secrets under Settings > Environment — what it holds, how secrets are protected, and the fact that no run reads it in this version.
---

Environment variables & secrets is a personal store under **Settings > Environment**: named values, scoped to you and to the current organization, with a **Secret** switch that makes a value write-only. Every role can open the page, and nobody else in the organization can read your entries. What the page does not do in this version is the part worth knowing before you fill it: nothing injects these entries into a run. No project agent turn, automation agent node, or script reads them — the store is kept, but the lane that would set them in a sandbox's environment is not wired.

This page covers what you can save, the rules a name and value have to satisfy, and where the values a run actually receives come from instead.

<Note>

Personal environment variables are stored but not injected into any sandbox in this version. The page's own description still speaks of injection; treat the store as inert until a release note says otherwise. A value a project agent needs belongs in its **Secrets** — see below.

</Note>

<Frame caption="Settings > Environment — the saved entries, each with the Secret switch that decides whether its value can be read back.">

![The Environment settings page listing three saved entries — ANALYTICS_ORG and CRM_BASE_URL with their values in plain sight, and CRM_API_TOKEN masked as dots with its Secret box ticked — above an Add variable action.](/images/platform/settings-environment.webp)

</Frame>

## Variables and secrets

Open **Settings > Environment**. **Add variable** adds a row to the list — a name, a value, and the **Secret** switch — and the page's **Save** writes every pending change at once. A plain variable is stored as-is and shown back in full. A secret is encrypted the moment it is saved and is write-only from then on: the list shows `••••••••` in its place, and there is no way to read it back. If you are unsure a secret's value is right, replace it rather than hunting for a reveal button that does not exist. **Remove** on a row asks for confirmation — _Remove variable?_ — and takes effect when you save.

## Names, values, and limits

A name must start with a letter or underscore and contain only letters, numbers, and underscores — the shape of an ordinary environment variable, `MY_API_KEY` rather than `my-api.key`. A name that breaks the rule is refused when you save, and so is a duplicate. Names are capped at 128 characters and values at 8,192, and you can keep up to 100 entries. Values are stored exactly as typed: nothing trims a stray space or line break from a pasted token, so check the paste before you save.

## What a run receives instead

The values a sandbox actually holds come from three places, none of them this page. A **project agent** carries the organization's **Secrets** — an API key handed to the agent as an environment variable, injected per run and gone when it ends; that is the route for a token a service without a connector needs, and [Project agents](/platform/projects/project-agents) covers it. A GitHub token arrives per run while the agent has the GitHub connector equipped. And the credential a turn uses to reach its model belongs to the organization's provider records under [Providers](/platform/admin/providers), where it can be rotated and audited in one place — an agent holds no keys of its own.

## Where this fits

Environment variables & secrets is a store with no consumer in this version: entries are kept per member and per organization, secrets are encrypted and write-only, and no run reads them. Put what a project agent needs into its **Secrets**, and read [Harnesses](/platform/agents/harnesses) for what else the container holds and what it may reach. For the rest of your personal settings — display name, password, custom instructions — see [Preferences](/platform/member/preferences).
