---
title: Configure approvals
description: Where approval requirements are declared — per connector operation, with one policy file per organization moving the line — and which human gates sit outside that policy.
---

Approval requirements in Tale are declarative: each capability carries its own flag saying whether a run must ask first, and the flag travels with the connector that provides the capability. Nothing has to be configured for the defaults to be right — this page shows where each flag lives, which writes ask by default, and how to change that for your organization.

The model of what an approval card is and who decides it lives on [Approval concepts](/platform/approvals/concepts). What follows is the configuration surface, capability by capability.

## Connector operations

Every connector declares its operations, and each operation carries its own approval flag — for the shipped connectors, that is the write side: sending mail, posting messages, creating issues. Reads run without a card; a flagged write parks the automation run, and the run's detail page shows the operation with its exact parameters until someone decides.

The flag is not a separate setting an admin toggles. Every action a connector declares carries an effect — `read` or `write` — and the write side is what the approval policy gates. That keeps the two honest with each other: an action cannot quietly change from a read to a write without also changing what it has to ask for.

## Which writes ask

A card is worth someone's attention when the write **leaves your tenant**. That is the default line:

- **Writes to outside systems ask** — sending mail, posting to Slack, opening a GitHub issue, writing to a WebDAV share. These connectors hold your vendor credentials and act on systems Tale does not own.
- **Writes on Tale's own surface do not** — moving a task, commenting on it, saving a document into the project, running a script in your own sandbox. These are already bound by the permissions of whoever (or whatever) performed them, an automation that performs them passed its deploy gate, and every one of them is recorded in the run's own trace and the audit log.

Without that line a single automation run could stack up half a dozen cards for its own bookkeeping — "move this card to In progress" — and bury the one card that actually needed a person.

## Changing the line for your organization

Both directions are configurable per organization, in `governance/approval-policy.yml` under your configuration directory. Each rule names **one** target — a whole connector, or a single action as `<connector>.<action>` — and the more specific rule wins:

```yaml
rules:
  # This team reviews every task the desk touches.
  - connector: task
    decision: require_approval
  # Their nightly report mail is trusted; other mail actions still ask.
  - action: imap-smtp.send
    decision: auto_approve
```

An operation that is already waiting on a card keeps its card even if the policy is loosened afterwards — a decision belongs to the operation it was asked about, so a parked run is never stranded by a policy edit.

## MCP tools

External MCP servers — and the per-tool approval flags their manifests used to carry — are not part of this version: there is no server to connect and no tool list to review. The one MCP surface is the inbound endpoint under **Settings > API > MCP**, where your client drives Tale, and a connector action invoked through it runs under the same approval rules as everywhere else — a gated action answers a pending-approval result instead of running. [MCP endpoint](/develop/mcp-endpoint) covers the tools and what each role's key may do; [MCP servers](/platform/connectors/mcp-servers) says what replaced the registration form.

## Gates outside this policy

Three human gates in the product are not approval-policy matters and cannot be switched off here, because each has its own door:

- **Agent work at In review** — a project agent never completes a task; its result parks at **In review** for a person to accept, and [Task automation](/platform/projects/task-automation) covers who may sign it off.
- **Controlled documents** — a file marked as controlled walks a submit-review-approve lifecycle with a named reviewer; [Documents](/platform/knowledge/documents) covers it.
- **Erasure requests** — a GDPR erasure needs a second Admin's approval before the cascade runs; [Data subject requests](/platform/admin/governance/data-subject-requests) covers it.

<Note>

The chat assistant produces no approval of any kind: its tools are read-only, so there is no document-write card, no knowledge-write card, and no workflow card in a chat. A run that needs an answer rather than a permission — an agent node asking a question — is a **Waiting** run, covered in [Approvals in workflows](/platform/automations/approvals-in-workflows).

</Note>

## Verifying what will ask

Before deploying an automation against real systems, read its connector nodes the way an approver would: which of them write, and which of those your policy auto-approves. **Test run** shows you the graph without touching anything — mock mode never asks — and the [audit log](/platform/admin/governance/audit-logs) then records every decision the live runs produce.

## Where this fits

Configuration here is distribution — flags live with the connectors that own the capabilities, and one policy file per organization moves the line. Read [Approval concepts](/platform/approvals/concepts) for the card those flags produce, and [Approvals in workflows](/platform/automations/approvals-in-workflows) for where the parked run waits.
