---
title: Govern project agents
description: Review who can change agents, which resources they can use and how secret grants affect their runs.
---

Govern an agent through its project and the organization resources it uses. There is no separate organization-wide agent roster to configure: open the project from **Projects** in Home, then **Agents** to inspect or edit its workers.

## Establish who can change the agent

Anyone who can read the project can see its agents. People with project edit access may create, update or delete agents while the project is active. Archived projects remain readable. Review [members’ roles](/platform/admin/members-and-roles) and [team access](/platform/admin/teams) when the wrong person can or cannot manage a roster.

An agent belongs to one project. Neither its ID nor access to a second project lets an integration use it as that second project’s agent. Projects allow up to 50 agents, with names unique inside each project.

## Review the resources before work starts

Open the agent’s edit dialog and review the combination, rather than checking the model alone:

| Check | Why it matters | Where to resolve a problem |
| --- | --- | --- |
| Harness, model and provider | The credential must support that execution path. | [AI providers](/platform/admin/providers). |
| Skills and their sharing | The project’s team scope determines which bundles can be equipped. | [Skill library](/platform/workspace/skills) and project access. |
| Connectors and platform tools | They grant access to services and supported data operations. | [Connector credentials](/platform/admin/connectors) and the agent’s equipment. |
| Secrets | The running session can read the granted values. | The agent’s **Secrets** controls, available to Owners and Admins. |
| Sandbox capacity and spending | Work needs an available environment and an allowed budget. | [Sandboxes](/platform/admin/sandboxes) and [Policies and limits](/platform/admin/governance/policies-and-limits). |

For a review agent, repository read access and reporting tools may be enough. Granting a write tool authorizes its operations within its access rules; a standing instruction to ask first is not a substitute for removing an unnecessary grant.

## Handle secret changes deliberately

Only an Owner or Admin can change secret grants. An editor can update other fields while preserving the existing grants. Secret values are encrypted in organization storage and are not returned with the agent configuration, but a running agent receives the values it is granted.

Use narrowly scoped, replaceable credentials. A secret name may be shared by several agents or automation nodes, so rotating or deleting its organization value affects every future run that refers to it. Review those uses before changing it.

## Apply the same review to API clients

The public API reads and writes the same project roster and applies the key holder’s project permissions. Every operation includes a project ID. An update provides the full configuration, including secret grants to retain; omitting them requests their removal and therefore requires administrative permission.

Use the [project-agent API example](/develop/api-reference#manage-a-projects-agents) for integration details. After a configuration change, reopen the agent to check the saved model, equipment and grants, then give it a small task with an outcome a person can review. [Project agents](/platform/projects/project-agents) covers that workflow.
