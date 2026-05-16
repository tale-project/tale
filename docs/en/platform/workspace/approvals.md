---
title: Approvals
description: Review, approve, or reject actions that automations and agents queue up for human sign-off, directly inside the chat conversation.
---

Approvals are inline cards that appear in a chat conversation when an automation or AI agent reaches a step gated for human sign-off. The card carries the full context — which workflow or tool triggered it, what action it wants to take, what data it would use — and offers **Approve** and **Reject** buttons that run or cancel the action in place. The audience is anyone in the conversation when an approval lands; the cards arrive in line with the messages they belong to, so the reviewer doesn't change surface to make a decision.

This page covers the seven approval shapes you can encounter, the review flow on each card, and how the two interactive variants (human input requests and location requests) differ from the standard approve-or-reject pair.

## Approval types

The seven cards that can appear in a conversation, each gated for a different reason:

| Type                  | What it asks for                                                                    |
| --------------------- | ----------------------------------------------------------------------------------- |
| Integration operation | Permission to execute a REST API call or SQL query through a connected integration. |
| Workflow creation     | Permission to create a new automation workflow.                                     |
| Workflow execution    | Permission to run an existing workflow with specific parameters.                    |
| Workflow update       | Permission to modify an existing workflow's steps or configuration.                 |
| Document write        | Permission to create or save one or more files to the knowledge base.               |
| Human input request   | A paused workflow asking the reviewer to fill in information before it continues.   |
| Location request      | Permission to access the browser's location for a location-aware task.              |

## Review an approval

Every card shares the same shape. A header identifies the approval type and the actor (the workflow or agent that raised it). A details section you can expand shows the parameters, the file list, or the workflow steps — whatever the action would touch. The two buttons at the bottom run or cancel the action.

To let the action proceed, click **Approve**. The card switches to an execution view showing live progress, then the final result. To cancel it, click **Reject** (some cards use a context-specific label like **Cancel workflow creation** or **Reject this operation**). The agent receives a notification that the action was rejected and adjusts its approach on the next turn.

## Human input and location requests

Two of the seven types are interactive rather than simple approve-or-reject decisions. Human input requests display a form with fields the paused workflow needs — text inputs, dropdowns, yes/no toggles — and submitting the response resumes the workflow with the answers attached. Location requests ask for your browser's geolocation: click **Share location** to grant access (the browser shows its native permission prompt) or **Deny** to refuse.

For both shapes, the conversation is paused until the reviewer responds. The card shows _Waiting for input_ in the agent's transcript so the chat history stays readable.

## Where this fits

Approvals are the in-the-loop control surface. They exist because some actions — billing operations, mass email, production data writes — shouldn't run autonomously even when the agent has the technical capability. The card pattern is the same whether the request comes from an [agent](/platform/agents/concepts) calling an integration's write operation, an automation reaching a step gated for review, or an MCP server's tool flagged `requiresApproval: true`.

To gate a specific integration operation behind approval, the per-operation flag lives on the integration's configuration page in [Settings > Integrations](/platform/integrations/overview). To require approval before a workflow step runs, the workflow editor exposes the same flag on each step.
