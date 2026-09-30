---
title: Delegate a task to an agent
description: Start an agent on a project task, review its result, request changes, and recover or cancel a run.
---

A project agent works on a task and returns a result for a person to review. Choose its assignment, start the work, and keep feedback on the task so the agent and reviewer have the same context. You need to be able to change the task: an Editor or higher can on every task in the project, and a Member on the tasks they created or that are assigned to them. The organization also needs a working provider, compatible harness, and available sandbox capacity.

<Frame caption="Agent work uses the same board as human work: start at In progress and review the result at In review.">

![The project task board shows work distributed across Backlog, To do, In progress, In review, Done, and Cancelled.](/images/platform/projects-task-board.webp)

</Frame>

## Prepare and start the task

1. Create a [task](/platform/projects/tasks) with the desired result, completion criteria, and input files.
2. Choose a [project agent](/platform/projects/project-agents) under **Assignee**.
3. Set **Reviewer** to the person who should check the result. Without a named reviewer, the request falls back to the task creator or project creator. Reviewers need project edit access, so a Member who created the task is not sent the review request; they follow the task and hear when it reaches **In review**, and they can accept the result themselves unless your organization requires an independent reviewer and they started the run.
4. Click **Start agent**, or move the task to **In progress**.

Assignment alone does not start execution. A task may remain assigned in **Backlog** while the team decides whether to proceed. When started, the agent uses the task description, comments, and input files in its sandbox. Its run card shows whether it is queued or working. A run a Member starts keeps to its task and goes without the agent's secrets; [Agent runs a Member starts](/platform/projects/tasks#agent-runs-a-member-starts) lists what changes.

Agents are instructed to keep task updates, reports, related tasks and questions in the language of the task's title and description. If those do not establish a language, they use the organization's default agent language. An identifier, quarter or generated title template does not choose a language. Changing your interface language does not change the task's language; an explicit request to the agent can.

Workflow progress comments can carry translations for each supported interface language. The same saved comment then follows the reader's language selection. Comments without translations retain their original text.

## Read and accept the result

The agent posts its report as a task comment and adds produced files as deliverables. It then moves the task to **In review**. The reviewer receives a notification and, when email delivery is configured, an email.

Tale lists delivered or skipped files in a separate system comment that follows your interface language. A missing or shortened report is noted there too, so the report keeps the task's language.

Read the report, open the deliverables, and compare them with the completion criteria. Move the task to **Done** only when you accept the work. Tale records the human decision; the agent cannot mark its own task Done.

**Reviewer** routes the notification and review queue. It does not exclude anyone else who can change the task, an Editor or higher or the Member the task belongs to, from accepting the result, and changing the reviewer does not reassign the work away from the agent. When your organization requires an independent reviewer, whoever started the run can't accept its result, so a run a Member started on their own task waits for an Editor or higher; [Choose an owner and a reviewer](/platform/projects/tasks#choose-an-owner-and-a-reviewer) has the details.

Changing **Reviewer** while the task waits in **In review** hands the pending request to the new reviewer: it leaves the previous reviewer's queue, and the new reviewer receives the notification and, when email delivery is configured, an email. **Clear reviewer** returns the request to the task creator or project creator.

## Ask for changes

Add a task comment that names what needs to change and **@mention the assigned agent**. The mention is an instruction: an active agent can receive it during its run, and an idle agent starts a rework run that continues the previous conversation. The result returns to **In review**.

If you started a run, your mentions keep guiding it even after the task has passed to the agent, for example because your mention handed it a task that was assigned to you. When the agent's runtime restarts to take in a comment, which every runtime except Claude Code does, the rest of the run belongs to the comment's author: it counts against their limits, and its connector calls act for them.

A plain comment keeps a note without starting that agent action. The mention picker indicates when an agent cannot respond, for example because task automation is disabled or paused, or because you can comment on the task but not change it.

For an automation-owned task, mention the owning automation to request another run. Mentioning a different automation does not transfer ownership or start it. See [Automations](/platform/automations/concepts) for workflows that coordinate several steps.

A task can have only one queued, running, or waiting run at a time, whichever automation started it. Repeating a start request while one is active returns the existing run, even when it names another automation. Once it finishes, another start can create a new run and repeat the work. Check the current run and its effects before requesting another attempt.

## Let a manager agent keep the queue moving

A manager agent is a project agent whose instructions are to read the whole board, hand out ready work and answer the routine questions other agents leave, so that people see only what needs them. It reads with **Find tasks** and **Read a task**; neither tool changes anything.

### Read the whole queue in passes

**Find tasks** answers at most 50 tasks at a time. While a page says `isDone: false`, its `continueCursor`, passed back as `cursor` with the same arguments, returns the next page; the last page says `isDone: true`. A cursor that comes back with other filters, another order or from another project's run is refused, and so is a damaged one: it is never read as the first page. A total appears only when one page holds every matching task.

To walk a whole queue, use `order: "created"`. Tasks come oldest first and keep their place, so a pass lists each task at most once, as it stands when its page is read. The default order groups tasks by status and keeps each column's order within it, so a task that moves while the manager pages can be missed or listed twice.

A pass can outlast one run. Before its run ends, the manager saves a checkpoint comment on its own task: the pass, its order and filters, the next `continueCursor` and the last task it examined. Its next run finds that checkpoint with **Read a task** and continues from it. When a pass ends, or its cursor is refused, the next pass starts at the first page. A read that fails is not an empty queue: the manager reports it and stops.

### Tell running, finished and waiting work apart

**Read a task** names subtasks, blockers and comments by their IDs and pages back through older comments with `commentCursor`. It also lists the task's project-agent runs, newest first, each with the first 500 characters of the message its start carried, along with the task's automation run and any pending review:

- A run with `live: true` is queued or running, and nothing else starts on the task until it ends.
- A run that has settled, failed or been cancelled is finished; `settledAt` says when.
- A `workflowRun` waiting for an `ask` or an `approval`, and a `pendingReview`, wait on a person.

The answer leaves out transcripts, error texts and results, and anything from another project.

### Answer a routine question

A routine question is one the manager can answer from what the project already records. Write the same protocol into the instructions of the working agents and of the manager:

1. The working agent posts the question as a task comment with a stable question key, its evidence and the question. It names the comment's ID and its own run ID in its result (**Read a task** on its task shows that run as the live one) and finishes the run instead of waiting inside it. Mentioning the manager in that comment starts nothing: a comment by an agent never starts an agent.
2. On its next pass, the manager answers only while the task still waits on that question: the run that asked is the task's newest run and has finished, nothing is live on the task, and the task waits in review of that run (`pendingReview.runId`). It keeps that run's ID and `pendingReview.approvalId` from this read. If a person has since moved the task on, by accepting or cancelling it or asking for changes, the question is no longer the manager's to answer, and it reports the question instead.
3. It posts its answer as a comment that names the question's comment ID; the answer stays on the task whatever happens next. It then resumes the agent with **Start other agents on tasks**, passing `resumeFrom: {runId, approvalId}` with the two IDs it kept, and a message that opens with the question's key, the run's ID and the answer's comment ID: a later **Read a task** shows only the first 500 characters of a start's message. The start checks, as it happens, that this is still the task's open question. Only then does it withdraw the pending review, without approving it, and resume the agent.
4. If the start answers `stale_question`, the question was overtaken between the manager's read and the start: a person decided, a newer run or review exists, or the assignee changed. Nothing was changed. The manager reads the task again and drops the outdated question. It does not start again, and never without `resumeFrom`.
5. If the start's response is lost, the manager reads the task again before trying anything else: a newer run whose message opens with that question's key, run ID and answer comment ID means the start went through. If the same start is sent again, it answers `stale_question` and changes nothing.

A question from a standing task, one a schedule starts with `moveToInProgress: false`, waits for no review. The manager only posts its answer there, and the run at the schedule's next occurrence reads it. Neither the manager nor anyone else starts the task early to deliver the answer.

Accepting a result, answering an automation's question and deciding an approval stay with people. The manager sees them in **Read a task** so that it can leave them to the person concerned and report them.

## Handle waiting and failed runs

| State or symptom | What to do |
| --- | --- |
| Waiting for a sandbox slot | Available capacity may be exhausted for the organization or shared infrastructure. Wait for a slot, or ask an admin to inspect [Sandboxes](/platform/admin/sandboxes). |
| Automatic retry is shown | Tale is retrying a recoverable failure. Read the attempt count and avoid starting another run. |
| The run remains failed | Read the error and resolve its cause, then use **Retry** to continue the conversation. Deleted agents and time-limit failures need intervention. |
| Reassignment is refused | Cancel the live run before choosing another assignee. |
| Agents or automations keep restarting one task | A task takes at most three starts of its agent by automations and other agents in any hour, their automatic retries included; the next start is refused, a retry past the limit is not started, and the timeline says **Run refused: agent runs are paused on this task**. Starts by people, and their retries, are never counted. Automation runs have no such cap: between two automations that keep mentioning each other, the one-engine rule is what stops a loop. Cancel the live run, then read the timeline before letting either start again. |
| The task cannot close | Finish its open subtasks first. |

Recoverable failures get up to three automatic retries, which start right away except in the case below. A run that makes sustained progress for at least fifteen minutes receives a fresh retry allowance. This helps long work recover from interruptions; it does not prove the resulting work is correct.

An automatic retry continues the work of the person who started the run, so it starts only where that person could start the run now: the project must still be active, and they must still be allowed to change the task. If an admin archives the project, or that person leaves the organization or loses the right to change the task, no further retry starts and the run stays failed. The same applies to a mention that reaches the agent only after its run has ended. Once the project is restored, anyone who can change the task can use **Retry**.

An agent served by a subscription broker can lose its token while it works, when the broker refreshes the account. The retry then continues the conversation on a fresh token, and the attempt count does not advance: the retry shows the same count as the run it replaces, or **Resumed after a token refresh** when that run showed none or had worked for at least fifteen minutes, which earned it a fresh retry allowance. After two such interruptions in a row, a further one counts like any other failure.

A run can also fail to start because every account of its subscription broker is cooling down after a rate limit. Its retry is queued at once but starts only when the first account is available again, at most a minute later. The wait uses no attempt when the refused run was itself retrying a rate-limit failure; otherwise the refused start counts as one.

## Work an automation or another agent starts

A project agent can also be put to work without anyone pressing **Start agent**: by a [scheduled automation](/platform/automations/triggers#start-a-project-agent-on-a-schedule), or by another agent of the project that holds the **Start other agents on tasks** tool, such as a manager agent that hands out ready work and answers questions. The timeline lists such a run as **automation**, with a link to the automation run for Owners, Admins, and Developers, or as **delegated**, started by the agent that asked. The agent is told who started it, and a message that automation or agent passed reads as theirs, never as a person's review: where it contradicts the description or a person's comment, those win.

The run answers to whoever the requesting run answers to: the person who started it, or nobody for a schedule's chain, whose spend counts as automation spend. That person, or the schedule, has to be able to act in the project when the run starts; a lost Editor role, a paused schedule, or an automation removed from the project stops the next start. An agent another agent started cannot start further agents, and a run a Member started cannot start any. Such a start also checks what a person might forget: a task an open task blocks does not start, and an agent already working another task is not started twice.

The review gate stays a person's. A delegated run parks its result at **In review** like any other, and resuming a task that waits there withdraws its pending review without approving it. A start that leaves the card where it is (`moveToInProgress: false`) is refused under a card waiting for review, or a **Done** or **Cancelled** one, so earlier work is never presented for judgment while new work runs under it. A manager that answers an agent's question resumes it naming the run that asked and the review it waits at. The resumption happens only while that is still the task's open question. If a person decided in the meantime (Done, Cancelled or another move), a newer run or review exists, or the assignee changed, the agent answers `stale_question` and nothing is assigned, withdrawn, moved or started. When your organization requires an independent reviewer, the person the run answers to cannot accept its result.

## Cancel or pause work

Use **Cancel run** to stop the active agent. Anyone who can change the task can cancel its run, and so can the person who started the run, even after the task has passed to the agent. Moving a running agent-owned task out of **In progress** can also cancel the run; read the confirmation before proceeding. A task cannot have two active agent runs at once.

For a task an automation owns, the move stops the run and puts the task where you moved it in one step. If that move is refused, for example because you moved a parent task to **Done** while its subtasks are still open, the run keeps working and the task stays in **In progress**. **Cancel run** in the automation's panel on the task moves it to **Cancelled**, so the same open subtasks refuse it; to stop the run and keep the task open, move it to **To do** instead.

An admin can disable task automation for the organization. That blocks new starts while existing work finishes. Organization limits and budget policies still apply to each run; see [Policies and limits](/platform/admin/governance/policies-and-limits).

## Choose the right assignee

Assign a person when the task needs human judgment or work outside an agent’s permitted access. Assign a project agent for a bounded job using its configured files and tools. Use an automation when the work follows a defined process with stages, triggers, or connector approvals. A Member can choose only an automation built for tasks, one of those listed under **Automations** in **Assignee**.

For a first run, follow [Build your first agent](/tutorials/editor/first-agent-end-to-end). Keep the task small enough that you can inspect its result yourself.
