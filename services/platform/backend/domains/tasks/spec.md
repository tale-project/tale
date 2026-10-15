# Tasks — who may change a task, and what a task refuses

> **Prefix** `TASK-` · **Suite** [`tasks`](../../../tests/manual/suites/tasks.md) · **Docs** [`projects/tasks`](../../../../../docs/en/platform/projects/tasks.md)

The rules a task write is held to before anything is saved: who can create, change and delete
a task, what an archived task or project refuses, how long its text can be, how often
automations can start an agent on it, how one agent works several tasks at once, what a
deleted task leaves behind, and how an issue sync keeps tasks in step with their trackers. The
rest of agent runs, reviews beyond captured agent handoffs and a reviewer who loses access,
repeating tasks and the importers beyond the issue sync are not covered; see Not yet.

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

A run the provider refused because its model is at capacity is not counted either: its retry
waits on the model (`TASK-R40`), which spaces the attempts out and ends them, so it cannot
restart the task in a loop.

- **Example**: A schedule has started the agent on a task three times since 14:00. At 14:40
  another agent starts it again → refused as `paused`, with the time after which it may retry.
- **Example**: Since 14:00 the provider has refused three runs on the task because the model
  was at capacity. At 14:40 a schedule starts the agent → it is started.

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

## A reviewer who loses access

### TASK-R39 · A review waiting on someone who can no longer edit the project goes on

A person is no longer the reviewer in a project once they are removed from the organization,
given a role that cannot edit it, or taken out of the last team that reaches it. Their choice
as reviewer is cleared on every task of the project, and a review that waited on them moves
to the task's creator or, when the creator cannot edit the project either, to the project's
creator, who is asked. A person who can still edit the project, through an admin role or
another team, keeps their reviews. A review that waits on an agent, a review already decided
and the tasks of other organizations stay as they are.

- **Example**: Mia created a task and Noor is its reviewer. An admin changes Noor's role to
  Member → the task no longer names Noor, and the review moves to Mia, who is asked.
- **Example**: Noor belongs to two teams that both reach the project. An admin takes her out
  of one → she keeps the review.

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

### TASK-R40 · A model at capacity makes every run on it wait instead of failing

When the provider answers a run that its model is at capacity, the organization's runs on that
model wait for it: the run that was refused fails once and its automatic retry, which uses no
attempt, waits; a run started meanwhile waits before it takes a worker, reading "Waiting for
model capacity". The wait lasts 1 minute, then 2, 4, 8 and 15 minutes as the refusals go on.
When it ends one run goes first; the others follow once that run has worked for two minutes,
or as soon as any run on the model finishes. They then start in waves 15 seconds apart: one run,
then two, four and so on, never more than a sixteenth of them at once, so even 500 waiting runs
have all started within five minutes. A model at capacity for twelve hours is no longer
waited for: its next refusal ends the run, and a run that waited that long fails as having
waited too long.

- **Example**: The provider refuses Scribe's run on "Changelog" at 10:00 because its model is
  at capacity. At 10:00:30 a schedule starts Lector, on the same model, on "Press kit" → it
  reads "Waiting for model capacity" and takes no worker. At 10:01 the retry of "Changelog"
  starts first; at 10:03 it is still working → "Press kit" starts. Had 256 runs been waiting,
  the last of them would have started at 10:07:45.

## Dispatch

A project's dispatch starts its ready work on its idle agents without anyone starting each run.
People and their manager agents decide what is ready and in what order: the column a task waits
in, its priority, its place on the board, its assignee. Dispatch decides when, and on which agent
of its pool, as the sandbox host allows.

### TASK-R41 · Dispatch starts ready work on idle agents of its pool, up to its limits

Ready work is a task in one of the dispatch's columns that no run works on, whose last run is not
about to retry on its own, that nothing open blocks, and that is assigned to an agent of the pool.
It is taken by column, then priority, then board order, then age. An agent of the pool holds one run at a time (or as many as the dispatch
allows), and the pool as many as its limit, counting every run of its agents whoever started it.
Nothing starts while the organization's agent workers are all in use. Each start is an ordinary
automated start: the task's hourly limit and its dependencies apply (`TASK-R12`).

- **Example**: The pool is Scribe and Lector, with two runs at most. Scribe works on "Changelog".
  "Release notes" (To do, p1) is Lector's, "Press kit" (To do, p2) is Scribe's → Lector starts on
  "Release notes"; "Press kit" waits for Scribe.

### TASK-R62 · A dispatch holds up to 500 runs, one agent at most as many as the pool

Runs at once and runs per agent each go up to 500, as many agent workers as an organization may
have, so one agent can be kept busy on every worker. A save that lets one agent hold more runs
than the whole pool is refused, naming runs per agent; a dispatch saved before this rule still
reads and starts work, the pool's limit binding first. Every run still needs an agent worker of
the organization's: beyond them, nothing more starts (`TASK-R41`).

- **Example**: Ada keeps Coder alone in the Fleet pool, with 256 runs at once and 256 per agent,
  and the organization has 256 agent workers → dispatch starts Coder on 256 ready tasks. She
  lowers runs at once to 200 and keeps 256 per agent → refused, naming runs per agent.

### TASK-R42 · Dispatch hands unassigned work to its pool only when told to

With pool assignment, a ready task nobody is assigned to goes to the idle agent of the pool with
the most room, and is assigned to it. With rebalance, a ready task that never ran moves from its
busy agent to such an agent. A task that already ran stays with its agent, so its conversation
and files stay where they are.

- **Example**: The dispatch hands work to its pool. "Sitemap" is assigned to nobody, Scribe is
  busy and Lector idle → Lector is assigned "Sitemap" and starts on it.

### TASK-R43 · An agent whose model is at capacity takes no work from dispatch

While the provider holds its model at capacity (`TASK-R40`), the agent's ready work waits, and
unassigned work goes to an agent whose model answers. When the model answers again, dispatch
looks for work at once.

- **Example**: Scribe's model is at capacity; Lector's is not. "Sitemap" is assigned to nobody →
  Lector takes it, and Scribe's own ready work waits.

### TASK-R44 · Dispatch asks the sandbox host before each start and spaces its starts

Before each start of ready work, dispatch asks the sandbox host whether it admits another, by the
deployment's thresholds or, with the conservative preset, by stricter ones for load and CPU,
memory and I/O pressure. A hold ends the pass, and dispatch asks again after its recheck delays
(60, 120, then 240 seconds by default, then the last). Its starts are at least the spacing it
names apart (30 seconds by default). The host's readings a start was admitted on are kept with
the pass and with the record of the run it started.

- **Example**: The host's memory pressure is high when "Changelog" is next → nothing starts, and
  dispatch asks again a minute later, then after two minutes, then every four.

### TASK-R63 · A pass starts work for two minutes at most, and the next goes on at once

A pass reads up to 500 ready tasks, enough to fill the largest pool. Without a spacing it starts
every one the host admits; after two minutes it stops, its first start always made, and the next
pass goes on at once with the runs and the host as they stand then, so no two passes start work
on one plan; its record says it ran out of time. With a spacing, each pass makes one start and
the next pass comes a spacing later:
the 256th run starts 255 spacings after the first, 2 hours 7 minutes 30 seconds at the default 30
seconds.

- **Example**: Coder's pool may hold 256 runs with no time between starts, and each start takes
  the host a second to admit → the first pass starts about 120 of them by its two minutes, and
  the next pass, at once, the rest.

### TASK-R45 · A standing role starts its agent on its task at each occurrence of its schedule

An occurrence fires on time, within ten minutes, never as a burst of what an outage missed. It
moves the task to In progress and hands the agent the occurrence, read in the schedule's time zone
with its UTC instant, the role's mode and its brief. An occurrence that finds the task still being
worked on is coalesced into that run. Each occurrence is decided once, whichever passes decide it
again. A role starts even when the pool holds as many runs as it may; a run of a role whose agent
is in the pool counts toward the pool.

- **Example**: The manager role runs at :00 and :30 in Zurich. At 14:00 its agent starts with
  "Scheduled occurrence: manager 2026-10-14 14:00 Europe/Zurich (2026-10-14T12:00:00.000Z)". At
  14:30 the 14:00 run still works → nothing new starts, and the occurrence reads as coalesced.

### TASK-R46 · The dispatch readback says what each agent of the pool does, or why it is idle

For every agent of the pool it names the runs it holds, and for an idle one why: dispatch is off,
its model is at capacity, the host held the last start, the agent workers are all in use, the
next start waits (for the spacing, or for the pass that follows one that ran out of time), or no
work is ready for it. It counts an agent's runs by what they do
(running, queued, and waiting by why) and lists its 50 oldest, so an agent on hundreds of tasks
still reads in one answer; the page shows the first five and the rest of the list on request. It
reads the run ledger and the passes, never where cards stand on the board.

- **Example**: Scribe has no run and the last pass stopped because the host was under pressure →
  the readback says Scribe is idle because the host held the last start. Coder holds 256 runs, 6
  of them waiting for model capacity → the readback counts 250 running and 6 waiting for model
  capacity, and lists 50 of them.

### TASK-R47 · A run dispatch starts answers to the project, never to a person

It names the project's dispatch as its starter and spends under the automation subject, as a
schedule's run does. It acts with the agent's full equipment while the project's dispatch is
switched on and the project is active; a run that has not launched when dispatch is switched off
fails without running.

- **Example**: Dispatch starts Scribe on "Changelog" → the run's starter reads `dispatch:` and the
  project, and no member's budget pays for it.

### TASK-R48 · Only who may administer the project changes its dispatch

Owners and admins of the organization, and the project's own administrators, change it on an
active project. Every agent, task and label it names must be the project's, and its schedules must
read (`DISPATCH_INVALID`). Anyone who can read the project reads it.

- **Example**: Mia, a member, tries to switch the project's dispatch on → refused. An admin adds a
  standing role on a task of another project → refused, naming the task.

### TASK-R52 · A stored dispatch this version cannot read is never overwritten

A dispatch stored in a shape this version of Tale cannot read, such as one a newer version wrote,
starts nothing. Managed configuration does not read it as missing, and a save is refused
(`CONFIG_UNREADABLE`) instead of replacing it with a document that drops what this version does
not know. The readback says the project has one this version cannot read.

- **Example**: A newer version stored the Fleet project's dispatch with a field this one lacks,
  and the deployment rolls back. A declaration that names the Fleet dispatch → refused when it is
  planned, never planned as a new dispatch; Ada saves the dispatch → refused, and the stored one
  is kept for the newer version.

### TASK-R61 · A declaration whose dispatch would be refused writes nothing

Managed configuration writes a project's dispatch after everything else it declares, the schedules
it switches off included. Before it writes anything, it asks whether the dispatch would be saved.
The check runs exactly as a save does and writes nothing. A dispatch that would be refused stops
the plan, or the apply, before any resource is written. A dispatch would be refused for an agent, a
task, a label or a schedule the project cannot use, a stored dispatch changed since it was
reviewed, or a caller who may not administer the project. The refusal names the declared fields,
never the platform's words.

- **Example**: The Fleet declaration switches six automations off and declares a dispatch whose
  `ci` gate holds the label `optional-ci`, which the project lacks → the plan is refused at
  `gates.0.labels.0`, and all six automations keep running.

### TASK-R50 · Every switched-on dispatch reports when it last passed

The backend's metrics name, per project, when its switched-on dispatch last completed a pass —
whatever the pass found — so an alert outside the platform notices a dispatch that stopped. A
dispatch switched off drops out; a read that fails reports zero for every project it knew.

- **Example**: The job workers stop at 14:00 → the Fleet project's last pass stays at 13:59, and
  an alert on its age fires at 14:15.

### TASK-R51 · A gate holds the ready work it governs while a signal from outside says so

A dispatch may declare gates: signals from outside the platform, such as a CI system whose runner
queue is full. Something outside reports on a gate — a state, or a value the gate judges: at or
above its hold value it holds, and once held it opens only below its recover value (half the
hold value unless declared). A held gate leaves the ready work it governs — the tasks with one of
its labels, or all ready work when it names none — and dispatch starts the rest; standing roles
are never held by a gate. A gate nobody reports on for its stale window (ten minutes unless
declared) opens, or holds when it declares so. A gate with start spacing lets one start of its
work through, then the next only after the spacing. A report that opens a gate asks for a pass
at once. Who may edit the project reports through the API; who may administer it, in the app.

- **Example**: The CI watcher reports 23 queued jobs on the gate `ci` (hold at 20) → "Changelog",
  labelled `ci`, waits and "Press kit" starts. It reports 14 → `ci` still holds; 9 → it opens, and
  "Changelog" starts within the minute.

## What a run is handed

### TASK-R49 · Every turn gets its project's current instructions, and its run records them

Every turn of a task agent — a start, a retry, a steered restart — reads its project's
instructions when it starts and is handed them between the organization's Custom instructions
and the agent's own; a project without instructions adds nothing. The run records the SHA-256
of the project's instructions, of the agent's and of the task's description the turn was
handed, with the execution that read them. A turn whose task or project cannot be read does not
start: its run fails as a start failure and is retried like one.

- **Example**: Ada changes the project's instructions to "Never merge red" while Scribe works
  "Changelog". She asks for changes → the turn that continues the conversation opens with "Never
  merge red", and the run's record names the new digest.

## Runs that need no workspace

The organization's standard agent works a task with what a chat reply has: the model, the
organization's knowledge, the skills it is equipped with, files and images it makes, and code
run in a light sandbox. It starts a worker, a full workspace of its own, only when the work
needs one. The run card says which a run is on.

### TASK-R30 · A person's start of the standard agent works without a worker

Starting the organization's standard agent with Start, with an @mention in a comment or in a
description, or over the API runs it with the tools a chat reply has. It makes its files with
the same file, image and code tools, runs code in the same light sandbox a chat starts rather
than in one of the agent's workers, and acts as the person who started it, within the
project, for as long as that person is an active member. A start by an automation, a schedule
or another agent, an agent with connectors, tools or secrets of its own, a runtime an Admin
pinned, and a model only a runtime can serve all work in the agent's full workspace from the
start.

- **Example**: Mia starts the standard agent on "Onboarding contacts" and asks for a CSV and a
  chart → both are attached to the task, and no worker of the agent was started.
- **Example**: A weekly schedule starts the same agent on the same task → the run works in a
  worker of the agent's full workspace.

### TASK-R31 · A run that needs the full workspace hands itself over and keeps what it made

When the work needs a repository, a browser or hours, the run hands the task to the agent's
full workspace with a reason and a brief. The files it already made are the task's
deliverables from then on, the full workspace carries on from the brief without redoing them,
and the run's own closing sentence is not posted as the report. A retry of a run that handed
over starts in the full workspace, with the same brief.

- **Example**: Ada asks the standard agent to run a repository's tests. It sees it needs a
  checkout and hands over → the task stays In progress, the run now works in a worker, and
  the notes it drafted are among the task's deliverables.
- **Example**: The full workspace could not start and the run is retried → the retry starts
  in the full workspace, with the same brief.

### TASK-R32 · A run without a workspace finishes like any other run

Its closing message is posted as the agent's report, the files it made are the task's
deliverables (a file revised under the same name replaces the earlier one; a run delivers at
most 64 files, as a run in the full workspace does, and names the rest as not delivered), and
the task moves to In review. The run card shows what it did, tool by tool, and everyone who can read
the project can open the files it made; nobody else can. Its work is booked to the person who
started it, under the agent, and to the project, and a limit that binds that person refuses
the run before it spends anything. The light sandbox it used is given back when it ends.

- **Example**: Mia's run finishes → the report says what was made, "contacts.csv" is under
  Deliverables and the task waits at In review. Noor, who is in the project's team, opens the file;
  Sam, who is not, cannot.
- **Example**: Mia's daily limit is spent → the run fails at once, saying so, and nothing was
  spent.

### TASK-R33 · A comment to the agent stops a run without a workspace and starts the next

Such a run takes no word mid-way. An @mention of its agent, in a comment or in the
description, by someone who may work the task stops the run and starts the next one with the
comment as its message. The stop and the start stand or fall together: a start the
organization refuses leaves the run working. Stop on the task ends it at once.

- **Example**: Mia's run is working. Ada comments "@Scribe also add a summary table" → the
  run stops and a new run starts from Ada's comment.

### TASK-R34 · A run without a workspace that fails or is lost fails as any run does

A provider's rate limit fails the run as model capacity and is retried after a minute. That
capacity refusal does not consume the task's hourly automated-start circuit. A run
whose turn is gone fails as interrupted and is retried: it never opened its transcript, its
turn ended without settling, or it has been silent for ten minutes. A run that outlasts its
time limit, one the organization's content policy refuses, one a spent limit refuses, and one
whose model, agent or skill is gone fail for good, and the person who started the run is told.

- **Example**: The provider answers "rate limit" → the run fails, and a new run starts a
  minute later.
- **Example**: A guardrail blocks the task's text → the run fails naming the organization's
  policy, nothing retries, and Mia is told in her inbox.

### TASK-R35 · Deleting a task deletes what its runs without a workspace kept

The transcripts of its runs and the files they made go with the task, and their bytes are
released unless another task or document still holds them. A run still working when its task
is deleted stops at its next step, within seconds, and spends nothing more.

- **Example**: Ada deletes "Onboarding contacts" → its runs' transcripts are gone, and
  "contacts.csv" is released.
- **Example**: Ada deletes the task while Mia's run is on its third step → the run ends at the
  next step instead of working on, and no file lands on a task that is gone.

### TASK-R36 · A run without a workspace is kept as long as its record, and no longer

What the run said, did and read goes when the organization's retention window deletes the
run's record, and when the person who started the run is erased. A deliverable stays with its
task whoever started the run; the files only the transcript held are released with it.

- **Example**: The retention window of agent runs passes for Mia's run → the run and its
  transcript are deleted, and "contacts.csv" stays on the task.
- **Example**: Mia is erased → the transcripts of the runs she started are gone, the runs
  name no one, and the deliverables stay.

### TASK-R37 · A run without a workspace takes no worker

It is never counted as using one of its agent's workers: a run of the same agent in the
full workspace, started at the same time, takes the agent's first worker; a worker with only
such runs left goes idle and stops; and the end of such a run frees no slot and wakes nothing.

- **Example**: Mia's run works while a schedule starts the same agent on another task → the
  schedule's run takes the first worker, and a third run waits for a worker only when the
  organization's real workers are all busy.

### TASK-R38 · An organization works at most four runs without a workspace at once

The next one waits its turn, queued, in the order it was started, and begins as soon as one of
the organization's runs ends; no other organization's run waits behind it. A run whose
process died stops counting within two minutes.

- **Example**: Ada starts six agent runs at once → four work and two wait; when one ends, the
  next begins. Another organization's run starts at once.

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

Managed provisioning may explicitly create an absent UUID task and enroll it in
one transaction through the native task creator. Omission remains adoption-only.
Failed enrollment rolls back creation, counters and audit; retry keeps the same
identity and hash precondition. Tenant collisions never overwrite existing work.

- **Example**: An editor tries to enroll an implementation card already awaiting
  review → refused. A new managed review context accepts batches instead, while
  each implementation card keeps its own independent captured gate.

## Issue sync

An issue sync is one automation step (`task.sync_issues`) that keeps a project's tasks in step
with a list of issue sources: GitHub repositories and GlitchTip projects. Each run reads every
source in turn, and answers one receipt per source: what it read and wrote, where it stopped,
and why it did not go as planned.

### TASK-R53 · One source that fails never stops the other sources of an issue sync

When a tracker refuses a source (its credentials, a repository that is gone, a tracker that does
not answer), that source's receipt names the error, and the sync goes on with the next source.
The failed source saves nothing, and reads the same batch on the next run.

- **Example**: Mia's sync lists the repositories web and mobile. GitHub refuses the token for web
  → mobile's new issues become tasks, and web's receipt says `unauthorized`.

### TASK-R54 · An issue sync fails only when every one of its sources failed

While some sources succeed, the step succeeds, with the failed sources' errors in their receipts.
When every source failed, the step fails with the cause they share, so the schedule counts the
failure like any other. A source that waits out a rate limit has not failed.

- **Example**: Both of Mia's repositories refuse the token → the step fails, named as refused
  credentials, and the schedule counts a failed run.

### TASK-R55 · One issue that cannot be read or written never stops the rest of its source

An issue imported earlier that the tracker will not show again (a 403, a 500) is skipped and read
again on a later run, while the others are refreshed. Each issue is written into its task on its
own, so one that the task domain refuses (`TASK_EXTERNAL_REF_INVALID`) rolls back alone. The
receipt counts the skipped issues and names the first ones.

- **Example**: Of the 50 issues a run reads again, GitHub answers 403 for one → the other 49
  tasks are refreshed, and the receipt counts 1 skipped.

### TASK-R56 · A rate-limited source keeps what it did and waits as long as its tracker asks

When a tracker answers with its rate limit (a 429, or GitHub's 403 with its reset time), the
source stops for this run: what it read and wrote stays, its position moves on as far as it got,
and the wait is kept. Until the wait is over, later runs leave that tracker alone. The wait
counts as no failure, neither for the step (`TASK-R54`) nor for the position (`TASK-R59`).

- **Example**: GitHub asks the sync to wait 20 minutes while it reads Mia's issues again → the
  new batch is written and saved all the same, and the runs of the next 20 minutes do not call
  GitHub for that repository.

### TASK-R57 · Each run of an issue sync reads a source's next batch from where it stopped

A source's position is kept per project, source name (`owner/repo`, `organization/project`) and
filter: each run reads the next batch of open issues from there and saves where it stopped, and
after the last issue the next run starts the next pass from the first. Automations naming the
same source under the same filter in the same project share one position; a source narrowed by
labels or a search keeps a position of its own, and one without keeps the plain name a
hand-built import chain uses. A new issue becomes a task in Backlog, and an issue imported
before is written into its task again, never into a second one (`CONN-R12`).

- **Example**: Mia's repository has 250 open issues and her sync reads 100 a run → the first
  three runs import 100, 100 and 50, and the fourth starts again from the oldest.
- **Example**: Mia syncs her repository's `bug` issues in one automation and its `ui` issues in
  another → each continues its own pass, and neither starts the other's over.

### TASK-R58 · An issue sync saves its position only from where its run read it

Two runs of one source may overlap. The first to save moves the position on; the save of the
other is refused (`conflict`) and writes nothing, so a pass never moves backwards and no batch
is skipped.

- **Example**: A slow run and the next scheduled one read the same batch of Mia's repository →
  both write the same tasks, the first saves its position, and the second's receipt says
  `conflict`.

### TASK-R59 · A position that fails three times, or no longer fits its filter, starts over

A batch the tracker refuses counts against its position, and after three in a row the next run
starts the pass from the first issue. A position saved under another label filter or search
starts over at once. A rate limit and a stopped server count nothing.

- **Example**: Mia changes the sync's label filter from `bug` to `bug, ui` → the next run reads
  from the first matching issue instead of failing on the old position.

### TASK-R60 · An issue closed upstream leaves its task where it is

The sync records the issue's state, title and text on the task's source card (closed,
resolved, ignored, or no longer available), and never moves the task or changes its title,
description, status or assignee. Its receipt counts the issues closed, reopened and gone since
they were last read. The tracker itself is only ever read.

- **Example**: Noah closes an issue on GitHub while its task is In progress in Tale → after the
  next run the task's source card shows Closed, and the task stays In progress.

## Not yet

- **Agent runs**: steering, stopping, retrying and re-attaching a run beyond `TASK-R24`–`TASK-R27`, `TASK-R30`–`TASK-R38` and `TASK-R40`, and how a run moves the card between statuses (`agent-runs.ts`,
  `run-start.ts`, `reattach.ts`, `kick-plan.ts`).
- **Reviews beyond `TASK-R21`–`TASK-R22`, `TASK-R28`–`TASK-R29` and `TASK-R39`**: who a review goes to otherwise, an agent as reviewer, and what a decision does to the task
  (`reviews.ts`, `agent-review.ts`, `review-decision.ts`, `review-repair.ts`). `TASK-R39` hands reviews on from the members door
  (removal, role change), the team door and the removal cascade that SCIM and the sign-in handler's hook share; SCIM role updates, SSO role
  reconciliation, a deleted team and an edited project audience do not hand them on yet.
- **Repeating tasks, date notifications beyond `TASK-R23`, metrics and board search** (`repeat.ts`,
  `date-notifications.ts`, `metrics.ts`).
- **Imported and externally referenced tasks** beyond `TASK-R9`, `TASK-R14`–`TASK-R20` and the
  issue sync's `TASK-R53`–`TASK-R60` (`external-ref.ts`, `import-cursors.ts`): the hand-built import
  chains' reads and saves of a position (`task.get_import_cursor`, `task.save_import_cursor`).
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
