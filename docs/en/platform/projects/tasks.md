---
title: Manage tasks on a project board
description: Create a task, name its owner, track progress, and review the result in one place.
---

A task keeps a piece of work together: its purpose, owner, status, files, and the conversation about the result. Use the project board for work a person will do as well as work you delegate to an agent. You need permission to edit the project to change its tasks.

<Frame caption="The board groups the same tasks by status. Switch to List when you prefer rows.">

![The Website relaunch project’s task board shows cards in Backlog, To do, In progress, In review, Done, and Cancelled.](/images/platform/projects-task-board.webp)

</Frame>

## Create a task with a clear result

1. Open the project’s **Tasks** tab and click **Create task**.
2. Write a **Title** that names the result, such as “Review the launch brief”.
3. Use **Description** to explain what is needed and how the result will be checked. Add supporting files under **Attachments** when the work depends on them.
4. Choose **Status**, **Priority**, and an **Assignee** as needed. New tasks default to **To do**; use **Backlog** for a proposal the team has not committed to.
5. Click **Create task**. Open the new card to continue adding details.

Tale gives the task an identifier built from the project key, such as `WEB-1`. Use that identifier when referring to the work so similarly named tasks remain distinguishable.

<Tip>

A useful description states the input, the requested output, and a check for completion. For example: “Compare the review date in the attached brief with the meeting notes. Comment with any mismatch and cite both files.”

</Tip>

<Frame caption="The task details keep the description, attachments, subtasks, and comments beside ownership and status.">

![The task Sign off the launch checklist shows its description area, attachments, subtasks, comments, status, assignee, reviewer, dates, labels, and dependencies.](/images/platform/project-task-detail.webp)

</Frame>

## Choose an owner and a reviewer

**Assignee** identifies who does the work: a person, a project agent, or an automation available to the project. **Reviewer** identifies the person to notify when an agent’s result needs review. Only members who can edit the project can be reviewers.

Assigning an agent and starting its run are separate choices. After assigning it, click **Start agent**, or move the task to **In progress**. Read [Task automation](/platform/projects/task-automation) before starting work that can use connected services or produce files.

The reviewer receives the review request, but the designation does not reserve the decision exclusively to that person. Another member with project edit access can also accept the result.

## Use statuses to communicate progress

Change **Status** in the task details, or drag a card to another column on **Board**. The status picker is the keyboard-accessible alternative to dragging.

| Status | Meaning |
| --- | --- |
| **Backlog** | Proposed work that has not been committed to. |
| **To do** | Work ready to be picked up. |
| **In progress** | Work is underway. Moving an agent-owned task here starts its run. |
| **In review** | A result is waiting for a person to check it. |
| **Done** | A person has accepted the completed work. |
| **Cancelled** | The work is no longer going ahead. |

For an agent-owned task, changing status can start or cancel execution. Read the action hint before moving it. An agent reports back at **In review**; it cannot mark its own work **Done**.

## Keep decisions with the work

Open the task to add a description, attachments, dates, labels, subtasks, or comments. Use comments for questions, decisions, and feedback that future reviewers need to understand.

Typing `@` in a comment opens the mention picker. A mention of an assigned agent is an instruction: it can steer a running agent or start another run when the agent is idle. A plain comment records the discussion without requesting that agent action.

Use **Subtasks** to split work that has separately checkable results. A parent task cannot close while its subtasks remain open. **Dependencies** shows which tasks block this task and which it blocks; circular dependencies are refused.

## Review the result before closing

For a human-owned task, compare the work with the description’s completion check. For agent work, read the report in the task’s comments and inspect any produced files. A finished run means the agent has stopped working, not that a person has accepted the result.

Move the task to **Done** when the result meets the requirement. If an agent needs to revise it, add specific feedback and mention that agent. [Task automation](/platform/projects/task-automation) explains retries, rework, and cancellation.

## Find work that needs attention

Use **Filter** to narrow the board, or switch to **List** to scan rows. Keep proposals in [Backlog](/platform/projects/backlog) until they are ready to start; use labels for distinctions that do not need another status.

If a change is refused, check the task’s current state before trying again: a live agent run blocks reassignment, open subtasks block closure, and project access determines whether you can edit at all.
