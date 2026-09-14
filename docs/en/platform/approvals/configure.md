---
title: Decide which actions need approval
description: Understand the default approval rules, request a policy change, and distinguish operation approvals from other reviews.
---

An approval policy decides which connector writes must wait for a person during a live automation run. Review the workflow’s outbound actions before deploying it, especially when it sends messages or changes another system. [Approval concepts](/platform/approvals/concepts) explains the decision card itself.

## Start with the default behavior

Reads do not require operation approval. By default, writes to external systems, such as sending mail, posting to Slack, creating a GitHub issue, or writing to WebDAV, pause for approval. Internal operations, such as updating a task or saving a document in Tale, do not ask by default.

An allowed operation still runs under the relevant access rules. A missing approval card is not evidence that an operation is read-only: it may be an internal write or one that your organization explicitly auto-approves.

## Request a policy change

There is no per-action approval switch in the connector settings page. The organization’s approval policy can require or bypass approval for a connector or an individual action. A rule for one action takes precedence over a rule for its connector.

Ask the person managing your deployment to apply the [approval policy configuration](/self-hosted/configuration/approvals). Name the exact operation, why it should ask or proceed automatically, and which workflow uses it. Cloud administrators should coordinate the change with whoever manages their deployment.

An operation already waiting for approval keeps its pending decision after a policy change. Approve or reject that card explicitly; loosening the policy does not release it.

## Check a workflow before it goes live

1. Inspect each connector node and identify whether it reads or writes.
2. Confirm which writes the organization’s effective policy auto-approves.
3. Run **Test run** to check inputs and output against mocks.
4. During a controlled live run, inspect the operation and exact input on any pending card before deciding.

A mock test does not prove that a live approval will appear. Mock connectors do not change external systems and do not request approval.

## Distinguish the other human decisions

| Decision | Where to read the rules |
| --- | --- |
| Accept an agent’s task result | [Task automation](/platform/projects/task-automation). A person moves the result from In review to Done. |
| Approve a controlled document version | [Documents](/platform/knowledge/documents). The named reviewer decides on the frozen version. |
| Authorize an erasure request | [Data subject requests](/platform/admin/governance/data-subject-requests). A second Admin provides the required approval. |
| Answer an agent node’s question | [Approvals in workflows](/platform/automations/approvals-in-workflows). The run needs information to continue. |

These decisions have their own rules; the connector approval policy does not disable them. Chat has read-only retrieval tools and does not create operation approval cards.
