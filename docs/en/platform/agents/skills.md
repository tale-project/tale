---
title: Agent skills
description: Binding a skill from the organization's library to one agent — the allowlist on the Skills tab, its ceiling, and how a bundle reaches a sandbox session.
---

An agent reaches a skill only when you bind it. The organization's [skill library](/platform/workspace/skills) holds the bundles, and an agent's **Skills** tab is the allowlist naming which of them this persona may expand. Bind one bundle to three agents and the behaviour stays in a single file, maintained once.

This page is the agent side of skills: what a binding decides, what the ceiling is, and what changes when the turn runs in a sandbox. Writing and sharing the bundles themselves happens in the library.

## What a binding decides

A bound skill is offered to the agent by its description. When the model judges that description relevant to what you asked, it expands the bundle — it reads the `SKILL.md` body, then opens individual bundle files where the body points at them. Nothing is executed and nothing is pasted in up front, so a skill costs context only on the turns where the agent actually reaches for it.

A bundle whose frontmatter carries `disable-model-invocation: true` behaves differently. It stays bound and stays readable, but the model must not reach for it unprompted; it waits for a turn where somebody names it.

## Bind a skill to an agent

Open the agent, switch to **Skills**, and pick from the organization's library. A counter beside the list shows what you have used against the ceiling: an agent may bind **at most ten skills**. Ten is deliberate — a binding list is a hard allowlist someone maintains by hand, and past a handful it stops being one.

Treat the list as an allowlist rather than a hint. An agent whose list is empty expands no skills at all; there is no implicit fallback to everything the organization happens to share. Binding is per agent and symmetric — two agents can bind the same bundle, and unbinding takes effect from the next request.

<Note>

Which bundles you can pick from is decided in the library, not here: an `org` skill is offered across the organization, a `private` one only where its owner works. Sharing a bundle is an edit to its `visibility` field on the [skill library](/platform/workspace/skills) page.

</Note>

## When the bundle changes underneath

A binding names a slug, never a snapshot. Replace a bundle in the library and every agent bound to it reads the new text from its next request — there is no version to pin and no re-binding to do afterwards. That is what makes a skill worth extracting in the first place: one edit reaches every agent that holds it.

<Warning>

Deleting a skill removes the bundle from disk, and every agent bound to it loses access with nothing to fall back on. Replace the bundle instead when you want to change what it says, and delete only once you have checked which agents still name it.

</Warning>

## Skills in a sandbox session

When a turn runs in a sandbox, bound bundles do not arrive through a tool call. They are staged into the session as files, in the layout the runtime already knows how to discover, so the coding agent finds them the way it would find a skill on any machine it works on.

One rule governs collisions: the repository wins. If the checked-out repository ships a skill under the same slug as one Tale would stage, Tale withholds its copy and the repository's version stands. A repository can always override what the platform would otherwise teach the agent, and the session never holds two bundles claiming the same name. Matching is exact, so a slug that differs by a single character is a different skill and both get staged.

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

Binding is the narrow half of skills: the library decides what exists and who may see it, and the **Skills** tab decides which persona may expand what. Keep the lists short, prefer replacing a bundle over cloning it, and let a repository override what the platform stages when an agent works inside one. The other half of the story — writing a `SKILL.md`, uploading a zip, and sharing a bundle across the organization — is the [skill library](/platform/workspace/skills).
