---
title: Content and models
description: Model-level controls — which models are allowed per role or team, and the default model each user group lands on. Admins and Owners read this when a compliance rule pins a workload to an approved model or when a team needs a cheaper default.
---

Content and models is the surface where you decide which LLMs the people in your organisation can reach and which one each group lands on by default. It pairs an allowlist or blocklist per scope (org, team, role) with a default-model rule the resolver applies when no explicit choice has overridden it. Admins and Owners read this page when a compliance rule pins a workload to an approved model, when a team should default to a cheaper model than the rest of the org, or when a new model from an existing provider needs to be made reachable.

<Frame caption="Settings > Governance > Models — the per-scope default-model rules, with the model-access allowlist below them and the vision model further down.">

![The Models governance page showing the default-models table with three rules — a default for all users, and role rules for Developer and Member, each pinned to an OpenRouter model — above the model-access section set to Allowlist with one allowed-models rule per role.](/images/platform/governance-content-models.webp)

</Frame>

## A worked default

To set the default model for the Editor role, open **Settings > Governance > Models** and click **Add rule** under **Default models**. Pick **Role** as the scope, **Editor** as the target, then pick the provider and model. Save and the next chat any Editor starts without an explicit model choice lands on the rule's model. More specific scopes win — a team rule beats a role rule beats the org default.

## The two layers

**Model access** is the allowlist or blocklist that gates which models a scope can use at all. A model not on the allowlist is refused at request time — the turn comes back with a refusal naming the policy, even if an agent has it pinned. Reach for the allowlist when a regulator names the approved models; reach for the blocklist when a single model should be off-limits everywhere else.

**Default models** is the resolver rule that picks the model when nothing else has — no explicit pick, no per-conversation override. The default applies when a chat runs on **Auto**: the resolver takes the governance default ahead of the automatic pick, and when the default itself is denied by model access, it skips it and auto-picks a model the caller is permitted to use.

## Scopes and precedence

Both layers carry a scope: the whole org, a team, or a role. The resolver evaluates from narrowest to widest — a team rule wins over a role rule wins over the org default. The model access layer composes with the default-model layer; the default the resolver picks must also pass the access check, otherwise the resolver skips it and auto-picks a model the caller is permitted to use.

## Allowlist and blocklist warnings

The default-models editor surfaces a warning when a rule names a model the allowlist for the same scope does not permit, or when the blocklist for the same scope blocks it. The warning does not block saving — the resolver skips the denied default at request time — but it flags the mismatch so you can fix one or the other.

## The model that reads images

Not every model can see. When a text-only model runs an agent that opens a screenshot, a scanned invoice, or a rendered slide, Tale hands that image to a second model and gives the agent the transcription back. That happens through the gateway, so no provider key ever reaches the sandbox, and a model that already reads images skips the detour entirely.

**Vision model** decides which model does that reading. Leave it on **Automatic** and Tale picks for you, preferring a recommended vision model and falling back to the cheapest one your credentials reach. The line under the picker always names the model currently doing the job and why it was chosen, so the answer to "which model is reading our images" is never a guess.

Pin a model when you want that choice to stop moving. Automatic reads a live provider catalog, so the cheapest reachable model changes as providers publish new listings — a pin holds the lane on the model you tested. Only models that can actually transcribe are offered: media generators and free-tier lanes are filtered out, because both accept an image and then refuse the request. If a pinned model later stops being reachable — the credential rotated, the allowlist narrowed, the provider dropped it — Tale logs that and falls back to Automatic rather than leaving your agents unable to read at all.

## Where this fits

Content and models is the gate every chat and every agent passes through at request time. Pairing model access with default models lets you ship a tight compliance posture without forcing every agent author to remember which model is approved this quarter. The companion is the [policies and limits](/platform/admin/governance/policies-and-limits) page — it covers the cost and request caps that apply on top of the model choices made here.
