---
title: Approval concepts
description: An approval is a card a human must click before an automated action proceeds. This page names the four trigger sources, the approver routing, and what an approval leaves behind in the audit log.
---

An approval is the seam between an automated action and a human decision. It is a card a person must click — Approve, Reject, or Request changes — before the action proceeds. Editors and Developers configure where approvals are required; the approver pool decides them.

This page hands you the mental model for what an approval is, what fires one, and what each decision leaves behind. Read it before you configure a gate in a workflow or wire an agent that writes back to the knowledge base.

## What an approval is

An approval lives as a row in the approvals table and as a card in the chat surface. The card carries the action's context (who triggered it, what is about to change, why an approval was required) and the three decision buttons. Approvers can leave a comment with their decision; the comment lands in the audit log alongside the action.

Pending approvals surface in two places: inline in the chat where the action was attempted, and in the approver's inbox (the conversations area). Approvers can act from either surface; the decision propagates the same way.

## The four trigger sources

**Workflow gates.** A step in a workflow is configured as an approval gate. The run pauses until the gate resolves. See [Approvals in workflows](/platform/workflows/approvals-in-workflows).

**Document writes.** An agent attempts to write to the knowledge base — create or edit a document, a customer, a product, a vendor — and the governance policy on that resource requires sign-off. The write does not commit until approved.

**Integration calls.** An agent attempts to call an external system through an integration that requires approval for outbound writes. The call is held until an approver clicks Approve.

**Agent creation and skill installation.** When governance policy requires admin review, creating a new agent or installing a skill emits an approval card to the configured approver pool.

## Approver routing

Each approval is created with an approver pool — a team, a role, or an explicit list of users. The first eligible approver to click decides; the rest of the pool sees the card transition to a resolved state. If no one acts within the gate's timeout, the approval escalates per the gate's escalation policy (typically: re-route to a fallback pool, or fail the run).

Approvers cannot approve their own request: the user who triggered the action is excluded from the eligible pool, even if they would otherwise be in it.

## States and timeouts

An approval has four lifecycle states:

- **pending** — created, not yet decided.
- **approved** — an approver clicked Approve; the action proceeds.
- **rejected** — an approver clicked Reject; the action is abandoned, the run records the rejection.
- **timed-out** — no decision within the configured window; either escalated or failed per policy.

Every state transition lands in the audit log with the actor, the timestamp, and the comment. The transitions are append-only: a resolved approval cannot be re-opened.

## Putting it together

A finance-operations team configures three governance policies: workflow steps that send mail to external addresses require approval; agent writes to the customer database require approval; new MCP server installations require approval. Three trigger sources, one approver pool (the finance team's team), one audit trail. The team sees every pending approval in their inbox and every resolved decision in the audit log.

## Where this fits

Approvals are the surface where automation and accountability meet — they let you delegate the work to agents and workflows without giving up the record of who approved what. The natural next read is [Configure approvals](/platform/approvals/configure) for the per-resource policy fields, and [Approvals in workflows](/platform/workflows/approvals-in-workflows) for the workflow-gate specifics.
