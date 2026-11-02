---
title: Add tasks from an automation
description: Create a task in a project with the task.create step — its title, assignee, status, due date and labels — once each time the step runs, list a project's tasks with task.list, report on a gate of a project's dispatch with task.report_gate, and know what is refused.
---

Use a `task.create` step when an automation should hand work to a person or an agent: a reply an email asks for, a form to follow up, a check that failed. It creates the task in a project the automation is installed in, and the task names the automation as its creator. A live run creates it; a test run answers with a mock.

## Create a task

```yaml
nodes:
  - id: ticket
    type: task.create
    input:
      projectId: '{{ input.projectId }}'
      title: 'Reply to {{ input.from }}'
      description: '{{ input.body }}'
      assignee: ada@example.com
      status: todo
      dueDate: '2026-10-17'
      labels: [support]
```

| Input         | What it holds                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`   | The project the task goes to. The automation must be installed in it, and a run started in a project creates tasks only there.                             |
| `title`       | The task's title. One over 200 characters is cut, ending in "…".                                                                                           |
| `description` | The task's description, in Markdown.                                                                                                                       |
| `assignee`    | A member's email or user id, or an agent of the project by its name or handle.                                                                             |
| `status`      | `backlog`, the default, `todo` or `in_progress`. An agent's task created at `in_progress` starts its run.                                                  |
| `dueDate`     | A date such as `2026-10-17`, or an ISO date and time. A date alone falls on that day in nearly every time zone.                                            |
| `labels`      | Label names. The project's catalog gains those it doesn't have yet when the person who started the run may edit the project, or when a trigger started it. |

The step returns `{ taskId, number, title, url }`; `url` opens the task in Tale.

<Frame caption="A live run in Customer onboarding portal: the step read the email's sender and subject from the run's input, and created the task.">

![The page of a succeeded live run of Follow up on support emails with the Ticket step selected, a Tasks · Create task step. Its Last run tab says it ran task.create and read from, subject and projectId from the run input; under Received are the task's title, a list of 1 label and the status todo. Below the canvas the run lists 1 effect.](/images/platform/automation-task-create-run.webp)

</Frame>

## One task each time the step runs

The step creates one task each time it runs: once per run, and once per item or pass in a loop. When a run is interrupted after the task was created and resumes, the step answers the task it already made instead of creating a second one.

The task is created with the rights of the person who started the run, as on the board; a run a trigger started creates it as the automation. Other automations can start on its creation, which they see as made by an automation.

## List a project's tasks

A `task.list` step reads a project's tasks, newest or oldest first, to report on them — a daily digest, a count of what waits for review. It reads a project the way a create there does, and it changes nothing, so it never waits for approval.

```yaml
nodes:
  - id: open
    type: task.list
    input:
      projectId: '{{ input.projectId }}'
      status: [todo, in_progress]
      createdSince: '2026-10-17'
      limit: 20
```

| Input          | What it holds                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`    | The project to read.                                                                                                                        |
| `status`       | Only tasks in these statuses — any of `backlog`, `todo`, `in_progress`, `in_review`, `done` and `cancelled`; every status when left out.    |
| `createdSince` | Only tasks created at or after this moment: epoch milliseconds, a date such as `2026-10-17` (its start, in UTC), or an ISO date and time.   |
| `createdBefore` | Only tasks created before this moment, written the same way. With `createdSince`, it makes a window: one that starts where the last one ended never lists a task twice. |
| `order` | `newest` first, as when left out, or `oldest` first. |
| `after` | With `order: oldest`, only the tasks after this place: the `next` an earlier listing answered. Empty starts from the first. |
| `limit`        | At most this many tasks, up to 200; 50 when left out.                                                                                       |

The step returns `{ tasks, hasMore, next }`. Each task carries its `taskId`, `number`, `title`, `status`, `priority`, `assignee` (its `type`, `id` and `name`), `dueDate`, `createdAt` and the `url` that opens it. Archived tasks are left out, and `hasMore` says that more tasks match than `limit` returned. Oldest first, `next` then names the last task listed: pass it as `after`, and the next listing carries on behind it, even past tasks created in the same millisecond. The **Daily task digest** [template](/platform/automations/templates#task-digest) is built on it.

<Frame caption="The Daily task digest's run, with its Tasks step selected: the project and the moment it read from, and the seven tasks it returned.">

![The page of a succeeded live run of Daily task digest with its Tasks step selected, a Tasks · List tasks step. Its Last run tab says it ran task.list and read since from the Window step; under Received are the projectId, createdSince and limit 50, and under Returned a list of 7 tasks.](/images/platform/automation-task-list-run.webp)

</Frame>

## Read a task and a specific run

A `task.get` step normally returns the task’s title, status, project and description. Add `agentRunId` to read one exact run on that task. `agentRun` then contains `id`, `taskId`, `agentId`, `status`, `execId`, `startedAt`, `launchedAt` and `settledAt`; timestamps are epoch milliseconds and the last two can be `null`. A missing run or one belonging to another task or organization returns `agentRun: null`. No latest run is substituted. Leaving `agentRunId` out preserves the original response.

Use `task.list_comments` with `includeIds: true` when a receipt needs each comment’s native `messageId` alongside `authorType`, `authorId`, body and timestamp. The default response stays unchanged, and `truncated` still reports incomplete history. IDs written inside a comment are not its native identity.

These reads do not reserve capacity or authorize a start, command or publication. A missing field or refusal on an older platform leaves identity unknown. For a task agent’s own fresh execution, use [workspace discovery](/platform/projects/project-agents#current-execution).

```yaml
nodes:
  - id: task
    type: task.get
    input:
      taskId: '{{ input.taskId }}'
      agentRunId: '{{ input.agentRunId }}'
  - id: comments
    type: task.list_comments
    input:
      taskId: '{{ input.taskId }}'
      includeIds: true
      limit: 10
```

## Report on a dispatch gate {#report-gate}

A `task.report_gate` step reports on a [gate](/platform/projects/dispatch#hold-work-behind-a-gate) of a project's dispatch from inside Tale, as an external system does through the [REST API](/develop/api-reference#dispatch). A scheduled automation reads the signal the gate follows and reports it, and no job outside Tale needs an API key. This automation reads how many GitHub Actions runs wait in a repository's queue, through an [HTTP credential](/platform/automations/http) whose base URL is `https://api.github.com`, and reports that number on the gate `ci`:

```yaml
nodes:
  - id: queue
    type: http.get
    credential: GitHub API
    input:
      url: /repos/tale-project/tale/actions/runs
      query: { status: queued, per_page: 1 }
  - id: report
    type: task.report_gate
    input:
      projectId: <the project's ID>
      key: ci
      value: '{{ nodes.queue.output.body.total_count }}'
      reason: '{{ nodes.queue.output.body.total_count }} workflow runs queued'
```

Install the automation in the project and give it a [schedule](/platform/automations/triggers#set-a-schedule) such as `*/5 * * * *`. Report at every occurrence, not only when the signal changes: a gate nobody reports on within its **Stale after (seconds)** opens again, or holds.

| Input       | What it holds                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId` | The project whose dispatch declares the gate. The automation must be installed in it, and the project must not be archived.          |
| `key`       | The gate's key, as the dispatch declares it.                                                                                          |
| `state`     | `hold` or `open`.                                                                                                                     |
| `value`     | Instead of `state`, a number for a gate with **Hold at**: at or above it the gate holds, and once held it opens only below **Open again below**. |
| `reason`    | Up to 500 characters, shown with the gate's last report.                                                                              |

A run a schedule or an event started reports as the automation installed in the project. A run a person started, with **Run now** or through the API, reports only while that person may edit the project. The step returns `{ projectId, key, held, changed, value, reason, reportedBy }`: `held` is the gate's state after the report, `changed` says whether the report changed it, and `reportedBy` is `run:` followed by the run's ID. The gate keeps that name as its reporter, so its last report leads to the run and its automation. The report counts as any other: it starts the gate's stale window again, and a report that opens the gate lets the work it held start at once.

## When a step fails

| Failure                                       | What happened                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **The task's project isn't the automation's** | The automation isn't installed in the project, or the run was started in another project.                           |
| **The task's project isn't the automation's**, on a gate report | The project is archived, the run was started by a person who may not edit the project, or by nobody who may report on its gates. |
| **The service failed**, on a gate report | The dispatch declares no gate of that key (`DISPATCH_GATE_UNKNOWN`), or the step sent a `value` to a gate without **Hold at** (`DISPATCH_GATE_VALUE_UNJUDGED`). |
| **The task's assignee isn't known**           | No member of the organization and no agent of the project answers to the name, or they may not work in the project. |

Nothing the step began stays written when it fails.
