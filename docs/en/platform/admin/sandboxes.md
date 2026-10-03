---
title: Manage sandbox capacity
description: Adjust concurrent workload limits, interpret infrastructure measurements and investigate work waiting for a sandbox.
---

Open **Settings > Sandboxes** when agent work or crawling cannot obtain an execution environment. The page separates your organization’s workload limits from the deployment’s actual infrastructure. Owners and Admins can change limits and decide when unused workspaces are deleted; Developers can read limits and aggregate capacity, without the private workspace list.

## Identify the limit that matters

| Workload | Default | What uses a slot |
| --- | --- | --- |
| **Project agent sessions** | 2 | An agent workspace starting or doing work. The agent reuses its workspace across tasks. |
| **Workflow sessions** | 2 | A workflow run’s sandbox, shared by its sandbox work. Concurrent runs use separate slots. |
| **Render sessions** | 2 | A temporary sandbox rendering pages during website crawling. |

These are concurrency limits, not a count of tasks or a spending budget. An agent can work on several tasks in its one workspace. Limits do not reserve infrastructure for the organization; all organizations share the deployment capacity.

<Frame caption="The three workload limits add up automatically. Their total must fit within the deployment capacity.">

![The Organization limits section shows three editable session limits and their calculated total against the deployment capacity.](/images/platform/settings-sandboxes.webp)

</Frame>

## Change a workload limit

1. Check the workload’s **Allocated** count and the infrastructure measurements below it.
2. Enter a whole number from 1 to 500 for the relevant limit. **Total organization sessions** recalculates the sum of all three fields.
3. Keep that total within deployment capacity, then select **Save** in the header. **Discard** restores the saved values.
4. Reopen the page to confirm the saved limits and inspect whether new work can obtain an allocation.

For example, the defaults total 6. If deployment capacity is 8, a total of 8 is valid and 9 is refused. The server rechecks capacity when saving, so another observation may differ from the one you first saw. Your organization's connected [devices](/platform/admin/sandbox-devices) add the sandboxes they run to the ceiling: with one device that runs 4, the total may reach 12.

Lowering a limit affects future admissions; it does not interrupt active work. If infrastructure data is unavailable, reductions remain possible but increases need a fresh capacity observation. If the operator lowered capacity below your existing total, reduce your limits before saving again. If organization allocation data itself cannot load, the fields remain unavailable instead of showing editable defaults.

## Read the infrastructure measurements

<Frame caption="Deployment sandboxes shows the shared count and capacity. Your organization's sandboxes shows its current count, including idle environments kept for reuse.">

![The Infrastructure capacity section shows deployment sandboxes as a current count and capacity, the organization's sandbox count, and measured host CPU and memory.](/images/platform/sandbox-infrastructure-capacity.webp)

</Frame>

| Measurement | What it means |
| --- | --- |
| **Deployment sandboxes** | Running and starting environments across all organizations, compared with shared capacity. Kubernetes reports the namespace boundary. |
| **Your organization's sandboxes** | This organization’s running and starting environments, including idle ones kept for reuse. This is a count, not another organization limit. |
| **Host CPU usage** | Recently used and total CPU cores for the host, including its other services. |
| **Host memory usage** | Used and total host memory, including other services and allowing for reclaimable cache. |

Measurements refresh every 15 seconds; **Refresh** requests a new observation. Check its timestamp before interpreting it. CPU usage is the change between two samples; a first observation after a long gap takes about a second longer. Remote hosts may expose totals without usage. Kubernetes namespace access does not expose host measurements. **Unavailable** means unknown, not zero.

## Explain an allocated or idle workspace

Owners and Admins can inspect **Workspaces**. A row identifies its agent or workflow run, runtime state, allocation state and running tasks. These states answer different questions: a container may remain running for reuse after it has released its organization slot. A project agent’s workspace stays listed while the agent is idle, as **Stopped** with **Quota released**, until you destroy it or Tale deletes it: when nobody has used it for [the number of days your organization sets](#delete-unused-workspaces-automatically), or when [its agent, project or member is removed](#explain-why-a-workspace-disappeared). Once the agent itself is deleted, the row reads **Deleted agent** until Tale has deleted the workspace. A workflow run’s workspace is reclaimed shortly after the run ends.

**Spend** adds the metered cost of finished turns. A turn still running is included when it ends. Temporary crawler environments appear in capacity counts even without a standing workspace row.

When deployment capacity is full, Tale may reclaim an unpinned idle environment whose allocation is released and which confirms it has no ongoing work. Its persistent workspace files remain for the next start. Busy, pinned or unresponsive environments are not candidates. If there is no safe candidate, new work must wait for capacity. An environment whose task or run has finished stops after a few idle minutes, so its room frees soon after the work ends. An agent environment that runs Docker inside keeps its full idle time, so the next turn does not have to pull its images again.

## Manage an existing workspace

Owners and Admins can use a workspace’s row menu:

| Action | Effect |
| --- | --- |
| **Stop task** | Cancels all currently running operations in that workspace. Check the listed tasks first; one agent may have several. |
| **Pin** / **Unpin** | Keeps the workspace exempt from automatic idle and expiry cleanup and from deletion for being unused, or restores normal cleanup. A pinned allocation can continue holding capacity. If a pinned workspace’s environment disappears, for example after a host restart, Tale starts it again with its workspace files, and the workspace stays pinned. |
| **Destroy** | Asks for confirmation, then removes the sandbox and its workspace files in the background: it unpins the workspace first and cancels running work. Until the workspace is gone, its row reads **Destroying** and you can go on using the page. If Tale still cannot remove it after several attempts, the workspace remains listed, unpinned, and reads **Destroy failed**; choose **Destroy** again to finish removing it. While the row reads **Destroying**, nothing new starts in that workspace: an agent's run waits and reads **Waiting for a sandbox slot**, and a workflow run's step that needs the workspace fails at once with the reason, without waiting or trying again, because the files its earlier steps left are being deleted. Once the row is gone, the next start creates a fresh environment; if it reads **Destroy failed** instead, the waiting work continues in the old files. |

Use stop when the current work should end but its files should remain. Before destruction, preserve outputs you still need and read the confirmation. Idle capacity reclamation preserves workspace files; explicit destruction and automatic deletion do not.

## Delete unused workspaces automatically

A project agent keeps its files between runs in workspaces: the one it reuses across tasks, and a separate one for each Member who [starts its runs](/platform/projects/tasks#agent-runs-a-member-starts). Tale deletes a workspace that nobody has used for the number of days your organization sets; **Destroy** still deletes one at once. Owners and Admins set this rule under **Workspace cleanup**, above **Workspaces**. Developers don't see that section.

<Frame caption="With Delete unused workspaces on, a workspace nobody has used for the set number of days is deleted. Pinned workspaces are kept.">

![The Workspace cleanup section shows the Delete unused workspaces switch turned on and Days without use set to 30, each with an explanation of what it does.](/images/platform/sandbox-workspace-cleanup.webp)

</Frame>

1. Keep **Delete unused workspaces** switched on, as it is by default. While it is off, Tale deletes no workspace for being unused.
2. Enter **Days without use**, a whole number from 1 to 3650; the default is 30. The days count from the last time the agent worked in the workspace, or from when it was unpinned.
3. Select **Save** in the header. **Discard** restores the saved values.

A change never makes a workspace go early. After you switch deletion on or shorten the period, no workspace is deleted for being unused until the full number of days has passed since the change. The same wait follows the update that introduced the setting. Lengthening the period doesn't restart the wait; switching deletion off and on again does.

In **Workspaces**, a stopped agent workspace shows the day it will be deleted under its status: **Deleted on … unless used again**. A new run in the workspace starts the count again. A pinned workspace, or one a [legal hold](/platform/admin/governance/legal-hold) keeps, shows no date and is never deleted for being unused.

## Explain why a workspace disappeared

Besides deleting unused workspaces, Tale deletes a workspace when what it belongs to is removed, whatever the cleanup setting says:

- Deleting a project agent deletes all its workspaces, including each Member's. Deleting a project does the same for every agent in it.
- [Removing a member](/platform/admin/members-and-roles#remove-or-recover-access) from the organization deletes their own workspaces with every agent. Setting the member to **Disabled** instead keeps them.
- [Erasing a person's data](/platform/admin/governance/data-subject-requests) deletes their own workspaces without waiting for work running in them.
- Deleting the organization deletes all its sandboxes and their files, revokes the gateway keys issued to them, disconnects its [devices](/platform/admin/sandbox-devices) and removes the build and package caches kept for it.

This happens within about a minute, or after the task ends if one is still running in the workspace. A pinned workspace goes too, but a [legal hold](/platform/admin/governance/legal-hold) keeps every workspace it covers: a hold on the organization keeps all of them, and a hold on a person keeps that person's own workspaces. An hourly cleanup also deletes leftovers that nothing owns any more, such as a workflow run's workspace that was never reclaimed.

Every workspace Tale deletes on its own, for one of these reasons or for being unused, appears in the [audit log](/platform/admin/governance/audit-logs) under **Settings > Governance > Logs** as **Sandbox workspace deleted**. It is a system event in the **Data** category, and its metadata names the reason: `agent_deleted`, `member_removed`, `member_erased`, `unused` or `orphaned`.

## Resolve a blocked start

A start that finds no room waits, and needs nothing from you. When your organization's limits are in use, or the deployment is full or short of memory or disk space, the work starts on its own once room frees. When the deployment itself is full, its room goes to the work that has waited longest, whichever organization it belongs to, and each waiting start is told when its turn comes:

- A task run waits in the queue. It is tried again as soon as a session ends, in your organization or in another one on the same deployment. When the deployment is full, it is also tried when its turn comes. Every two minutes, Tale also tries a few of each organization's waiting runs, the longest-waiting first.
- An automation's agent step tries again without using up its retries: when its turn comes if the deployment is full, otherwise after a pause that grows while the step keeps waiting, up to about two minutes. The run shows **Waiting for a sandbox slot** meanwhile. After two hours without room, the run fails with that reason. A workspace an administrator is destroying is no lack of room: the step fails at once instead, as described for **Destroy** above.
- Crawling waits for its turn, then continues with its next batch.

Raise a workload limit only when its allocations are full and the new total fits shared capacity. If the deployment itself is full, increasing an organization limit cannot create infrastructure. To add capacity of your own, [connect a device](/platform/admin/sandbox-devices): new workspaces start on it. Otherwise, ask the operator to inspect capacity and host resources; a free container slot alone does not guarantee enough CPU, memory or disk space.

For a credential or model refusal, use [AI providers](/platform/admin/providers). For a spending refusal, use [Policies and limits](/platform/admin/governance/policies-and-limits). Self-hosted operators can inspect the deployment setting in the [environment reference](/self-hosted/configuration/environment-reference#sandbox-infrastructure).
