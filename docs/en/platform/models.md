---
title: Model catalog
description: Which models your organisation can pick, where each provider's list comes from, and what to check when a model you expected is missing from the picker.
---

Every model picker in Tale offers the same thing — the models your organisation can actually reach right now. That set is assembled per provider, from the connector's own model list and the credentials you hold against it, then narrowed by your governance rules. This page explains where each piece comes from, so "why is that model missing" has an answer you can act on rather than guess at.

## The catalog is per provider

There is no single global model list. Each provider connector declares where its models come from, and the badge on that connector's section under **Settings > AI providers** names the source:

- **Built-in catalog** — the list ships with the platform and is upgraded with it. OpenAI, Anthropic, Gemini, DeepSeek, Moonshot AI (Kimi), Qwen (Alibaba), SpaceXAI, and Z.ai (GLM) work this way.
- **OpenRouter catalog** — fetched from OpenRouter's own catalog and normalised on arrival. OpenRouter works this way, which is why its list is by far the longest.
- **Provider models endpoint** — fetched from the provider's own models listing. Vercel AI Gateway works this way.
- **No catalog** — the provider publishes nothing worth shipping, so the models come from each credential instead. Azure OpenAI and Nous Portal (Hermes) work this way.

The count beside the badge is that connector's current list. It says nothing about what your organisation may call, only about what the provider offers.

## What decides availability

A model reaches a picker after clearing two gates in order.

The first is credentials. A connector with no credential is a provider you cannot call, catalog or not. A credential with an empty **Model allowlist** offers its connector's whole catalog; one with an allowlist offers only the models on it. The union across every enabled credential is what your organisation can technically reach.

The second is governance. The model-access rules under [Content and models](/platform/admin/governance/content-models) allow or block models per organisation, team, role, or user, and they apply on top of the first gate. A model that clears the credentials but not the policy stays invisible to that scope, and the resolver refuses to bind to it even when an agent has it pinned.

<Note>

When a model you expected is absent, walk the two gates in that order. Confirm a credential for its provider exists and is enabled, check whether that credential's allowlist excludes it, then check the model-access rules for the scope you are looking from. Almost every "missing model" is one of those three.

</Note>

## Providers that ship no catalog

Some providers cannot publish a list Tale could ship. For those connectors the credential's **Model allowlist** stops being a filter and becomes the availability set itself: it is a free-text field, you type model ids into it separated by commas, and those ids are the only models that credential can reach.

<Info>

On Azure OpenAI the ids are the deployment names you chose inside your Azure resource, not the vendor's public model names. A credential with an empty allowlist there makes no model available at all, which is the usual cause of an Azure connector that looks configured but offers nothing.

</Info>

## Refreshing a live catalog

Catalogs fetched from a provider are cached, and they refresh only when somebody asks. The **Model catalogs** card at the top of **Settings > AI providers** carries a **Refresh catalogs** button that re-fetches every live source and reports one line per connector: the number of models found, or the error that stopped it.

There is no background sync and no scheduled job, so a model released this morning appears after the next refresh and not before. When every connector on your instance ships a built-in catalog, there is nothing to fetch and the card says so.

## Choosing a model

Chat opens on **Auto**: Tale reads each message and picks a model for it — a light heuristic over length, code, and subject matter, never another AI call — then runs exactly that model and records it on the reply, where the message details name it. Pick a model from the menu instead and the choice is yours until you hand it back to Auto; pinning a model is the fix for a pick that is slow, expensive, or wrong for the job.

Everywhere else the model is always named explicitly: on an agent, on any workflow step that calls a model, and on every API request. Nothing there routes on your behalf — no selection by task complexity, no quality tiers. And in no lane — chat included — is there silent failover: the model that starts a reply is the model that answers it, or you see the error. A run stays reproducible and a bill stays attributable, because the model that ran is recorded, never guessed.

<Tip>

When more than one model could plausibly do the job, [Arena Mode](/platform/chat/arena-mode) runs the same prompt against several of them side by side, which turns the choice into a comparison instead of a hunch.

</Tip>

## Where this fits

The catalog is the visible half of provider configuration: what an Admin connects under [AI providers](/platform/admin/providers) is what everyone else sees in a picker here. Widening the set means adding a credential or relaxing an allowlist; narrowing it means an allowlist or a model-access rule under [Content and models](/platform/admin/governance/content-models). For how a model fits alongside instructions, knowledge, and tools when you build an agent, read [Agent concepts](/platform/agents/concepts).
