---
title: Data subject requests
description: File and review a person's erasure request, manage approvals and deadlines, and inspect the resulting receipt.
---

Use **Settings > Governance > Data subject requests** as an Admin or Owner to process a person's erasure request. Tale tracks the request, its approval and waiting period, and the result of the deletion process. Confirm the person's identity and the appropriate scope through your organization's process before filing.

<Frame caption="Governance > Data subject requests — the DSAR governance policy (cooling-off window, dual approval, daily limit) above the request receipts list with File request.">

![The Data subject requests governance page showing the cooling-off window, dual-approval toggle, and daily-limit fields above an erasure-requests table with one pending request — subject Jordan Blake, reason code consent withdrawn, 24 hours until execution and 29 days left on its SLA — beside a File request button.](/images/platform/governance-data-subject-requests.webp)

</Frame>

## File a request

1. Select **File request** and choose the **Subject** by name or email. Check that you selected the intended account.
2. Select the **Lawful ground** and write a **Reason narrative** that explains the request and references your internal case.
3. Type `ERASE` exactly, then select **File request**.
4. Open the receipt and check its status, deadline, and next required action.

Erasure permanently removes covered data; it is not a move to Trash. The receipt records the affected categories and counts, including chats, documents and uploads, preferences, feedback, notifications, usage, and audit-identifier scrubbing.

## Check the policy before filing

| Setting | Effect |
| --- | --- |
| **Cooling-off window (hours)** | A waiting period of 0–72 hours before execution. Admins can cancel while waiting. Zero allows immediate execution once other requirements are met. |
| **Require dual approval** | A different admin must approve before the cooling-off window begins. The filer cannot approve their own request. |
| **Daily limit per admin** | Limits each admin to 1–50 filings per day. |

Only the Owner can change this policy. Stronger safeguards apply immediately; weaker safeguards are staged for 24 hours so any admin can cancel the change. Review the effective settings and any pending-change banner before relying on a new value.

## Follow the receipt

| State | What to do |
| --- | --- |
| Pending / awaiting approval | Check whether another admin must approve or the cooling-off window must finish. Cancel or reject if the request should not run. |
| Running | Wait for the category results; do not file a duplicate request. |
| Completed | Review the recorded counts and retain the receipt with your case. |
| Partial | Inspect the skipped categories and errors. Resolve the cause before retrying. |
| Blocked | Inspect the [legal hold](/platform/admin/governance/legal-hold). Covered data remains protected. |
| Failed | Read the failure details. Use **Retry** when available; a watchdog timeout may require a new request. |
| Cancelled | No further execution is scheduled by this receipt. File a new request if the case must resume. |

An open receipt for a subject can prevent a duplicate filing. Work from that receipt rather than creating repeated requests. A retry blocked at initial filing must satisfy the current approval and waiting-period policy again.

## Manage the deadline

The list shows the tracked deadline and whether it is overdue. Use **Extend deadline** for a justified extension while it is still available: the application permits one extension before the original deadline expires and records the reason and admin.

The deadline is a tracking aid. Your organization remains responsible for assessing the request and communicating with the person. Completing a Tale receipt does not by itself confirm deletion from unrelated external systems or backups.

## Verify the outcome

Open the receipt's category counters, errors, and audit timeline. A completed action, a held category, and a failed pass have different outcomes; record those distinctions in your case. Review [audit logs](/platform/admin/governance/audit-logs) for the associated administrative events.
