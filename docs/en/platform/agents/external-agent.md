---
title: External agents
description: Built-in coding agents (Claude Code, Cursor, OpenCode, Hermes Agent, Gemini CLI, Codex, OpenClaw) that run inside an isolated sandbox; you chat with them directly as they edit files, run commands, and continue the work across turns.
---

Tale ships built-in **external agents** — **Claude Code**, **Cursor**, **OpenCode**, **Hermes Agent**, **Gemini CLI**, **Codex**, and **OpenClaw** — whose whole turn runs inside an isolated sandbox. Instead of the normal chat loop, your message is handed to that coding agent, which lives in a fresh container, edits files, runs commands, and reports back. You talk to it directly in the chat, and it keeps the same working directory and conversation across turns, so a follow-up like "now add a test for that" continues where it left off.

It is the same idea as running such a tool on a remote machine, except the machine is a managed sandbox the workspace controls. This page covers how to use it, what the sandbox can and cannot reach, and how it is billed.

## Talking to a coding agent

Pick **Claude Code**, **Cursor**, **OpenCode**, **Hermes Agent**, **Gemini CLI**, **Codex**, or **OpenClaw** in the chat picker and describe a task in plain language — "write a small Python CLI and test it", "clone this repo and fix the bug in issue #42". The agent works inside its sandbox: it plans, writes files, runs shell commands, and installs packages as needed, then replies with what it did. While it works you see a thinking indicator; the reply lands when the turn finishes.

You do not have to wait for a turn to finish. The composer stays open while the agent works: anything you send waits in a **Queued messages** tray above the composer and is handed to the running agent at its next opportunity. **Claude Code** picks those up mid-turn, at the agent's next tool boundary, so a correction like "use pnpm, not npm" lands while the work is still going. **Cursor**, **OpenCode**, **Codex**, **OpenClaw**, and other one-shot runtimes drain the queue at turn boundaries instead. The message enters the thread itself only when the agent picks it up, in the exact spot where it took effect; until then you can remove it (the × on its row). Pressing **Stop** ends the current turn; messages still waiting are sent automatically a few seconds later as the next turn, with the agent's context intact.

Each chat thread is backed by one persistent sandbox session. Follow-up messages reuse the same session and the same files, and the agent resumes its earlier reasoning rather than starting cold. Because the session belongs to the thread, the thread also keeps its agent: the chat picker pins to it, and switching agents elsewhere never re-routes this thread — start a new chat to use a different one. Deleting or archiving the thread tears the sandbox down and frees its resources.

## What the sandbox can reach

The sandbox starts from an empty working directory and is locked down by default. Outbound network is denied except for a small allowlist (package registries and GitHub), so the agent can install dependencies and clone public repositories but cannot reach arbitrary hosts. By default the model is reached through the workspace's gateway, never a raw provider key — the sandbox only ever holds a short-lived, budget-scoped key for that turn. That default is the agent's _managed_ credential mode; the _bring-your-own_ alternative, covered below, deliberately puts your own provider key inside the box instead.

Beyond that lockdown, the agent can reach any integration your org has connected — search the web through Tavily, call an API, query a database — as long as that integration is bound to the agent. You bind them the same way as for any other agent: open the agent's **Tools** tab and pick them under **Bound integrations**. The credential never enters the sandbox; when the agent calls an integration, the request is brokered back to Tale, which runs the call with the stored credential and hands back only the result, so a compromised container cannot read your keys. A write operation does not run silently — it surfaces as an approval card in the chat and proceeds once you approve it.

GitHub is the exception that also places a token inside the sandbox, because `git` and the `gh` CLI need it locally: connect GitHub under [Integrations](/platform/integrations/overview) and bind it to the agent, and the session receives a scoped token so the agent can clone, push, and open pull requests on your behalf. Every credential — the in-sandbox GitHub token and the brokered ones alike — is scoped to the session, audited on each call, and revoked when the session ends.

## Managed and bring-your-own credentials

How the agent reaches its model is a per-agent choice, set on the agent's **Instructions** tab under **Credentials**. Three credential backends exist; the UI labels them from the agent's runtime.

**Gateway-managed (Claude Code, OpenCode, Hermes Agent, Gemini CLI, Codex, and OpenClaw, managed)** is the default for those runtimes. The platform mints a short-lived virtual key for the turn, routes the agent through its gateway, enforces the agent's allowed models from the **Providers** catalogue, meters usage, and applies the org's spend caps. The sandbox never holds a real provider key. Hermes and Codex managed runs use an OpenAI-compatible gateway route (`OPENAI_BASE_URL` + session virtual key inside the sandbox; Codex speaks the OpenAI Responses API to it); Gemini CLI managed runs use the gateway's Google GenAI-compatible route (`GOOGLE_GEMINI_BASE_URL` + the session virtual key as `GEMINI_API_KEY`); OpenClaw managed runs use the gateway's OpenAI-compatible route through a generated per-turn provider config.

**Env-managed (Cursor, managed)** applies to runtimes that authenticate with an API key you store on the agent, not through the gateway. Open the agent's **Environment** page and set `CURSOR_API_KEY` (or the key the runtime declares). The model is a **runtime id** you type on the Instructions **Models** list — `composer-2.5`, for example — not a catalogue entry. These turns are **not** metered into Usage analytics; billing lives on your Cursor account.

**Bring your own (BYO)** takes the platform out of the request path for supported runtimes (Claude Code, Cursor, Gemini CLI, Codex, and OpenClaw today). No virtual key is minted; the agent authenticates with credentials you store under [Environment variables & secrets](/platform/member/environment) and reaches the provider directly. The model becomes a raw runtime id you type verbatim rather than a catalogue entry. Because the gateway is bypassed, the org's model allowlist, spend caps, and usage metering do not apply to BYO turns — billing and limits move to your own provider account. Switching an agent from managed to BYO clears its saved platform models when they were catalogue references; you re-enter raw ids.

**OpenCode is managed-only** — its runtime config points at the platform gateway and authenticates with the session virtual key, so BYO is not available for OpenCode agents. Configure models from the **Providers** catalogue the same way as gateway-managed Claude Code.

That is also a shift in the trust boundary. In gateway-managed mode the sandbox holds only a budget-scoped gateway key; in env-managed or BYO mode your real credential is injected into the sandbox environment — the same posture as the in-sandbox GitHub token — so any code the agent runs in the box can read it. That is by design: it is your box and your credential. Configuring an agent is already a privileged action, so the per-agent toggle is the only control; there is no separate org-level switch.

## Engines and models

**Claude Code**, **Cursor**, **OpenCode**, **Hermes Agent**, **Gemini CLI**, **Codex**, and **OpenClaw** are separate entries in the chat picker (or agents you configure with `agentKind` set accordingly).

For **gateway-managed Claude Code, OpenCode, Hermes Agent, Gemini CLI, Codex, or OpenClaw**, the model comes from the agent's supported-models list in the **Providers** catalogue — pick it in the model selector. The shipped Claude Code and OpenCode defaults include Claude Fable 5, and Fable capacity is rationed: a request its safety classifiers flag, an overloaded model, or exhausted Fable usage does not fail the turn — the session falls back automatically to the catalogue entry's fallback model, Claude Opus 4.8 (Claude Code only; OpenCode uses the gateway model id you select). Hermes Agent and OpenClaw ship with Claude Sonnet 4.6 and Claude Opus 4.8, Gemini CLI ships with Gemini 3 Pro and Gemini 3 Flash, and Codex ships with GPT-5.5 and GPT-5.5 Pro; they run the whole turn on the model you picked. One OpenClaw caveat: its runtime reports headlessly at the end of the turn, so the chat shows the final reply and usage rather than a live tool-by-tool timeline.

For **env-managed Cursor** (and BYO on any runtime), the Instructions **Models** editor accepts **runtime ids** from your account — run `agent models` inside a sandbox session to see what your subscription exposes. Leave the list empty to let the runtime pick its default (Auto). The chat model picker shows a read-only indicator — the configured id's short name, or **Default model** when the list is empty — rather than the catalogue dropdown.

A **BYO Hermes Agent** uses credentials you store under [Environment variables & secrets](/platform/member/environment) — commonly `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` depending on your provider. Set the model to a Hermes/OpenRouter-style id (for example `openrouter:anthropic/claude-sonnet-4.6`).

A **BYO Gemini CLI** agent uses your own Google credentials from [Environment variables & secrets](/platform/member/environment) — `GEMINI_API_KEY` for the Gemini API, or `GOOGLE_API_KEY` with `GOOGLE_GENAI_USE_VERTEXAI=true` for Vertex AI. Type raw Google model ids (for example `gemini-3.1-pro-preview`); the shipped catalogue-shaped defaults are translated to their Google-native ids at runtime.

A **BYO OpenClaw** agent uses credentials you store under [Environment variables & secrets](/platform/member/environment) — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` depending on your provider. Set the model to an OpenClaw `provider/model` ref (for example `anthropic/claude-sonnet-4-6`), or leave it empty for the runtime default.

A **BYO Codex** agent uses the `OPENAI_API_KEY` you store under [Environment variables & secrets](/platform/member/environment) and talks to OpenAI's own API. Shipped catalogue references translate to the entry's `nativeModelId` (`gpt-5.5`, say); ids you type yourself pass through unchanged.

A **BYO Claude Code** agent types raw Anthropic ids — `claude-opus-4-20250514`, say — in priority order. Shipped pack agents that still carry catalogue-shaped refs are translated at runtime via each catalogue entry's `nativeModelId`; ids you typed yourself pass through unchanged.

## Cost and budget

External-agent turns can be long and call the model many times, so they cost more than a single chat reply. Each managed turn runs against a per-turn budget, and the org's [Policies and limits](/platform/admin/governance/policies-and-limits) cap spend per user, per team, or per agent. Usage is metered into [Usage analytics](/platform/admin/governance/usage-analytics) alongside every other agent, attributed to the external agent so you can see what these runs cost.

This accounting is a property of the **gateway-managed** path, so it covers Claude Code, OpenCode, Hermes Agent, Gemini CLI, Codex, and OpenClaw managed turns. Env-managed and bring-your-own agents run on credentials outside the gateway: their turns are not metered into Usage analytics and the org's spend caps do not apply, and the cost and any rate limits live with your provider account instead.

## Where this fits

An external agent turns a chat thread into a live session with a coding tool in a sandbox — you drive it in plain language, it works in an isolated workspace, and the session persists for follow-ups until you close the thread. Credentials are the axis that decides how much of that runs under the org's control: a managed agent stays on the platform gateway under the org's caps and metering, while a bring-your-own agent runs on the keys you keep under [Environment variables & secrets](/platform/member/environment) and answers to your own provider account. The drift candidates here are the agent and model names; pair this page with the running [Providers](/platform/admin/providers) list rather than memorising specific model strings, and with [Integrations](/platform/integrations/overview) for the connected integrations the agent can reach — from GitHub for a real pull-request workflow to a search or data integration that pulls outside facts into the work. To run Claude Code or Codex on hardware you control instead of the managed sandbox — for board tasks rather than chat — see [tale-daemon](/self-hosted/operate/tale-daemon).
