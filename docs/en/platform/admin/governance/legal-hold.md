---
title: Legal hold
description: The dual-controlled freeze that pauses retention sweeps and erasure cascades for a specific user, document, thread, or the whole organisation during litigation. Admins and Owners read this when counsel asks them to preserve evidence.
---

Legal hold is the mechanism Tale ships for preserving evidence under litigation hold. A hold pins a target — a user, a document, a thread, a workflow execution, or the whole organisation — out of reach of the retention sweep and the data-subject erasure cascade. Admins and Owners read this page when counsel asks them to preserve a custodian's data, when a release request needs the dual-control sign-off, or when an audit reconciles which holds were in force on a given date.

<Frame caption="Governance > Legal hold — the active-holds table with the Place legal hold action above the dual-control release-requests queue.">

![The Legal hold governance page showing one active hold — a User hold on marta.vogel, placed by Alex Rivera under the Northstar contract matter — beside a Place legal hold button, above the Pending approval and Approved release-request queues, both reading No release requests.](/images/platform/governance-legal-hold.webp)

</Frame>

## A worked placement

To place a hold on a user, open **Settings > Governance > Legal hold** and click **Place legal hold**. Pick the target type — user, thread, document, execution, or organisation — pick the specific target, add a reason, and link the hold to a matter if one is open. The hold takes effect immediately; retention sweeps skip the target's rows, the erasure cascade reports them as **Skipped by hold**, and the target row carries the **On legal hold** badge in every list where it appears.

## The four sections

**Active holds** is the working list of every hold currently in force. Each row carries the type, the target, the reason, the matter, who placed it, and when. Filter by type or by matter to scope the view.

**Release requests** is the dual-control queue. Releasing a hold requires a different Admin to approve the request; approved requests still wait out a cooldown before they take effect. The section splits into _pending approval_ and _approved, awaiting cooldown_ so the queue and the timer are both visible.

**Matters** groups holds by case. Each matter carries a name, a case number, and the list of linked holds. Closing a matter files release requests for every linked hold — still subject to the dual-control approval per request.

**Release history** is the read-only audit of effected and rejected releases. Use it to reconcile against an opposing counsel's preservation letter or to feed an audit report.

## Hold-and-cascade interaction

A hold blocks every retention pass and every erasure step for the target. It also blocks deleting the organization itself: while any hold — org-wide or on a member — is active, **Delete organization** is refused and the organization stays exactly as it was. The trash page shows the **Delete is blocked by an active legal hold** banner when an Admin tries to purge a row under hold. A data subject request whose subject is covered by a hold lands in the **Blocked** status until the hold is released; partial coverage (some threads under hold, some not) lands in **Partial** with per-category counters in the receipt.

## Dual-control

Place and release are not symmetric. Place is a single-Admin action — the speed matters when litigation arrives. Release is dual-control: the requesting Admin files, a different Admin approves, and a cooldown window applies between approval and effect so a hasty release can still be cancelled. Both halves of the workflow are audited end to end.

## Where this fits

Legal hold is the freeze button on retention. It is the only mechanism that beats the timed retention sweep and the data-subject erasure cascade — both of which respect holds by design. The companion pages are [data subject requests](/platform/admin/governance/data-subject-requests) for the cascade side and [policies and limits](/platform/admin/governance/policies-and-limits) for the retention windows the hold overrides.
