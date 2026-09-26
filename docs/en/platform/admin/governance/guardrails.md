---
title: Guardrails
description: Configure chat content filters, personal-data protection, and moderation, then review detections and errors.
---

Use **Settings > Governance > Guardrails** as an Admin or Owner to control how chat text is checked before and after a model call. Enabled layers run in order: content safety, personal-data detection, then external moderation. Start with one clear rule and verify its effect before broadening the policy.

<Frame caption="Governance > Guardrails — the three filter-layer status cards (content safety, PII detection, moderation provider) above the recent-events log.">

![The Guardrails governance page showing three status cards — Content safety off, PII detection off, and the Moderation provider not configured — above a recent-events feed reporting no events yet and the organization's custom instructions.](/images/platform/governance-guardrails.webp)

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

**Custom instructions** adds organization instructions ahead of agent instructions. Members cannot edit this organization policy. Use it for shared behavior and terminology; use access rules and filters for restrictions that must be enforced independently of a model following prose instructions.

## Review and tune

**Recent events** shows the latest 50 detections, blocks, and provider errors. Filter by layer or outcome and inspect category, direction, and time. Raw matched text is not stored in these events, so a row explains the detection without reproducing the sensitive match.

If a rule is too broad, adjust its category or patterns and repeat the synthetic tests. If a detection is absent, check that the layer, category, and intended direction are enabled. Event history depends on the chat-filter-event [retention policy](/platform/admin/governance/policies-and-limits); do not assume a fixed archive duration.
