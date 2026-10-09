# Settings — boxes a spec took over

Rows for [`settings`](../../suites/settings.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [settings](../../suites/settings.md) / [tasks](../../suites/tasks.md) | Sandbox CPU growth: cleanup matches retained executions through one set of per-round process indexes, preserving group and descendant ownership; failed runnerd output readers cancel and unlock before repeated attaches can accumulate producers; settings views visit each historical operation once and project only displayed operation details, with bounded progress tails and unchanged spend, running order and task ownership | 🔶 unit + real Postgres | `services/sandbox-runtime/daemon/src/process-reaper.test.ts`, `services/sandbox/src/session/runnerd-client.test.ts`, `backend/domains/sandbox/sessions.views.test.ts`, `checkSandboxSettingsViews` in `backend:integration`; sustained deployment CPU under real agent workloads remains an operator measurement |
| [settings](../../suites/settings.md) | Docker filesystem observation verifies the read-only data-root mount; inherited startup cancellation bounds cleanup; optional mounts and backend agent settings reach generated Compose | ✅ automated | `services/sandbox/src/docker-data-disk.test.ts`, `services/sandbox/src/spawn-util.test.ts`, `tools/cli/src/lib/compose/services/create-sandbox-service.test.ts`, `tools/cli/src/lib/compose/services/compose-parity.test.ts`; actual hard disk quotas remain storage-backend dependent |
