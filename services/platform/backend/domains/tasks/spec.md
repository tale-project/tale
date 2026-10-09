# Tasks — who may change a task, and what a task refuses

> **Prefix** `TASK-` · **Suite** [`tasks`](../../../tests/manual/suites/tasks.md) · **Docs** [`projects/tasks`](../../../../../docs/en/platform/projects/tasks.md)

The rules a task write is held to before anything is saved: who can create, change and delete
a task, what an archived task or project refuses, how long its text can be, how often
automations can start an agent on it, how one agent works several tasks at once, and what a
deleted task leaves behind. The rest of agent runs, reviews beyond captured agent handoffs,
repeating tasks and the importers are not covered; see Not yet.

## Who can do what

Anyone who can read a project can create a task in it. What they can do with a task afterwards
depends on whether they are an editor of the project and whether the task is theirs:

| | Change the task | Delete the task | Stop or steer its agent run |
| --- | --- | --- | --- |
| An editor of the project | yes | only as an owner or admin | yes |
| A member, on their own task | yes | only as an owner or admin | yes |
| A member, on someone else's task | no | no | only a run they started |

A member here is someone who can read the project without being one of its editors.

### TASK-R1 · Anyone who can read a project can create a task in it

The task records them as its creator, which makes it their own task (`TASK-R2`).

- **Example**: Mia can read the project and is not one of its editors. She creates a task → it
  is created, with Mia as its creator.

### TASK-R2 · You can change a task if you are an editor, or the task is yours

Changing covers its fields, assignee, status, review decision, agent runs, attachments,
dependencies and archiving. A task is yours when you created it, when it is assigned to you,
or when it is a subtask of a task that is yours. A task an agent, an automation or an import
created belongs to nobody until it is assigned to a person. Anyone else is refused
(`RBAC_FORBIDDEN`) and nothing is saved.

- **Example**: Mia can read the project. She did not create the task and it is not assigned to
  her. She renames it → refused, and the title stays.
- **Example**: An agent added a subtask under Mia's own task. Mia marks the subtask Done → it
  is accepted.

### TASK-R3 · Whoever started an agent run can stop or steer it

This holds even when the task is no longer theirs, for as long as they can read the project.
Handing a task to an agent makes the agent its assignee; the person who started the run keeps
control of that run.

- **Example**: A task is assigned to Mia. She hands it to an agent, which becomes its assignee
  and starts working → Mia can still stop the run she started.

### TASK-R4 · Only owners and admins can delete a task

Being able to change a task is not enough to delete it. Anyone without the owner or admin role
is refused (`ROLE_FORBIDDEN`).

- **Example**: Mia created a task. She deletes it → refused, and the task stays.

## Archived tasks and projects

Archiving makes a task read-only for people. Archiving a project makes everything in it
read-only for everyone.

### TASK-R5 · People cannot change an archived task until it is restored

Editing its fields, moving it, assigning it, starting its agent, commenting on it and changing
its dependencies are all refused (`TASK_ARCHIVED`), and nothing is saved. Three things still
work: restoring it, deleting it, and stopping its running agent.
An opted-in custom source form may record a guarded reopening request while the
task stays archived; only the source's accepted projection changes its lifecycle.

- **Example**: Mia archived her task last week. Today she posts a comment on it → refused, and
  no comment appears.

### TASK-R6 · An agent run can still report on an archived task

The refusal in `TASK-R5` is for people. A run that is working the task can still post its
report to the task's discussion.

- **Example**: An agent is working a task when Mia archives it. The run finishes and posts its
  report → the report appears in the discussion.

### TASK-R7 · Nothing in an archived project can be changed

Creating a task, changing one and commenting on one are all refused (`PROJECT_ARCHIVED`), for
editors too.

- **Example**: The project was archived. Noah, one of its editors, comments on a task in it →
  refused, and no comment appears.

## Size limits

| What | Limit | Measured |
| --- | --- | --- |
| Title | 1 to 200 | after trimming spaces |
| Description | up to 20,000 | as sent |
| Comment | 1 to 10,000 | after trimming spaces |
| Label name | 1 to 50 | after trimming spaces |
| Labels on one task | up to 50 | |
| Attachments on one task | up to 50 | |

Length is counted the way a browser's `maxLength` counts it (UTF-16 code units), so most emoji
count as 2.

### TASK-R8 · Text over its limit is refused, never cut

This holds wherever a person or an agent writes the text: creating a task, editing it, and
posting or editing a comment. The refusal names the limit and the length it measured, and
tells an empty value from one that is too long.

- **Example**: Mia creates a task with a title 201 long → refused, with a message that names
  the limit of 200 and the length of 201.

### TASK-R9 · An import shortens text that is too long instead of failing

Nobody here wrote a title or a description that comes from outside, such as a GitHub issue, so
refusing it would fail the whole import. It is cut to the limit and ends in "…". The full text
stays reachable through the task's link to its source.

- **Example**: A GitHub issue whose title is 250 long is imported → the task is created with
  the title cut to fit, ending in "…".

### TASK-R10 · The limits in the user docs match the code

The task page of the user docs states the title and description limits in English, German and
French. A test reads the three pages and fails when a number differs from the code's.

- **Example**: The description limit moves from 20,000 to 30,000 in the code alone → the test
  fails until all three pages say 30,000.

### TASK-R11 · A task holds at most 50 attachments

A longer list is refused (`TASK_ATTACHMENTS_INVALID`).

- **Example**: A request saves a task with 51 attachments → refused, and the task keeps the
  attachments it had.

## Automatic agent starts

A person can start an agent on a task as often as they like. Starts that nobody clicked, by an
automation or by another agent, are limited so that a task cannot be restarted in a loop.

### TASK-R12 · Automations and agents can start an agent on a task three times an hour

Automatic retries count as starts. The next start within any 60 minutes is refused (`paused`)
and noted on the task's timeline. A start by a person, and its retries, are never counted and
never refused.

One wait is free: when a run hits the model provider's rate limit (HTTP 429) and waits before
trying again, that wait is not counted as a start. A second wait in a row is.

A Codex model-capacity failure schedules an automatic retry one minute later. Its
attempt still counts; it does not qualify for the free account-cooldown wait and does not
exclude the account.

- **Example**: A schedule has started the agent on a task three times since 14:00. At 14:40
  another agent starts it again → refused as `paused`, with the time after which it may retry.

## Deleting a task

### TASK-R13 · Deleting a task removes everything it owned

In the same step as the delete, its running agent and automation runs are cancelled, its
discussion is deleted, and reviews still waiting on it are closed as rejected with the reason
`task_deleted`. They are kept for the audit trail, not removed. Its attachments and outputs
are deleted afterwards, except a file another task, document or file entry still uses.

- **Example**: A task is waiting for Noah's review. An admin deletes the task → the review
  leaves Noah's pending list and is recorded as rejected because the task was deleted.

## Accepted custom source status

### TASK-R14 · A source projection must match the task's exact custom reference

The caller must be able to change the task in its active project. The explicit
external-status API opts a custom task into source-validated lifecycle ownership.
GitHub and GlitchTip issue imports keep their independent Tale triage and cannot
use this lane. Source projection changes status and optional archival together;
title, assignee, discussions and other task fields stay intact.

- **Example**: A quality-system worker sends an accepted result for ticket 7 against
  the Tale task linked to ticket 8 → refused, and neither task changes.

### TASK-R15 · A source-approved result never claims a native Tale approval

A source validates its own business transitions before projecting them, including
Done. Tale records the result as external evidence. Leaving a pending human review
withdraws it, without recording a human approval. A captured native agent review
refuses projection until it is resolved or explicitly transferred. Entering In
review through source projection requests no second review and starts no agent.
The source owns recurrence; projecting completion creates no local repeat copy.

- **Example**: Noah approved ticket 7 in the quality system. Its worker projects
  Done → the card is Done with source evidence; Tale records no approval by Noah.

### TASK-R16 · A source projection cannot overwrite a newer native lifecycle change

Projection compares the task's lifecycle activity revision in the write
transaction. Status changes, archives, restores and native source-form requests advance that revision; comments
and unrelated edits do not. A lost-reply replay writes nothing while its receipt
is still the latest lifecycle activity. A later native move, even back to the same
column, must be read and validated at the source before projection can proceed.

- **Example**: Mia moves ticket 7 after the worker reads it. The worker sends its
  earlier revision → refused with `TASK_STATUS_CONFLICT`, and Mia's move remains.

### TASK-R17 · Older source lifecycle observations cannot replace newer ones

The source supplies a monotonically increasing lifecycle timestamp, including for
archival changes. An older timestamp, or a different status or archival state at
the same timestamp, is refused with `TASK_EXTERNAL_STATUS_STALE`. A new content
revision at the same timestamp may refresh the receipt when lifecycle is unchanged.
Routine intake refreshes leave the projected source lifecycle alone.

- **Example**: A delayed scan sends ticket 7's open state from before its accepted
  closure → refused, and the Done card stays Done.

### TASK-R18 · Status readback relays an actor's email only while actively verified

The snapshot carries the current status activity's immutable actor id and origin.
Later archive or restore activities advance its lifecycle revision without replacing
the status actor with the person who archived or restored it.
Its email is present only for an active, verified member of the task's organization.
An agent, removed or disabled member, or unverified account supplies no address
that a business system could accept as an authenticated human request.

- **Example**: Mia's account is disabled after her board move. The worker reads
  its actor → Mia's id remains, but no email can be relayed as a verified request.

### TASK-R19 · Source forms record a verified person's complete intent

The exact custom source declares actions using the maintained field controls.
Only a native authenticated, active, verified member with task work permission
can submit; neither a key nor the request body chooses their identity. Declared
required fields, types, choices and safe patterns are validated before saving.
The form compares both the native revision and its accepted source revision.
A request records intent and evidence, even when both stages map to In review;
it does not change status or approve a review. The source validates all business
guards and may explain a refusal. A native captured agent review stays protected.

- **Example**: Mia submits a first-verification result with its note. Both stages
  map to In review → one immutable request reaches the source with Mia's actual
  session identity and the note; the column changes only after source validation.

### TASK-R20 · A source request and its decision survive replay exactly once

Each submission has an immutable id, body, source binding, actor and activity
revision. An identical lost-response retry returns the current snapshot; changed
input under the same id conflicts. Only one request may await validation. Each
source decision belongs to its exact request and cannot later be contradicted.
An older accepted fact may be acknowledged under a fresh native CAS after newer
intent is reconciled; it never replaces or obsoletes a newer visible request.

- **Example**: The source accepts Mia's first verification but its reply is lost.
  Mia retries → the same decision returns; a later delayed reply cannot replace
  her newer pending closure request or submit either transition again.

## Captured agent review handoffs

### TASK-R21 · A granted manager delegates only the exact captured agent gate

The live manager needs an explicit project-only routing grant and project-wide
starter authority, and is never the captured source's implementation agent.
The recipient must already be an eligible independent agent of the same
project, distinct from the manager and implementation agent. The captured
approval, source run, reviewer and evidence must still match. A task of another
project, human or workflow gates, live work, archived tasks and policy failures
are refused. The task's implementation owner, status, source, future reviewer
configuration and permissions stay unchanged. The handoff starts no run.

- **Example**: A manager moves an agent review to an available qualified reviewer
  → one successor approval preserves the source and task owner; the old approval
  records its successor and a receipt attributed to the manager agent.
- **Example**: A verdict wins while a manager holds the old review identity
  → delegation is refused and no successor gate appears.
- **Example**: The implementation agent also holds the routing grant and names a
  reviewer it picked for its own work → refused with
  `TASK_REVIEWER_NOT_INDEPENDENT`, and the captured reviewer keeps the gate.

### TASK-R22 · A handoff receipt cannot replay a changed review

An identical retry needs the same still-authorized live issuer, the unchanged
pending successor and current source evidence. A newer handoff, decision or
source edit refuses the old intent. The native task read exposes the validated
historical handoff into its latest gate, separately from current pending ownership.

- **Example**: A handoff reply is lost and the same manager retries immediately
  → the same receipt returns without another approval or activity.
- **Example**: The recipient decides before that retry → the old handoff refuses;
  its historical receipt does not claim the review is still pending.

## Dates

### TASK-R23 · A start date that has already arrived raises no bell

A task's start date normally rings once, the day it arrives: the hourly sweep sends its
"starts today" bell. A start that is today or already past when someone writes it — the
default today of a task made in the app, or a start moved back — was set by someone looking
at the task, so it is written as already announced and rings nobody. A start still ahead rings
on its day, also after it is moved.

- **Example**: Lea creates "Ship the pricing page" in the morning; its start date reads today
  → no "starts today" bell reaches her or the assignee.
- **Example**: Lea moves the start of "Plan the launch" to next Monday → the bell comes on
  Monday.

## One agent on several tasks

An agent is a configuration; each of its runs works in a worker, a sandbox of its own. The
organization's limit of agent workers (`SBX-R18`) decides how many work at once.

### TASK-R24 · An agent works each of its running tasks in a worker of its own

Two runs of one agent never share a sandbox: each has its own memory, processes and files, as
far as the limit of agent workers allows.

- **Example**: Ada starts the agent Scribe on "Release notes" and on "Changelog". The
  organization allows 2 agent workers → both work at once, each in its own sandbox.

### TASK-R25 · A start that finds no free worker waits and starts on its own

The run waits and says why: every agent worker is in use, the sandbox host is full, the
workspace it would use is being deleted, or its sandbox is still ending an earlier process.
It starts by itself as soon as room frees, uses no attempt for the wait, and gets its full
working time from the moment it starts. It waits at most 12 hours from the start request.
When several runs wait, a freed worker goes to the run of the agent with the fewest runs
working, and among those to the one that has waited longest. A start that has not waited never
takes the room freed for a waiting run: it waits behind that run.

- **Example**: Both of Scribe's workers are busy. Ada starts Scribe on a third task → it reads
  "Waiting for a worker". "Changelog" finishes → the third run starts by itself.
- **Example**: Scribe was handed thirty tasks at once and every worker is busy. Ada then starts
  Lector once → the next worker that frees goes to Lector's run, ahead of Scribe's waiting runs.
- **Example**: Lector's run waits. "Changelog" finishes and frees a worker, which goes to
  Lector's run. A manager agent starts Scribe on "Press kit" before Lector's run has started →
  "Press kit" waits, and Lector's run starts.

Until it starts, a waiting run can be taken back: stopping it cancels it, and handing the task to
someone else cancels it on the way. A run that has started is still stopped before the task
can pass to someone else.

- **Example**: Scribe's run on "Press kit" waits for a worker. Ada assigns "Press kit" to
  Lector → Scribe's waiting run is cancelled and the task is Lector's.

### TASK-R26 · Automations and agents can start an agent that is busy on another task

A start by an automation step, a schedule or a manager agent is answered `started` while the
agent works other tasks; when its run waits for a worker (`TASK-R25`) the answer says why. An
automatic retry starts at once, whatever else the agent is doing. An agent cannot start itself
on another task (`self_start`).

- **Example**: Scribe works "Changelog". A manager agent starts Scribe on "Press kit" → the
  answer is `started`, and Scribe works both.
- **Example**: Every agent worker of Ada's organization is busy. An automation starts Scribe on
  "Press kit" → the answer is `started` with `waitingReason: org_limit`, and the run starts by
  itself once a worker frees.

### TASK-R27 · A task's next run goes back to its worker when that worker is free

There the run continues the task's conversation and finds the files it left. On another worker
it starts fresh from the task's description, discussion, attachments and deliverables. A
worker whose run failed or was cancelled is kept for that task for 15 minutes, so a retry finds
what the run left there; another task's run takes it only when no other worker is free and no
new one can open.

- **Example**: "Release notes" finished in Scribe's worker 2. Ada asks for changes while
  worker 2 is free → the run continues there, in the same conversation.
- **Example**: Scribe's run on "Changelog" fails in worker 1, and its automatic retry is about
  to start. Ada starts Scribe on "Press kit" → it takes another worker, and the retry continues
  in worker 1.
- **Example**: "Release notes" last worked in Scribe's worker 1, which is free. Ada starts
  Scribe on "Changelog" and, a moment later, asks for changes on "Release notes" → "Release
  notes" continues in worker 1, and "Changelog" takes another worker: a run that has not
  started yet holds no worker.

## Operational review batches

### TASK-R28 · A review batch completes only through every declared native decision

A live project manager declares one fixed set of at most twenty distinct captured
agent reviews. Each decision must name the declared source and evidence, the
independent enrolled reviewer, and an actual run of that batch. A report or a
settled run supplies no missing decision. Both approval and changes requested
complete the review action; changes requested leave the implementation unfinished.
Replaying the same request returns its existing result without another start. A
new occurrence explicitly declares the reviews that remain.

- **Example**: A reviewer decides two of three targets and writes a report → the
  batch remains incomplete. Its manager retries the same request and receives
  that result; a new request names the remaining target.

### TASK-R29 · A managed review context never becomes an implementation deliverable

A project editor explicitly enrolls a pristine native operational task for one
eligible reviewer. The immutable purpose cannot be adopted by an ordinary task
with retained source work, review history, external identity or implementation
relationships. Disabling preserves that purpose. Ordinary tasks keep their review
gates. A context runs only through its native batch admission and cannot itself
acquire a report-review gate. Its evidence follows the existing legal-hold and
retirement rules.

- **Example**: An editor tries to enroll an implementation card already awaiting
  review → refused. A new managed review context accepts batches instead, while
  each implementation card keeps its own independent captured gate.

## Not yet

- **Agent runs**: steering, stopping, retrying and re-attaching a run beyond `TASK-R24`–`TASK-R27`, and how a run moves the card between statuses (`agent-runs.ts`,
  `run-start.ts`, `reattach.ts`, `kick-plan.ts`).
- **Reviews beyond `TASK-R21`–`TASK-R22` and `TASK-R28`–`TASK-R29`**: who a review goes to, an agent as reviewer, and what a decision does to the task
  (`reviews.ts`, `agent-review.ts`, `review-decision.ts`, `review-repair.ts`).
- **Repeating tasks, date notifications beyond `TASK-R23`, metrics and board search** (`repeat.ts`,
  `date-notifications.ts`, `metrics.ts`).
- **Imported and externally referenced tasks** beyond `TASK-R9` and `TASK-R14`–`TASK-R20` (`external-ref.ts`,
  `import-cursors.ts`).
- **Undecided: can a task with an old, over-long description still be edited?** Some tasks
  hold a description over 20,000, left by an import made before `TASK-R9`. The server checks
  a description only when a request sends one (`updateTask` in `service.ts`), so a change to
  the title alone is accepted. The user docs say **Save** stays unavailable on such a task
  until the description is shortened (`docs/en/platform/projects/tasks.md`). One of the two
  is the intended rule.
- **`TASK-R12` covers project agents only.** Nothing counts automation runs on a task; the
  contract debt ledger in [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
- **`TASK-R4` has no REST twin.** A task cannot be deleted over `/api/v1`; the same ledger
  records it.
