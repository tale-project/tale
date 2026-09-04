---
title: Approval concepts
description: An approval is a parked step in a live automation run — a connector write waiting on the run's detail page until a person approves or rejects it. This page names what fires one, the decision it offers, and what it leaves behind.
---

An approval is the seam between an automation's initiative and your judgement. When a live run reaches a connector write that your organization's policy gates — sending mail, posting a message, opening an issue — the step does not run: the run parks, and its detail page shows a card with the operation and the exact input the step would call with, until a person decides. Nothing is sent while the card is pending, and a rejected step fails the run rather than being retried behind your back.

This page is the mental model — what fires an approval, where it appears, and what a decision leaves behind. Where the requirement is declared lives on [Configure approvals](/platform/approvals/configure); the other place a run waits on a person — the question an agent node asks mid-run — lives on [Approvals in workflows](/platform/automations/approvals-in-workflows).

## What fires an approval

One thing: a **connector write in a live run** that the approval policy requires a decision for. The default line is whether the write leaves your tenant — mail, Slack, GitHub, and WebDAV ask; a task moved or a document saved on Tale's own surface does not — and `governance/approval-policy.yml` moves that line per connector or per action. Reads never ask. Test runs never ask either: in mock mode connectors return stand-ins and nothing outside the platform is touched.

Nothing else produces an approval card in this version. The chat assistant cannot write anywhere — its three tools retrieve and fetch — so there is no card in a chat; a project agent's connector calls are read-only through its broker, so a task run never reaches the gate; and there is no per-tool approval flag on an MCP server, because outbound MCP servers are not part of this version.

## The decision on the card

Open the run — from the automation's run list, where it shows as **Waiting** — and the card reads **Waiting for your approval**, names the operation as `<connector>.<action>` and the node that requested it, and shows the input under **The step would call with**. Two decisions: **Approve** lets the parked step act on the run's next poll and the run carries on; **Reject** fails the step and stops the run. There is no third path — you cannot edit the parameters or ask the automation to revise the call; a wrong call is rejected and the definition is fixed on the canvas.

<Note>

Approvals have no inbox in this version. The card lives on the run's detail page, and whoever can open that page decides — there is no routing to an approver pool and no per-person queue. The one decision that demands an Admin is the second signature on an erasure request, covered in [Data subject requests](/platform/admin/governance/data-subject-requests).

</Note>

## States and the trail

A card moves from pending to executing when approved — the step acts on the next poll and the record settles to completed — or to rejected. The decision belongs to the operation it was asked about: loosening the policy afterwards does not release a card already waiting, and a run re-entering the same operation reads the same answer instead of asking twice. Each decision lands in the [audit log](/platform/admin/governance/audit-logs) with the actor and the timestamp, and the run keeps the outcome in its own detail. A decided card cannot be reopened — a rejected run is over, and the retry is a fresh run.

## Where this fits

Approvals are how an automation reaches outside systems without acting alone: the write waits, a person reads the exact call, and the record says who allowed what. Read [Configure approvals](/platform/approvals/configure) for where the line between asking and not asking is drawn, and [Approvals in workflows](/platform/automations/approvals-in-workflows) for the other place a run waits on a person.
