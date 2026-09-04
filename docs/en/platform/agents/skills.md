---
title: Skills on agents
description: How a skill from the library reaches an agent — equipping a project's agents, whose visibility counts, and how a bundle lands in a sandbox session.
---

An agent reaches a skill only when it is equipped, and equipping is a pick from the organization's [skill library](/platform/workspace/skills). This page is about the surfaces that pick — a project's agents and an automation's agent nodes. One rule decides what they may pick: **the project's own visibility counts, never the configuring member's.**

## What equipping decides

An equipped skill is offered to the model by its description. When the model judges that description relevant to what you asked, it reads the `SKILL.md` body, then opens individual bundle files where the body points at them. Nothing is executed and nothing is pasted in up front, so a skill costs context only on the turns where the model actually reaches for it.

A bundle whose frontmatter carries `disable-model-invocation: true` behaves differently. It stays equipped and stays readable, but the model must not reach for it unprompted; it waits for a turn where somebody names it.

## Equip a project's agents

A [project agent](/platform/projects/project-agents) carries its own equipment, picked in the capability menu on the agent's dialog. The list there follows the **project's** visibility, not yours: organization-wide skills, plus team skills shared with any of the project's teams. An org-wide project sees organization skills only, and nobody's legacy private skills ever appear — a project agent runs for every member of the project, so its equipment must never smuggle in something only its author could see.

The same scope holds at run time. A task run stages the agent's skills as the project; an org-level automation stages as the organization. A skill that stops being visible to that scope fails the run by name rather than quietly running without it — deliberate equipment silently missing is worse than a failed run.

## Skills in a sandbox session

When a turn runs in a sandbox, equipped bundles do not arrive through a tool call. They are staged into the session as files, in the layout the runtime already knows how to discover, so the harness finds them the way it would find a skill on any machine it works on.

One rule governs collisions: the repository wins. If the checked-out repository ships a skill under the same slug as one Tale would stage, Tale withholds its copy and the repository's version stands. A repository can always override what the platform would otherwise teach the agent, and the session never holds two bundles claiming the same name.

## Skill or instructions

| Use … when                                              | Skill | Agent instructions |
| ------------------------------------------------------- | ----- | ------------------ |
| The pattern repeats across several agents               | ✓     |                    |
| The behaviour needs reference files alongside the prose | ✓     |                    |
| The behaviour is this one agent's voice                 |       | ✓                  |
| One edit should reach everyone who uses the behaviour   | ✓     |                    |
| The agent's instructions still fit on one screen        |       | ✓                  |

Instructions are the right shape for one agent's own character. A skill is the right shape as soon as the same behaviour turns up in a second and third agent and keeping their instructions in step starts to cost you.

## Where this fits

Equipping is the narrow half of skills: the library decides what exists and who may see it; a project's agent dialog and an automation's agent nodes decide where it gets used — always through the project's or the organization's own visibility. Keep equipment lists short, prefer replacing a bundle over cloning it, and let a repository override what the platform stages when an agent works inside one. The other half of the story — writing a `SKILL.md`, uploading a folder, and sharing a bundle — is the [skill library](/platform/workspace/skills).
