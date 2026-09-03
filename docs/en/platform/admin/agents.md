---
title: Agents (admin view)
description: What agents exist in this version and how an admin governs them — project agents on each project's Agents tab, and file-based agent personas in the organization's configuration.
---

There is no org-wide **Settings > Agents** directory in this version of Tale, and no per-agent policy or ownership screen. Agents live in two places instead: **project agents**, the named crew a project staffs on its **Agents** tab and puts to work on board tasks, and **agent personas**, configuration files the platform reads from the organization's config tree and serves through its own API. This page is the admin's map of both — where each kind lives, who may change it, and which levers an Owner or Admin actually holds.

Building an agent is covered elsewhere: [Project agents](/platform/projects/project-agents) walks the dialog, and [Agent concepts](/platform/agents/concepts) explains what a persona carries. What follows is the governance side.

## Project agents — the agents with a screen

A project's **Agents** tab lists its agents: each row names a coding [harness](/platform/agents/harnesses), the provider that serves its model, the model itself, and how much it is equipped with. Anyone with edit access to the project creates, edits, and deletes them — up to 50 per project — and the equipment list follows the project's team access rather than the editor's personal visibility. An agent is put to work by assigning it a board task and clicking **Start agent**; it works in an isolated sandbox and parks the result at **In review** for a person to accept.

The levers an admin holds sit one level up, on the organization:

- **Providers** decide which models and credentials an agent can be created on at all; a model whose provider can no longer serve it fails the run with the reason instead of switching bills. Manage them under **Settings > AI providers** — see [Providers](/platform/admin/providers).
- **Connectors and skills** decide what an agent can be equipped with. Connect services under **Settings > Connectors**, curate bundles under **Settings > Skills**.
- **Secrets** an agent receives as environment variables are owned by the organization, stored encrypted, never shown again, and reused across agents — rotate one in one place.
- **Budgets and policies** cap spend and gate actions organization-wide; see [Policies and limits](/platform/admin/governance/policies-and-limits).
- **Project membership** decides who may edit a project's crew at all — [Members and roles](/platform/admin/members-and-roles) covers roles, [Teams](/platform/admin/teams) the team grants.

## Agent personas — configuration, not a screen

A persona is a YAML file in the organization's configuration: a slug, a display name and description, optional per-locale versions of those strings, instructions, a tools allowlist and a skills allowlist, a knowledge scope, and a **visibility** of `private` or `org` with a recorded owner. Every organization is seeded with one, `coding-agent`. No screen in this version lists, edits, or picks a persona — the chat composer has no agent picker, and the chat assistant runs with a fixed, read-only tool loadout — so personas move through the configuration tree and the platform's own API.

The rules the API enforces are the ones an admin should know:

- **Who sees what.** An `org` persona is visible to every member. A `private` persona is visible to its owner only — an Owner or Admin cannot read it, and asking for it answers as if it did not exist.
- **Who edits what.** The owner always may. Owners and Admins — anyone who may write the organization's settings — may edit and delete every `org` persona, so a member who leaves cannot strand shared configuration.
- **Ownership by adoption.** A new persona belongs to whoever created it and starts `private`; turning a shared persona back to `private` when it has no recorded owner makes the editor its owner, because a private persona nobody owns would be reachable by nobody.
- **History.** Every save keeps the superseded file in a history trail, and restoring an earlier entry snapshots the current one first — a restore is additive, never destructive. A persona that fails to parse is reported with its path rather than silently dropped from the roster.

Self-hosted operators reach the files directly — the project layout is on [AI-assisted development](/develop/ai-assisted-development) and the CLI on [CLI install](/self-hosted/install/cli-install).

## Where this fits

Admin governance of agents in this version is indirect on purpose: you shape what every agent may use — providers, connectors, skills, secrets, budgets — and who may edit each project, rather than editing agents one by one. The day-to-day work happens on each project's **Agents** tab, walked in [Project agents](/platform/projects/project-agents); the persona model is [Agent concepts](/platform/agents/concepts); and the roles behind the rules above are [Members and roles](/platform/admin/members-and-roles).
