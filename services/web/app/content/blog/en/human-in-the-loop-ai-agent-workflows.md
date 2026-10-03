---
title: 'Human-in-the-loop AI: reviews and approvals'
description: Design useful checkpoints for AI agents. Separate questions, result reviews, and action approvals, with a practical review-packet template.
slug: human-in-the-loop-ai-agent-workflows
topicId: T02
reviewed: '2026-10-03'
draft: false
coverAlt: "Three separate objects represent a question, an inspected result, and an action gate."
---

An agent prepares a support announcement, and someone clicks “approve.” What has the team established? Perhaps that the message is accurate. Perhaps only that the person had access to the button. Perhaps that a correct message may be sent to the wrong audience.

A human-in-the-loop AI workflow places people at selected decision points. The difficult part is choosing those points and giving the person a decision they can actually improve. **A checkpoint deserves human attention when the person supplies missing authority, relevant knowledge, or judgment that the process cannot otherwise provide adequately.** Requiring a click is not evidence that any of those things happened.

This guide works through an announcement that should be corrected, a send proposal that should be refused, and a review queue that cannot keep up. Each failure calls for a different remedy.

## Give each checkpoint one meaning

Three decisions often share the same “approval” label, although their consequences differ.

| Interaction | Decision | Consequence |
| --- | --- | --- |
| Question | Which missing fact or preference applies? | The worker can use that information |
| Result review | Does this particular deliverable meet its criteria? | Accept the work or request changes |
| Action approval | May this specific operation proceed? | Permit an attempt or prevent it |

The distinction is operational. Answering “use the regional support process” does not accept the agent's eventual description of that process. Accepting an announcement does not approve every possible recipient. Permission to send does not prove delivery.

Frameworks implement these decisions differently. LangChain's human-in-the-loop middleware, for instance, documents configurable decisions around interrupted tool calls. Its available responses are implementation details to check, not universal meanings of an approval button. [See the middleware documentation](https://docs.langchain.com/oss/python/langchain/human-in-the-loop).

Write the decision in a sentence before designing the interface: “May this workflow send announcement revision 3 to the regional support test group?” If that sentence cannot name the material and consequence, the checkpoint is too vague to review reliably.

![Three separate checkpoints: questions supply information, result reviews accept work or request changes, and action approvals permit or deny a specific operation. Permission does not prove execution succeeded.](/blog/diagrams/en/T02-diagram.svg)

## Illustrative example: reject the right thing

The following service-update scenario uses invented documents and destinations. It demonstrates a review method, not a measured deployment.

A process owner has approved note P-17: from Monday, the regional support team should escalate unresolved access problems to the duty lead. An agent drafts announcement revision 2. The team intends to test distribution internally before considering a wider audience.

Here is the substantive part of the first review packet:

| Packet field | Filled example |
| --- | --- |
| Decision requested | Accept announcement r2 as an accurate regional process update |
| Proposed claim | “All support teams must escalate access problems immediately” |
| Governing evidence | P-17: regional team; unresolved access problems; effective Monday |
| Criteria | Preserve audience, escalation condition, and effective date |
| Reviewer finding | Scope expanded; unresolved condition removed; date omitted |
| Decision | Request changes to those three elements |

The reviewer does not need a model confidence score to find the problem. Comparing the proposed sentence with the governing note exposes it. The changes are consequential: the draft broadens who must act, which cases qualify, and when the process starts.

Revision 3 restores all three conditions. The reviewer can now accept its accuracy. That still leaves a separate distribution decision. Suppose the send proposal names `all-support` rather than the intended `regional-support-test` group. The appropriate answer is to reject that operation. Reopening the accepted wording would not fix the destination.

After correction, the new proposal identifies revision 3 and the intended test group. The person checks the actual group identity or membership evidence available to them, rather than relying on the reassuring word “test.” Approval then permits the attempt. A delivery error is recorded as an execution failure, not as evidence that the person's earlier decision was refused.

This sequence gives every intervention a purpose. The question resolves scope; the review corrects meaning; the action decision restricts distribution; the outcome check verifies execution.

## A human can add authority without adding accuracy

Some decisions require a person because the organization reserves the authority. Other checkpoints exist because the person is expected to detect errors. Those are different justifications, and they need different evidence.

A 2024 meta-analysis covering 106 experiments found that human–AI combinations improved on human-only performance on average, yet underperformed the better of the human-only and AI-only conditions. It included studies published through June 2023 and required all three comparison conditions. It therefore cannot establish how a current agent-review workflow will perform, or whether a required authorization should be removed. [Read the final paper and its methods](https://www.nature.com/articles/s41562-024-02024-1).

The practical challenge is to name the human contribution. In the announcement example, the process owner knows which policy governs. The factual reviewer compares the draft with that policy. The person authorizing distribution controls the intended audience. Assigning all three to whoever is online would leave those contributions unproven.

When accuracy is the purpose, give the reviewer evidence they can use to disagree. An agent-generated rationale may help navigate a packet, but it is not a replacement for the underlying record. For consequential claims, ask the reviewer to identify the relevant source condition before accepting the proposed wording. This is our recommended review design, not a claim that a particular interface has been validated.

A study by Buçinca and colleagues found that more deliberate interaction could reduce overreliance while receiving less favorable user ratings. Its result supports examining both decision quality and review burden; it does not justify adding friction everywhere. [Read the 2021 experiment](https://arxiv.org/abs/2102.09692).

## Spend attention where it can change the outcome

A missing required date can often be detected automatically. Whether “unresolved” means the same thing in a revised policy requires interpretation. Whether a message may go to a particular audience requires the relevant authority and current destination evidence.

Use automated checks to remove avoidable review work before the packet arrives. They can reject missing fields, identify a changed artifact revision, or check an allowed destination identifier where the rules are explicit. They cannot establish that every valid sentence preserves the intended meaning.

In the example, a useful division is:

| Check | Starting approach | Reason |
| --- | --- | --- |
| Required packet fields present | Defined validation | The required structure is known |
| Announcement preserves P-17's conditions | Substantive review | A fluent paraphrase can change meaning |
| Destination matches the authorized audience | Exact identifier check plus appropriate authorization | Correct content does not settle distribution |
| Delivery actually occurred | Execution evidence | Approval alone cannot establish an effect |

This choice should change when the task changes. A reversible internal formatting adjustment may need sampling and an easy correction path instead of individual approval. A message creating a new service commitment may need a qualified owner even when its grammar, references, and destination are all correct. Required organizational approvals remain required; lower review volume does not itself authorize removing them.

## Check whether the review queue is feasible

An operating model that assigns every proposal to a busy person may simply move the bottleneck.

Consider an illustrative capacity calculation. Assume 24 new proposals arrive each workday, every review takes four minutes, and the assigned reviewer has 60 minutes a day for this work. Ignore rework and variation initially.

The incoming work requires `24 × 4 = 96 minutes`. Available time covers `60 ÷ 4 = 15 reviews`. Under those assumptions, nine proposals remain unreviewed each day; after five days, the additional backlog is 45. This is arithmetic on invented inputs, not a prediction of real waiting times. Variable arrivals, more complex cases, and repeated review would require further measurement.

The design needs a response before an urgent queue forms. The team might reduce unnecessary proposals, fix recurring packet defects, allocate qualified coverage, or narrow the pilot. Batching a few similar decisions can reduce repeated setup, but the packet must still preserve exceptions and the scope of each decision. Automatically accepting overdue work would change the authorization policy; it is not a remedy for insufficient staffing.

Measure both arrival rate and actual handling time during the pilot. Track change requests as well as approvals: a proposal that returns three times consumes capacity three times. The goal is a review process people can perform carefully at the expected workload.

## Attach decisions to versions and define recovery

A review record should identify exactly what was inspected. “Approved on Tuesday” is inadequate if someone changed the audience on Wednesday.

For the announcement, a later wording correction may require another content review while leaving the verified audience unchanged. A destination change requires another action decision even if the content remains accepted. A new process note can invalidate the factual review. Record the affected decision and why it must be revisited; avoid both blanket approval reuse and unnecessary repetition of unrelated checks.

Missing evidence is a valid outcome. The reviewer can return “unable to decide: group membership unavailable,” with an owner for the missing input. That response should leave the operation unapproved. Likewise, a reviewer without the needed expertise should route the decision to someone qualified instead of treating system access as competence.

The [review-packet template](/blog/worksheets/en/T02-review-packet.md) separates requested decision, overturning evidence, revision, authority, and observed effect. Its capacity fields help test whether the intended operating process is sustainable.

## Apply the distinction to Tale

Tale's documentation separates task results submitted for review from workflow questions and connector-write approvals. For a project task, put the acceptance criteria beside the deliverable so the reviewer can inspect the work. A successful run alone does not settle acceptance. [Read task delegation and review](https://docs.tale.dev/platform/projects/task-automation).

For a proposed connector write, the documented approval card shows the input but does not edit it. Rejecting prevents the operation and fails the run; correcting the workflow or input requires a new execution. [See waiting workflows](https://docs.tale.dev/platform/automations/approvals-in-workflows).

A business-designated approver is also distinct from platform access. Tale's public guide says connector approvals do not route to a named approver group. Owners, Admins, and Developers can open run detail; task-linked cards can be decided by anyone who can open that task. Match the documented access behavior to the responsibility your process requires. [Read operation-approval concepts](https://docs.tale.dev/platform/approvals/concepts).

Connector approval is a defined control path. Do not assume it intercepts every action possible through direct sandbox tools or granted credentials. Review those access paths when configuring the process. [See runtime and credential boundaries](https://docs.tale.dev/platform/agents/harnesses).

For a [Tale demo](/request-demo), bring the incorrect announcement, the corrected revision, and the wrong-destination proposal. A useful demonstration should make all three decisions distinguishable and leave enough evidence to explain what happened after each one.
