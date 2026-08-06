---
title: Content and models
description: Model-level controls — which models are allowed per role or team, and the default model each user group lands on. Admins and Owners read this when a compliance rule pins a workload to an approved model or when a team needs a cheaper default.
---

Content and models is the surface where you decide which LLMs the people in your organisation can reach and which one each group lands on by default. It pairs an allowlist or blocklist per scope (org, team, role, user) with a default-model rule the resolver applies when no agent or conversation has overridden the choice. Admins and Owners read this page when a compliance rule pins a workload to an approved model, when a team should default to a cheaper model than the rest of the org, or when a new model from an existing provider needs to be made reachable.

<Frame caption="Governance > Content & Models — the mandatory system-prompt prefix and suffix above the per-scope default-model rules.">

![The Content and Models governance page showing the mandatory system-prompt prefix and suffix fields filled with the org's house rules, above a default-models table carrying three rules: a default for all users, and role rules for Developer and Member, each pinned to an OpenRouter model.](/images/platform/governance-content-models.webp)

</Frame>

## A worked default

To set the default model for the Editor role, open **Settings > Governance > Default Models** and click **Add rule**. Pick **Role** as the scope, **Editor** as the target, then pick the provider and model. Save and the next request from any Editor without an explicit per-agent or per-conversation model lands on the rule's model. More specific scopes win — a user rule beats a team rule beats a role rule beats the org default.

## The two layers

**Model access** is the allowlist or blocklist that gates which models a scope can use at all. A model not on the allowlist is invisible to that scope — the picker hides it and the resolver refuses to bind to it, even if an agent has it pinned. Reach for the allowlist when a regulator names the approved models; reach for the blocklist when a single model should be off-limits everywhere else.

**Default models** is the resolver rule that picks the model when nothing else has — no per-agent override, no per-conversation override. The default applies the moment the user starts a fresh chat and applies as the fallback when an agent's pinned model is unreachable.

## Scopes and precedence

Both layers carry a scope: org, team, role, or user. The resolver evaluates from narrowest to widest — user wins over team wins over role wins over org default. The model access layer composes with the default-model layer; the default the resolver picks must also pass the access check for the same scope, otherwise the resolver falls back to the nearest permitted model.

## Allowlist and blocklist warnings

The default-models editor surfaces a warning when a rule names a model the allowlist for the same scope does not permit, or when the blocklist for the same scope blocks it. The warning does not block saving — the resolver will fall back at request time — but it flags the mismatch so you can fix one or the other.

## The model that reads images

Not every model can see. When a text-only model runs an agent that opens a screenshot, a scanned invoice, or a rendered slide, Tale hands that image to a second model and gives the agent the transcription back. That happens through the gateway, so no provider key ever reaches the sandbox, and a model that already reads images skips the detour entirely.

**Vision model** decides which model does that reading. Leave it on **Automatic** and Tale picks for you, preferring a recommended vision model and falling back to the cheapest one your credentials reach. The line under the picker always names the model currently doing the job and why it was chosen, so the answer to "which model is reading our images" is never a guess.

Pin a model when you want that choice to stop moving. Automatic reads a live provider catalog, so the cheapest reachable model changes as providers publish new listings — a pin holds the lane on the model you tested. Only models that can actually transcribe are offered: media generators and free-tier lanes are filtered out, because both accept an image and then refuse the request. If a pinned model later stops being reachable — the credential rotated, the allowlist narrowed, the provider dropped it — Tale logs that and falls back to Automatic rather than leaving your agents unable to read at all.

## Where this fits

Content and models is the gate every chat and every agent passes through at request time. Pairing model access with default models lets you ship a tight compliance posture without forcing every agent author to remember which model is approved this quarter. The companion is the [policies and limits](/platform/admin/governance/policies-and-limits) page — it covers the cost and request caps that apply on top of the model choices made here.
