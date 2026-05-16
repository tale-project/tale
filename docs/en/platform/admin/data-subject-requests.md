---
title: Data subject requests
description: File GDPR Art. 17 erasure requests directly from the admin UI, with SLA tracking, single-grant Art. 12(3) extensions, and audit-chained receipts.
---

Data subject requests is where org Admins handle GDPR Art. 17 (Right to Erasure) filings without leaving the product. Every request inserts a durable receipt with a 30-day SLA deadline, runs the erasure cascade as a background job, and writes an audit-log entry for every state transition — filed, blocked, executed, extended, retried, partial, failed. The page is named for the umbrella DSR concept rather than "erasure" alone so future Art. 16 (rectification) and Art. 20 (portability) flows can land on the same surface without renaming the route; only Art. 17 ships today.

The audience is the org Admin in charge of compliance. Members, Editors, and Developers cannot see this page. The surface is **Settings > Governance > Data subject requests**.

## Identity verification is out of band

Tale is admin-mediated by design — there is no subject-facing self-service portal. The Admin who files the request **is** the identity-verification checkpoint, having confirmed the subject's identity through the organisation's own process before opening the dialog (HR offboarding, ticketed support flow, in-person verification). The product does not add an in-flow IDV step.

This contract makes the Admin authoritative for the request. Counsel should treat the typed-confirm phrase on the file dialog as the IDV gate: typing it through is a deliberate, audit-logged signal that the Admin has verified the subject.

## File a request

Click **File request** at the top of the page. The dialog asks for four fields:

- **Subject** — any active member of the organisation, picked from a searchable list. The picker is the same one used by the legal-hold UI.
- **Lawful ground** — one of seven structured codes mapped to GDPR Art. 17(1)(a)–(f), plus the operational `contract_termination` ground used during HR offboarding. Regulators expect requests to be classified by ground for reporting, which is why production DSR tooling (OneTrust, TrustArc, Ketch) all carry a structured code next to the narrative.
- **Reason narrative** — free text, minimum 10 characters, describing the verification context. The narrative is written onto the receipt and into the audit log.
- **Typed confirmation** — type `ERASE` to enable the submit button. The phrase is locale-stable so the typing requirement is identical across languages.

On submit, the cascade runs as a background job: it deletes the subject's chat threads, RAG-indexed documents, file-metadata blobs, and nine per-table subject-scope categories, then scrubs personal data from any audit-log rows the subject authored.

If the subject is under an active legal hold — org-wide or custodian — the request is **rejected at the gate**. An inline panel surfaces the count of held threads and documents plus a deep link to the legal-hold page. The receipt is still inserted in the **blocked** state so the regulator audit trail has structured proof that the request was received.

## SLA badge and the Art. 12(3) extension

Each request carries a 30-day deadline counted from the filing date. The list and detail views render an SLA countdown badge with four buckets:

- **Green** — more than 7 days remaining.
- **Yellow** — 7 days or fewer remaining.
- **Red** — overdue.
- **Grey** — terminal status (done or failed); the countdown is moot.

Art. 12(3) of the GDPR lets the controller extend the response window by up to two further months for complex requests, **but the extension must be communicated to the subject within the original month, with reasons**. The detail drawer's **Extend deadline** action implements that constraint:

- Open while the request is non-terminal and the original deadline has not lapsed.
- Add 1 to 60 days, with a required extension reason of at least 10 characters.
- Each request can be extended **at most once** — a second attempt is rejected with an "already extended" error.
- The SLA badge shows the extended deadline once an extension is granted, otherwise the original deadline, so a granted extension changes the colour bucket and the displayed countdown immediately.

The audit log records who granted the extension, the reason, and the new deadline.

## Retry partial, blocked, or failed runs

Three states are retriable from the detail drawer's **Retry** action:

- **partial** — the cascade ran but some categories were skipped by a hold placed mid-flight, or the page-attempts ceiling was hit on a specific thread.
- **blocked** — the request was rejected at the legal-hold gate at filing time. Release the offending hold, then retry.
- **failed** — the cascade crashed (RAG service unreachable, transient infrastructure error) or was reaped by the watchdog after running past the 30-minute action ceiling.

The hold gate runs again at processor start, which closes the window during the operator's "release hold then retry" interval.

## What the receipt shows

The detail drawer renders the full Art. 17 / Art. 19 receipt for one request:

- Status badge plus SLA countdown.
- Subject identifier, lawful ground, reason narrative, who filed it and when, current SLA deadline (with extension info when applicable).
- Counters: threads erased and targeted, RAG documents removed, documents erased, documents skipped by hold, error message on failure.
- Audit timeline: every GDPR-erasure audit-log row scoped to the subject, ordered by chain timestamp.

**No erased PII content is rendered** — only aggregate counts and identifiers. The receipt is safe to hand directly to a regulator or to the subject.

## Scope today, scope later

Only Art. 17 erasure ships today. The intentional v1 exclusions:

- Art. 16 rectification and Art. 20 portability — land as additional request kinds on the same DSR page, no route rename needed.
- Subject-facing self-service portal — Tale is admin-mediated by design.
- In-product identity verification — handled out of band by the Admin's organisation.
- Subject email notification on completion — deferred to the email-infrastructure workstream.
- Bulk subject requests (claims-management-company submissions).
- Multi-jurisdiction templates (CCPA, LGPD) — GDPR-first.
- AI-driven redaction — Tale erases rather than redacts.

## Where this fits

Data subject requests is the compliance escape hatch that proves Tale takes the right to erasure seriously. It sits next to [Governance](/platform/admin/governance) (retention, legal hold, audit logging) — together those three pages cover the data-lifecycle controls a privacy officer needs to make a defensible argument under GDPR. Reach for this page when a verified data-subject filing arrives; reach for Governance when the question is "what is our retention default?".

External references:

- [GDPR Art. 12 — Transparent information and modalities](https://gdpr-info.eu/art-12-gdpr/)
- [GDPR Art. 17 — Right to erasure](https://gdpr-info.eu/art-17-gdpr/)
