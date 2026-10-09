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

Erasure permanently removes covered data; it is not a move to Trash. The receipt records the affected categories and counts, including chats, documents and uploads, preferences, feedback, notifications, usage, and audit-identifier scrubbing. The erasure also deletes the separate sandbox workspaces of the [agent runs the person started](/platform/projects/tasks#agent-runs-a-member-starts), even while work still runs in them, and the receipt counts them under **Sandbox workspaces**. A workspace counts only once the sandbox service has deleted its files, which can take a while for a large one. Until then, or while deleting them keeps failing, the receipt reads **Partial** with `sandboxWorkspaces` among its failed passes; choose **Retry** later, and the erasure completes once the files are gone. On Kubernetes, a workspace counts once its volume is handed to the cluster's storage provisioner; with a StorageClass whose `reclaimPolicy` is `Retain`, the volume's files stay until an operator removes the volume, although the receipt counts the workspace. A sandbox service or device that is not yet updated to this version cannot confirm the deletion, so the receipt stays **Partial** until it is updated.

The **Model requests** category covers requests to the model API and direct model calls in automations. Settled requests are removed; a request still in progress keeps the information needed to finish accounting, with the person’s identity replaced by a pseudonym. Later usage is recorded under that pseudonym. If retiring the automation run or removing the identity fails, the receipt stays **Partial** and the dependent usage cleanup waits for a retry.

Tasks that name the person as **Reviewer** lose that designation. A task review still waiting on them moves to the first eligible human fallback, the task creator or project creator, and that person is notified. On an archived task the review moves without a notification. Review decisions the person already made stay on record without their name.

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
| Blocked | Inspect the [legal hold](/platform/admin/governance/legal-hold). Covered data remains protected. The receipt names the hold that still applies; once the hold is released it says so, and the erasure continues only when you choose **Retry**. |
| Failed | Read the failure details. Use **Retry** when available; a watchdog timeout may require a new request. |
| Cancelled | No further execution is scheduled by this receipt. File a new request if the case must resume. |

An open receipt for a subject can prevent a duplicate filing. Work from that receipt rather than creating repeated requests. A retry blocked at initial filing must satisfy the current approval and waiting-period policy again. A receipt awaiting approval keeps the approval requirement captured when it was filed: turning dual approval off later does not release it.

Automation runs held during an upgrade are preserved while their earlier external actions remain unverified. An erasure still deletes the person's other eligible automation runs and reports erased and preserved counts separately. The receipt stays partial. These execution holds are separate from legal holds, and currently have no release action. Requesting a stop or retrying erasure does not clear them. An organization containing these holds also cannot be deleted.

## Manage the deadline

The list shows the tracked deadline and whether it is overdue. Use **Extend deadline** for a justified extension while it is still available: the application permits one extension before the original deadline expires and records the reason and admin.

The deadline is a tracking aid. Your organization remains responsible for assessing the request and communicating with the person. Completing a Tale receipt does not by itself confirm deletion from unrelated external systems or backups.

## Verify the outcome

Open the receipt's category counters, errors, and audit timeline. A completed action, a held category, and a failed pass have different outcomes; record those distinctions in your case. Review [audit logs](/platform/admin/governance/audit-logs) for the associated administrative events.
