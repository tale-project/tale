---
title: Manage sandbox capacity
description: Adjust concurrent workload limits, interpret infrastructure measurements and investigate work waiting for a sandbox.
---

Open **Settings > Sandboxes** when agent work or crawling cannot obtain an execution environment. The page separates your organization’s workload limits from the deployment’s actual infrastructure. Owners and Admins can change limits; Developers can read limits and aggregate capacity, without the private workspace list.

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

For example, the defaults total 6. If deployment capacity is 8, a total of 8 is valid and 9 is refused. The server rechecks capacity when saving, so another observation may differ from the one you first saw.

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

Measurements refresh every 15 seconds; **Refresh** requests a new observation. Check its timestamp before interpreting it. CPU usage needs two samples, and a first observation after a long gap can be unavailable. Remote hosts may expose totals without usage. Kubernetes namespace access does not expose host measurements. **Unavailable** means unknown, not zero.

## Explain an allocated or idle workspace

Owners and Admins can inspect **Workspaces**. A row identifies its agent or workflow run, runtime state, allocation state and running tasks. These states answer different questions: a container may remain running for reuse after it has released its organization slot.

**Spend** adds the metered cost of finished turns. A turn still running is included when it ends. Temporary crawler environments appear in capacity counts even without a standing workspace row.

When deployment capacity is full, Tale may reclaim an unpinned idle environment whose allocation is released and which confirms it has no ongoing work. Its persistent workspace files remain for the next start. Busy, pinned or unresponsive environments are not candidates. If there is no safe candidate, new work must wait for capacity.

## Manage an existing workspace

Owners and Admins can use a workspace’s row menu:

| Action | Effect |
| --- | --- |
| **Stop task** | Cancels all currently running operations in that workspace. Check the listed tasks first; one agent may have several. |
| **Pin** / **Unpin** | Keeps the workspace exempt from automatic idle and expiry cleanup, or restores normal cleanup. A pinned allocation can continue holding capacity. |
| **Destroy** | Asks for confirmation, cancels running work and removes the sandbox and its workspace files. The next agent start creates a fresh environment. |

Use stop when the current work should end but its files should remain. Before destruction, preserve outputs you still need and read the confirmation. Idle capacity reclamation preserves workspace files; explicit destruction does not.

## Resolve a blocked start

Raise a workload limit only when its allocations are full and the new total fits shared capacity. If the deployment itself is full, increasing an organization limit cannot create infrastructure. Ask the operator to inspect capacity and host resources; a free container slot alone does not guarantee enough CPU or memory.

For a credential or model refusal, use [AI providers](/platform/admin/providers). For a spending refusal, use [Policies and limits](/platform/admin/governance/policies-and-limits). Self-hosted operators can inspect the deployment setting in the [environment reference](/self-hosted/configuration/environment-reference#sandbox-infrastructure).
