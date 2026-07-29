---
title: Configure approvals
description: Where approval requirements are declared — per integration operation, per MCP tool, and built in for writes and workflow changes — and where to see what will ask before it runs.
---

Approval requirements in Tale are declarative: each capability carries its own flag saying whether an agent must ask first, and the flag travels with the integration or server that provides the capability. Nothing has to be configured for the defaults to be right — this page shows where each flag lives, which writes ask by default, and how to change that for your organization.

The model of what an approval card is and who decides it lives on [Approval concepts](/platform/approvals/concepts). What follows is the configuration surface, capability by capability.

## Integration operations

Every integration declares its operations, and each operation carries its own approval flag. Open **Settings > Integrations**, click an integration, and its operations list badges the ones marked **Requires approval** — for the shipped connectors, that is the write side: sending mail, posting messages, creating issues. Reads run without a card; flagged writes hold in chat with their exact parameters until someone approves.

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

An MCP server's manifest marks which of its tools need sign-off. Open **Settings > API > MCP**, expand a server, and its **Discovered Tools** list badges each flagged tool with **Requires approval** — those ask in chat every time an agent calls them. The flag comes from the server's author; connecting a server is how you accept its tool contract, so review the list before activating one. [MCP servers](/platform/integrations/mcp-servers) covers registration.

## Built-in write gates

Some gates ship on and are not configurable, because the action is consequential by nature:

- **Document writes** — an agent saving files to the document hub always asks (**Save to documents**).
- **Knowledge writes** — an agent storing an org-wide fact always asks (**Save to knowledge base**).
- **Workflow creation, updates, and runs** — an agent building, editing, or starting a workflow always asks; see [Approvals in workflows](/platform/automations/approvals-in-workflows).

<Note>

The lever for these is not the approval flag but the capability itself: an agent without the document tools or workflow tools never produces the card. Trim the agent's [tool set](/platform/agents/tools) to remove the capability entirely.

</Note>

## Verifying what will ask

Before putting an agent in front of real systems, read its capabilities the way an approver would: the integration's operations list for flagged writes, the MCP server's **Discovered Tools** for flagged tools, and the agent's tool tab for whether it holds write tools at all. The [audit log](/platform/admin/governance/audit-logs) then records every decision the setup produces.

## Where this fits

Configuration here is distribution — flags live with the integrations and servers that own the capabilities. Read [Approval concepts](/platform/approvals/concepts) for the card lifecycle those flags produce, and [Agent tools](/platform/agents/tools) for the capability side of the same boundary.
