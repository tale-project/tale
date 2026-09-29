---
title: Guardrails
description: Configure chat content filters, personal-data protection, and moderation, then review detections and errors.
---

Use **Settings > Governance > Guardrails** as an Admin or Owner to control how chat text is checked before and after a model call. Enabled layers run in order: content safety, personal-data detection, then external moderation. Start with one clear rule and verify its effect before broadening the policy.

<Frame caption="Governance > Guardrails — the three filter-layer status cards (content safety, PII detection, moderation provider) above the recent-events log.">

![The Guardrails governance page showing three status cards — Content safety on with two categories for input and output, PII detection on in mask mode, and the Moderation provider not configured — above a recent-events feed reporting no events yet and the organization's custom instructions.](/images/platform/governance-guardrails.webp)

</Frame>

## Add a content rule

1. Under **Content safety**, choose whether to check **User input**, **Model output**, or both.
2. Select **Add category**, give it a recognizable **Label**, and choose its **Mode**.
3. Add the words or phrases to detect, one per line. You can import a text list; review it before applying it.
4. Save the category, enable the intended category and layer, then save the page's pending changes.
5. Test with synthetic text containing a match and with ordinary text that should pass. Check **Recent events** and the visible chat outcome.

| Mode | What happens on a match |
| --- | --- |
| **Flag** | Records the detection and allows the message. Useful while tuning a rule. |
| **Mask** | Replaces matched text with the configured placeholder. |
| **Block** | Refuses the message. |

When several categories match, block takes precedence over mask, then flag. Word matching ignores case. Check variants and false positives that matter for your languages; one successful test does not establish complete coverage.

## Protect personal data

**PII protection** detects configured patterns such as email addresses, phone numbers, and identifiers. Select the relevant built-in types and any custom patterns, then choose the intended behavior.

Masking removes matched values from the text sent onward. In a chat, the masked text is also what Tale stores and shows as the message; the original wording is not kept. Blocking refuses a match. Tokenization replaces detected values with indexed tokens for the model and restores them in its reply. Tokenization is therefore useful for processing with reduced exposure, but it is not a promise that the final reply will contain no personal data.

A built-in identifier that is digits only, such as a Swedish passport number or a Ukrainian tax ID, is recognized only next to a word that names it, for example `passnummer` or `ІПН`. Order numbers, compact dates, and build numbers pass through. Each detection in **Recent events** names the pattern that fired, such as `se-passport`.

Test the formats you actually use with synthetic values. Pattern detection can miss unusual formats and can flag ordinary text. Check input and output separately.

## Add external moderation

The moderation layer sends text to a configured classifier, such as OpenAI, Azure, Perspective, or a custom endpoint. Configure its credentials, categories, and actions, and choose the directions it should inspect.

Decide what should happen if the provider is unavailable: fail-open allows the message, while fail-closed refuses it. Review provider errors and circuit-open events when unexpected refusals or unfiltered messages occur. Enabling this layer introduces another service that processes the text; use the provider and endpoint approved for your organization.

## Set organization instructions

**Custom instructions** adds organization instructions ahead of the chat assistant's instructions and ahead of every agent's own: project agents working tasks and agent nodes in automations. Members cannot edit this organization policy. Use it for shared behavior and terminology; use access rules and filters for restrictions that must be enforced independently of a model following prose instructions.

## Guardrails on the model endpoints {#model-endpoints}

When your organization turns on [model endpoints for API keys](/platform/admin/governance/content-models#model-endpoints), the input side of these guardrails also judges every request sent to them. Content safety, PII protection, and the moderation provider read the request's system and user text before Tale passes it to the model:

- A block refuses the request with `400 MODEL_API_GUARDRAIL_BLOCKED`, and nothing reaches the model.
- A mask replaces the match, and the model receives the masked text.
- Tokenization cannot be honoured, because Tale relays the model's answer unchanged and cannot restore the values into it. While PII protection is on in **Tokenize** mode, every request is refused with `403 MODEL_API_GUARDRAIL_UNSUPPORTED`; choose **Mask** or **Block** if members use the model endpoints.
- A moderation provider that fails under fail-closed refuses the request with `503 MODEL_API_GUARDRAIL_UNAVAILABLE`.

Nothing else is filtered there: rules that check **Model output** do not apply, and the model's answers, streamed or not, the assistant turns and tool results a request carries, and its images and documents pass unchecked. Custom instructions are not added either; the model receives the request as the caller's tool sent it. Detections appear under **Recent events** like chat detections, each recorded under `model-api:` followed by the request's `X-Request-Id`, the ID the caller received. Because tools resend the whole conversation with every request, Tale reuses its verdict on a text it judged within the last few minutes and records a detection once rather than on every resend.

## Review and tune

**Recent events** shows the latest 50 detections, blocks, and provider errors. Filter by layer or outcome and inspect category, direction, and time. Raw matched text is not stored in these events, so a row explains the detection without reproducing the sensitive match.

If a rule is too broad, adjust its category or patterns and repeat the synthetic tests. If a detection is absent, check that the layer, category, and intended direction are enabled. How long events stay depends on the **Chat filter events** category of the [retention policy](/platform/admin/governance/policies-and-limits). The category is off by default, and events are kept until an admin enables it. While it is enabled, scheduled cleanup deletes events older than its period plus the deletion grace period, up to 50,000 per night; a larger backlog, such as months of events when the category is first enabled, is cleared over several nights. Recent events and the guardrail figures under **Settings > Metrics > Chat health** only show the events still kept: if the period plus the grace period is shorter than 30 days, the older part of a 30-day view stays empty.

A [legal hold](/platform/admin/governance/legal-hold) protects events from cleanup: an organization hold keeps every event, and a member hold keeps the events raised in that member's chats. An event whose chat was permanently deleted before the hold has no owner left to protect it and is not kept.
