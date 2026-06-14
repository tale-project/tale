---
title: Workforce operations
description: Runbook for the task-ops automation pack — rollout waves, the kill switch, symptom→action table, and where to look when agent automation misbehaves.
---

This is the operator's page for the AI-workforce automation. The product surfaces live in the app (**Agents → Workforce** is the operational home); this page covers rollout, the kill switch, and diagnosis.

## Rollout waves

The pack provisions per organization with sticky opt-outs (org edits always win; a re-run never re-activates triggers an admin disabled):

1. **Wave 0 — dogfood**: enable for an internal organization (`provisioning/provision_task_ops_pack` with activation), watch the Workforce health strip for a week. Exit: zero unacknowledged automation failures.
2. **Wave 1 — provisioned, off**: all organizations receive the pack inactive; admins self-serve via the Workforce master toggle. Exit: health strip clean for 72 h across enabled orgs.
3. **Wave 2 — default on**: enable by default for organizations that never toggled.

## The kill switch

**Time to quiet: under two minutes.** Switching the master toggle off (Agents → Workforce, admin-only, audited) — or running the `workflows/ops/disable_task_ops_pack` operation — does two things: deactivates every pack trigger row (the scheduler stops scanning them) and gates the run path itself (`task_automation` policy), so even an already-queued event refuses to start agent work. In-flight runs finish; nothing new starts.

Verification: the Workforce page shows automation **off**; new task assignments produce no acknowledgment comment; `[TaskOpsKillSwitch]` appears in the backend logs.

## Symptom → action

| Symptom                                     | Likely cause                                  | Action                                                                            |
| ------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Tasks assigned to agents do nothing         | Automation off, or pack triggers inactive     | Workforce toggle; Automations → check `tasks/…` triggers are active               |
| Work stuck _In progress_ > 24 h             | Agent run died; stale sweep will roll it back | Check the task's run history; the hourly sweep returns it to _To do_              |
| Agent refuses every run                     | Budget pause or circuit breaker               | Workforce → needs-attention queues; raise budget or change task status as a human |
| Reviews pile up                             | Reviewers missing the inbox                   | Review reminders escalate at 4 h / 24 h automatically; check Inbox preferences    |
| External runs always fail `runtime_offline` | No daemon online for the adapter              | Settings → API → Runtimes: daemon status; `tale-daemon status` on the machine     |
| Digest reports `capped` numbers             | Very high activity day hit a scan cap         | Numbers are lower bounds; no action needed                                        |

## Where to look

- **Logs**: stable bracket prefixes — `[AgentTaskRun]`, `[ExternalRuns]`, `[WorkforceRollup]`, `[TaskOpsKillSwitch]`, `[RetentionCleanup]` — with key=value fields. Prompt bodies are never logged.
- **Per-task trace**: the task sheet's run history links each run to its automation execution.
- **Data lifecycle**: run records honor the `agentRuns` retention category (default 180 days, org-tunable 30–400); aggregates are pruned at a fixed 400 days; review decisions survive subject erasure pseudonymized.
