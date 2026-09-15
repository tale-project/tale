---
title: Equip agents with skills
description: Choose reusable skill bundles for project agents and automation nodes, understand their access scope, and check how they run.
---

Equip an agent with a skill when it needs a reusable procedure or reference material from the organization's [skill library](/platform/workspace/skills). The library stores the bundle; the agent's equipment determines which bundles are available to its runs.

## Choose a skill for the task

A useful skill explains when to use it, how to perform the work, and what a good result looks like. For example, equip a release-note skill with the agent that prepares releases, then give it a small set of changes and check its output against your expected format.

The bundle contains `SKILL.md` and may include references, assets, or scripts. Importing it does not execute those files. Once equipped, its instructions can guide a coding agent that has a shell or other tools, including running a bundled script. Review the whole bundle before use; a skill does not add a separate permission boundary.

## Equip a project agent

Open the [project agent](/platform/projects/project-agents) and select the needed skills in its equipment. The available list follows the project's access, even if you personally can read more skills:

| Project scope | Available skills |
| --- | --- |
| Organization-wide project | Organization skills |
| Project shared with teams | Organization skills and team skills shared with at least one of the project's teams |

Legacy private skills cannot be equipped on a project agent. The same access rule is checked when a task runs; selecting a skill does not grant the project permanent access to it.

## Use skills in an automation

An automation's agent nodes declare the skills they need. A run bound to a project uses that project's scope. An organization-level run can use organization skills only. Your personal membership in additional teams does not expand either scope.

During sandbox setup, Tale stages the equipped bundles as files and gives the agent paths to their `SKILL.md` instructions. Supporting files are available alongside those instructions. Keep the equipment focused and tell the agent which procedure matters for the task; availability alone does not prove that the result followed it.

## Resolve missing or changed skills

If a required skill is missing or is no longer shared with the run's scope, staging fails and names the unavailable skill. Check its slug, visibility, the project's teams, and whether it was deleted or replaced. Restore the intended access or remove the obsolete equipment before retrying.

Changes to a shared bundle affect later staging for its users. Review replacements and test an agent with a known input after a substantial change. Do not assume a repository's similarly named skill overrides the equipped bundle.

## Choose skills or agent instructions

| Put it in a skill when… | Put it in agent instructions when… |
| --- | --- |
| Several agents share the procedure. | It defines this agent's role or voice. |
| The procedure needs reference files or scripts. | It is a short, stable rule for this agent. |
| Maintainers should update the procedure in one place. | It describes how this agent should use its equipped skills. |

Use the [skill library guide](/platform/workspace/skills) to create, import, edit, and share a bundle.
