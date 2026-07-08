---
title: Configure approvals
description: Reference for the approval rules an Admin or Editor can attach to an agent, an integration, or a workflow step — when an approval is required, who decides, what happens on timeout.
---

Approval rules are the configuration behind every approval card Tale surfaces. They name what triggers an approval, who is in the approver pool, and what happens when no one decides in time. Admins configure org-wide policies; Editors configure per-agent and per-workflow gates. This page is the reference for the fields you set on each rule and what they change about the running product.

The mental model of approvals — what a card is, what an approval leaves behind, the four trigger sources — lives on [Approval concepts](/platform/approvals/concepts). What follows is the configuration surface: where the rules live, the per-rule fields, and how rules compose when two fire at once.

## A worked rule

To require approval before an agent writes to the customer database, open **Settings > Governance > Approval rules** and click **New rule**. Pick the resource (`Customers — write`), pick the trigger (`Any agent`), pick the approver pool (`Team: Operations`), set the timeout (`24h`) and the timeout action (`Reject`). Save. The next time any agent tries to create or edit a customer, the write is held, an approval card lands in the Operations team's inbox, and the run continues only if someone clicks Approve within the day.

The rule is in effect immediately; in-flight writes complete, the next one is held. Removing the rule lifts the hold on future writes; existing pending approvals stay pending until they resolve.

## Where rules live

Three configuration surfaces produce approval rules; each one writes to the same underlying rules table.

- **Settings > Governance > Approval rules** is the org-wide surface. Admins create rules that apply to a resource (documents, customers, products, integrations, MCP servers, agent creation, skill installation) and pick the trigger pattern (any actor, specific roles, specific teams, specific agents).
- **The agent editor's Governance tab** lets an Editor attach an agent-specific rule. The rule fires only for that agent's calls; it composes with any org-wide rule that also applies.
- **The workflow step's Approval gate** lets the workflow author require approval at a specific step. This is the [Approvals in workflows](/platform/workflows/approvals-in-workflows) surface; the gate writes a one-off rule scoped to that step.

A resource can have multiple rules in effect; the engine runs them all and the action is held until every applicable rule approves. Reject from any rule ends the action.

## Per-rule fields

Every rule carries the same shape regardless of where it was authored.

| Field             | Required              | Description                                                                                                                                                                                             |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name              | Yes                   | Human label shown on cards and in audit. Pick something the approver will recognise.                                                                                                                    |
| Resource          | Yes                   | The thing being changed: a knowledge-base type (Documents, Customers, Products, Vendors, Websites), an integration call (`Integrations > Outbound`), agent creation, skill install, or a workflow step. |
| Trigger pattern   | Yes                   | Who is acting: any actor, a specific role, a specific team, a specific agent. Restrictive patterns narrow the rule's reach.                                                                             |
| Approver pool     | Yes                   | The eligible set: a team, a role, or an explicit member list. The first eligible approver to click decides.                                                                                             |
| Exclude requester | Default               | The actor who triggered the action is removed from the pool. On by default; turning it off is rarely the right call.                                                                                    |
| Timeout           | Yes                   | The window before the timeout action fires. Tale supports minutes, hours, and days.                                                                                                                     |
| Timeout action    | Yes                   | What happens when the window closes with no decision: `Reject` (the action is abandoned), `Escalate` (route to a fallback pool), or `Approve` (auto-allow — only safe on low-risk resources).           |
| Escalation pool   | If timeout = Escalate | The pool that gets the card on escalation. Same shape as Approver pool.                                                                                                                                 |
| Comment policy    | Default               | Whether the approver may, must, or cannot leave a comment. Default is may.                                                                                                                              |

## How multiple rules compose

When a single action matches more than one rule, Tale evaluates them in parallel. The action is held until every rule resolves; an Approve on one is not enough if a second rule is still pending. A Reject on any rule ends the action and writes the rejection to the audit log. This is intentional — the strictest applicable rule wins, and a permissive rule cannot accidentally override a stricter one.

If two rules target the same approver pool, the approver sees one card per rule; deciding each one is required. The cards link back to each other so the approver can see the full set of holds before making a call.

## Auditing and history

Every rule change lands in the audit log with the actor, the timestamp, and the diff. The audit row also tracks every approval the rule produced — each card's actor, decision, comment, and resolution time. Reach for the rule's audit view (the **History** tab on the rule's row) when you want to see how often the rule fires and how long approvers typically take.

## Where this fits

Approval rules are the configuration plane behind [Approval concepts](/platform/approvals/concepts); the workflow-gate variant has its own surface under [Approvals in workflows](/platform/workflows/approvals-in-workflows). The natural next read depends on what you are wiring — for workflow gates the workflow page, for agent-write approvals the [Admin agents view](/platform/admin/agents) where the per-agent governance lives.
