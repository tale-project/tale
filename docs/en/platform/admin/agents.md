---
title: Agents (admin view)
description: Govern project-agent access, providers, equipment and secret grants through the project's permissions and the organization's resources.
---

Agents belong to projects, and their management follows project permissions. As an Owner or Admin, you control the resources they may use and who can change their configuration. This page explains those boundaries; [Project agents](/platform/projects/project-agents) covers the day-to-day setup.

## Decide who can manage the roster

Project readers can see its agents. People with project edit access can create, update and delete agents in an active project; archived projects remain readable. Each project holds up to 50 agents with names unique inside that project.

An agent ID belongs to its project. Access to two projects does not let someone use one project's agent ID to change a record through the other project. [Members and roles](/platform/admin/members-and-roles) and [Teams](/platform/admin/teams) explain the access rules behind the roster.

## Control the resources agents use

- **Providers** supply the models and credentials for execution. Manage the available engines through [Providers](/platform/admin/providers).
- **Connectors, skills and tools** determine which services, reference material and platform operations an agent can reach. Grant only the equipment its work needs.
- **Secret grants** give a run the values of named organization secrets. Only an organization Owner or Admin can change the granted names. An editor can save other configuration while preserving the existing grants.
- **Budgets and policies** govern spending and actions across the organization; see [Policies and limits](/platform/admin/governance/policies-and-limits).

Secret values are stored encrypted and are never returned with the agent configuration. Rotating a secret changes the organization-owned value used by agents that reference its name.

## Apply the same rules to integrations

The public API requires a project ID for every agent operation and applies the key holder's project permissions. It reads and writes the same roster as the project interface. The [API reference](/develop/api-reference#manage-a-projects-agents) provides the routes and a complete example.

An update supplies the full configuration, including secret grants that should remain. Omitting those grants asks to clear them, which requires the same administrative permission as adding a grant.

## Review the project's setup

Review the project membership together with the agent's model, equipment and secret grants. [Agent concepts](/platform/agents/concepts) explains how those choices fit together, and [Project agents](/platform/projects/project-agents) covers the configuration used for tasks.
