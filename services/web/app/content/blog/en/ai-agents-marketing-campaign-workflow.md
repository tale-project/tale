---
title: 'AI agents for marketing: from research to review'
description: Follow a practical AI marketing workflow from campaign research to a reviewed brief, with clear tasks, source evidence, handoffs, and human decisions.
slug: ai-agents-marketing-campaign-workflow
topicId: T10
reviewed: '2026-10-03'
draft: false
coverAlt: "Research materials and message options converge on a campaign brief."
---

A marketing agent is useful when it helps a team choose what to say, why a customer might care, and what evidence would change that choice. Generating more copy is easy to count. Turning incomplete research into a defensible campaign decision is the harder and more valuable task.

Start with a brief that connects evidence to a testable message. Ask agents to prepare the source analysis, challenge interpretations, and develop distinct options. Keep responsibility for claims, positioning, and publication explicit. The result should help the next person act without guessing which statements are facts and which remain hypotheses.

The worked example here concerns a fictional service-software company launching a shared request queue. Its sources, customer observations, and campaign figures are all invented teaching material. They are not Tale product claims, customer interviews, or measured outcomes. The [campaign research pack](/blog/worksheets/en/T10-campaign-brief.md) includes a filled decision record and a reusable blank version.

## Give research a decision to resolve

The fictional team has two plausible launch directions: make request ownership visible, or standardize handoffs. It can afford one initial campaign. Its target is managers of service teams with several people working from a shared queue.

The research question is therefore: **which direction has enough support to test first, and what would make us reject it?** That is more useful than asking an agent to “research the market” or create twenty headlines. It defines the output and leaves room for an honest answer that more evidence is needed.

Specify the product version, audience, geography, source period, and available customer material. Name the decision owner and the person who can verify product claims. In this example, the marketing lead selects the positioning and the product owner checks capability statements. This is a deliberate allocation of responsibility for this campaign, not a claim about how every agent task must be reviewed.

## Make the strength of evidence visible

Assume the team supplies the following small packet. The entries are fabricated summaries, not quotations.

| Synthetic source | Observation available to the team | What it cannot establish |
| --- | --- | --- |
| P1: launch specification | Every request can show an owner and a next-step field; notes are free text | Faster response times or a standardized handoff process |
| I1: manager interview | During an absence, staff could not tell who owned several requests | How often this happens across the target market |
| I2: manager interview | Staff duplicated work because responsibility was unclear | Whether that concern drives software purchases |
| I3: manager interview | Ownership was clear; missing background made handoffs difficult | That an owner field solves missing context |
| C1: competitor page | A competing product promotes collaboration | Which product performs better |

P1 establishes a capability. I1 and I2 suggest a problem the capability could address. I3 is a meaningful challenge: the same broad audience can experience a different failure that this launch may not solve. Counting two supportive interviews and one contrary interview does not produce a market percentage. The sample was not designed for that purpose.

An agent can organize these distinctions and recover relevant passages from the supplied materials. The reviewer should still be able to return to the original context. Repeated summaries of I1 do not become independent corroboration, and a competitor's omission of a feature is not evidence that it lacks the feature.

## Build two options, then make a bounded choice

Before drafting channel copy, ask for a decision table. Each option needs a promise, supporting evidence, objection, and next learning step. This stops minor wording variations from masquerading as strategic alternatives.

| Filled synthetic decision | Ownership direction | Handoff direction |
| --- | --- | --- |
| Working message | Keep the owner and next step visible for every request | Standardize handoffs without losing context |
| Product support | P1 supports the stated fields | P1 has notes, but no defined handoff structure |
| Audience support | I1 and I2 describe unclear responsibility | I3 describes missing background |
| Main objection | Visible ownership may not be a buying priority | Current promise exceeds demonstrated capability |
| Decision | Advance to a small message test | Hold; investigate a narrower promise or product gap |

The first option wins a place in the test because its promise can be substantiated today and its problem appears in the supplied evidence. It has not won the market. The second option may be more commercially important, but the present product evidence does not support the wording.

The resulting brief contains a concrete decision: **“Test ownership visibility with service-team managers. Use the owner-and-next-step capability claim. Exclude response-time savings. Keep handoff context as an unresolved research question.”** The task is complete when the evidence and limits are clear enough for the team to make that choice, not when an agent sounds certain.

This recommendation reverses if further target-customer research shows ownership is already well handled while missing context drives buying decisions. In that case, revise the product promise or investigate the product gap. Producing more confident ownership headlines would avoid the real issue.

## Use agents where the questions are independent

One task can inspect product evidence and another can analyze the supplied interviews. A synthesis task then receives their actual artifacts. Specify the question, allowed sources, output, stopping point, and recipient for each assignment. Give the source workers the campaign question without instructing them to prove the preferred option.

For the small packet above, one worker followed by review may be sufficient. Additional workers earn their cost when they investigate separate material or provide a check the team will use. Anthropic's research-system report describes duplication from poorly bounded delegation and the overhead of coordinating more workers. It supports deliberate division of research, not automatic use of a large team. [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

![Start with a brief, research evidence, and message options. Marketing review chooses a direction or asks for revision. The accepted brief records evidence and decisions; publication remains a separate step.](/blog/diagrams/en/T10-diagram.svg)

*The accepted brief records what the team chose and why. Publishing it remains a separate operation.*

Ask a reviewing worker to challenge the evidence-to-message link, not merely rewrite the preferred message. “Which source would make us change this recommendation?” is more useful than “make this stronger.” Where evidence is thin, an agent can prepare interview questions or a test brief, but simulated customer personas are not new customer observations.

## Distinguish creative variety from useful experimentation

An agent may generate many different sentences around the same assumption. For this launch, varying tone is less informative than varying the problem addressed: ownership, missing context, or time spent chasing status. Keep a small set of meaningfully different directions before producing variants within one direction.

Creativity research supplies a caution, not a marketing forecast. Doshi and Hauser's short-story experiment found improved individual evaluations alongside greater similarity across writers. A later study examined how diverse AI inputs could reduce homogenization in related ideation tasks. Neither tests conversion for your product. [Doshi and Hauser](https://discovery.ucl.ac.uk/id/eprint/10195027/), [Wan and Kalman](https://arxiv.org/abs/2504.13868)

There is also a case for using AI primarily in production after humans have chosen the message. Kapoor and Kumar's randomized WhatsApp experiment compared personalized generated videos with personalized images and generic videos. The associated MIT research brief reports click-through gains, while noting single exposure and possible novelty effects. Crucially, marketers controlled message content; AI produced the video variations. This does not demonstrate autonomous campaign strategy or sales lift. [Research paper](https://pubsonline.informs.org/doi/10.1287/mksc.2023.0494), [MIT methods and limitations](https://ide.mit.edu/wp-content/uploads/2025/07/RB-DRAFT__7-8-25.pdf)

If your bottleneck is producing approved variations for a well-understood audience, that production role may be more valuable than delegating positioning. If you lack a credible message, cheaper variations multiply the uncertainty. Decide which problem the agent is solving.

## Write the measurement decision into the brief

Choose the outcome before seeing campaign results. For the fictional launch, the business wants qualified enquiries from service-team managers, so clicks are a diagnostic measure rather than the final objective. Define a qualified enquiry in advance, along with an observation window and a consistent way to count people or accounts.

Here is an intentionally synthetic result-reading exercise. Assume two randomized groups of 1,000 eligible recipients each, complete observation over the same window, one click and one qualified-enquiry indicator per recipient, and consistent qualification. For this exercise, assume every qualified enquirer also clicked their assigned message. In real data, the per-clicker numerator must count recipients who both clicked and made a qualified enquiry, rather than all enquirers in the group. These assumptions make the arithmetic comparable; the counts are not observations.

| Synthetic measure | Message A | Message B |
| --- | --- | --- |
| Eligible recipients assigned | 1,000 | 1,000 |
| Recipients who click | 60 | 40 |
| Recipients with a qualified enquiry | 3 | 4 |
| Click rate | 6% | 4% |
| Qualified-enquiry rate per assigned recipient | 0.3% | 0.4% |
| Qualified enquiries per clicker | 5% | 10% |

A wins on clicks. B has one more qualified enquiry. With only seven qualified enquiries in total, the table gives weak grounds for declaring a stable winner; the test needs an appropriate uncertainty analysis and enough information for the decision. The per-clicker ratio is diagnostic, not a clean causal comparison: clicking is itself affected by the message and selects different people into each denominator.

Preserve the assigned-audience denominator for the primary comparison. If delivery fails or people do not click, do not quietly remove them to improve the rate. Record those events separately. Agree the minimum useful difference, allocation, duration, and analysis with the person responsible for experimentation before launch. A fixed sample can be planned; an adaptive test needs an appropriate analysis. Repeatedly stopping at a favorable fluctuation is not the same procedure.

Equal spending alone does not randomize audiences. Advertising delivery systems can show variants to different people. Gordon and colleagues compared observational estimates with randomized advertising experiments and found that rich observed data often failed to recover the experimental effects. That older advertising-measurement result supports checking allocation; it is not a finding about AI copy. [Study and methods](https://www.kellogg.northwestern.edu/faculty/gordon_b/files/fb_comparison.pdf)

If the audience is too small for a useful outcome comparison, use customer conversations or comprehension checks to learn whether the message is understood. Report what those methods establish. Do not relabel a few favorable reactions as conversion evidence.

## Preserve claim decisions through the publishing handoff

For the worked brief, remove “cut response times in half” because no source supports it. Retain the owner-and-next-step capability statement subject to product confirmation. Keep the rejected wording and reason in the claim record so later email or landing-page drafts do not reintroduce it.

The publishing owner receives the selected direction, approved claim language, source references, excluded claims, proposed measurement, copy and asset versions, and unresolved questions. A layout task should not have to infer which feature promise is approved. If a substantive claim changes, route it back to the appropriate reviewer.

For search content, apply that review to titles, descriptions, image text, and structured data too. Google's guidance emphasizes accuracy and useful added value; generating more pages does not establish either. [Google's AI-content guidance](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)

## Keep campaign evidence attached to the work in Tale

A Tale [project](https://docs.tale.dev/platform/projects/overview) can organize the materials and [tasks](https://docs.tale.dev/platform/projects/tasks). Configure suitable [project agents](https://docs.tale.dev/platform/projects/project-agents), provide each worker with its bounded question, and pass named source and decision artifacts into synthesis. Separate workspaces do not imply shared memory. Keep revision requests and acceptance decisions with the work, using the documented [task review process](https://docs.tale.dev/platform/projects/task-automation).

The publishing path needs its own permissions and confirmation. Tale's agent connector broker supplies read-only connector actions; configured workflow nodes and separately granted tools have different boundaries. Verify the route you intend to use. [Runtime and tool access](https://docs.tale.dev/platform/agents/harnesses)

Measure the research process by accepted briefs, review effort, unresolved claims, and time to decision. Measure the campaign by the audience outcome selected in its test plan. Bring the filled research pack and one real launch decision to a [Tale demo](/request-demo) to examine how the evidence can travel with the work.
