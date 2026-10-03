---
title: "When is a second AI agent worth the effort?"
description: "Decide whether to use one AI agent or split a project. See how to separate useful work, handle conflicting findings, and judge the extra effort."
slug: multi-agent-orchestration-business-teams
topicId: T01
reviewed: '2026-10-03'
draft: false
coverAlt: "A central coordination hub connects three separate task platforms to one shared output."
---

Start with one agent. Add another when it can answer a separate question, examine different material, or perform a check that the first agent cannot cover well. Before splitting the work, decide who will combine the results.

That is the useful test for multi-agent orchestration. Three agents called researcher, writer, and reviewer can still repeat the same mistake if they all rely on one misleading source. A second agent earns its place through the work it contributes, not its job title.

## Find work that can proceed independently

A good split gives each agent a useful result to produce without waiting for the other to finish. For example, one agent can examine customer interviews while another checks product documentation. Both can return findings to the person or agent writing the recommendation.

Keep the work together when each next step depends on the previous one, the source packet is small, or several agents would keep rewriting the same document. In those cases, extra handoffs may add more work than they remove.

Anthropic describes duplicated searches when its research agents received vague assignments. Its experience supports clear task boundaries; it does not show that every project needs several agents. [Read the research-system account](https://www.anthropic.com/engineering/multi-agent-research-system).

A practical question is: **what will the second agent bring back that I would otherwise be missing?** If the answer is only “another opinion,” explain what evidence that opinion will use before creating the task.

## Split a handbook update into two useful questions

Consider this illustrative project: a team needs to update its onboarding handbook. It has handbook r6, approved product reference r12, and recent support notes. It wants to fix incorrect instructions and cover questions customers actually ask.

Two investigations make sense:

| Assignment | Material to examine | Result to return |
| --- | --- | --- |
| Find missing customer guidance | Support notes | Recurring questions, with links to the original notes |
| Find incorrect instructions | Handbook r6 and product reference r12 | Each discrepancy, both source passages, and a proposed correction |

Neither investigation needs to edit the handbook. Give one editor responsibility for combining their findings into a revised draft. The editor can be a person or an agent; someone still needs to check the proposed changes against their sources.

![Two separate investigations feed an editor who combines findings and resolves conflicts before the revised work is reviewed.](/blog/diagrams/en/T01-diagram.svg)

For a three-paragraph guide with one reference, this split would probably be excessive. One agent could check and revise it, followed by review. The amount of useful independent work determines the team size.

## Give each agent a deliverable, not just a role

“Be the fact-checker” leaves too much for the agent to infer. For the handbook audit, a usable assignment would be:

> Compare handbook r6 with approved product reference r12. For each incorrect instruction, return both source passages and a proposed correction. Do not edit the handbook. If the sources conflict, preserve the disagreement and name the question the product owner needs to answer.

Attach the named inputs, identify the editor receiving the result, and set a time or effort limit. Agree what the agent should return if it cannot finish: completed findings plus the specific missing evidence are more useful than a confident guess.

The [task-contract worksheet](/blog/worksheets/en/T01-task-contract.md) provides a longer version when you need to record permissions, dependencies, and acceptance criteria.

## Resolve disagreements from sources

Suppose the handbook says everyone can invite users, the approved reference says only administrators can, and a support note reports a successful invitation from a standard account.

Do not ask the agents to vote. The handbook is the material being checked. The approved reference establishes the documented rule. The support note raises a question about the customer's actual role or configuration; it does not yet explain the difference.

The editor can propose “An administrator sends the invitation” and ask the product owner to investigate the conflicting report. If the rule cannot be confirmed, leave that section unresolved. Agreement between agents would not supply the missing fact.

Keep input versions with the findings. If reference r13 arrives during the work, recheck the permission finding against it. The customer-question list may remain useful because its support notes have not changed.

## Keep the split only if it improves the finished work

Try the same small assignment with one agent and with the proposed split. Give both the same inputs and acceptance criteria, and record any difference in the total budget. Compare missed errors, useful findings, time until the draft is accepted, and the effort spent coordinating and correcting it.

Keep the second agent if its contribution justifies that effort. Combine the tasks again if you get the same result with fewer handoffs. Faster individual searches are not enough if assembling the final answer takes longer.

In Tale, project tasks keep assignments, reports, and deliverables together. Agent-to-agent delegation requires an explicit tool grant; assigning work alone does not start it. The [task delegation guide](https://docs.tale.dev/platform/projects/task-automation) explains the setup.
