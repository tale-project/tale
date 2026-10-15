---
title: Keep agents busy with dispatch
description: Let Tale start a project's ready tasks on idle agents, run standing roles on a schedule, hold work behind outside signals, and see why an agent is idle.
---

Dispatch starts a project's ready tasks on the agents you put in its pool, as soon as an agent is free, and starts standing roles — a manager's routing pass, a nightly check — on their schedules. Nobody has to start each run, and no automation or manager agent has to decide when an agent may start. Anyone who can read the project sees what dispatch does under **Dispatch** in the project; project administrators change it.

Dispatch decides when and where work starts. What is worth doing stays a person's or a manager agent's decision: set priorities, order the board and move tasks between columns, and dispatch takes the work in that order.

<Frame caption="The Dispatch tab shows whether dispatch is on, how many runs its pool holds, and why each agent of the pool is idle.">

![The Dispatch tab of the Website relaunch project: dispatch is off, no run is held, both agents of the pool are idle because dispatch is off, and no pass has run yet.](/images/platform/project-dispatch.webp)

</Frame>

## Choose what dispatch takes and who works on it

Open the project, choose **Dispatch**, then **Edit**, or **Set up dispatch** while the project has none.

| Setting                                            | What it decides                                                                                                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dispatch is on**                                 | Whether dispatch starts anything. Switched off, it starts nothing; runs already working continue.                                                                                                         |
| **Agents in the pool**                             | The project's agents dispatch starts. A task assigned to an agent outside the pool is never started by dispatch.                                                                                          |
| **Runs at once**                                   | The most runs the pool holds at the same time. Runs that people, automations and standing roles start on the pool's agents count too; a standing role still starts on its schedule when the pool is full. |
| **Runs per agent**                                 | The most runs one agent of the pool holds at once, 1 by default. Each run works in an [agent worker](/platform/projects/project-agents#run-one-agent-on-several-tasks) of its own.                        |
| **Take ready work from**                           | The columns ready work comes from, **To do**, **Backlog** or both, in the order you list them.                                                                                                            |
| **Unassigned tasks**                               | **Leave them alone**, or **Give them to the pool**: an unassigned task is then assigned to the idle agent with the most room.                                                                             |
| **Move tasks that never started to an idle agent** | Lets a task wait for a busy agent of the pool only until another agent is free. A task that already ran stays with its agent, so its conversation and files stay together.                                |
| **Only tasks labelled** / **Never tasks labelled** | Narrows ready work by label. A label the project does not have is refused when you save.                                                                                                                  |
| **Sandbox host**                                   | How carefully a start is admitted on the shared sandbox host: **Deployment's thresholds**, or **Conservative**, which also waits for load, memory and disk input/output pressure to ease.                 |
| **Time between starts (seconds)**                  | The least time between two starts, 30 seconds by default, so a host is not hit by many starts at once.                                                                                                    |
| **Ask a busy host again after (seconds)**          | When the host holds a start, dispatch asks again after these delays in turn, 60, 120 and 240 seconds by default, then keeps the last.                                                                     |

Ready work is ranked by column, then priority, then its place on the board, then age. A task is ready when it sits in a chosen column, is not archived, has no unfinished blocker and no run working on it.

## How dispatch starts work

Dispatch makes a pass whenever something changes: a run of the project ends, a model answers again, someone saves the dispatch or a gate opens, and at least once a minute. Each pass:

1. starts the standing roles that are due;
2. counts the runs the pool's agents hold, whoever started them;
3. leaves an agent alone while the AI model it uses is [at capacity](/platform/projects/task-automation#handle-waiting-and-failed-runs);
4. asks the sandbox host before each start, and stops when the host is busy;
5. starts the best-ranked ready task on its own idle agent.

Every start passes the same checks as a start from the board: a task with an open blocker waits, a task takes at most three automated starts an hour, and a task runs once at a time. A run dispatch started reads **Started by dispatch** in the task's timeline and answers to the project, not to a person.

Each agent run needs an agent worker. When the pool can hold more runs at once than your organization has agent workers, **Dispatch** says so: the extra runs would only wait for a free worker. Owners and Admins raise the limit in [Sandboxes](/platform/admin/sandboxes#identify-the-limit-that-matters).

## Run standing roles on a schedule

A standing role starts one agent on its own task on a schedule, for work that recurs: a manager agent that routes reviews every thirty minutes, a quality check every night. Add one under **Standing roles** in **Edit**:

| Field                                 | What it is                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------- |
| **Key**                               | A short name such as `manager`, used in the occurrence label.               |
| **Agent** and **Task**                | Who works, and the task that holds the role's instructions and history.     |
| **Schedule (cron)** and **Time zone** | A five-field cron expression, read in the time zone.                        |
| **Mode**                              | A word the agent receives with every occurrence, such as `full` or `light`. |
| **Brief**                             | What the agent addresses first on every occurrence.                         |

At each occurrence, dispatch moves the task to **In progress** and starts the agent with the brief, labelled with the occurrence in the role's time zone — for example `manager 2026-10-14 16:30 Europe/Zurich`. An occurrence that finds the role still working is folded into that run instead of starting a second one. After an outage, only the latest missed occurrence runs. Each occurrence is decided once, even if two passes meet it, and the role's task is never started as ready work.

## Hold work behind a gate

A gate holds the ready work it governs while a signal from outside says so — for example while your CI system's runner queue is full. Declare the gate under **Gates** in **Edit**: a **Key**, the **Labels it holds** (none holds all ready work), and either let a person hold and open it or let it judge a value with **Hold at** and **Open again below**. A held gate opens again only below the second value, half of the first unless you set it, so a signal near the threshold does not switch it back and forth.

An external system reports on the gate through the [REST API](/develop/api-reference#dispatch); project administrators can also **Hold** and **Open** it under **Gates**. A gate nobody reports on within **Stale after (seconds)**, ten minutes by default, opens again, or holds when **When stale** says **Hold**. **Time between its starts (seconds)** lets one start of the gate's work through, then the next only after that time. Standing roles are never held by a gate.

## Read why an agent is idle

**Agents** lists each agent of the pool with the runs it works on, and why it is idle when it has none:

| Idle because                     | Meaning                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Its model is at capacity**     | The provider called the agent's model at capacity; the agent takes work again once the model answers. |
| **The sandbox host is busy**     | The host held the last start; dispatch asks again after its delays.                                   |
| **All agent workers are in use** | Every agent worker of your organization is busy.                                                      |
| **Waiting between starts**       | The last pass started a run and waits for the time between starts.                                    |
| **A gate holds the ready work**  | The work left for this agent is held by a gate.                                                       |
| **No ready work**                | No task in the chosen columns is ready for this agent.                                                |
| **Dispatch is off**              | Dispatch, or task automation for your organization, is switched off.                                  |
| **No pass yet**                  | Dispatch has not made a pass since the agent joined the pool.                                         |

**Recent passes** shows the last 20 passes: when, what asked for them, how many runs they started and held, and why they stopped. **Run a pass now** asks for one at once. A self-hosted deployment can alert when a dispatch stops passing; [Prometheus and Grafana](/self-hosted/operate/observability/prometheus-grafana) shows the rule.

## Manage dispatch as configuration

A deployment that keeps its configuration in a repository declares a project's dispatch as the managed resource `project-dispatch`, applied with the [Tale CLI](/self-hosted/install/cli-install#configure-the-platform) like other [managed settings](/develop/mcp-settings). What it declares is what **Edit** shows; a change in the app is overwritten at the next apply. Before the CLI writes anything of a declaration, it asks Tale whether the declared dispatch would be saved. A dispatch that names an agent, a task, a label or a schedule the project cannot use stops the plan at that field, and nothing of the declaration is applied, not even the schedules it would switch off.
