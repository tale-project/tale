---
title: Delegate a task to an agent
description: Start an agent on a project task, review its result, request changes, and recover or cancel a run.
---

A project agent works on a task and returns a result for review. Choose its assignment, start the work, and keep feedback on the task so the agent and reviewer have the same context. You need to be able to change the task: an Editor or higher can on every task in the project, and a Member on the tasks they created or that are assigned to them. The organization also needs a working provider, compatible agent runtime, and available sandbox capacity.

<Frame caption="Agent work uses the same board as human work: start at In progress and review the result at In review.">

![The project task board shows work distributed across Backlog, To do, In progress, In review, Done, and Cancelled.](/images/platform/projects-task-board.webp)

</Frame>

## Prepare and start the task

1. Create a [task](/platform/projects/tasks) with the desired result, completion criteria, and input files.
2. Choose a [project agent](/platform/projects/project-agents) under **Assignee**.
3. If you can edit the project, choose a person or independent agent under **Reviewer**, or keep **Project default**. The initial project default routes reviews to an eligible task creator or project creator. [Choose an owner and a reviewer](/platform/projects/tasks#choose-an-owner-and-a-reviewer) explains the default, permissions, and pending handoffs.
4. Click **Start agent**, or move the task to **In progress**. When you assign the agent while creating the task, **Create and start agent** in **Create task** does this in the same step.

Assignment alone does not start execution. A task may remain assigned in **Backlog** while the team decides whether to proceed; until someone starts it, whoever can start the agent sees **Start agent** on the task with the note **The agent waits until you start it.** When started, the agent uses the task description, comments, and input files in its sandbox. Its run card shows whether it is queued or working. A run a Member starts keeps to its task and goes without the agent's secrets; [Agent runs a Member starts](/platform/projects/tasks#agent-runs-a-member-starts) lists what changes.

Agents are instructed to keep task updates, reports, related tasks and questions in the language of the task's title and description. If those do not establish a language, they use the organization's default agent language. An identifier, quarter or generated title template does not choose a language. Changing your interface language does not change the task's language; an explicit request to the agent can.

Workflow progress comments can carry translations for each supported interface language. The same saved comment then follows the reader's language selection. Comments without translations retain their original text.

## Read and accept the result

The agent posts its report as a task comment and adds produced files as deliverables. It then moves the task to **In review**. A human reviewer receives a notification and, when email delivery is configured, an email. An agent reviewer reads the pending review from its own task; routing a review to it does not start it automatically.

Tale lists delivered or skipped files in a separate system comment that follows your interface language. A missing or shortened report is noted there too, so the report keeps the task's language.

For a human review, read the report, open the deliverables, and compare them with the completion criteria. Move the task to **Done** only when you accept the work. Tale records the decision; the implementation agent cannot approve its own result.

For a review assigned to a person, **Reviewer** routes the notification and review queue without reserving the decision to that person. Other people who can change the task may accept it, subject to the organization's independent-review and competence rules. A pending review assigned to an agent must be explicitly transferred to an eligible person before a human can approve it. Changing the reviewer does not reassign the implementation work; [Choose an owner and a reviewer](/platform/projects/tasks#choose-an-owner-and-a-reviewer) has the details.

Changing **Reviewer** while the task waits in **In review** transfers the recorded request. The previous human reviewer's notification clears; a new human reviewer receives the request, while an agent-owned review waits for that agent. **Project default** uses the current project choice. A concurrent change to the review or result refuses the handoff, so read the refreshed state before trying again.

## Set up an independent reviewer {#agent-review}

1. Create a separate [project agent](/platform/projects/project-agents) for review. Under **Skills, connectors & tools**, grant **Find tasks**, **Read a task**, and **Review other agents’ task results**. The review grant is off initially and is not available to automation agent nodes.
2. Select that agent as the project's [default reviewer](/platform/projects/tasks#review-default), or explicitly under **Reviewer** on a task. For a review already waiting, use the task's reviewer control to transfer it; changing the project default alone does not.
3. Give the reviewer its own task and instructions to inspect only reviews assigned to it. Start that task directly or through an existing [schedule](/platform/automations/triggers#start-a-project-agent-on-a-schedule). Do not start a new implementation run on the task being judged.
4. Require the reviewer to read the current review, examine the actual report and deliverables, and record concrete check results and feedback. It must decide against the same completed run and evidence it read; a changed result requires another read and review.

For a captured agent review, `task_get.reviewFiles` lists attachments and outputs in pages of 50. Continue with `reviewFiles.page.continueCursor` as `reviewFileCursor`. The reviewer can use `task_review` with `operation: "stage_file"`, the current `expected: {approvalId, runId, evidenceRevision}`, and one listed `fileId` to copy an available file of at most 20 MiB into its workspace. It must then open and inspect the returned path: staging alone is not evidence that the contents were reviewed.

An `unavailableReason` explains why a file cannot be staged, including unsupported storage, missing or ambiguous metadata, a larger file, or a protected document binding. Document access rules still apply. A changed source or reviewer requires a fresh read. If authority changes during transfer, the operation refuses success; bytes already authorized for that workspace can remain there, but they do not authorize an outdated verdict.

Approval moves the reviewed task to **Done**. A request for changes records the feedback and moves it to **To do**, preserving its assignment. Neither verdict starts another run. Even an agent mention inside review feedback does not dispatch work: an authorized person, manager, or schedule must start the next attempt separately. The activity identifies the reviewer agent and its decision.

For one recorded request for changes, the manager calls `task_start_agent` with `taskId` and `resumeFrom: {kind: "review_repair", approvalId, runId}`. These IDs name the rejected review and the implementation it judged. The server selects that implementation agent and includes the reviewer’s saved feedback and `feedbackCommentId` in the repair brief. Any additional `feedback` must fit with that text and its identity prefix within the existing limit of 10,000 UTF-16 code units.

The repair starts only while the task is still **To do**, assigned to that same agent, with the same latest completed implementation and no newer review or intervening status, assignment or archive decision. Changing a value and then changing it back still invalidates the old intent. A `stale_repair` answer changes nothing: the manager reads the current task and retires the outdated intent. It never retries without the tagged guard. The repair uses the ordinary lifecycle and submits a new review when it finishes; `moveToInProgress: false` is refused.

If the response is lost, the same manager agent can repeat the guarded call from a currently authorized live run, including a later occurrence. `replayed: true` returns the original `runId` and `repairReceipt`, preserving the first issuing run and creating no further work. It reports a previous admission, not that the run is still active. Current delegation permission and project authority are checked again on every call. The existing single-live-run, busy-agent and three-automated-starts-per-task-per-hour limits still apply to new admissions. Repeated unchanged failures need a separate investigation task rather than an unbounded retry instruction.

To reconcile a lost verdict response across reviewer occurrences, read `task_get.reviewDecision`. It contains the latest validated native decision receipt, or `null` behind a newer pending, human or workflow review or when the receipt is unavailable. Compare its approval and run IDs with the recorded intent, and read the task’s current state separately. A historical receipt does not describe the current column, and `null` does not prove that a verdict failed to commit. An immediate identical `task_review` replay still requires the same live issuer.

The reviewer must be different from the agent that actually produced the result, for either verdict. It needs a live run with project-wide authority and the review grant still enabled; a run started by a Member cannot decide reviews. An independent-human-review policy or required human competence records routes new reviews to the human chain; a captured agent review requires explicit transfer to an eligible person. Workflow approvals and questions addressed to a person keep their own human gates. Read `pendingReview.agentReviewBlockedReason` for a current source, grant, identity or policy problem before attempting a verdict. If GitHub work is involved, the reviewer must check the referenced commit and checks itself: Tale records its evidence but does not independently verify GitHub's current state or merge a pull request as part of the verdict.

### Delegate a captured review {#delegate-review}

A manager with **Delegate pending agent reviews** can transfer one waiting agent review to another eligible agent in the same project. The recipient must already have **Review other agents’ task results**, the access needed to inspect the work, and independence from the implementation agent. The manager cannot route the review to itself or convert a human or workflow review. The implementation agent cannot delegate the review of its own work. This permission is separate from deciding reviews and starts no work.

The manager reads `task_get`, copies the full approval, source-run and captured reviewer IDs and `evidenceRevision`, and calls `task_delegate_review` with that expectation, the recipient’s full `reviewerAgentId`, and a reason. A changed source, evidence, permission or policy refuses the handoff. The implementation assignment, task status and future reviewer settings stay unchanged. If execution is needed, use ordinary admission on the recipient’s own review task, never on the implementation task being judged.

After a lost response, read `task_get.reviewDelegation` and the current `pendingReview`. The receipt records the previous and successor approval IDs, previous and new reviewer, source, evidence, manager, issuing run, reason and time. It is historical; it does not prove that the review is still pending or that a reviewer started. An identical retry requires the same live authorized manager run and the unchanged successor gate and evidence. A later occurrence reconciles the receipt and current state instead of replaying an old intent.

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

Each listed task carries `pendingReview: null` or the captured `approvalId`, source `runId`, and typed `reviewer`. A reviewer finds its own queue with `status: "in_review"` and `reviewerAgentId` set to its agent ID; this matches the recorded review owner, not the implementation assignee or today’s project default. Keep that filter on every cursor request. The manager also scans all `in_review` tasks to find reviews whose agent has been deleted, then uses `task_get.pendingReview.agentReviewBlockedReason` to identify the recovery needed. Agent reviews stay in this task queue; a person’s Home review queue is for human requests.

A pass can outlast one run. Before its run ends, the manager saves a checkpoint comment on its own task: the pass, its order and filters, the next `continueCursor` and the last task it examined. Its next run finds that checkpoint with **Read a task** and continues from it. When a pass ends, or its cursor is refused, the next pass starts at the first page. A read that fails is not an empty queue: the manager reports it and stops.

### Tell running, finished and waiting work apart

**Read a task** names subtasks, blockers and comments by their IDs and pages back through older comments with `commentCursor`. It also lists the task's project-agent runs, newest first, each with the first 500 characters of the message its start carried, along with the task's automation run and any pending review:

- A run with `live: true` is queued or running, and nothing else starts on the task until it ends.
- A run that has settled, failed or been cancelled is finished; `settledAt` says when.
- `retryPending: true` means the newest failed run still has an armed automatic retry with budget remaining. Leave that retry to Tale. `false` means no retry is pending for that run; a missing field on an older platform means unknown. It supplies no provider reset time or permission to restart: first read the current task, assignee, runs and review, then honor any provider wait and admission `retryAfter`.
- A `workflowRun` waiting for an `ask` or an `approval` waits on a person. A `pendingReview` records its human or agent reviewer; a manager leaves the decision to that reviewer unless it is itself the assigned independent reviewer with the review grant.

The answer leaves out transcripts, error texts and results, and anything from another project.

### Answer a routine question

A routine question is one the manager can answer from what the project already records. Write the same protocol into the instructions of the working agents and of the manager:

1. The working agent posts the question as a task comment with a stable question key, its evidence and the question. It names the comment's ID and its own run ID in its result (**Read a task** on its task shows that run as the live one) and finishes the run instead of waiting inside it. Mentioning the manager in that comment starts nothing: a comment by an agent never starts an agent.
2. On its next pass, the manager answers only while the task still waits on that question: the run that asked is the task's newest run and has finished, nothing is live on the task, and the task waits in review of that run (`pendingReview.runId`). It keeps that run's ID and `pendingReview.approvalId` from this read. If someone has since moved the task on, by accepting or cancelling it or asking for changes, the question is no longer the manager's to answer, and it reports the question instead.
3. It posts its answer as a comment that names the question's comment ID; the answer stays on the task whatever happens next. It then resumes the agent with **Start other agents on tasks**, passing `resumeFrom: {runId, approvalId}` with the two IDs it kept, and a message that opens with the question's key, the run's ID and the answer's comment ID: a later **Read a task** shows only the first 500 characters of a start's message. The start checks, as it happens, that this is still the task's open question. Only then does it withdraw the pending review, without approving it, and resume the agent.
4. If the start answers `stale_question`, the question was overtaken between the manager's read and the start: a decision was made, a newer run or review exists, or the assignee changed. Nothing was changed. The manager reads the task again and drops the outdated question. It does not start again, and never without `resumeFrom`.
5. If the start's response is lost, the manager reads the task again before trying anything else: a newer run whose message opens with that question's key, run ID and answer comment ID means the start went through. If the same start is sent again, it answers `stale_question` and changes nothing.

A question from a standing task, one a schedule starts with `moveToInProgress: false`, waits for no review. The manager only posts its answer there, and the run at the schedule's next occurrence reads it. Neither the manager nor anyone else starts the task early to deliver the answer.

Answering an automation's question and deciding a workflow approval stay with people. A manager may decide a project-agent task review only through the independent-review flow above, when that review is assigned to it; reading or resuming a task does not approve it.

## Handle waiting and failed runs

| State or symptom | What to do |
| --- | --- |
| Waiting for a sandbox slot | Available capacity may be exhausted for the organization or shared infrastructure, or the agent's workspace may already be running four of its runs at once; the run then starts as soon as one of them ends. Waiting uses up no automatic retry. Wait for a slot, or ask an admin to inspect [Sandboxes](/platform/admin/sandboxes). |
| Automatic retry is shown | Tale is retrying a recoverable failure. Read the attempt count and avoid starting another run. |
| **The agent couldn't finish this task** | No automatic retry follows. The notice says what went wrong and who can fix it, and **Details** beside the run shows what the run itself reported; [When the agent can't finish](#when-the-agent-cant-finish) lists the cases. Resolve the cause, then use **Retry** to continue the conversation. |
| Reassignment is refused | Cancel the live run before choosing another assignee. |
| Agents or automations keep restarting one task | A task takes at most three starts of its agent by automations and other agents in any hour, ordinary automatic retries included; the cooldown exception below applies. The next start is refused, a retry past the limit is not started, and the timeline says **Run refused: agent runs are paused on this task**. Starts by people, and their retries, are never counted. Automation runs have no such cap: between two automations that keep mentioning each other, the one-engine rule is what stops a loop. Cancel the live run, then read the timeline before letting either start again. |
| **Run refused: agent is working on another task** | An automatic retry waited two hours for its agent, which is still working on another task. Nothing waits behind the refusal: start the task again once the agent is free, or leave it to the manager agent or automation that hands out the work. |
| The task cannot close | Finish its open subtasks first. |

Recoverable failures get up to three automatic retries, which start right away except in the cases below. A run that makes sustained progress for at least fifteen minutes receives a fresh retry allowance. This helps long work recover from interruptions; it does not prove the resulting work is correct.

An automatic retry continues the work of the person who started the run, so it starts only where that person could start the run now: the project must still be active, and they must still be allowed to change the task. If an admin archives the project, or that person leaves the organization or loses the right to change the task, no further retry starts and the run stays failed. The same applies to a mention that reaches the agent only after its run has ended. Once the project is restored, anyone who can change the task can use **Retry**.

Before a new run starts working, a short connection failure to its subscription broker can recover within that same run. For a run with the agent’s full permissions, Tale makes at most three GET requests, waiting at least five seconds and then ten seconds between them, within a shared 60-second request-and-result budget. Within that resolution, Tale waits at least as long as the broker requests or stops if the wait cannot fit. That transport wait is not carried into a later run; normal retry and hourly-start rules still apply. Database and DNS checks, as well as connection cleanup, can delay the final refusal. These requests add no task start or automatic retry. Tale checks the run and credential again before retrying or returning a token. Member-confined runs, POST brokers, rejected credentials and account cooldowns keep their existing behavior.

An agent served by a subscription broker can lose its token while it works, when the broker refreshes the account. The retry then continues the conversation on a fresh token, and the attempt count does not advance: the retry shows the same count as the run it replaces, or **Resumed after a token refresh** when that run showed none or had worked for at least fifteen minutes, which earned it a fresh retry allowance. After two such interruptions in a row, a further one counts like any other failure.

A run can also fail to start because every account of its subscription broker is cooling down after a rate limit. Its retry is queued at once but starts only when the first account is available again, at most a minute later. The wait uses no attempt when the refused run immediately follows the same agent’s HTTP 429 failure. That single wait also adds no start to the task’s hourly automated-start count: the rate-limit failure already counted. A consecutive cooldown refusal, or one following any other failure, counts toward both limits.

### When the agent can't finish

When a run fails and nothing retries it, because its automatic retries are used up or a retry can't change the cause, the task says so at the top: **The agent couldn't finish this task**, with what went wrong and who can fix it. **Retry** there starts the agent again for whoever can change the task.

| The notice says | Who acts |
| --- | --- |
| A usage limit stopped the run | An Admin raises the limit; then start the agent again. |
| Something the agent needs is missing: its model, one of its skills, or the agent itself | An Editor or Admin fixes the agent on the project's **Agents** tab. |
| An attachment on this task is no longer in storage | Whoever can change the task removes the attachment or uploads it again; **Details** beside the run names the file. Then start the agent again. |
| The run reached its time limit | Start the agent again, or split the task into smaller ones. |
| The run waited too long for a free sandbox | Start the agent again when fewer agents are busy. |
| The AI model failed, or the run couldn't start or was interrupted | Start the agent again. If it fails again, show an Admin what the run reported under **Details**. |

Tale also tells the person who started the run and everyone watching the task: with the notification **Agent run failed** and, when the organization has a connected mailbox, by email. Only people who can still open the project are told. Starting a new run on the task marks the unread notification as read. Switch these notices off with **Agent escalations** under **Settings > Notifications**.

## Work an automation or another agent starts

A project agent can also be put to work without anyone pressing **Start agent**: by a [scheduled automation](/platform/automations/triggers#start-a-project-agent-on-a-schedule), or by another agent of the project that holds the **Start other agents on tasks** tool, such as a manager agent that hands out ready work and answers questions. The timeline lists such a run as **automation**, with a link to the automation run for Owners, Admins, and Developers, or as **delegated**, started by the agent that asked. The agent is told who started it, and a message that automation or agent passed reads as theirs, never as a person's review: where it contradicts the description or a person's comment, those win.

The run answers to whoever the requesting run answers to: the person who started it, or nobody for a schedule's chain, whose spend counts as automation spend. That person, or the schedule, has to be able to act in the project when the run starts; a lost Editor role, a paused schedule, or an automation removed from the project stops the next start. An agent another agent started cannot start further agents, and a run a Member started cannot start any. Such a start also checks what a person might forget: a task an open task blocks does not start, and an agent already working another task is not started twice. An automatic retry of such a run keeps to that rule: while its agent works on another task in the same workspace, the retry waits, checks again every five minutes and starts once the agent is free, without using an attempt. Each check reads the task afresh, so a move out of **In progress**, a reassignment, an archived task or project, or a lost role ends the wait. If the agent is still busy two hours after the failure, the retry does not start, and the timeline says **Run refused: agent is working on another task**.

A delegated run parks its result at **In review** for its recorded reviewer. Resuming a task that waits there withdraws its pending review without approving it. A start that leaves the card where it is (`moveToInProgress: false`) is refused under a card waiting for review, or a **Done** or **Cancelled** one, so earlier work is never presented for judgment while new work runs under it. A manager that answers an agent's question resumes it naming the run that asked and the review it waits at. The resumption happens only while that is still the task's open question. If a decision was made in the meantime (Done, Cancelled or another move), a newer run or review exists, or the assignee changed, the agent answers `stale_question` and nothing is assigned, withdrawn, moved or started. When your organization requires an independent human reviewer, the person the run answers to cannot accept its result.

## Cancel or pause work

Use **Cancel run** to stop the active agent. Anyone who can change the task can cancel its run, and so can the person who started the run, even after the task has passed to the agent. Moving a running agent-owned task out of **In progress** can also cancel the run; read the confirmation before proceeding. A task cannot have two active agent runs at once.

For a task an automation owns, the move stops the run and puts the task where you moved it in one step. If that move is refused, for example because you moved a parent task to **Done** while its subtasks are still open, the run keeps working and the task stays in **In progress**. **Cancel run** in the automation's panel on the task moves it to **Cancelled**, so the same open subtasks refuse it; to stop the run and keep the task open, move it to **To do** instead.

An admin can disable task automation for the organization. That blocks new starts while existing work finishes. Organization limits and budget policies still apply to each run; see [Policies and limits](/platform/admin/governance/policies-and-limits).

## Choose the right assignee

Assign a person when the task needs human judgment or work outside an agent’s permitted access. Assign a project agent for a bounded job using its configured files and tools. Use an automation when the work follows a defined process with stages, triggers, or connector approvals. A Member can choose only an automation built for tasks, one of those listed under **Automations** in **Assignee**.

For a first run, follow [Build your first agent](/tutorials/editor/first-agent-end-to-end). Keep the task small enough that you can inspect its result yourself.
