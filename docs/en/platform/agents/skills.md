---
title: Agent skills
description: A skill is a reusable bundle of instructions and an optional sandbox script you can attach to an agent. This page hands you the mental model for when to reach for a skill instead of editing the agent's instructions.
---

A skill is the unit Tale reaches for when the same pattern appears across multiple agents. It is a reusable bundle — a chunk of instructions, and optionally a sandbox script the agent can call — that you attach to an agent the way you attach a tool. Editors and Developers publish skills at the org level; agents pick from the org's skill library.

This page hands you the mental model for when a skill is the right move and when inline instructions are. Read it before you publish your first skill; come back when an agent's instructions are getting long and you are wondering if the right answer is to split them into a skill.

## What a skill bundles

A skill carries two things:

- **Instructions** — prose that frames a specific behaviour. The skill's instructions append to the agent's own at request time; the agent reads both as one long prompt.
- **An optional script** — code that runs in the sandbox when the agent calls the skill as a tool. The script's inputs and outputs are typed; the agent passes JSON, the skill returns JSON.

A pure-instruction skill is the right shape when the behaviour is voice or constraint — "always cite the source by section number", "refuse questions outside this product". A skill with a script is the right shape when the behaviour is a calculation, a transformation, or a multi-step task the model would otherwise have to do in tokens.

## Attaching to an agent

A skill becomes visible to an agent by attachment. The agent's editor lists the org's available skills under the **Skills** tab; check the ones that apply. Attached skills always inject their instructions; a skill with a script also appears in the agent's tool list as the agent can choose to call.

The attachment is per agent: two agents can attach the same skill and the agent's behaviour is the union of its instructions and the skill's. Detaching is symmetric — the next request runs without the skill.

## Skill scripts and the sandbox

Skill scripts run in the same sandbox as the **Run code** tool: Python or Node, allowed packages declared per skill, package installs gated by the org's [run-code policy](/platform/admin/governance/run-code-policy). Network egress from the sandbox is open by default; self-hosted operators can restrict it at the deployment level. The script's contract is a typed input and a typed output; what runs in between is yours.

The trust boundary is sharp. A skill script can be invoked by any agent it is attached to. Treat publishing a skill as widening the trust surface for every agent that picks it up; the [governance policy on run-code](/platform/admin/governance/run-code-policy) gates which packages the script can install.

## Versioning

Skills are versioned. Saving a skill creates a new version; the agent that attaches the skill pins to a specific version. Updating a skill does not automatically propagate — agents pick up the new version on save. This is intentional: a skill is a contract, and versioning the contract is how you keep the contract.

## When to reach for it

| Use … when                                                      | Skill | Inline instructions |
| --------------------------------------------------------------- | ----- | ------------------- |
| The pattern repeats across multiple agents                      | ✓     |                     |
| The behaviour involves a script the model would otherwise mimic | ✓     |                     |
| The behaviour is one agent's voice                              |       | ✓                   |
| You want the org to govern the behaviour through a single edit  | ✓     |                     |
| The agent's instructions still fit on one screen                |       | ✓                   |

Inline instructions are the right shape for one agent. Skills are the right shape when the same behaviour shows up in two or three agents and the maintenance cost of keeping their inline instructions in sync starts to bite.

## Build one

Skills are the level of abstraction above the four knobs — they let you ship a behaviour once and have every agent that needs it pick it up by attachment. The natural next walk is [Build a custom tool](/tutorials/developer/build-a-custom-tool) — it walks publishing a skill with a script from a blank page through agent attachment.
