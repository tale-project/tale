---
title: Sandboxes
description: Set concurrent workload limits and compare organization allocations with actual sandbox runtime and host capacity.
---

Sandboxes shows how much work your organization may start and how much infrastructure is currently occupied. Open **Settings > Sandboxes** to change workload limits as an Admin or Owner; Developers can read the limits and aggregate capacity without seeing private workspace details.

<Frame caption="Compare saved organization limits with observed runtime slots and host capacity. Unavailable usage stays explicit when the host does not expose a measurement.">

![The Sandboxes settings page shows the three editable organization limits, actual runtime slot counts, and measured host CPU and memory totals.](/images/platform/settings-sandboxes.webp)

</Frame>

## Set concurrent workload limits

Change a limit and click **Save** in the settings header. **Discard** restores your saved values. Each limit accepts a whole number from 1 to 500; the saved value controls future admissions. Lowering a limit does not interrupt work already running.

| Workload | Default | What consumes an allocation |
| --- | --- | --- |
| Project agent sessions | 2 | An agent workspace starting or doing work; the same agent reuses it across tasks. |
| Workflow sessions | 4 | A workflow run's workspace, shared across its agent and script steps. |
| Render sessions | 4 | Temporary environments that render web pages during crawling. |

**Allocated** compares occupied organization slots with the saved limit. If allocation data cannot be read, the inputs stay unavailable rather than presenting editable defaults.

## Read actual capacity

**Infrastructure capacity** refreshes every 15 seconds. Use **Refresh** for another observation. Its numbers describe a different boundary from the organization limits:

| Measurement | Meaning |
| --- | --- |
| Host session slots | Running and starting environments across organizations, against the deployment's runtime ceiling. Kubernetes shows namespace slots instead. |
| Your organization's runtime slots | This organization's running and starting environments across all workload types, against its deployment ceiling. |
| Host CPU usage | Recently used CPU cores and total cores, including other services on the host. |
| Host memory usage | Used and total memory in GiB, including other services and accounting for reclaimable cache. |

The observation time tells you when the data was collected. CPU needs two recent samples; a new observation after a long gap may show unavailable usage. Remote hosts can expose totals without usage, and Kubernetes namespace access does not expose host resource measurements. A failed observation shows **Unavailable**, never zero.

## Understand workspace allocation

Admins and Owners also see **Workspaces**, including the agent or workflow owner and its current operation. A released allocation can still have a running environment: work finished and freed the organization slot, while the container stays ready until its idle cleanup. Runtime status and allocation status therefore appear separately.

Crawler environments are temporary. Their use appears in the capacity counts, even when there is no standing workspace row.

## Decide which limit to change

Raise an organization limit when that workload's allocations are full and the deployment has room. A higher limit adds no CPU or memory, and a free runtime slot does not guarantee enough resources to start more work. Deployment operators control the runtime ceilings; self-hosted operators can find them in the [environment reference](/self-hosted/configuration/environment-reference#sandbox-infrastructure). Token and spending budgets remain under [Policies and limits](/platform/admin/governance/policies-and-limits).
