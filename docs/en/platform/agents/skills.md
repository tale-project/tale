---
title: Agent skills
description: A skill is a reusable bundle — a SKILL.md plus optional scripts and references — that agents read at runtime. This page covers when to reach for one instead of longer instructions.
---

A skill is the unit Tale reaches for when the same pattern appears across multiple agents. It is a reusable bundle — a `SKILL.md` with instructions, plus optional scripts, references, and assets — that lives in the org's skill library and that agents read at runtime. Bind the same skill to three agents and you maintain the behaviour in one place.

This page hands you the mental model for when a skill is the right move and when inline instructions are. Read it before you upload your first skill; come back when an agent's instructions are getting long and you are wondering whether to split them out.

## What a skill bundles

A skill is uploaded as a zip with `SKILL.md` at the root. The file's frontmatter carries the metadata — description, license, recommended Python or Node versions — and the body carries the instructions. Bundle assets live under `scripts/`, `references/`, or `assets/`: code the agent can run when it works in a sandbox, and reference material it can read on demand.

A pure-instruction skill is the right shape when the behaviour is voice or constraint — "always cite the source by section number", "refuse questions outside this product". A skill with scripts is the right shape when the behaviour is a calculation, a transformation, or a multi-step task the model would otherwise have to improvise in tokens.

## Binding to an agent

A skill becomes visible to an agent by binding it on the agent's **Skills** tab — **Bound skills** lists the org's library with a checkbox per skill. An agent can bind at most ten skills, and an agent with none bound sees none: there is no implicit fallback to org-wide visibility. The agent reads a bound skill at runtime — the description tells it when the skill applies, and it pulls in the body and bundle files when they do.

The binding is per agent: two agents can bind the same skill, and unbinding is symmetric — the next request runs without it.

For **external agents** (Claude Code, Cursor, and other sandbox runtimes), workflow disciplines such as fix-bug and write-notes load automatically each turn — you do not bind them on the Skills tab. Use the tab to bind **extra org skills** only; bound skills are staged into the session as files the runtime discovers natively.

## Managing the library

Managing skills takes Admin or Developer permissions. The library lives in the org's Skills settings, where each skill shows its overview, instructions body, bundle file tree, and a **Recent changes** audit trail. **Upload skill** adds a new bundle, **Replace bundle** overwrites an existing one in place, and **Duplicate** forks it under a new slug.

<Warning>

There is no version pinning: replacing a bundle changes what every bound agent reads from the next request, and deleting a skill removes the bundle from disk — any agent currently bound to it loses access.

</Warning>

## When to reach for it

| Use … when                                                     | Skill | Inline instructions |
| -------------------------------------------------------------- | ----- | ------------------- |
| The pattern repeats across multiple agents                     | ✓     |                     |
| The behaviour involves scripts the model would otherwise mimic | ✓     |                     |
| The behaviour is one agent's voice                             |       | ✓                   |
| You want the org to govern the behaviour through a single edit | ✓     |                     |
| The agent's instructions still fit on one screen               |       | ✓                   |

Inline instructions are the right shape for one agent. Skills are the right shape when the same behaviour shows up in two or three agents and the maintenance cost of keeping their inline instructions in sync starts to bite.

## Build one

Skills are the level of abstraction above the four knobs — they let you ship a behaviour once and have every agent that needs it pick it up by binding. The natural next walk is [Build a custom tool](/tutorials/developer/build-a-custom-tool) — it goes from a blank page to a skill with scripts bound to an agent.
