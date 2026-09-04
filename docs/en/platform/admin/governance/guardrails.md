---
title: Guardrails
description: The three filter layers — content safety, PII detection, and a moderation provider — that screen chat inputs and outputs before and after the model. Admins and Owners read this when a regulator names a content rule or when a leak warrants a tighter policy.
---

Guardrails is the surface where you configure the three filter layers Tale runs on every chat message in your organisation. Each message passes through content safety (word lists and admin regex), then PII detection (built-in patterns plus custom), then an optional external moderation provider — in that fixed order, on the way in and on the way out. Admins and Owners read this page when a regulator names a content rule, when a leak warrants a tighter policy, or when an agent's replies need to be sanitised before they leave the model.

<Frame caption="Governance > Guardrails — the three filter-layer status cards (content safety, PII detection, moderation provider) above the recent-events log.">

![The Guardrails governance page showing three status cards — Content safety off, PII detection off, and the Moderation provider not configured — above a recent-events feed reporting no events yet and the organization's custom instructions.](/images/platform/governance-guardrails.webp)

</Frame>

## A worked layering

To configure the layers, open **Settings > Governance > Guardrails**. The overview shows three status cards, one per layer — content safety, PII detection, moderation — and each layer's editor sits further down the same page, where you pick whether the layer runs on input, on output, or both, and what it does on a match. The org's mandatory custom instructions live here too — they constrain every agent, so they sit with the other content controls. The recent-events table under the overview shows the last 50 detections, blocks, and provider errors with their layer, direction, and match category.

## Content safety

Content safety is the layer you own. Define one or more categories — hate speech, profanity, a custom regex for an internal codename — and pick a mode per category: **block** refuses the message, **mask** replaces matches with a placeholder, **flag** records the detection without changing the message. Block wins over mask wins over flag when more than one category matches.

The layer's word lists and patterns never leave the deployment. Matched text is not stored — only the category, the direction (input or output), and the count of matches end up in the audit event.

## PII detection

PII detection ships with patterns for emails, phones, government IDs, payment numbers, and a long tail of regional formats. Add custom patterns if your regulator names a format the built-ins miss. Pick a mode — block, mask with a placeholder, or tokenize, which swaps PII for indexed tokens on the way in and restores them in the model's reply. Mask is the typical choice when the model has been given access to records that include PII it should not echo back.

## Moderation provider

The moderation layer is an external classifier — OpenAI Moderation, Azure Content Safety, Perspective API, or a custom HTTP endpoint. Configure the provider's endpoint, an API key, and the category-to-action mapping (each provider returns its own taxonomy; the mapping decides which categories block, mask, or flag). The layer is optional — leave it disabled and only the first two layers run.

The provider sits on the network egress path. Failures are configurable per direction: fail-open lets the message through, fail-closed refuses it. The recent-events view shows provider errors, HTTP statuses, and circuit-open events when the layer is rate-limited.

## Recent events

Every detection, block, and provider error lands in the recent-events table — kept for 90 days by default, adjustable on the retention policy page. Filter by layer or by kind; each row carries the matched categories, the actor, and the timestamp. Raw matched text is never stored — the events are a tuning surface, not a content archive.

## Where this fits

Guardrails is the runtime filter between the user and the model in both directions. Pair it with [content and models](/platform/admin/governance/content-models) so an approved model is also subject to the approved content rules. The companion is the [audit log](/platform/admin/governance/audit-logs) — every block and every mask the guardrail layers apply lands there as a permanent record.
