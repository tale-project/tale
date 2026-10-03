---
title: "Does this task need an AI agent or a workflow?"
description: "Choose fixed steps, one model call, or an AI agent for a reporting task. Keep calculations reliable and use investigation only where it helps."
slug: ai-agents-vs-workflow-automation
topicId: T03
reviewed: '2026-10-03'
draft: false
coverAlt: "A fixed path and a branching path converge on a shared work product."
---

Use a fixed workflow when you can define the steps and decision rules in advance. Use an agent when it needs to examine a result and decide what to investigate or do next. If all you need is a summary of supplied text, one model call may be enough.

You can combine these approaches in the same process. A monthly report might use fixed steps to calculate totals, a model to summarize comments, and an agent to investigate an unexplained change. Decide what each part must accomplish before choosing the architecture.

## Ask who chooses the next step

A workflow follows steps and branches that you define. An agent chooses its next action from the options it has been given. This distinction concerns control over the process, not whether AI appears anywhere inside it. It follows the distinction in [Anthropic’s guide to building agents](https://www.anthropic.com/engineering/building-effective-agents).

A workflow can contain a language-model step. “Classify these comments, then summarize them” is still a predefined sequence, even though the classifications may vary or be wrong. Fixed execution order does not make generated content correct.

An agent also need not control the whole job. You can let it investigate a question while keeping calculations, record changes, and distribution in defined steps.

![A fixed workflow follows predefined steps, an agent chooses actions from observations, and a hybrid process places a bounded agent investigation between validation and review.](/blog/diagrams/en/T03-diagram.svg)

## Work through a monthly feedback report

Here is an illustrative example. A team receives 22 feedback rows. Two repeat an existing feedback identifier. Under the team's agreed rule of keeping one row per identifier, that leaves 20 distinct feedback items.

Eight are already categorized as setup feedback. Last month, four of 20 were in that category. Setup's share of recorded feedback has therefore risen from 20% to 40%, an increase of 20 percentage points.

These are calculations, not reasons to give an agent discretion. A defined step can validate the identifiers, apply the duplicate rule, count the categories, and preserve the excluded rows. If two versions of one identifier conflict, send that exception to the report owner rather than silently choosing a version.

The next step depends on what the owner actually wants:

| Requested result | Available input | Starting approach | Why |
| --- | --- | --- | --- |
| Report the category counts | Validated rows and agreed counting rules | Fixed workflow | The operations are already known |
| Summarize the eight setup comments | A complete packet of comments | One model call, followed by review | There is no need to choose further sources |
| Investigate possible reasons for the increase | Comments plus permission to consult product references | A bounded agent or a person | Findings determine which source to inspect next |

The third option is useful only when further investigation can change the answer. If the relevant evidence already fits in one short packet, adding a tool-using loop may accomplish little.

## Give the investigation a narrow job

Suppose an initial reading finds three invitation complaints, two single-sign-on complaints, two import complaints, and one unclear item. The invitation comments point toward a permissions reference; the sign-on comments suggest checking a release note. Different findings lead to different next sources.

That is a plausible agent task. A brief could say:

> Investigate the eight setup comments using the supplied product references and release notes. Return possible explanations with feedback IDs, supporting passages, and missing facts. Preserve the accepted counts. Ask the report owner if you need unavailable account data. Do not change records or publish the report.

The agent can recommend checking the invitation instructions without claiming that all eight comments have one cause. Two sign-on complaints and a release in the same month do not establish that the release caused the increase.

Likewise, “40% of recorded feedback concerns setup” must not become “40% of customers struggle with setup.” The export does not establish that customer denominator. Review the proposed explanation against the original records, not just the neatness of its format.

## Test the simplest approach that answers the request

Run a small example before building the full process. Include an ordinary input, a conflicting duplicate, and a missing reference. Check that the counts remain correct, unresolved questions stay visible, and the result answers the requested question.

If a single model call produces an adequate explanation from the supplied packet, keep it. If the agent finds useful evidence that the packet lacks, compare that gain with its extra tool use and review effort. A person may remain the better investigator when essential evidence is inaccessible or cannot be checked.

For a recurring process, repeat representative cases instead of relying on one good run. Record failures and the corrections needed to obtain a usable report. The [process-decision worksheet](/blog/worksheets/en/T03-process-decision.md) helps record the choice and the condition that would make you reconsider it.

Tale offers an `llm` step for a single completion and an `agent` step for work needing tools, files, or multiple turns. See [automation concepts](https://docs.tale.dev/platform/automations/concepts) for their current behavior.
