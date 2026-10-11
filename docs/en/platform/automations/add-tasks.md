---
title: Add tasks from an automation
description: Create a task in a project with the task.create step — its title, assignee, status, due date and labels — once each time the step runs, and know what is refused.
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

## When a step fails

| Failure                                       | What happened                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **The task's project isn't the automation's** | The automation isn't installed in the project, or the run was started in another project.                           |
| **The task's assignee isn't known**           | No member of the organization and no agent of the project answers to the name, or they may not work in the project. |

Nothing the step began stays written when it fails.
