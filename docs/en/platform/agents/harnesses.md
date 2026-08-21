---
title: Harnesses
description: Coding CLIs that run a model in an isolated sandbox — which harnesses ship, where you pick one, where the credential comes from, and what the box can reach.
---

A **Harness** is a shipped coding CLI — Claude Code, Codex, Cursor, and peers — that runs your chosen model inside an isolated container instead of the ordinary chat loop. The harness plans, writes files, runs commands, installs packages, and reports back. You never pick a harness from the chat composer: chat selects a **model** only. The harness is chosen when you create a **project agent** — its dialog calls the field **Agent type** — or an automation **agent** node, where it is labeled **Harness**.

This page covers which harnesses ship with Tale, where you bind one, where the credential comes from, and what the container can and cannot reach. The credentials themselves are an organization-level surface — see [Providers](/platform/admin/providers). **Settings > Providers** also has a **Harnesses** tab that shows how each harness would resolve for the organization.

## Where you pick a harness

Open a project's **Agents** tab and create or edit an agent. The dialog asks for an **Agent type** — the harness, the coding CLI that agent will run on — alongside its model, equipment, and instructions. Assign a board task to that agent and it works in a sandbox on that harness.

In an automation, an **agent** node carries the same **Harness** field. When the workflow reaches that node, the turn runs on the chosen harness.

Chat never lists harnesses. The composer's picker is models only; harness work arrives through a project agent or an automation agent node, not through a composer group.

## What a harness turn is

Describe a task in plain language — "write a small Python CLI and test it", "clone this repository and fix the bug in issue 42". The message goes to the harness rather than to the model directly. The harness drives the model in a loop inside the container, deciding for itself when to read a file, run a command, or try again, and the reply lands when its turn finishes.

Two things follow from that. The work is real rather than described: files exist, commands actually ran, and their output is what the model reasoned over. And the shape of the turn belongs to the harness, not to Tale — a harness with a plan mode ends its turn with a proposal you can review, and one built for single shots simply runs to completion.

## The harnesses that ship

Nine harnesses ship with the platform. They differ in how they take a prompt, whether they can be steered mid-turn, and whether they can reach MCP servers.

| Harness     | Credentials it accepts | Worth knowing                                                                                                  |
| ----------- | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Claude Code | Managed or your own    | The most capable: steerable mid-turn, and a plan mode that ends in a reviewable proposal. Reaches MCP servers. |
| Codex       | Managed or your own    | One-shot turns. Reaches MCP servers.                                                                           |
| Cursor      | Your own only          | One-shot turns. Its CLI cannot route through the platform gateway, so a managed credential is refused.         |
| Gemini CLI  | Managed or your own    | One-shot turns. Reaches MCP servers.                                                                           |
| Hermes      | Managed or your own    | One-shot turns, with no MCP channel.                                                                           |
| OpenClaw    | Managed or your own    | One-shot turns. Reaches MCP servers.                                                                           |
| OpenCode    | Managed only           | One-shot turns. Reaches MCP servers. Runs through the gateway, so your own key is refused.                     |
| Pi          | Managed or your own    | One-shot turns, with no MCP channel.                                                                           |
| Qwen Code   | Managed or your own    | One-shot turns. Reaches MCP servers.                                                                           |

Steering is what the difference buys you in practice. With Claude Code, a correction you send while the turn is running reaches the agent at its next tool boundary — "use pnpm, not npm" lands while the work is still going. Every other harness picks a queued message up at the turn boundary instead.

## Where the credential comes from

The credential is the organization's, not the agent's. An agent holds no keys of its own, and there is no per-agent credential tab; what a turn authenticates with follows from the provider credential behind the model you picked, configured under [Providers](/platform/admin/providers). Which of two postures a turn runs in follows from the kind of credential that is.

**A stored API key, or one read from a deployment environment variable**, stays with the platform. Tale mints a session-scoped gateway key for the turn, and the harness authenticates with that rather than with the real secret, so the container never holds a credential that outlives the session. This is the managed posture, and the only harness that refuses it is Cursor.

**A vendor subscription** — a coding-plan key, a portal key, an OAuth blob, or a pool of rotating tokens fetched from a broker — works differently, because vendors sanction those credentials for their own agent tooling and nothing else. A subscription credential therefore forces the turn onto one specific harness: asking for a plain chat turn is refused with a reason naming that harness, and asking for a different harness is refused too. The secret is injected into the session environment, which is bring-your-own posture, so the forced harness has to accept it — OpenCode, being gateway-only, refuses.

<Note>

A harness turn always names a concrete harness. Nothing guesses one for you: the only case where a harness arrives on its own is the subscription credential that carries its forced choice with it.

</Note>

## What the sandbox can reach

The container starts from an empty working directory and is locked down by default. Files and folders you pin with `@` ride along into the session under `/agent/uploads/`, so the agent opens the real bytes rather than a retrieval snippet, and what it writes under `/agent/output/` comes back into the chat as a file. Outbound network is denied apart from a narrow allowlist — package registries and GitHub — so the agent can install what it needs and clone a public repository without being able to reach arbitrary hosts.

Connected connectors reach the agent through a broker rather than through the box. When the agent calls one, the request goes back to Tale, which runs it with the stored credential and hands back only the result, so a compromised container cannot read your keys. A write surfaces as an approval card in the chat and proceeds once you approve it. GitHub is the deliberate exception: `git` and the `gh` CLI need a token locally, so a turn runs with a scoped one while the conversation has the GitHub connector equipped — injected per turn, gone when the turn ends.

Skills bound to the agent are staged into the session as files rather than fetched through a tool, and a skill the checked-out repository ships wins over the copy Tale would stage — [Agent skills](/platform/agents/skills) covers that precedence rule. Your own [environment variables and secrets](/platform/member/environment) are set in the container too, which is how a personal token or endpoint reaches the work without anyone else's session seeing it.

## Cost and metering

A harness turn can be long and call the model many times, so it costs more than a single chat reply. Managed turns run through the gateway, which is what makes them meterable: they land in [Usage analytics](/platform/admin/governance/usage-analytics) alongside every other turn, and the organization's [Policies and limits](/platform/admin/governance/policies-and-limits) cap what they may spend.

Turns on a subscription credential bypass the gateway by design, since the secret goes into the container and the vendor's own tooling talks to the vendor directly. Those turns are not metered and the organization's spend caps do not reach them — the accounting lives with whoever owns the subscription.

## Where this fits

A harness turns a project agent or an automation agent node into a live session with a coding tool in an isolated container: you drive it in plain language, it works on real files, and the harness decides the rhythm of the turn. Chat stays model-only; the **Harness** field lives on the agent or the automation node. The axis that decides how much of it stays under the organization's control is the credential — a stored key keeps the turn on the gateway, under the caps and in the metering, while a vendor subscription pushes it into the box and onto that vendor's own account. Pair this page with [Providers](/platform/admin/providers) for the credential side and [Connectors](/platform/connectors/overview) for what the agent can reach once it is running.
