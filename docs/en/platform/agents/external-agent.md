---
title: External agents
description: The built-in Claude Code agent that runs inside an isolated sandbox; you chat with it directly as it edits files, runs commands, and continues the work across turns.
---

Tale ships a built-in **external agent** — **Claude Code** — whose whole turn runs inside an isolated sandbox. Instead of the normal chat loop, your message is handed to that coding agent, which lives in a fresh container, edits files, runs commands, and reports back. You talk to it directly in the chat, and it keeps the same working directory and conversation across turns, so a follow-up like "now add a test for that" continues where it left off.

It is the same idea as running such a tool on a remote machine, except the machine is a managed sandbox the workspace controls. This page covers how to use it, what the sandbox can and cannot reach, and how it is billed.

## Talking to a coding agent

Pick **Claude Code** in the chat picker and describe a task in plain language — "write a small Python CLI and test it", "clone this repo and fix the bug in issue #42". The agent works inside its sandbox: it plans, writes files, runs shell commands, and installs packages as needed, then replies with what it did. While it works you see a thinking indicator; the reply lands when the turn finishes.

You do not have to wait for a turn to finish. The composer stays open while the agent works: anything you send waits in a **Queued messages** tray above the composer and is handed to the running agent at its next opportunity — for Claude Code that is mid-turn, at the agent's next tool boundary, so a correction like "use pnpm, not npm" lands while the work is still going. The message enters the thread itself only at that pick, in the exact spot where it took effect; until then you can remove it (the × on its row). Pressing **Stop** ends the current turn; messages still waiting are sent automatically a few seconds later as the next turn, with the agent's context intact.

Each chat thread is backed by one persistent sandbox session. Follow-up messages reuse the same session and the same files, and the agent resumes its earlier reasoning rather than starting cold. Because the session belongs to the thread, the thread also keeps its agent: the chat picker pins to it, and switching agents elsewhere never re-routes this thread — start a new chat to use a different one. Deleting or archiving the thread tears the sandbox down and frees its resources.

## What the sandbox can reach

The sandbox starts from an empty working directory and is locked down by default. Outbound network is denied except for a small allowlist (package registries and GitHub), so the agent can install dependencies and clone public repositories but cannot reach arbitrary hosts. By default the model is reached through the workspace's gateway, never a raw provider key — the sandbox only ever holds a short-lived, budget-scoped key for that turn. That default is the agent's _managed_ credential mode; the _bring-your-own_ alternative, covered below, deliberately puts your own provider key inside the box instead.

Beyond that lockdown, the agent can reach any integration your org has connected — search the web through Tavily, call an API, query a database — as long as that integration is bound to the agent. You bind them the same way as for any other agent: open the agent's **Tools** tab and pick them under **Bound integrations**. The credential never enters the sandbox; when the agent calls an integration, the request is brokered back to Tale, which runs the call with the stored credential and hands back only the result, so a compromised container cannot read your keys. A write operation does not run silently — it surfaces as an approval card in the chat and proceeds once you approve it.

GitHub is the exception that also places a token inside the sandbox, because `git` and the `gh` CLI need it locally: connect GitHub under [Integrations](/platform/integrations/overview) and bind it to the agent, and the session receives a scoped token so the agent can clone, push, and open pull requests on your behalf. Every credential — the in-sandbox GitHub token and the brokered ones alike — is scoped to the session, audited on each call, and revoked when the session ends.

## Managed and bring-your-own credentials

How the agent reaches its model is a per-agent choice, set on the agent's **Instructions** tab under **Credentials**. The two modes trade platform control for direct access.

**Managed (platform gateway)** is the default and what every section above describes. The platform mints a short-lived virtual key for the turn, routes the agent through its gateway, enforces the agent's allowed models, meters usage, and applies the org's spend caps. The sandbox never holds a real provider key.

**Bring your own credentials (BYO)** takes the platform out of the request path. No virtual key is minted; the agent authenticates with credentials you store under [Environment variables & secrets](/platform/member/environment) and reaches the provider directly. The model becomes a raw provider id you type verbatim rather than a catalogue entry, and the agent's native web search and fetch are left enabled rather than disabled. Because the gateway is bypassed, the org's model allowlist, spend caps, and usage metering do not apply to BYO turns — billing and limits move to your own provider account. Switching an agent from managed to BYO clears its saved platform models, since catalogue references mean nothing to a raw passthrough; you re-enter the raw ids.

That is also a shift in the trust boundary. In managed mode the sandbox holds only a budget-scoped gateway key; in BYO mode your real provider credential is injected into the sandbox environment — the same posture as the in-sandbox GitHub token — so any code the agent runs in the box can read it. That is by design: it is your box and your credential. Configuring an agent is already a privileged action, so the per-agent toggle is the only control; there is no separate org-level switch.

## Engines and models

**Claude Code** is its own entry in the chat picker. In managed mode the model is independent: it comes from the agent's supported-models list the same way it does for any other agent, so you pick it in the model selector. Note that a coding agent's prompts work best against the model family it was designed for; pairing it with an unrelated model still works but quality varies.

The shipped default is Claude Fable 5, and Fable capacity is rationed: a request its safety classifiers flag, an overloaded model, or exhausted Fable usage does not fail the turn — the session falls back automatically to the catalogue entry's fallback model, Claude Opus 4.8. Opus 4.8 also stays in the model selector as a manual switch.

A bring-your-own agent picks its model differently. Instead of the provider catalogue you type raw provider model ids — `claude-opus-4-20250514`, say — in priority order, the first as the primary and the rest as fallbacks. If the agent sits on a catalogue model, a bring-your-own session automatically requests that entry's vendor-native id instead — catalogue ids only exist on the gateway, and the shipped Anthropic entries each declare their native counterpart (the Fable default maps to `claude-fable-5`). A model you typed yourself is never rewritten. The list is optional; leave it empty and your credential's own default model decides. The chat model picker reflects this: for a BYO agent it shows a read-only indicator — the model's short name, or **Default model** when the list is empty — rather than the catalogue dropdown, because the model is fixed by the agent's configuration and your credential, not chosen per message.

## Cost and budget

External-agent turns can be long and call the model many times, so they cost more than a single chat reply. Each managed turn runs against a per-turn budget, and the org's [Policies and limits](/platform/admin/governance/policies-and-limits) cap spend per user, per team, or per agent. Usage is metered into [Usage analytics](/platform/admin/governance/usage-analytics) alongside every other agent, attributed to the external agent so you can see what these runs cost.

This accounting is a property of the gateway, so it covers managed turns only. A bring-your-own agent runs on your own provider credential outside the gateway: its turns are not metered into Usage analytics and the org's spend caps do not apply, and the cost and any rate limits live with your provider account instead.

## Where this fits

An external agent turns a chat thread into a live session with a coding tool in a sandbox — you drive it in plain language, it works in an isolated workspace, and the session persists for follow-ups until you close the thread. Credentials are the axis that decides how much of that runs under the org's control: a managed agent stays on the platform gateway under the org's caps and metering, while a bring-your-own agent runs on the keys you keep under [Environment variables & secrets](/platform/member/environment) and answers to your own provider account. The drift candidates here are the agent and model names; pair this page with the running [Providers](/platform/admin/providers) list rather than memorising specific model strings, and with [Integrations](/platform/integrations/overview) for the connected integrations the agent can reach — from GitHub for a real pull-request workflow to a search or data integration that pulls outside facts into the work.
