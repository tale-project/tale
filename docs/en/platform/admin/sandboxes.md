---
title: Sandboxes
description: Set concurrent workload limits and compare organization allocations with actual sandbox runtime and host capacity.
---

Sandboxes shows how much work your organization may start and how much infrastructure is currently occupied. Open **Settings > Sandboxes** to change workload limits as an Admin or Owner; Developers can read the limits and aggregate capacity without seeing private workspace details.

<Frame caption="The three workload limits add up automatically. Their total must fit within the deployment capacity.">

![The Organization limits section shows three editable session limits and their calculated total against the deployment capacity.](/images/platform/settings-sandboxes.webp)

</Frame>

## Set concurrent workload limits

Change a limit and click **Save** in the settings header. **Discard** restores your saved values. Each limit accepts a whole number from 1 to 500; the saved value controls future admissions. Lowering a limit does not interrupt work already running.

**Total organization sessions** updates as you edit and compares the sum of the three limits with deployment capacity. The defaults add up to **2 + 2 + 2 = 6**. With deployment capacity at 8, a total of 8 is allowed; 9 blocks saving and asks you to reduce a limit. The server checks the current deployment capacity again when you save. If capacity is unavailable, you can still lower limits; refresh the infrastructure data before raising one. If the operator lowers capacity below your saved total, reduce the limits before saving again.

| Workload | Default | What consumes an allocation |
| --- | --- | --- |
| Project agent sessions | 2 | An agent workspace starting or doing work; the same agent reuses it across tasks. |
| Workflow sessions | 2 | A workflow run's workspace, shared across its agent and script steps. |
| Render sessions | 2 | Temporary environments that render web pages during crawling. |

One workflow run uses one sandbox for its agent and sandbox script steps. Concurrent runs each use their own sandbox and workflow allocation, even when they execute the same workflow.

**Allocated** compares occupied organization slots with the saved limit. If allocation data cannot be read, the inputs stay unavailable rather than presenting editable defaults.

## Read actual capacity

**Infrastructure capacity** refreshes every 15 seconds. Use **Refresh** for another observation. Its numbers describe a different boundary from the organization limits:

<Frame caption="Deployment sandboxes shows the shared count and capacity. Your organization's sandboxes shows its current count, including idle environments kept for reuse.">

![The Infrastructure capacity section shows deployment sandboxes as a current count and capacity, the organization's sandbox count, and measured host CPU and memory.](/images/platform/sandbox-infrastructure-capacity.webp)

</Frame>

| Measurement | Meaning |
| --- | --- |
| Deployment sandboxes | Running and starting environments across all organizations / deployment capacity. Kubernetes shows **Deployment sandboxes (namespace)**. |
| Your organization's sandboxes | This organization's running and starting environments across all workload types, including idle environments kept for reuse. This is a count with no separate organization runtime ceiling. |
| Host CPU usage | Recently used CPU cores and total cores, including other services on the host. |
| Host memory usage | Used and total memory in GiB, including other services and accounting for reclaimable cache. |

The observation time tells you when the data was collected. CPU needs two recent samples; a new observation after a long gap may show unavailable usage. Remote hosts can expose totals without usage, and Kubernetes namespace access does not expose host resource measurements. A failed observation shows **Unavailable**, never zero.

## Understand workspace allocation

Admins and Owners also see **Workspaces**. Each row names the agent or workflow run that owns the workspace, its runtime and allocation status, and every task running in it. A project agent runs its tasks concurrently in the one workspace it owns, so a single row can list several tasks while the organization limit counts one session. **Spend** adds up the metered cost of the workspace's finished turns; a turn still running is added when it ends. A released allocation can still have a running environment: work finished and freed the organization slot, while the container stays ready until its idle cleanup. Runtime status and allocation status therefore appear separately.

When deployment capacity is full, Tale can stop an unpinned idle environment whose allocation has been released to make room for new work. Its persistent workspace files remain available for the next start. This only applies when the environment confirms it has no ongoing work; pinned, busy or unresponsive environments are protected from this reclamation. If no safe candidate exists, new work still needs capacity to become available.

Crawler environments are temporary. Their use appears in the capacity counts, even when there is no standing workspace row.

## Decide which limit to change

Raise an organization limit when that workload's allocations are full and its new total fits the deployment capacity. Other organizations share that capacity; your limits do not reserve containers, CPU or memory. A free place does not guarantee enough resources to start more work. Deployment operators control the shared capacity; self-hosted operators can find the setting in the [environment reference](/self-hosted/configuration/environment-reference#sandbox-infrastructure). Token and spending budgets remain under [Policies and limits](/platform/admin/governance/policies-and-limits).
