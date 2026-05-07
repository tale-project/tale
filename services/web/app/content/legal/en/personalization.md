---
title: Personalization & Memory — Privacy notice
description: How Tale's personalization layer (Custom Instructions and Memories) handles your data, what we enforce, and the inherent caveats.
noindex: true
---

**Last updated:** 03.05.2026

## 1. The contract

Tale's personalization layer (Custom Instructions and Memories) is built around a single contract:

> **Within Tale, no other user — including your organization's admin — can read your custom instructions or memory content via any UI or API. Personalization is OFF by default; you must enable it explicitly in `/settings/personalization`.**

This page documents what that contract does and does not cover. Five caveats are inherent to running an AI service on a third-party model and cannot be eliminated by Tale's code alone.

## 2. Caveats inherent to the LLM stack

### 2.1 Memory content is sent to your configured LLM provider on every chat turn

When you send a chat message and personalization is active, your custom instructions and approved memories are included in the system prompt that goes to your organization's configured upstream LLM (OpenAI, Anthropic, Google, Azure, your self-hosted model, etc.). Memory content is then subject to that provider's data-retention and abuse-monitoring terms.

Most major hosted providers retain inputs and outputs for abuse monitoring for a bounded window (typically 7–30 days as of mid-2026) and offer Zero Data Retention or equivalent programs to qualifying enterprise customers. Durations and eligibility change frequently — refer to the contract your organization holds with the provider, and to each provider's published policy:

- Anthropic — [Privacy policy](https://www.anthropic.com/legal/privacy) · [Data retention FAQ](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- OpenAI — [API data usage policies](https://openai.com/policies/api-data-usage-policies/)
- Google Vertex AI / Gemini — [Generative AI data governance](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- Azure OpenAI / Microsoft Foundry — [Data, privacy & security](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy) · [Abuse monitoring](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring)

For self-hosted models or custom OpenAI-compatible endpoints (Ollama, vLLM, internal gateways, etc.), no third-party retention applies — retention is governed entirely by the operator of that endpoint.

Once memory content is sent, **Tale cannot recall it**. If you delete a memory, future requests stop including it, but previously-sent copies on the provider side follow the provider's retention schedule.

### 2.2 Self-hosted deployments: the deployment operator can read raw rows

Tale supports self-hosted Convex. Whoever has database or Convex dashboard access at your deployment can read raw `userPreferences` and `userMemories` rows — Tale's role-based admin restriction ("admin can't read content") **does not extend to the database layer**. If you self-host, treat your Convex operators as having access to all personalization content. SOC 2 / ISO controls covering DB-level access are your responsibility.

### 2.3 Assistant replies may quote or paraphrase your memories

The model's reply, when generated using your memory, can repeat the memory verbatim or paraphrased. That reply is then stored in your thread under the **thread visibility rules**, not the memory visibility rules. Sharing a thread automatically disables personalization for subsequent turns by the owner, but past replies that were already generated under personalization remain in the shared thread; deleting a memory does not retroactively redact past replies.

### 2.4 Convex platform logs

Convex's own function-call logs may include mutation arguments. Memory-write mutation arguments can land in those logs. Tale redacts pre-LLM-call debug logs and avoids logging memory content from application code, but the platform's structural logs are outside Tale's redaction surface.

### 2.5 Provider abuse-monitoring review

Major LLM providers run automated abuse-detection over inputs they receive. Content flagged as suspect may be reviewed by the provider's abuse team. Zero-data-retention (ZDR) endpoints, where available, can opt out. Personalization-bearing requests are no different from any other request in this regard.

## 3. What Tale enforces

- **Off by default.** With no organization policy and no user opt-in, personalization is never sent to the model — both read and write paths short-circuit.
- **Three-signal gating.** Whether personalization applies to a given chat is the merge of three independent signals; if any of them blocks it, no custom instructions or memories are sent:
  - **Organization default** — admin-controlled. When on, members inherit on; when off or absent, members inherit off.
  - **Your preference** — your explicit on/off beats the organization default in either direction.
  - **Thread-level disable** — a per-thread hard off (e.g. shared threads).
- **No admin override.** Admin role does not bypass another user's row. Every public read and write surface requires an exact user-id match plus a live organization-membership check, so a removed-but-still-tokened user cannot read stale rows.
- **Auto-disable on share.** Sharing a thread automatically disables personalization for that thread; unsharing re-enables it.
- **Cascade hard-delete.** Removing a user from an organization, or deleting the organization, immediately hard-deletes all of that user's personalization content rows in scope (custom instructions, memories, preferences). Audit-log entries that record those events are retained without content — only the timestamp, action type, and the raw subject user id — for compliance reporting; admin-blind pseudonymisation will be applied when an admin-readable audit view ships. Account-level self-deletion is not yet a product feature; the matching cascade hook will land alongside the user-delete plugin.
- **Soft-delete window for approved memories.** User-initiated deletion of an approved memory triggers a 30-day soft-delete window before storage is reclaimed via opportunistic cleanup. A discarded proposal — one you reject from the chat inline card or the Pending tab — is hard-deleted at the moment of discard.

## 4. DPA addendum (draft)

Customers requiring a Data Processing Addendum addition for personalization content should request the **Personalization & Memory Processor Annex**, which covers:

- Categories of personal data: free-form user-authored instructions; LLM-mediated facts about the user; raw-subject audit metadata.
- Purposes: per-user personalization of chat responses only.
- Sub-processors: the LLM provider configured per organization (see "Memory content is sent…" above).
- Retention: indefinite while the user is a member of the organization and personalization remains enabled; 30 days after soft-delete; immediate on hard-delete.
- Cross-border transfers: governed by the LLM provider's residency and the customer's choice of provider region.
- Subject rights: erasure of content (Art. 17 via cascade on member-remove and org-delete). Audit-log metadata (no content) is retained for compliance and pseudonymized when admin-readable audit views are introduced. Operator-invokable export query (Art. 15/20) is available against the underlying tables; in-product self-service export is planned for v2.
