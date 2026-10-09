# Metrics — boxes a spec took over

Rows for [`metrics`](../../suites/metrics.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [metrics](../../suites/metrics.md) | Historical end-of-day status, WIP, overdue and stale counts exclude archive intervals after later restores; today's archive/restore, repeated cycles and UTC-midnight boundaries preserve earlier days. Archive/restore activity shares the bounded event scan and every day is explicitly capped when that history overflows. | ✅ unit + real Postgres | `backend/domains/tasks/metrics.test.ts`, `backend/domains/tasks/metrics.integration.ts` (`checkProjectTaskMetrics`) |
