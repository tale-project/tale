---
title: Delegate a task to an agent
description: Start an agent on a project task, review its result, request changes, and recover or cancel a run.
---

A project agent works on a task and returns a result for a person to review. Choose its assignment, start the work, and keep feedback on the task so the agent and reviewer have the same context. You need project edit access; the organization also needs a working provider, compatible harness, and available sandbox capacity.

<Frame caption="Agent work uses the same board as human work: start at In progress and review the result at In review.">

![The project task board shows work distributed across Backlog, To do, In progress, In review, Done, and Cancelled.](/images/platform/projects-task-board.webp)

</Frame>

## Prepare and start the task

1. Create a [task](/platform/projects/tasks) with the desired result, completion criteria, and input files.
2. Choose a [project agent](/platform/projects/project-agents) under **Assignee**.
3. Set **Reviewer** to the person who should check the result. Without a named reviewer, the request falls back to the task creator or project creator.
4. Click **Start agent**, or move the task to **In progress**.

Assignment alone does not start execution. A task may remain assigned in **Backlog** while the team decides whether to proceed. When started, the agent uses the task description, comments, and input files in its sandbox. Its run card shows whether it is queued or working.

## Read and accept the result

The agent posts its report as a task comment and adds produced files as deliverables. It then moves the task to **In review**. The reviewer receives a notification and, when email delivery is configured, an email.

Read the report, open the deliverables, and compare them with the completion criteria. Move the task to **Done** only when you accept the work. Tale records the human decision; the agent cannot mark its own task Done.

**Reviewer** routes the notification and review queue. It does not exclude other project editors from accepting the result, and changing the reviewer does not reassign the work away from the agent.

## Ask for changes

Add a task comment that names what needs to change and **@mention the assigned agent**. The mention is an instruction: an active agent can receive it during its run, and an idle agent starts a rework run that continues the previous conversation. The result returns to **In review**.

A plain comment keeps a note without starting that agent action. The mention picker indicates when an agent cannot respond, for example because task automation is disabled or paused.

For an automation-owned task, mention the owning automation to request another run. Mentioning a different automation does not transfer ownership or start it. See [Automations](/platform/automations/concepts) for workflows that coordinate several steps.

A task can have only one queued, running, or waiting run at a time, whichever automation started it. Repeating a start request while one is active returns the existing run, even when it names another automation. Once it finishes, another start can create a new run and repeat the work. Check the current run and its effects before requesting another attempt.

## Handle waiting and failed runs

| State or symptom | What to do |
| --- | --- |
| Waiting for a sandbox slot | Available capacity may be exhausted for the organization or shared infrastructure. Wait for a slot, or ask an admin to inspect [Sandboxes](/platform/admin/sandboxes). |
| Automatic retry is shown | Tale is retrying a recoverable failure. Read the attempt count and avoid starting another run. |
| The run remains failed | Read the error and resolve its cause, then use **Retry** to continue the conversation. Deleted agents and time-limit failures need intervention. |
| Reassignment is refused | Cancel the live run before choosing another assignee. |
| Two automations keep mentioning each other on one task | There is no per-task rate cap: the one-engine rule is what stops a loop. Cancel the live run, then read the timeline before letting either start again. |
| The task cannot close | Finish its open subtasks first. |

Recoverable failures get up to three immediate automatic retries. A run that makes sustained progress for at least fifteen minutes receives a fresh retry allowance. This helps long work recover from interruptions; it does not prove the resulting work is correct.

## Cancel or pause work

Use **Cancel run** to stop the active agent. Moving a running agent-owned task out of **In progress** can also cancel the run; read the confirmation before proceeding. A task cannot have two active agent runs at once.

An admin can disable task automation for the organization. That blocks new starts while existing work finishes. Organization limits and budget policies still apply to each run; see [Policies and limits](/platform/admin/governance/policies-and-limits).

## Choose the right assignee

Assign a person when the task needs human judgment or work outside an agent’s permitted access. Assign a project agent for a bounded job using its configured files and tools. Use an automation when the work follows a defined process with stages, triggers, or connector approvals.

For a first run, follow [Build your first agent](/tutorials/editor/first-agent-end-to-end). Keep the task small enough that you can inspect its result yourself.
