# Tasks — who may change a task, and what a task refuses

> **Prefix** `TASK-` · **Suite** [`tasks`](../../../tests/manual/suites/tasks.md) · **Docs** [`projects/tasks`](../../../../../docs/en/platform/projects/tasks.md)

The rules a task write is held to before anything is saved: who can create, change and delete
a task, what an archived task or project refuses, how long its text can be, how often
automations can start an agent on it, and what a deleted task leaves behind. Agent runs,
reviews, repeating tasks and the importers are not covered; see Not yet.

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

## Not yet

- **Agent runs**: starting, steering, stopping, retrying and re-attaching a run, and how a run
  moves the card between statuses (`agent-runs.ts`, `run-start.ts`, `reattach.ts`,
  `kick-plan.ts`).
- **Reviews**: who a review goes to, an agent as reviewer, and what a decision does to the task
  (`reviews.ts`, `agent-review.ts`, `review-decision.ts`, `review-repair.ts`).
- **Repeating tasks, date notifications, metrics and board search** (`repeat.ts`,
  `date-notifications.ts`, `metrics.ts`).
- **Imported and externally referenced tasks** beyond `TASK-R9` (`external-ref.ts`,
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
