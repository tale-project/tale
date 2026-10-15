---
title: Keep agents busy with dispatch
description: Let Tale start a project's ready tasks on idle agents, run standing roles on a schedule, serve other projects' boards, hold work behind outside signals, and see why an agent is idle.
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
| **Runs at once**                                   | The most runs the pool holds at the same time, from 1 to 500. Runs that people, automations and standing roles start on the pool's agents count too; a standing role still starts on its schedule when the pool is full. |
| **Runs per agent**                                 | The most runs one agent of the pool holds at once, 1 by default and never more than **Runs at once**. Each run works in an [agent worker](/platform/projects/project-agents#run-one-agent-on-several-tasks) of its own. |
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
3. leaves an agent alone while the AI model it uses is [at capacity](/platform/projects/task-automation#handle-waiting-and-failed-runs), and starts work on that model in waves once it answers again;
4. asks the sandbox host before each start, and stops when the host is busy;
5. starts the best-ranked ready task — on this project's board or on a board it [serves](#sources) — on its own idle agent.

Every start passes the same checks as a start from the board: a task with an open blocker waits, a task takes at most three automated starts an hour, and a task runs once at a time. A run dispatch started reads **Started by dispatch** in the task's timeline and answers to the project, not to a person.

Each agent run needs an agent worker. When the pool can hold more runs at once than your organization has agent workers, **Dispatch** says so: the extra runs would only wait for a free worker. Owners and Admins raise the limit in [Sandboxes](/platform/admin/sandboxes#identify-the-limit-that-matters).

## Run one agent on hundreds of tasks {#limits}

Dispatch can keep one agent busy on as many tasks at once as your organization may have agent workers: up to 500. To run the agent Coder on 256 tasks at once, put Coder alone in the pool, set **Runs at once** and **Runs per agent** to 256, and give your organization at least 256 **Agent workers** in [Sandboxes](/platform/admin/sandboxes#identify-the-limit-that-matters), within what the deployment can run. Each run still works in a worker and workspace of its own.

| Setting                                            | Allowed values                                         |
| -------------------------------------------------- | ------------------------------------------------------ |
| **Runs at once**                                   | 1 to 500                                               |
| **Runs per agent**                                 | 1 to 500, never more than **Runs at once**; 1 by default |
| **Agents in the pool**                             | Up to 50                                               |
| **Only tasks labelled** / **Never tasks labelled** | Up to 20 labels each                                   |
| **Time between starts (seconds)**                  | 0 to 3,600; 30 by default                              |
| **Ask a busy host again after (seconds)**          | 1 to 10 delays, each from 10 to 3,600                  |
| **Standing roles**                                 | Up to 20                                               |
| **Gates**                                          | Up to 10                                               |
| **Boards it serves**                               | Up to 20 other projects                                |
| **Reviewers**                                      | Up to 10 agents                                        |

A save that lets one agent hold more runs than **Runs at once** is refused under **Runs per agent**. A dispatch saved before that rule keeps working as it is; the next save corrects it.

How fast a large pool fills depends on **Time between starts (seconds)**. With a time set, each pass starts one task and the next pass comes that much later, so the 256th run starts 255 times that time after the first: 2 hours 7 minutes 30 seconds at the default 30 seconds, 21 minutes 15 seconds at 5. With 0, a pass starts every ready task the sandbox host admits, for at most two minutes, and the next pass carries on at once; when the host is busy, its recheck delays slow the start. A pass reads up to 500 ready tasks, enough to fill the largest pool.

When an AI model answers again after it was at capacity, the runs waiting for it start in waves 15 seconds apart: one run, then two, then four, and so on, up to a sixteenth of them at a time. Even 256 waiting runs have all started within five minutes. New work dispatch starts on that model ramps up the same way, so the ready work it held back while the model was at capacity does not reach the model at once: one run as soon as the model answers, two more 15 seconds later, then four, eight and sixteen, and from then on up to 32 every 15 seconds, counting every run started on the model since it answered, whoever started it. A pool of 256 on that model fills within three minutes; after five minutes the ramp is over. A **Time between starts (seconds)** slower than the ramp still applies.

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

## Serve other projects' boards {#sources}

One project's dispatch can work the boards of other projects of your organization. A Development project, for example, keeps a pool of coding agents that takes the ready work arriving on the boards of the Website, Billing and Mobile app projects. These other projects are the dispatch's sources. Declare them in the managed resource `project-dispatch` or with the [settings tools](/develop/mcp-settings): each source names the project's ID and, if you like, the columns its ready work comes from (the dispatch's own unless you set them) and that project's labels to take or leave out. **Edit** keeps the sources as they are; it does not change them.

While a dispatch serves a project:

- that project's ready work joins the dispatch's own in one order — column, priority, place on the board, age — and each agent's runs on every board count towards **Runs per agent** and **Runs at once**;
- the agents of the pool, of the standing roles and the reviewers may be assigned that project's tasks and started on them, and they find, read, comment on, move and review those tasks with their task tools, as granted. They create no task there, start no other agent there and read nothing else of that project. That project's board shows them by name, and its assignee and reviewer lists offer them, marked with the project whose dispatch they come from; a mention there does not reach them;
- a run on one of its tasks belongs to that task: it shows on that project's board and in the task's history, for the people who read that project. The agent reads both projects' instructions: the board's project decides how its tasks are written, labelled, moved, reviewed and reported, and the agent's own project how the agent works;
- a run a person starts there — with **Start agent**, a comment or a move to **In progress** — gets the agent's secrets, credentials and standing workspace only when that person may edit both that project and the dispatch's own. Anyone else's run works on its own task alone, in a workspace of their own, without the agent's secrets. A run's task tools reach only the boards its starter may edit; a run the dispatch started reaches every board it serves.

To someone who cannot open one of these projects, the **Dispatch** page lists it as **A project you cannot open** and counts the runs on its board without listing them, and an assignee list marks the agents it sends only as **From another project's dispatch**.

Adding a source, or changing one, needs the right to edit that project, besides administering the dispatch's own project. A source kept as it is needs no such check, and switching dispatch off is never refused because of the projects it serves. Tale checks that right again at every pass, every start and every tool call, for whoever last saved the dispatch: a project that was deleted or archived, or that this person can no longer edit, is skipped. Dispatch then takes nothing from it, and its agents can no longer act on its tasks, until someone who may edit it saves the dispatch again. For such a person, **Edit** says so and offers **Save** even without a change, and applying an unchanged declaration with the CLI saves the dispatch again. Its tasks stay assigned to those agents until someone reassigns them, but **Start agent** on one of them is refused, and neither a move to **In progress**, a retry nor a comment starts them there. Deleting one of the dispatch's agents, or the dispatch's project, removes that agent from the tasks it holds on every board. **Boards it serves** on the **Dispatch** page shows each source as **Served** or skipped, and why. The **Dispatch** tab of a project another dispatch serves says so, with a link to that dispatch — whether or not the project has a dispatch of its own.

Switched off, a dispatch serves none of these projects, whoever last saved it: their boards no longer offer its agents, nothing starts its agents there, their runs on those boards can no longer act, and the dispatch routes no review, on its own board either. The **Dispatch** tab of each project it lists still names it, marked **switched off**. Switched on again, it serves each project as Tale judges it then.

### Review what the pool produced {#reviewers}

The dispatch's **Reviewers** are agents of its own project, granted [task review](/platform/projects/task-automation#agent-review), that review what its pool produced on every board it serves. When an agent of the pool finishes a task, the review goes to the reviewer the task names, if it names one. Otherwise it goes to the first of the dispatch's reviewers that did not produce the work, before the project's default reviewer. A reviewer never reviews its own work.

## Read why an agent is idle

**Agents** lists each agent of the pool with the runs it works on, and why it is idle when it has none:

| Idle because                     | Meaning                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Its model is at capacity**     | The provider called the agent's model at capacity; the agent takes work again once the model answers. |
| **The sandbox host is busy**     | The host held the last start; dispatch asks again after its delays.                                   |
| **All agent workers are in use** | Every agent worker of your organization is busy.                                                      |
| **Waiting between starts**       | The next start waits for the time between starts, for the next wave of a model that answered again, or for the next pass, which follows at once when a pass ran out of time. |
| **A gate holds the ready work**  | The work left for this agent is held by a gate.                                                       |
| **No ready work**                | No task in the chosen columns is ready for this agent.                                                |
| **Dispatch is off**              | Dispatch, or task automation for your organization, is switched off.                                  |
| **No pass yet**                  | Dispatch has not made a pass since the agent joined the pool.                                         |

A run on a board the dispatch serves names that board's project beside its task. An agent that holds more than five runs shows how many it holds — **Running**, **Queued**, and each reason its runs wait, such as **Waiting for model capacity** — and its first five runs, the oldest first. A button such as **Show 45 more runs** lists up to 50 of them; past that, the page says how many more are not listed here. The [REST API](/develop/api-reference#dispatch) counts and lists them the same way.

**Recent passes** shows the last 20 passes: when, what asked for them, how many runs they started and held, and why they stopped. **Run a pass now** asks for one at once. A self-hosted deployment can alert when a dispatch stops passing; [Prometheus and Grafana](/self-hosted/operate/observability/prometheus-grafana) shows the rule.

## Manage dispatch as configuration

A deployment that keeps its configuration in a repository declares a project's dispatch as the managed resource `project-dispatch`, applied with the [Tale CLI](/self-hosted/install/cli-install#configure-the-platform) like other [managed settings](/develop/mcp-settings). What it declares is what **Edit** shows; a change in the app is overwritten at the next apply. Before the CLI writes anything of a declaration, it asks Tale whether the declared dispatch would be saved. A dispatch that names an agent, a task, a label or a schedule the project cannot use, a reviewer without task review, or a source the declaring key may not edit stops the plan at that field, and nothing of the declaration is applied, not even the schedules it would switch off. The same declaration may create the project, its agents, standing tasks and labels: the check counts what it creates, and the dispatch is written once they exist.
