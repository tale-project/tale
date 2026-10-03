---
title: How to evaluate AI agents on real business tasks
description: Compare AI agents using real tasks, accepted results, review time, cost, and latency. Build a practical scorecard before expanding a rollout.
slug: evaluate-ai-agents-business-tasks
topicId: T08
reviewed: '2026-10-03'
draft: false
coverAlt: "Three sample reports are compared against the same measuring frame."
---

An AI agent that completes more tasks can still be the wrong choice if checking its work consumes the team's day. An inexpensive run can become an expensive deliverable after failed attempts and repairs. Evaluate the operating process you intend to use: the initial output, the assistance it needs, and the result your team can finally accept.

That requires four separate measures: acceptance, human effort, covered cost, and delivery time. It also requires a trustworthy way to grade them. A polished report and an enthusiastic automated reviewer are two outputs to check, not independent proof that the work succeeded.

This guide works through a synthetic comparison of two campaign-research configurations. Every trial count, time, and price in that example is assumed for teaching; none is a Tale benchmark. The accompanying [evaluation scorecard](/blog/worksheets/en/T08-evaluation-scorecard.md) includes the worked calculation and a blank record for your own pilot.

## Define acceptance where mistakes become costly

Choose a deliverable your team knows how to inspect. For the campaign example, each task supplies a product specification, interview excerpts, and dated competitor material. The worker must propose two launch messages with evidence. Publication is outside its authority.

A reviewer can disagree with the proposed strategy while accepting a sound analysis. Conversely, attractive copy fails if its central product claim is invented. Write the rubric around those distinctions:

| Requirement | What the reviewer checks | Acceptance rule |
| --- | --- | --- |
| Supported product claims | Each material claim against the supplied specification | No unsupported material claim |
| Honest audience evidence | Interview context and the statement derived from it | No sample observation presented as market prevalence |
| Useful alternatives | Audience problem, promise, evidence, and objection | Two different choices, with reasons |
| Visible uncertainty | Missing sources and unresolved decisions | Gaps remain explicit |
| Authorized activity | Available action records and relevant external state | No publication or customer contact |

Do not demand the exact sequence of searches you would have used unless that sequence is itself required. Valid work can take different paths. But if the task prohibits sending messages, a correct document does not cancel out an unauthorized send. Outcome checks and process constraints have different jobs. [Anthropic's evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) makes the related distinction between what an agent reports and what the environment actually contains.

## Test the reviewer before trusting the score

A model can help identify unsupported claims or compare clarity. It needs calibration on your rubric. The MT-Bench research found substantial agreement between a strong model judge and human preferences, while also demonstrating sensitivity to answer order and unnecessary length. These were conversational judgments with older models; they neither validate nor disqualify your current evaluator. [MT-Bench study, methods and limitations](https://arxiv.org/html/2306.05685v4)

Before scoring candidates, prepare a small calibration packet. Include one concise but correct brief, one fluent brief that changes a source's meaning, one that acknowledges a missing input, and one with a harmless style defect. Have qualified people label the material defects independently, then reconcile disagreements against the sources. If they cannot agree what passes, clarify the rubric before adjusting the agent.

For the synthetic campaign, suppose a source says a feature is in a private pilot. A draft calls it generally available. The verdict is a material failure even if the draft wins a style comparison. A draft that says availability is unconfirmed may be the correct result. This gives the reviewer something harder to distinguish than an obviously excellent and an obviously broken answer.

Hide configuration names during grading where practical. If using pairwise model judgments, swap answer order and inspect reversals. Require a reference for factual verdicts; a judge's explanation can also be wrong. Audit a sample of accepted outputs as well as rejected ones, because checking only failures cannot expose false passes. These are proposed operating checks, not a guarantee of evaluator accuracy.

Automated review is most useful when it reduces repetitive checking without becoming the only source of truth. For a small pilot, direct expert review may cost less than building and maintaining a complicated judge. For high-volume, bounded work, calibrated automated checks can earn their place.

## Separate coverage from repeatability

Use cases that reflect the intended workload: ordinary inputs, contradictions, missing information, and situations where asking a question is correct. Keep some cases unseen while you tune the configuration. Freeze source snapshots where possible so changing web content does not quietly change the test.

Different cases test coverage. Repeated attempts at the same case test consistency. Six cases run twice are twelve trials across six cases; they are not evidence of twelve independent kinds of work. Preserve this distinction when presenting counts.

The original tau-bench research formalized a useful contrast: finding at least one success across retries and succeeding across every repetition answer different questions. Its environments use simulated users and bounded retail and airline tasks, so its rates do not predict your team's results. [Tau-bench, evaluation and limitations](https://arxiv.org/html/2406.12045v1)

Consider a purely mathematical illustration. If each attempt independently succeeds with an assumed probability of 90%, the chance of ten consecutive successes is `0.9^10`, about 35%. Real task failures can be correlated, so do not apply that calculation to a measured average without checking its assumptions. It simply explains why “we eventually got a good answer” is inadequate evidence for unattended recurring work.

Retries are sensible when a reliable check can identify a valid result and their cost is acceptable. They are less reassuring when each retry repeats a consequential action or when the same uncertain judge selects the apparent winner. Decide which process you are evaluating before running it.

## Keep the trial and its repair history together

Record runtime, model, provider, instructions, skills, tools, input snapshot, and limits. Start independent trials from equivalent conditions in disposable test workspaces. Preserve artifacts before resetting them. An agent that can read last time's answer has a different starting point.

A repair belongs to its original trial. Record the initial verdict before supplying feedback, then record whether the allowed repair process produced an accepted result. Keep valid timeouts and no-output runs as failures. Log a configuration that never starts separately as an availability problem; it still matters to deployment even though there is no output to grade.

![Evaluate completion, review burden, cost coverage, and time to acceptance separately. Use the same input snapshot and acceptance rubric across repeated trials, including failures.](/blog/diagrams/en/T08-diagram.svg)

*Keep the initial verdict after a repair. Otherwise, a helpful human can make a weak agent appear independently reliable.*

Measure active human work separately from calendar time. Preparation, supervision, source checking, and repair consume labor. Queueing and waiting for a reviewer affect delivery. Concurrent agent durations cannot be added and called time saved; they may overlap. Count each person's active intervals without counting the same minute twice.

## Work through the cost of an accepted deliverable

Assume both configurations receive the same six cases, each run twice from clean conditions. Both allow one repair round. No trial has a prohibited effect. All labor below includes preparation, supervision, review, and repair across successes and failures. The numbers are invented, including the assumed labor rate of $60 per hour.

| Synthetic cohort measure | Configuration A | Configuration B |
| --- | --- | --- |
| Valid started trials | 12 | 12 |
| Accepted on first output | 8/12 | 10/12 |
| Accepted within the repair allowance, including first-pass results | 10/12 | 11/12 |
| Unaccepted at the end | 2 | 1 |
| Covered model and tool charges | $6 | $18 |
| Active human time | 180 minutes | 120 minutes |
| Estimated human cost at $60/hour | $180 | $120 |
| Estimated covered-cost subtotal | $186 | $138 |
| Subtotal per accepted deliverable | $18.60 | $12.55 |

A looks cheaper if the decision considers only model and tool charges. After labor, B has the lower covered subtotal per accepted result: `(18 + 120) / 11 = 12.55`, rounded. This is still a partial cost calculation. Infrastructure, subscriptions, and deployment overhead are unmeasured here, so it cannot establish total savings.

The conclusion also depends on the labor assumption. Let `r` be the hourly rate. A's ratio is `(6 + 3r) / 10`; B's is `(18 + 2r) / 11`. They are equal at about `$8.77/hour`. Below that rate, A has the lower covered ratio; above it, B does. Missing cost differences can change the comparison again. Record the sensitivity instead of presenting the chosen rate as a fact about everyone's business.

Under these assumptions, B deserves the next supervised pilot, provided its remaining failure is acceptable and it meets the delivery deadline. Twelve trials do not justify a precise population ranking. If B's one failure exposed confidential material while A's failures merely asked for clarification, a lower average cost would not rescue B. The severity and meaning of failure come before the ratio.

## Choose the denominator before opening the spreadsheet

For the declared cohort, use `F/N` for first-pass acceptance and `A/N` for acceptance within the permitted repair process. `N` contains all valid started trials, including timeouts and absent outputs; `A` includes first-pass acceptances. Resolve ungraded outputs before comparing rates, and disclose invalid tests and operational start failures rather than dropping them silently.

For cost, sum nonduplicated observed charges, disclosed allocations, and estimated labor across the cohort, including failures, then divide by accepted deliverables. An allocation of a subscription is an accounting assumption, not a measured charge for that run. Avoid counting the same provider charge once from the gateway and again from an invoice.

If `N = 0`, acceptance rates are undefined. If `A = 0`, cost and effort per accepted result are undefined; report the spend, effort, and zero acceptances. With missing categories, call the result an **estimated covered-cost subtotal per accepted deliverable**. Reserve “measured subtotal” for observed charges alone. Unknown costs are not zero.

Keep elapsed delivery time alongside these figures. Report acceptance times for accepted trials and terminal durations for failures separately. A configuration that fails fast has not delivered fast. For a deadline-bound process, count how many accepted results arrived by the deadline as well as how many eventually passed.

## Make the pilot's decision narrower than its spreadsheet

The scorecard should lead to a bounded action: continue with a supervised workload, fix a particular failure, compare another configuration, or stop. Identify what would reverse the choice. A lower-cost model may be adequate when outputs have cheap deterministic checks; expensive review may dominate when every claim requires reading a source.

In Tale, put the brief and rubric on a [project task](https://docs.tale.dev/platform/projects/tasks), configure the worker through [project agents](https://docs.tale.dev/platform/projects/project-agents), and retain artifacts with their review decisions. Confirm the review arrangements for your deployment in the [task review guide](https://docs.tale.dev/platform/projects/task-automation). The worksheet remains a separate evaluation artifact.

[Usage analytics](https://docs.tale.dev/platform/admin/governance/usage-analytics) supplies recorded application usage, not a complete provider invoice or guaranteed task-level total. Supported subscription runtimes call providers directly and bypass Tale gateway metering and spending caps. Establish that coverage before using the records in a cost comparison. [Runtime credential paths](https://docs.tale.dev/platform/agents/harnesses)

Bring one representative input, the acceptance rubric, and the completed scorecard to a [Tale demo](/request-demo). The useful question is whether this particular working arrangement produces results your team can accept at a tolerable cost of checking them.
