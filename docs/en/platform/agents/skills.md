---
title: Skills on agents
description: How a skill from the library reaches a conversation or an agent — the chat equip menu, the one-turn / command, project agents, and whose visibility counts where.
---

A chat or an agent reaches a skill only when it is equipped, and equipping is a pick from the organization's [skill library](/platform/workspace/skills). This page is about the surfaces that pick — the chat composer, the `/` command, and a project's agents. One rule decides what each surface may pick: **in a chat, your visibility counts; in a project, the project's own does.**

## What equipping decides

An equipped skill is offered to the model by its description. When the model judges that description relevant to what you asked, it reads the `SKILL.md` body, then opens individual bundle files where the body points at them. Nothing is executed and nothing is pasted in up front, so a skill costs context only on the turns where the model actually reaches for it.

A bundle whose frontmatter carries `disable-model-invocation: true` behaves differently. It stays equipped and stays readable, but the model must not reach for it unprompted; it waits for a turn where somebody names it.

A skill's `usage-mode` decides which surfaces offer it at all: `chat` keeps it to conversations (the equip menu and the `/` command), `agent` keeps it to agents and automations, and `all` — the default — offers it everywhere.

## Equip a conversation

The capability menu beside the chat composer's model picker lists every chat-usable skill you can see, next to the enabled connectors. What you check there is the conversation's equipment: it stages into the agent's session and stays equipped for the whole thread.

Because a chat is yours, the list follows **your** visibility — your private skills, your teams' skills, and the organization's. A skill you lose sight of (reshared away, deleted) simply stops staging on your next turn.

## Invoke one skill for one message

Type `/` as the first character of the message and the composer offers the chat-usable skills you can see; keep typing to narrow, arrows to move, Enter to complete. A message like

```text
/release-notes everything merged since Tuesday
```

invokes that one skill for that one message: the bundle stages for the turn, the model is told to read it first and treat the rest of the message as its arguments, and the conversation's stored equipment is untouched. A `/something` that matches no skill you can use in chat sends as ordinary text — that fallthrough is the escape hatch, so there is nothing to escape.

## Equip a project's agents

A [project agent](/platform/agents/create) carries its own equipment, picked in the same capability menu on the agent's dialog. The list there follows the **project's** visibility, not yours: organization-wide skills, plus team skills shared with any of the project's teams. An org-wide project sees organization skills only, and nobody's private skills ever appear — a project agent runs for every member of the project, so its equipment must never smuggle in something only its author could see.

The same scope holds at run time. A task run stages the agent's skills as the project; an org-level automation stages as the organization. A skill that stops being visible to that scope fails the run by name rather than quietly running without it — deliberate equipment silently missing is worse than a failed run.

## Skills in a sandbox session

When a turn runs in a sandbox, equipped bundles do not arrive through a tool call. They are staged into the session as files, in the layout the runtime already knows how to discover, so the third-party agent finds them the way it would find a skill on any machine it works on.

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

Equipping is the narrow half of skills: the library decides what exists and who may see it; the chat menu, the `/` command, and a project's agent dialog decide where it gets used — each through its own visibility. Keep equipment lists short, prefer replacing a bundle over cloning it, and let a repository override what the platform stages when an agent works inside one. The other half of the story — writing a `SKILL.md`, uploading a folder, and sharing a bundle — is the [skill library](/platform/workspace/skills).
