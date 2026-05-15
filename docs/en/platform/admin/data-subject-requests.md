---
title: Data subject requests
description: Self-serve admin handling of GDPR Art. 17 erasure requests, with SLA tracking, single-grant Art. 12(3) extensions, and audit-chained receipts.
---

Org admins handle GDPR Art. 17 (Right to Erasure) requests directly from **Settings > Governance > Data subject requests**. Every filing inserts a durable receipt row with a 30-day SLA deadline, runs the cascade asynchronously, and writes an audit-log entry for every state transition (filed → blocked / executed / extended / retried).

The page is named for the umbrella DSR concept rather than just "erasure" so future Art. 16 (rectification) and Art. 20 (portability) flows can land on the same surface without a route rename. Only Art. 17 is implemented today.

## Identity verification is out of band

Tale is admin-mediated by design — there is no subject-facing self-service portal. The org admin who files the request **is** the identity-verification checkpoint, having confirmed the subject's identity through the organisation's own process before opening the dialog (HR offboarding, ticketed support flow, in-person verification, etc.). The product does not add an in-flow IDV step.

This contract makes the admin authoritative for the request. Counsel should treat the typed-confirm phrase ("ERASE") on the file dialog as the IDV gate: clicking through it is a deliberate, audit-logged signal that the admin has verified the subject.

## File a request

Click **File request** at the top of the page. The dialog asks for:

- **Subject** — any active member of the organisation, picked from a searchable list. The picker is the same one used by the legal-hold UI.
- **Lawful ground** — one of seven structured codes mapped to GDPR Art. 17(1)(a)–(f) plus the operational `contract_termination` ground used during HR offboarding. Production DSR tooling (OneTrust, TrustArc, Ketch) all carry a structured reason code alongside the narrative because regulators expect requests to be classified by ground for reporting.
- **Reason narrative** — free text (≥ 10 chars) describing the verification context. Goes onto the receipt and into the audit log.
- **Typed confirmation** — type `ERASE` to enable the submit button. The phrase is locale-stable so the typing requirement is identical across languages.

On submit the cascade runs asynchronously in a Convex Node action: it deletes the subject's chat threads, RAG-indexed documents, file-metadata blobs, and nine per-table subject-scope categories, then scrubs the audit-chain PII for any rows the subject authored.

If the subject is under an active legal hold (org-wide or custodian) the request is **rejected at the gate** and an inline panel surfaces the count of held threads / documents and a deep link to the legal-hold page. The receipt row is still inserted with `status: blocked` so the regulator audit trail has structured proof that the request was received.

## SLA badge and the Art. 12(3) extension

Each request carries a 30-day deadline derived from `requestedAt + 30 days`. The list and detail views both render an SLA countdown badge with four buckets:

- **Green** — more than 7 days remaining.
- **Yellow** — 7 days or fewer remaining.
- **Red** — overdue.
- **Grey** — terminal status (`done` / `failed`); countdown is moot.

Art. 12(3) of the GDPR allows the controller to extend the response window by up to two further months for complex requests, **but the extension itself must be communicated to the subject within the original month, with reasons**. The detail drawer's **Extend deadline** action implements that:

- Open while the request is non-terminal and the original deadline has not yet lapsed.
- Add 1–60 days, with a required extension reason (≥ 10 chars).
- Each request can be extended **at most once** — a second attempt is rejected with `ALREADY_EXTENDED`.
- The SLA badge derives from `extensionDeadlineAt ?? slaDeadlineAt`, so granted extensions take immediate effect on the colour bucket and the displayed countdown.

The audit log records who granted the extension, the reason, and the new deadline.

## Retry partial / blocked / failed runs

Three states are retriable:

- `partial` — the cascade ran but some categories were skipped by a hold placed mid-flight, or the page-attempts ceiling was hit on a specific thread.
- `blocked` — the request was rejected at the legal-hold gate at filing time. Release the offending hold, then retry.
- `failed` — the cascade crashed (RAG service unreachable, transient infra error) or was reaped by the watchdog after running past the 30-minute action ceiling.

The detail drawer's **Retry** action re-schedules the processor. The hold gate runs again at processor start, which closes the window during the operator's "release hold then retry" interval.

## What the receipt shows

The detail drawer renders the full Art. 17 / Art. 19 receipt for one request:

- Status badge + SLA countdown.
- Subject identifier, lawful ground, reason narrative, who filed it and when, current SLA deadline (with extension info if applicable).
- Counters: threads erased / targeted, RAG documents removed, documents erased, documents skipped by hold, error message on failure.
- Audit timeline: every `gdpr_erasure_*` audit-log row scoped to the subject, ordered by chain timestamp.

**No erased PII content is rendered** — only aggregate counts and identifiers. The receipt is safe to hand directly to a regulator or to the subject.

## Scope today, scope later

This page ships GDPR Art. 17 erasure only. Out of scope (intentional, per the v1 cut):

- Art. 16 rectification and Art. 20 portability — will land as additional `kind` values on the same DSR page, no route rename needed.
- Subject-facing self-service portal — Tale is admin-mediated by design.
- In-product identity verification — handled out-of-band by the admin's organisation.
- Subject email notification on completion — defer to the email-infrastructure workstream.
- Bulk subject requests (claims-management-company submissions).
- Multi-jurisdiction templates (CCPA, LGPD, etc.) — GDPR-only first.
- AI-driven redaction — Tale erases rather than redacts.

## Where this fits

Data subject requests are the compliance escape hatch that proves Tale takes the right-to-erasure seriously. They sit next to [Governance](/platform/admin/governance) (retention, legal hold, audit logging) — together those three pages cover the data-lifecycle controls a privacy officer needs to make a defensible argument under GDPR. Reach for this page when a verified data-subject filing arrives; reach for Governance when the question is "what's our retention default?".

External references:

- [GDPR Art. 12 — Transparent information & modalities](https://gdpr-info.eu/art-12-gdpr/)
- [GDPR Art. 17 — Right to erasure](https://gdpr-info.eu/art-17-gdpr/)
