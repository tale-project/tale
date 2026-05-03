# Personalization & Memory — Privacy Notice

Tale's personalization layer (Custom Instructions + Memories) is designed around a single contract:

> **Within Tale, no other user — including your organization's admin — can read your custom instructions or memory content via any UI or API. Personalization is OFF by default; you must enable it explicitly in `/settings/personalization`.**

This page documents what that contract does and does not cover. Five caveats are inherent to running an AI service and cannot be eliminated by Tale's code:

## 1. Memory content is sent to your configured LLM provider on every chat turn

When you send a chat message and personalization is active, your custom instructions and approved memories are included in the system prompt that goes to your organization's configured upstream LLM (OpenAI, Anthropic, Google, Azure, your self-hosted model, etc.). They are subject to that provider's data retention policy:

- Anthropic API: 30-day default abuse-monitoring retention (7 days starting 2025-09-14).
- OpenAI API: 30-day default abuse-monitoring retention.
- Google Vertex AI / Gemini API: 24-hour in-memory cache by default.
- Azure OpenAI: 30-day default; ZDR available only on EA/MCA managed-customer agreements.

Once memory content is sent, **Tale cannot recall it**. If you delete a memory, future requests stop including it, but previously-sent copies on the provider side follow the provider's retention schedule.

## 2. Self-hosted deployments: the deployment operator can read raw rows

Tale supports self-hosted Convex. Whoever has database / Convex dashboard access at your deployment can read raw `userPreferences` and `userMemories` rows — Tale's role-based admin access ("admin can't read content") **does not extend to the database layer**. If you self-host, treat your Convex operators as having access to all personalization content. SOC2 / ISO controls covering DB-level access are your responsibility.

## 3. Assistant replies may quote or paraphrase your memories

The model's reply, when generated using your memory, can repeat the memory verbatim or paraphrased. That reply is stored in your thread under the **thread visibility rules**, not the memory visibility rules. Sharing a thread (`isShared=true`) automatically disables personalization for subsequent turns by the owner, but past replies that were already generated under personalization remain in the shared thread; deleting a memory does not retroactively redact past replies.

## 4. Convex platform logs

Convex's own function-call logs may include mutation arguments. Memory-write mutation args (e.g. `addMemory.content`) can land in those logs. Tale redacts pre-LLM-call debug logs (PR #1657) and avoids logging memory content from application code, but the platform's structural logs are outside Tale's redaction surface.

## 5. Provider abuse-monitoring review

Major LLM providers run automated abuse-detection over inputs they receive. Content flagged as suspect may be reviewed by the provider's abuse team. Zero-data-retention (ZDR) endpoints, where available, can opt out. Personalization-bearing requests are no different from any other request in this regard.

---

## What Tale does enforce

- Default-OFF: personalization is disabled until you explicitly enable it in `/settings/personalization`. A missing `userPreferences` row, or `enabled !== true`, blocks both read and write paths.
- `assertSelfAndOrgMember` on every public read/write — admin role does not bypass.
- Symmetric kill-switch: org feature flag, per-user toggle, and per-thread `disablePersonalization` all gate the read path (`buildUserPersonalization`), the write path (`writeProposal`), AND the chat tool surface (the `propose_memory` tool is stripped from the agent's tool list when any switch is closed).
- Sharing a thread auto-disables personalization for that thread (`disablePersonalization=true` on share, cleared on unshare).
- Cascade hard-delete on member removal and organization deletion. Account-level self-deletion is not yet a product feature; when it ships, the matching cascade hook lands alongside the user-delete plugin.
- Active GDPR Art 17 erasure for the in-scope cascades is immediate; 30-day soft-delete window before storage is reclaimed via opportunistic cleanup.
- A dismissed proposal (one the user rejected via the chat inline card or the settings Pending tab) is **hard-deleted** at dismissal time — the row is gone, only an audit-log entry with `action='dismiss'` (no content) remains. The 30-day soft-delete window applies only to user-initiated deletes of previously-approved memories, not to dismissed proposals.
- Audit-log rows store `subjectUserId` raw — admin-blind pseudonymisation can be reintroduced when an admin-readable audit view ships (currently no such reader exists).

## DPA addendum (draft)

Customers requiring a Data Processing Addendum addition for personalization content should request the **Personalization & Memory Processor Annex**, which covers:

- Categories of personal data: free-form user-authored instructions; LLM-mediated facts about the user; raw-subject audit metadata.
- Purposes: per-user personalization of chat responses only.
- Sub-processors: the LLM provider configured per org (see "Memory content is sent…" above).
- Retention: indefinite while user is a member of the org and personalization remains enabled; 30 days after soft-delete; immediate on hard-delete.
- Cross-border transfers: governed by the LLM provider's residency and the customer's choice of provider region.
- Subject rights: erasure (Art 17 via cascade on member-remove and org-delete). Operator-invokable export query (Art 15/20) is available via `npx convex run` against the underlying tables; in-product self-service export UI is planned for v2.
