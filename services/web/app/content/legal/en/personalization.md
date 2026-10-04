---
title: Personalization — Privacy notice
description: How Tale's personalization layer (custom instructions) handles your data, what we enforce, and the inherent caveats.
noindex: true
---

**Last updated:** 03.10.2026

## 1. The contract

Tale's personalization layer — your custom instructions — is built around a single contract:

> **Within Tale, no other user — including your organization's admins — can read your custom instructions via any UI or API. Custom instructions are OFF by default: they apply only once you turn them on under Settings › Preferences, or once an admin makes them your organization's default and you have not turned them off yourself.**

This page documents what that contract does and does not cover. Five caveats are inherent to running an AI service on a third-party model and on a database someone operates, and cannot be eliminated by Tale's code alone.

## 2. Caveats inherent to the LLM stack

### 2.1 Your custom instructions are sent to your configured LLM provider on every chat turn

When you send a chat message and custom instructions apply to you, they are included in the system prompt that goes to your organization's configured upstream LLM (OpenAI, Anthropic, Google, Azure, your self-hosted model, etc.). They are then subject to that provider's data-retention and abuse-monitoring terms.

Most major hosted providers retain inputs and outputs for abuse monitoring for a bounded window (typically 7–30 days as of mid-2026) and offer Zero Data Retention or equivalent programs to qualifying enterprise customers. Durations and eligibility change frequently — refer to the contract your organization holds with the provider, and to each provider's published policy:

- Anthropic — [Privacy policy](https://www.anthropic.com/legal/privacy) · [Data retention FAQ](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- OpenAI — [API data usage policies](https://openai.com/policies/api-data-usage-policies/)
- Google Vertex AI / Gemini — [Generative AI data governance](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- Azure OpenAI / Microsoft Foundry — [Data, privacy & security](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy) · [Abuse monitoring](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring)

For self-hosted models or custom OpenAI-compatible endpoints (Ollama, vLLM, internal gateways, etc.), no third-party retention applies — retention is governed entirely by the operator of that endpoint.

Once your instructions are sent, **Tale cannot recall them**. If you change or clear them, future requests carry the new text, but copies already sent to the provider follow the provider's retention schedule.

### 2.2 Self-hosted deployments: the deployment operator can read raw rows

Tale stores your custom instructions in your deployment's Postgres database, in the `app.user_preferences` table. Whoever has database access at your deployment, or access to its backups, can read those rows directly — Tale's role-based admin restriction ("admin can't read content") **does not extend to the database layer**. If you self-host, treat your database operators as having access to all personalization content. Controls covering database-level access are your responsibility.

### 2.3 Assistant replies may quote or paraphrase your custom instructions

The model's reply can repeat your custom instructions verbatim or paraphrased. That reply is then stored in your chat under the **chat's visibility rules**, not the rules that protect your instructions: if you share the chat, the shared copy includes the reply. Changing or clearing your instructions does not retroactively redact past replies.

### 2.4 Database and server logs

Tale's application code keeps your custom instructions out of its own logs and error reports. The database server and the infrastructure around it keep logs of their own: if your operator turns on statement logging in Postgres, the text you save can land in those logs, and Tale cannot redact them.

### 2.5 Provider abuse-monitoring review

Major LLM providers run automated abuse-detection over inputs they receive. Content flagged as suspect may be reviewed by the provider's abuse team. Zero-data-retention (ZDR) endpoints, where available, can opt out. Personalization-bearing requests are no different from any other request in this regard.

## 3. What Tale enforces

- **Off by default.** With no organization default and no choice of your own, custom instructions are never sent to the model. Blank instructions count as none, even while the feature is on.
- **Two-signal gating.** Whether your custom instructions apply is decided by two signals:
  - **Organization default** — admin-controlled, under Settings › Governance › Policies & Limits. When on, members inherit on; when off or absent, members inherit off.
  - **Your preference** — your explicit on/off under Settings › Preferences beats the organization default in either direction. The page tells you whether you follow the organization default or override it.
- **No admin override.** The admin role grants no access to another user's row. Every read and write reaches only the signed-in user's own row and re-checks organization membership on every request, so a removed user whose session is still valid cannot read that row.
- **Off keeps the text.** Turning custom instructions off stops sending them but keeps the text, so it is still there when you turn them back on. To remove it, clear the field and save; Tale keeps no earlier versions.
- **Cascade hard-delete.** Removing a user from an organization, deleting the organization, or processing an erasure request for that user (filed by an admin under Settings › Governance › Data subject requests) hard-deletes the user's preferences in that organization, custom instructions included, in the same operation. An active legal hold on the user or on the whole organization blocks all three until it is released. The audit log records each of these events, but never the text of the instructions. Account-level self-deletion is not yet a product feature; when it ships, it will delete these rows too.

## 4. DPA addendum (draft)

Customers requiring a Data Processing Addendum addition for personalization content should request the **Personalization Processor Annex**, which covers:

- Categories of personal data: free-form user-authored instructions; audit metadata without instruction content.
- Purposes: per-user personalization of chat responses only.
- Sub-processors: the LLM provider configured per organization (see "Your custom instructions are sent…" above).
- Retention: indefinite while the user is a member of the organization, including while the feature is off; deleted immediately when the user clears the field, on member removal, on organization deletion, or when an erasure request is processed.
- Cross-border transfers: governed by the LLM provider's residency and the customer's choice of provider region.
- Subject rights: erasure of content (Art. 17 via cascade on member removal and organization deletion, and via erasure requests). Audit-log metadata (no content) is retained for compliance. Operator-invokable export query (Art. 15/20) is available against the underlying tables; in-product self-service export is planned for v2.
