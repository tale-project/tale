---
title: Approvals
description: Review and approve or reject actions queued by automations and agents directly in the chat interface.
---

Automations and AI agents can be configured to pause at certain steps and wait for human approval before proceeding. When an approval is needed, it appears as an inline card in your chat conversation.

## Approval types

| Type | What it asks for |
| --- | --- |
| Integration operation | Permission to execute a REST API or SQL query through a connected integration |
| Workflow creation | Permission to create a new automation workflow |
| Workflow execution | Permission to run an existing workflow with specific parameters |
| Workflow update | Permission to modify an existing workflow's steps or configuration |
| Document write | Permission to create or save one or more files to the knowledge base |
| Human input request | A paused workflow asking you to fill in information before it continues |
| Location request | Permission to access your browser location for a location-aware task |

## Reviewing an approval

When an agent or automation needs approval, a card appears in the chat with the full context: which workflow or tool triggered it, what action it wants to take, and what data it would use.

Each card includes:

- A header identifying the approval type
- Detailed metadata you can expand (parameters, file lists, workflow steps)
- **Approve** and **Reject** buttons

Click **Approve** to let the action proceed. The card updates to show execution progress and the final result. Click **Reject** to cancel it. The agent receives a notification that the action was rejected and can adjust its approach.

## Human input and location requests

Some approvals are interactive rather than simple approve/reject decisions:

- **Human input requests** display a form with fields (text, dropdowns, yes/no) that a paused workflow needs you to fill in. Submit your response to resume the workflow.
- **Location requests** ask for your browser location. Click **Share location** to grant access or deny the request.
