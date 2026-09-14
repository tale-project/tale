---
title: Create and test a project agent
description: Give a project agent a focused job, start it on a task, and review the result.
---

A project agent is a reusable brief for work on project tasks. You choose its instructions, runtime, model, and tools, then start it on a task and review what it produces.

## Before you begin

You need edit access to a project, a suitable model provider, and an available agent runtime with its required infrastructure. A successful ordinary chat verifies the provider’s chat path; it does not prove that an agent runtime or sandbox is ready. Ask an administrator to check [agent runtimes](/platform/agents/harnesses) if none is available.

Create or open a project first. For the project’s sharing and knowledge setup, follow [use projects](/tutorials/member/use-projects).

## Give the agent a focused job

<Steps>

<Step title="Create an agent in the project">

Open the project’s **Agents** tab and select **New agent**. Name it for the job, such as “Launch reviewer”. Choose an **Agent type** and **Model** supported by your workspace. When a model has multiple provider entries, choose the intended provider too.

<Frame caption="Project agents combine a named job with a runtime and model.">

![The project Agents tab lists agents with their configured runtime and model.](/images/platform/project-agents-models.webp)

</Frame>

</Step>

<Step title="Write instructions that you can evaluate">

In **Instructions**, describe the job, the source material, the expected output, and the limits. For example:

> Review the launch brief attached to the task. List missing decisions, unclear owners, and contradictions. Quote the relevant passage for each finding. Do not change files or contact external services. If the brief is missing, ask for it.

Grant only the **Skills, connectors & tools** and **Secrets** needed for that task. Select **Create agent** to save. You can edit the brief after reviewing a result.

</Step>

<Step title="Assign a concrete task and start it">

Create a task with a clear description and the required input files. Assign the agent, then select **Start agent**. Assignment and starting are separate actions. Watch the task’s status and activity while it runs.

If it cannot start, inspect the displayed reason before retrying. A missing provider, unavailable runtime, policy restriction, or absent input needs a different correction.

</Step>

</Steps>

## Review the work

Read the agent’s task comment and any output files. Compare the result with the brief: did it inspect the right source, support each finding, and stay within scope? A completed run means execution finished, not that the result is correct.

Keep review and completion explicit. Use the project’s task controls to record feedback, request another pass when needed, and mark accepted work as done. [Project tasks](/platform/projects/tasks) explains the statuses and reviewer field.

<Tip>

Test a missing-input case as well as a normal task. An agent that asks for a missing brief is more useful than one that invents what the brief might say.

</Tip>

## Refine one thing at a time

Improve the instruction that caused a poor result, then try a comparable task. Add tools only when the job needs them, and review the [approval behavior](/platform/approvals/concepts) before enabling external writes. For a longer worked example, follow [your first agent end to end](/tutorials/editor/first-agent-end-to-end).
