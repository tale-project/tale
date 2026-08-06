---
title: Task automation
description: How assigning a board task to an agent runs it, the Driver/Reviewer split, human review straight from the In review status, guardrails, and the kill switch.
---

Assigning a board task to an AI agent puts it to work. The task's **assignee is its driver** — a person, a project agent, or an automation — and drives the board choreography; the **Reviewer** is the named human the finished work waits on. A task an automation proposes sits in [Backlog](/platform/projects/backlog) until a human starts it — from that moment on it's a board task like any other and enters the loop below.

<Frame caption="The project task board — assigning a card to an agent is what starts the loop below.">

![A kanban task board inside the Website relaunch project, showing seven task cards spread across its status columns, from Backlog and To do through In review to Done and Cancelled.](/images/platform/projects-task-board.webp)

</Frame>

## The execution loop

1. **Assign** a task to an agent. The card moves to _In progress_ and the agent works in its own sandbox session, with the task's description, comments, and input files as context.
2. The agent **reports back**: its result lands as a task comment (deliverables in the task's Output zone), and the task parks at **_In review_** — agents can never set _Done_; that rule is enforced server-side.
3. The park **requests a review**: the task's **Reviewer** gets an inbox bell and an email, and the task sheet shows the review card — _Waiting on {name}_. Without a designated reviewer the request lands with the task's creator (or the project's), so a finish is never silent.
4. A human **decides from the review card**: **Approve** completes the task — _Done_ is recorded as that person's decision, never the agent's. **Request changes** posts the feedback as a task comment and hands it straight back to the agent, which starts a rework run and parks the result at _In review_ again.

A failed run leaves the task where it was and explains itself on the task sheet; start the run again once the cause is fixed. A parent task with open subtasks refuses to close until the last subtask is done.

## Driver and Reviewer

The two roles are deliberately separate fields:

| Role         | Who                           | What it does                                                                                                             |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Assignee** | person, agent, or automation  | Drives the work and the board status — the polymorphic single assignee                                                   |
| **Reviewer** | a project member who can edit | The named "waiting on" human: gets the review request, populates the **Needs my review** filter, decides the review card |

Pick the reviewer in the task sheet's **Reviewer** field. The designation is deliberately **soft**: it routes notifications and the queue, but any project editor can still respond to a review — and unlike reassigning the driver, you can set or change the reviewer while a run is live. Reviewing this way never requires taking the task over: the agent or automation stays the assignee, so the choreography keeps working after the decision.

The board names the gate: cards waiting at _In review_ carry a **Waiting on {name}** chip (or _Waiting on you_), and the board's **Review** filter reduces the board to the tasks waiting on you — your personal review queue inside the project.

## Mentions

**@-mention an agent** in a task comment and it reads the mentioning text and acts. Typing `@` opens an autocomplete over members and the project's agents; the composer previews whether each mentioned agent will actually respond (automation off, breaker paused, not mentionable in this project). A mention of the task's **assignee** is treated as feedback on its assigned work: a running agent picks the comment up mid-run, an idle one starts a rework run carrying the comment verbatim.

## Guardrails

Every agent run — assignment, mention, review rework — passes the same admission gate:

- **One engine per task**: a task with a live run refuses a second one, and reassigning mid-run is refused outright (cancel first — the picker offers cancel-then-reassign).
- **Concurrency**: agent sessions draw from per-organization capacity; excess runs queue and start when a slot frees.
- **Per-task circuit breaker**: too many automated runs within an hour on one task pauses automation on that task until a human changes its status.

## Choosing an assignee

Not every task belongs on a coding harness. Use this rule of thumb:

| Task shape                                          | Assign                                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Research, writing, summaries, personal deliverables | A **person**                                                                                                                                   |
| Board work driven by a deployed automation          | An **Automation** — its desk then drives the board's status verbs, and review happens on the task's subject panel                              |
| Repository work — bugs, features, refactors, PRs    | An **Agent** on a coding [**Harness**](/platform/agents/harnesses) — create it on the project's Agents tab with the harness that fits the work |

The assignee picker groups **Agents** and **Automations**. Each agent runs in a sandbox on the **Harness** chosen when it was created, pre-equipped with its skills, connectors, and instructions.

## The kill switch

The `task_automation` governance policy carries the master switch: switching it off stops the run path — in-flight work finishes, nothing new starts. It is admin-only and audited; on a self-hosted instance the policy is one of the org's governance config files, alongside the limits covered on [Policies and limits](/platform/admin/governance/policies-and-limits).

## Where this fits

Task automation is what turns the project board from a to-do list into a delegation surface: a human assigns, a named human reviews, the agent runs everything in between — and _Done_ stays a human decision. The natural next read is [Backlog](/platform/projects/backlog) for how proposed work enters the loop.
