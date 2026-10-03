---
title: "Turn AI research into a useful campaign brief"
description: "Give AI research a specific campaign decision to answer. Build a brief that connects the audience problem, product evidence, message, and next test."
slug: ai-agents-marketing-campaign-workflow
topicId: T10
reviewed: '2026-10-03'
draft: false
coverAlt: "Research materials and message options converge on a campaign brief."
---

A useful campaign brief tells the next person who the campaign is for, what to say, and why that message is credible. AI research should help you make those choices. If the output is a long market summary followed by generic headlines, the task probably left the decision unstated.

Start with a question your team is trying to resolve: “Should this launch lead with clearer ownership or better handoffs?” Give the agent the material it can use to answer, then ask for a recommendation that points back to the evidence. You should be able to inspect the reasoning without reading the entire research history.

## Give the research a choice to make

Imagine a service-software company launching a shared request queue. These are fictional teaching materials: a product specification and three interview summaries, not Tale features or customer research.

The specification says each request can show an owner and a next step. Notes are free text. Two managers described problems caused by unclear ownership; a third said ownership was clear but handoffs lacked background. The marketing team can test one launch message first.

A useful assignment would be:

> Recommend whether our launch should lead with ownership visibility or handoff quality for managers of service teams. Use the attached launch specification and interview notes. Show which source supports each proposed claim, include evidence against your recommendation, and identify what we still need to learn. Return a brief a writer can use. Do not invent customer quotations, claim time savings, contact customers, or publish anything.

This gives the agent a job that can end. “Research our market” does not tell it which facts will change the team's choice or when it has enough information.

## Separate what the product does from why people care

A feature description and a customer observation support different parts of a message. Keep those parts visible as you move from sources to a recommendation.

| Source in the example | What it supports | What it leaves open |
| --- | --- | --- |
| P1: launch specification | Requests can display an owner and a next step | Whether this reduces response time |
| I1: manager interview | Ownership became unclear during an absence | How common that problem is |
| I2: manager interview | Unclear responsibility led to duplicated work | Whether fixing it would motivate a purchase |
| I3: manager interview | Missing background made handoffs difficult despite clear ownership | Whether owner and next-step fields would help |

The ownership direction has product support and two relevant examples. The handoff direction has a real problem behind it, but the feature does not yet establish the promise “standardize handoffs without losing context.” That is a reason to narrow the promise or investigate a product gap.

Ask the agent to retain source passages, not only its summaries. In real research, you need to see whether an interviewee described a frequent problem, an unusual incident, or something the interviewer suggested. Two supportive conversations do not establish that most customers share the problem.

## Turn the recommendation into a brief someone can use

The decision is to test ownership visibility first. A writer now needs the approved message and its limits, not another list of possible benefits.

| Brief field | Filled example |
| --- | --- |
| Audience | Managers of service teams working from a shared request queue |
| Situation to address | During absences or shift changes, people cannot tell who is handling a request |
| Working message | Keep the owner and next step visible for every request |
| Product evidence | P1 confirms the two fields; verify this against the launch version |
| Audience evidence | I1 and I2 describe unclear responsibility and its consequences |
| Evidence against the direction | I3 describes missing context even when ownership is clear |
| Claim to leave out | “Cut response times in half”; no measurement supports it |
| Next learning step | Check whether target managers understand the message and consider the problem worth solving |

This is enough to start a draft or a customer conversation. It also makes disagreement useful: the product owner can challenge the feature claim, a researcher can challenge the interpretation, and the marketing lead can question whether this problem deserves the campaign.

The recommendation should change if further conversations show that ownership is already well handled and missing context is what drives purchases. Asking the agent for more ownership headlines would not answer that objection.

![A campaign question guides research and message options. Marketing review selects a direction or requests changes, then the accepted brief carries the evidence into a separate publishing step.](/blog/diagrams/en/T10-diagram.svg)

## Review the message before producing every variation

Check the central promise against the product and audience evidence before requesting emails, ads, and landing pages. Otherwise, the same unsupported claim can spread through a whole asset set.

Give a reviewer a concrete question: “What in this brief would a product owner or customer dispute?” Ask them to identify the source and explain the gap. “Make this more persuasive” tends to push in the opposite direction when the evidence is already thin.

For a small source packet, one agent and a human review may be enough. Split the work when there are separate questions worth investigating, such as product capability and interview analysis. The person or agent writing the brief then needs links to those actual findings. More workers do not remove the need for a coherent decision.

## Hand over the decision, sources, and open question

Send the writer or designer the selected direction, the brief, source references, and claims that were rejected. Name the copy and asset versions that have been accepted. If a later draft adds a new promise, have it checked before publication.

In Tale, a [project task](https://docs.tale.dev/platform/projects/tasks) keeps the brief, attachments, owner, and discussion together. Add the source material and completion criteria there; use the [task review process](https://docs.tale.dev/platform/projects/task-automation) to request corrections to the delivered brief.

The [campaign research pack](/blog/worksheets/en/T10-campaign-brief.md) includes the filled example and blank fields for your campaign. Its later sections help plan a test once you have a message worth testing. For now, the brief should let a colleague answer four questions without guessing: **who is this for, what can we credibly promise, why might they care, and what do we still need to find out?**
