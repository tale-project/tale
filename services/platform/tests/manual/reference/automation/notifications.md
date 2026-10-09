# Notifications (bell) — boxes a spec took over

Rows for [`notifications`](../../suites/notifications.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [notifications](../../suites/notifications.md) | #4077 follow-ups: assignment → access loss → reassignment retains the unread row without revealing the new title or hinting the former reader; queued email refuses lost access on real SQL; disabled members and foreign teams confer no notification access; the overdue rung chooses the first readable creator; bell-lane failure closes both tails and deletes its project even when close fails | 🔶 unit + integration | `backend/domains/collab/service.test.ts`, `backend/domains/collab/notification-access.integration.ts`, `backend/domains/tasks/date-notifications.test.ts`, `backend/integration-bell-hint-wire.test.ts` |
| [notifications](../../suites/notifications.md) | The SMTP integration fixture counts every delivery to its nonce recipient and preference-off recipient, so duplicate owned mail still fails; an unrelated real notification queued after the initial drain is observed separately without changing the exact debounce, read/undo/preference and overdue deep-link verdicts. | 🔶 real Postgres + worker | `backend/integration-check.ts` (`checkNotificationEmailSink`) |
