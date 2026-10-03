---
title: "What access should you give an AI agent?"
description: "Work out what an AI agent needs to read and change, which credentials to grant, and where a separate approval belongs, using a research task."
slug: ai-agent-security-permissions-approvals
topicId: T07
reviewed: '2026-10-03'
draft: false
coverAlt: "Nested frames give a task different openings and a visible paper trail."
---

Give an AI agent access for the task it is doing now. A worker preparing a launch announcement may need to read project notes and create a draft. It does not need permission to send email, publish the announcement or change who can access the project.

Start by separating **reading information, creating work and committing an action**. Those are often bundled into one broad account, even though the task needs only part of that account’s authority. A good initial setup lets the agent finish useful work while leaving unnecessary actions unavailable.

## Turn the task into a short access list

Consider a research worker that checks product information and drafts a launch announcement using an internal brief and supplier pages. A person will review the draft before anything is sent. Here is the access that task calls for:

| Need | Grant | Leave unavailable |
| --- | --- | --- |
| Understand the launch | Read the selected project brief and references | Other projects, staff records and unrelated customer files |
| Check supplier facts | Retrieve the required public sources | Unnecessary signed-in browser sessions and form submissions |
| Prepare the announcement | Create the report and draft in the project’s output area | Edit the source brief or publish to the live site |
| Hand over the result | Return files and source references for review | Mailbox, social publishing and broad administration credentials |

This is a proposed setup for the example; you still need to verify that your tools can enforce it. If a service offers only a broad account, the word “read” in the prompt does not make that account read-only. Use a narrower integration, provide an approved export, or keep that part of the work with a person.

The same reasoning applies to data access. Access to one project does not automatically justify access to every document the human operator can open. Give the worker the sources it needs, and add others when an actual task requires them.

![An agent’s authority depends on its identity, accessible data, tools and credentials, approval points, and the evidence kept after an action.](/blog/diagrams/en/T07-diagram.svg)

## Make the restriction hold outside the prompt

An instruction such as “never send the internal brief” tells the agent what you want. Removing its sending credential changes what it can do. Keep both: clear instructions help it perform the task, while tool permissions limit the consequences of a mistake or a misleading source.

For example, a supplier page might tell the agent to email the internal brief to “verify compatibility.” That page has no authority to change the task. The research worker should ignore the request; its equipment should also prevent that send if it follows the request anyway. OWASP’s [excessive-agency guidance](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) recommends limiting available functionality, permissions and autonomous actions.

Check every route that can reach the same service. A read-only connector is little protection if the worker also has a mailbox token in its shell. Allowing an email service’s hostname is also broader than permitting a specific recipient or attachment.

In Tale, agent connector-broker actions are read-only, while platform write tools, direct GitHub tooling and explicitly granted secrets have separate access rules. Review the agent’s actual equipment using the [project-agent guide](https://docs.tale.dev/platform/projects/project-agents). Do not infer its total authority from one connector’s restrictions.

## Add sending as a separate decision

If the task later includes sending the announcement, add that step deliberately. Keep the research worker’s access unchanged and use a separate, limited sending path. The reviewer should see the exact recipient, subject, message and attachments before deciding.

In Tale, connector writes in live automations can require operation approval under the organization’s policy. That does not put every shell command behind an approval card. Check the applicable [approval rules](https://docs.tale.dev/platform/approvals/configure).

A Tale approval card lets a reviewer approve or reject the proposed input, not edit it. Anyone who can open the task can decide a card shown there; the card does not select a named approver group. Verify that this audience fits your needs. [Operation approval details](https://docs.tale.dev/platform/approvals/concepts)

Accepting a draft and allowing it to be sent are different decisions. A perfectly good announcement might still have the wrong recipient. For help choosing the checkpoint and what to show the reviewer, see [where to put human approval in an AI workflow](/blog/human-in-the-loop-ai-agent-workflows).

## Test what the agent must be unable to do

Run a harmless task with the same role, tools and credential types the team will actually use. An administrator’s successful test does not establish what another user can do.

Alongside the normal task, try reading an unrelated test document and sending to a controlled test inbox without authorization. Check the access refusal, the sending service’s action records and the test inbox; no sending operation should have been accepted. Use fake content and accounts you control. You are testing the boundary, so the result you want is a useful draft with the excluded actions still unavailable.

If you add an approval step, exercise it in a controlled live run. Tale’s mock test does not make external writes or show live operation approval cards. Reject one proposed operation and confirm it did not happen; use a separate corrected run to test approval. The [operation approval guide](https://docs.tale.dev/platform/approvals/concepts) describes that distinction.

Keep the resulting access list with the agent’s configuration. The [action-authority worksheet](/blog/worksheets/en/T07-action-authority.md) gives you a place to record tools, credential references and refusal checks. Revisit it when the task gains a new destination or action, especially when a drafting worker starts publishing or sending.
