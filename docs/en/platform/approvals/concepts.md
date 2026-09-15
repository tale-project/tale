---
title: Understand operation approvals
description: Learn why a connector write pauses, what approving or rejecting means, and where to review its outcome.
---

An operation approval lets a person review a proposed connector write before it happens. For example, an automation can prepare an email, then wait for you to check its recipient and body before sending it.

## When a write waits

A live automation pauses when it reaches a connector write that the organization's policy requires someone to approve. By default, writes to external systems need approval; writes through internal, platform-authenticated connectors do not. The organization can change that rule for a connector or a specific action. See [Configure approvals](/platform/approvals/configure).

Reads do not request operation approval. **Test run** uses mock connectors, so it does not perform the external write or show its live approval card. Passing a test does not prove that the proposed live action is appropriate.

## Review the proposed operation

Open the automation's [run list](/platform/automations/execution-logs) and select the run marked **Waiting**. Its approval card names the operation, such as `imap-smtp.send`, and the node requesting it. **The step would call with** shows the exact input.

Check the destination, recipients, content, and identifiers against the intended task. Review sensitive details in the input before choosing:

- **Approve** allows this operation to execute when the run resumes.
- **Reject** prevents this operation and causes the step and run to fail.

The card does not edit the operation. If an input is wrong, reject it, correct the workflow or its input, and start a new run.

<Note>

Organization members can decide connector operation approvals. These cards do not route to a named reviewer or approver group; the run detail is where the decision is made. Other kinds of review can have stricter permissions.

</Note>

## Check what happened next

Approval permits execution; it does not guarantee that the connector succeeds. Check the resumed run's status, node result, and effects. A rejected run shows the rejection as its failure reason. The [audit log](/platform/admin/governance/audit-logs) records the decision and actor.

An existing pending approval stays pending if the policy is relaxed. The same operation in the same run keeps its recorded decision; starting a new run creates a new execution that is evaluated again. A finished or cancelled run cannot use an outstanding approval to perform its write.

## Distinguish approval from a question

An agent node may also pause because it needs information from a person. Answering that question supplies input; it is not approval of a connector write. [Approvals in workflows](/platform/automations/approvals-in-workflows) explains both interactions. Task reviews, controlled document reviews, and erasure requests have their own [review rules](/platform/approvals/configure#distinguish-the-other-human-decisions).
