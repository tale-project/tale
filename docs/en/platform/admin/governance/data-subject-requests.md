---
title: Data subject requests
description: The GDPR Article 17 workflow for erasing a person's data across chats, documents, uploads, and preferences.
---

Data subject requests is the workflow Tale ships for honouring GDPR Article 17 (right to erasure) and the equivalent CCPA right under California law. Each request becomes a receipt: it names the subject, the reason code, the SLA deadline, and the cascade of rows the system erased across threads, documents, uploads, and the other rows that identify the subject. Admins and Owners read this page when a subject files a request, when a deadline is closing in, or when an audit asks for the receipt of a past erasure.

<Frame caption="Governance > Data subject requests — the DSAR governance policy (cooling-off window, dual approval, daily limit) above the request receipts list with File request.">

![The Data subject requests governance page showing the cooling-off window, dual-approval toggle, and daily-limit fields above an erasure-requests table with one pending request — subject Jordan Blake, reason code consent withdrawn, 24 hours until execution and 29 days left on its SLA — beside a File request button.](/images/platform/governance-data-subject-requests.webp)

</Frame>

## A worked filing

To file a request, open **Settings > Governance > Data subject requests** and click **File request**. Pick the subject, choose a reason code (consent withdrawn, no longer necessary, unlawful processing, legal obligation, objection, child subject, or contract termination), and add a free-text narrative. The request enters a cooling-off window before the cascade runs — any Admin can cancel during the window. After the window elapses, the cascade erases the subject's threads and documents (a document's knowledge-base entry goes with it), their uploads, preferences, notifications, feedback, memories, and usage rows, and scrubs their identifiers from the audit trail — the receipt records a count per pass.

## Status lifecycle

| Name              | Default       | Description                                                                                                                          |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pending           | initial state | The request is filed and waiting for the cooling-off window or the second admin approval.                                            |
| Awaiting approval | dual-control  | A second Admin must approve before the cascade runs — or reject, which cancels the request.                                          |
| Running           | mid-cascade   | The cascade is in flight; partial counters update as each category completes.                                                        |
| Completed         | terminal      | Every category erased without error.                                                                                                 |
| Partial           | terminal      | Some rows were skipped (a legal hold blocked them) or a cascade pass failed — the receipt's error names the failed passes.           |
| Failed            | terminal      | The cascade died mid-run — a fatal error (Retry re-arms it) or a watchdog timeout (file a new request).                              |
| Blocked           | terminal      | An active legal hold blocks every cascade step.                                                                                      |
| Cancelled         | terminal      | An Admin cancelled before the cascade ran, or a second Admin rejected the dual approval. A new request can be filed for the subject. |

## SLA tracking

Every request carries a service-level deadline — by default, 30 days from filing. The Requests list shows days-left or an overdue badge per row. Article 12(3) of GDPR permits a single extension for complex cases; the **Extend deadline** action records the extension on the receipt with the requesting admin's name and a narrative.

## Legal hold interaction

A subject's data is _not_ erased while it is on legal hold. Rows under hold show as **Skipped by hold** in the receipt's per-category counters; releasing the hold and retrying the request finishes the erasure. The Blocked status fires when a hold covers every category from the start — the cascade does not run, and the receipt reflects the block.

## The cascade categories

The receipt breaks the erased rows down by pass — threads, documents, uploads, preferences, notifications, subscriptions, feedback, memories, usage ledger, and the audit-trail scrub. Read the drawer to see counts and the audit timeline; the audit log on the same Governance area carries the full event chain (`gdpr_erasure_requested`, `gdpr_erasure_executed`, `gdpr_erasure_extended`, `gdpr_erasure_rejected`, `gdpr_erasure_cancelled`).

## Where this fits

Data subject requests is the compliance face of retention — the audited, dual-controlled path that erases a specific subject on demand instead of the timed sweep retention runs across everyone. The companion page is [legal hold](/platform/admin/governance/legal-hold) — it covers how to pause retention and DSAR cascades for litigation before they run.
