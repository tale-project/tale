---
title: External agents
description: The built-in Claude Code agent that runs inside an isolated sandbox; you chat with it directly as it edits files, runs commands, and continues the work across turns.
---

Tale ships a built-in **external agent** — **Claude Code** — whose whole turn runs inside an isolated sandbox. Instead of the normal chat loop, your message is handed to that coding agent, which lives in a fresh container, edits files, runs commands, and reports back. You talk to it directly in the chat, and it keeps the same working directory and conversation across turns, so a follow-up like "now add a test for that" continues where it left off.

It is the same idea as running such a tool on a remote machine, except the machine is a managed sandbox the workspace controls. This page covers how to use it, what the sandbox can and cannot reach, and how it is billed.

## Talking to a coding agent

Pick **Claude Code** in the chat picker and describe a task in plain language — "write a small Python CLI and test it", "clone this repo and fix the bug in issue #42". The agent works inside its sandbox: it plans, writes files, runs shell commands, and installs packages as needed, then replies with what it did. While it works you see a thinking indicator; the reply lands when the turn finishes.

You do not have to wait for a turn to finish. The composer stays open while the agent works: anything you send is queued, appears in the thread immediately with a **Queued** badge, and is handed to the running agent at its next opportunity — for Claude Code that is mid-turn, at the agent's next tool boundary, so a correction like "use pnpm, not npm" lands while the work is still going. A queued message can be removed (the × next to the badge) until the agent picks it up. Pressing **Stop** ends the current turn; messages still queued are sent automatically a few seconds later as the next turn, with the agent's context intact.

Each chat thread is backed by one persistent sandbox session. Follow-up messages reuse the same session and the same files, and the agent resumes its earlier reasoning rather than starting cold. The session is the thread's — deleting or archiving the thread tears the sandbox down and frees its resources.

## What the sandbox can reach

The sandbox starts from an empty working directory and is locked down by default. Outbound network is denied except for a small allowlist (package registries and GitHub), so the agent can install dependencies and clone public repositories but cannot reach arbitrary hosts. The model itself is reached through the workspace's gateway, never a raw provider key — the sandbox only ever holds a short-lived, budget-scoped key for that turn.

Beyond that lockdown, the agent can reach any integration your org has connected — search the web through Tavily, call an API, query a database — as long as that integration is bound to the agent. You bind them the same way as for any other agent: open the agent's **Tools** tab and pick them under **Bound integrations**. The credential never enters the sandbox; when the agent calls an integration, the request is brokered back to Tale, which runs the call with the stored credential and hands back only the result, so a compromised container cannot read your keys. A write operation does not run silently — it surfaces as an approval card in the chat and proceeds once you approve it.

GitHub is the exception that also places a token inside the sandbox, because `git` and the `gh` CLI need it locally: connect GitHub under [Integrations](/platform/integrations/overview) and bind it to the agent, and the session receives a scoped token so the agent can clone, push, and open pull requests on your behalf. Every credential — the in-sandbox GitHub token and the brokered ones alike — is scoped to the session, audited on each call, and revoked when the session ends.

## Engines and models

**Claude Code** is its own entry in the chat picker. The model is independent: it comes from the agent's supported-models list the same way it does for any other agent, so you pick it in the model selector. Note that a coding agent's prompts work best against the model family it was designed for; pairing it with an unrelated model still works but quality varies.

## Cost and budget

External-agent turns can be long and call the model many times, so they cost more than a single chat reply. Each turn runs against a per-turn budget, and the org's [Policies and limits](/platform/admin/governance/policies-and-limits) cap spend per user, per team, or per agent. Usage is metered into [Usage analytics](/platform/admin/governance/usage-analytics) alongside every other agent, attributed to the external agent so you can see what these runs cost.

## Where this fits

An external agent turns a chat thread into a live session with a coding tool in a sandbox — you drive it in plain language, it works in an isolated workspace, and the session persists for follow-ups until you close the thread. The drift candidates here are the agent and model names; pair this page with the running [Providers](/platform/admin/providers) list rather than memorising specific model strings, and with [Integrations](/platform/integrations/overview) for the connected integrations the agent can reach — from GitHub for a real pull-request workflow to a search or data integration that pulls outside facts into the work.
