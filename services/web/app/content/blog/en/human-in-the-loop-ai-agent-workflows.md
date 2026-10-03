---
title: "Where should people approve an AI workflow?"
description: "Choose where an AI workflow needs a person, what the reviewer should see, and how to separate a correct draft from permission to send it."
slug: human-in-the-loop-ai-agent-workflows
topicId: T02
reviewed: '2026-10-03'
draft: false
coverAlt: "Three separate objects represent a question, an inspected result, and an action gate."
---

Put a human checkpoint where someone must supply missing information, judge the result, or authorize an action. Each checkpoint should ask a specific question. “Approve the agent's work” leaves too much open: a person might approve the wording of a message without noticing who will receive it.

Start by listing what the agent will produce and what it can change. Then decide which steps need your knowledge or authority. Drafting an internal note and sending it to customers have different consequences, even when they use the same text.

## Decide what the person is approving

Three interactions are worth keeping separate:

| Checkpoint | The question it answers | What happens next |
| --- | --- | --- |
| Question | Which policy, audience, or preference applies? | The agent continues with the missing information |
| Result review | Does this version meet the brief? | Accept the result or request changes |
| Action approval | May this exact operation proceed? | Allow the attempt or prevent it |

A question belongs before work that depends on the answer. Review belongs after there is something concrete to inspect. Action approval belongs before the effect you need to control, with the actual content and destination available to the reviewer.

![Questions supply missing information, result reviews accept work or request changes, and action approvals allow or refuse a specific operation.](/blog/diagrams/en/T02-diagram.svg)

These decisions can happen in one sitting. They still need distinct answers. If you approve both an announcement and its distribution, record which version and which audience that decision covers.

## A correct message can still go to the wrong people

Consider a fictional support announcement. The governing note, P-17, says that **from Monday, the regional support team should escalate unresolved access problems to the duty lead**. The first send is meant for an internal test group.

The agent's draft, revision 2, says: “All support teams must escalate access problems immediately.” It sounds clear, but it changes three things: who the rule applies to, which problems qualify, and when it starts.

The content reviewer should request those corrections. Revision 3 restores the regional scope, unresolved condition, and Monday start. Its wording can now be accepted.

Next, the workflow proposes sending r3 to `all-support`. That is the wrong destination; the task permits only `regional-support-test`. Rejecting this send does not mean the wording needs another rewrite. The operation needs a corrected recipient, followed by a new approval. Before allowing it, check the group's identity or membership, not just its reassuring name.

After the attempt, check whether delivery succeeded. An approval records permission to try; it cannot establish what happened afterwards.

## Give the reviewer enough to disagree

A reviewer should not have to reconstruct the task from a chat history. For the announcement's send decision, this compact request would be enough to start:

> - **Decision:** May we send announcement r3 to `regional-support-test`?
> - **Content:** Link to the exact r3 text, checked against P-17.
> - **Destination:** Link to the group's current membership.
> - **Change:** The earlier proposal incorrectly named `all-support`.
> - **If refused:** Stop this send and return the reason to the task owner.

Keep the original evidence beside the proposal. The agent's summary of a policy can contain the same mistake as its draft. A person checking the announcement needs P-17, not another confident explanation of P-17.

Choose the reviewer for the decision: someone who understands the policy for content, and someone authorized to approve distribution for the send. The same person may cover both. Being able to open an approval screen does not, by itself, establish either responsibility.

## Avoid approvals that add no useful judgment

Missing fields, invalid addresses, and forbidden destination identifiers are usually better handled by explicit validation rules. Have those checks run before asking someone to read a proposal. Save human attention for meaning, exceptions, and authority.

For reversible internal work, sampling completed results may be enough. For a new customer commitment, a payment, or publication under the company name, you may need a responsible person to inspect each proposal. Keep any approvals your organization requires.

Watch what reviewers actually do during a pilot. If most requests come back because the source is missing, fix the request format. If people cannot keep up, narrow the workflow or arrange qualified cover. A growing queue is a reason to change the process, not to treat silence as consent.

## Keep approval attached to the thing reviewed

Changing the message, its recipient, or the policy it relies on can invalidate an earlier decision. Name the version and scope in the record so the next person can see what still holds. When a source or destination cannot be checked, leave the action pending and identify who can supply the missing evidence.

In Tale, task results return for review, while waiting workflows distinguish questions from connector-write approvals. An incorrect operation cannot be edited on its approval card: reject it, correct the input or workflow, and start a new run. [Task review](https://docs.tale.dev/platform/projects/task-automation), [waiting workflows](https://docs.tale.dev/platform/automations/approvals-in-workflows).

Use the [review-packet template](/blog/worksheets/en/T02-review-packet.md) for a workflow you already have. Start with its next consequential action and write the one sentence the reviewer must answer. If you cannot make that sentence precise, the workflow is not ready for an approval button.
