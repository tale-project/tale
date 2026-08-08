# Notifications (bell) — Manual Test Plan

> **Purpose**: Exercise the notification center (the **bell** in the app
> sidebar's footer + its popover panel). Review decisions happen in the task
> sheet (`TaskReviewCard`), not inline in the bell — the bell deep-links there.
> No automated spec covers this area — every case is manual-only. Mock-LLM mode
> is fine; review items come from a task flow that requests a review (see
> Prerequisites). Naming note: the user-facing **Inbox** is the Conversations
> page ([conversations.md](conversations.md)); the `inbox.*` i18n namespace
> cited here is the BELL's notification copy — an unfortunate name collision.

## Scope & routes

The bell has **no dedicated URL**. It is mounted in the app sidebar's footer
(`app/features/notifications/components/notification-bell.tsx`, rendered by
`app/components/layout/app-sidebar/sidebar-footer.tsx` since the unified
sidebar of #2799) and therefore appears on **every** `/dashboard/{org}/…`
route. Drive the panel from any dashboard page. One related route is concrete:

| Surface                         | Route                                        |
| ------------------------------- | -------------------------------------------- |
| Any dashboard page (hosts bell) | `/dashboard/{org}/chat`                      |
| Any dashboard page (hosts bell) | `/dashboard/{org}/projects`                  |
| Governance Trash (memory audit) | `/dashboard/{org}/settings/governance/trash` |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). The bell + empty states
need no seed data. To exercise **review** items (F7) and the **unread badge /
Mark-all-read** path (F1, F4), first generate a personal `task_review_requested`
notification: run a flow that requests a review (e.g. a chat write-op approval, or
a task review per [projects.md](projects.md)), then reopen the bell. A fresh
seeded org starts with an **empty** notification stream. F9–F11 need **two
member accounts in the same org** (mode A is fine): the actor is never notified
of their own action, so a single account cannot generate those rows.

> **Agent note**: ⛔ no e2e spec. The bell's accessible name is **Notifications**
> (`navigation.notifications`), NOT a `notifications.*` key. The unread **count
> badge is `aria-hidden`** (decorative) — the per-row `sr-only` "Unread"
> (`notifications.ariaUnread`) is the only announced unread signal. The panel's
> **default filter is _Unread_**, so the first empty state you see is
> **"You're all caught up"** (`notifications.emptyCaughtUpTitle`); the
> **All** tab shows **"No notifications yet"** (`notifications.emptyAllTitle`).
> **Mark all as read** (`notifications.markAllAsRead`) only renders when the
> unread count is > 0. The memory-proposal audit trail lives under Governance →
> **Trash** → the **Category** filter option **Memory audit**
> (`governance.trash.tab.memoryAudit`) — it is a filter option, not a tab, and
> only appears once memory-audit rows have been retention-trashed.

## Automated coverage

| Case(s) | Status         | e2e spec                                            |
| ------- | -------------- | --------------------------------------------------- |
| F1–F8   | ⛔ manual-only | —                                                   |
| F9–F11  | ⛔ manual-only | — (need two accounts in one org; mode A works)      |
| F12     | ⛔ manual-only | — (env-gated: cron/agent-driven, documentation row) |
| B1–B3   | ⛔ manual-only | —                                                   |
| A1–A3   | ⛔ manual-only | —                                                   |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).
There is **no** `notifications.spec.ts`; no other spec touches the bell/panel.

## Functional tests

| ID  | Test               | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Expected (verifiable)                                                                                                                                                                                                                                                     |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Unread badge       | Generate ≥1 unread notification, load any `/dashboard/{org}/…` page                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A numeric badge (or `99+`) renders on the **Notifications** bell button (`navigation.notifications`). Badge is decorative (`aria-hidden`)                                                                                                                                 |
| F2  | Open panel         | Click the **Notifications** bell button (`navigation.notifications`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Popover opens; header shows **Notifications** (`notifications.title`) and two tabs **Unread** (`notifications.filterUnread`) + **All** (`notifications.filterAll`); default selected tab = Unread                                                                         |
| F3  | Deep-link a row    | With a notification that has a target, click its body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | URL changes to the linked item (task / approval / conversation); panel closes; row becomes read                                                                                                                                                                           |
| F4  | Mark all as read   | With unread > 0, click **Mark all as read** (`notifications.markAllAsRead`)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Badge clears to 0; button disappears (only renders when unread > 0); read state survives a reload (reopen bell → those rows no longer under **Unread**)                                                                                                                   |
| F5  | Mark one read      | On an unread row, click the trailing check **Mark as read** (`notifications.markAsRead`) icon button                                                                                                                                                                                                                                                                                                                                                                                                                                   | Row leaves the **Unread** tab and remains visible under **All** as read; badge decrements by 1; survives reload                                                                                                                                                           |
| F6  | Load more          | With > 25 notifications under **All**, click **Load more** (`notifications.loadMore`)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Older notifications append below; button shows **Loading…** (`notifications.loading`) while fetching, then disables when exhausted                                                                                                                                        |
| F7  | Review deep-link   | On a `task_review_requested` or review-reminder row, click the row body                                                                                                                                                                                                                                                                                                                                                                                                                                                                | URL opens the task in its project (`?task=` search param); the task sheet shows **Needs review** with **Approve** / **Request changes** (`TaskReviewCard`); the notification row becomes read                                                                             |
| F7b | Approve in context | From F7's task sheet, click **Approve** (`tasks.review.approve`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Success toast **Task approved and completed** (`tasks.review.approvedToast`); pending review notifications for that task clear from the bell without manual mark-read; task status reflects approval after reload                                                         |
| F7c | Request changes    | From the task sheet review card, click **Request changes** (`tasks.review.requestChanges`), type feedback, click **Send feedback** (`tasks.review.sendFeedback`)                                                                                                                                                                                                                                                                                                                                                                       | **Send feedback** is disabled until feedback is non-empty; on submit, toast **Changes requested — the agent is on it** (`tasks.review.changesRequestedToast`); review notifications clear from the bell                                                                   |
| F8  | Real-time update   | Open the panel; in another tab/session trigger a notification for this org                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The new row appears in the open panel (and the badge increments) **without a manual reload** (Convex live query)                                                                                                                                                          |
| F9  | Task assigned      | Mode A, two accounts: as user A, assign a project task to user B (self-assignment is **suppressed server-side** — assigning yourself creates no row, so B must be a different account); sign in as B and open the bell                                                                                                                                                                                                                                                                                                                 | B's bell shows a row titled **Task assigned to you** (`inbox.taskAssigned`) with the body **"{actor} assigned you to "{title}"."** (`inbox.taskAssignedByBody`, actor = A's display name); clicking the row deep-links to the task (URL commits) and the row becomes read |
| F10 | Mention            | Mode A, two accounts: as user A, comment on a task mentioning `@B`; sign in as B and open the bell                                                                                                                                                                                                                                                                                                                                                                                                                                     | B sees **You were mentioned** (`inbox.mention`) with the body **"{actor} mentioned you on "{title}"."** (`inbox.mentionByBody`). The mention **takes precedence**: B gets the mention row, not an additional comment row for the same comment                             |
| F11 | New comment        | Mode A, two accounts: user B is a task **subscriber** (assignee or creator) and NOT the actor; as user A, comment on the task **without** mentioning B; open B's bell. **Caveat (verified live):** a plain-member account's task modal is completely read-only — no comment box even as assignee (see Issues #1) — so the commenting actor must be an owner/admin; direct the roles accordingly                                                                                                                                        | B sees **New comment** (`inbox.taskCommented`) with the body **"{actor} commented on "{title}"."** (`inbox.taskCommentedByBody`). The actor (A) receives no row for their own comment (verified live)                                                                     |
| F12 | Other types        | Documentation row (env-gated — these are cron/agent-driven, not user-triggerable on demand): the remaining catalog a tester may see is **Start date reached** (`inbox.taskStartReached`), **Due soon** (`inbox.taskDueSoon`), **Overdue task escalated** (`inbox.taskSlaEscalated`), **Review reminder** (`inbox.taskReviewReminder`), **Review overdue** (`inbox.taskReviewEscalated`), **Workflow waiting on input** (`inbox.humanInputEscalated`), **Agent escalation** (`inbox.agentEscalation`, body `inbox.agentEscalationBody`) | Assert only that any observed row renders its **translated title** (one of the strings above) — never a raw key like `inbox.taskDueSoon`                                                                                                                                  |

> The **Upgraded to v{version}** changelog release toast is **not** a bell
> notification — it belongs to the app shell and is covered in
> [navigation.md](navigation.md) (its F12), which owns the changelog.

## Boundary & error tests

| ID  | Test                   | Input                                                                                  | Expected                                                                                                                                           |
| --- | ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Empty Unread (default) | Fresh org / nothing unread; open the bell (default Unread tab)                         | Empty state **You're all caught up** (`notifications.emptyCaughtUpTitle`) + subtext (`notifications.emptyCaughtUpDescription`) — NOT a blank panel |
| B2  | Empty All tab          | No notifications at all; open the bell and switch to the **All** tab                   | Empty state **No notifications yet** (`notifications.emptyAllTitle`) + subtext (`notifications.emptyAllDescription`)                               |
| B3  | Stale review action    | On a review row already resolved elsewhere, click **Approve** (`tasks.review.approve`) | No crash; generic error toast (`common.errors.generic`) is shown and the row's review controls collapse — never a thrown page error                |

## Accessibility (WCAG 2.1 AA)

| ID  | Check            | Expected                                                                                                                           |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Bell button name | The bell exposes the accessible name **Notifications** (`navigation.notifications`). The count badge is `aria-hidden` (decorative) |
| A2  | Panel keyboard   | Esc closes the popover and returns focus to the bell trigger (Radix Popover behaviour)                                             |
| A3  | Loading status   | While the first page loads, a `role="status"` `aria-live="polite"` region announces **Loading…** (`notifications.loading`)         |

> **A11y note**: there is **no** dedicated `aria-live` region announcing _new_
> notifications after first load — only the initial loading spinner is a live
> region. Unread rows expose an `sr-only` **Unread** (`notifications.ariaUnread`)
> label. Flag any expectation of spoken new-notification announcements as an
> IMPROVEMENT, not a pass.

## Performance

| ID  | Metric              | Target                                                                                       |
| --- | ------------------- | -------------------------------------------------------------------------------------------- |
| P1  | Panel open          | Popover content visible < 300 ms after the bell click (warm route, mock mode, local backend) |
| P2  | First page of items | Notifications list painted < 1 s after open (warm route, mock mode, local backend)           |
| P3  | Real-time delivery  | A notification triggered elsewhere appears in an open panel < 2 s (mock mode, local backend) |

## Issues Found

| #   | Test ID | Route / URL                                         | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                                                                   | Screenshot                                                      |
| --- | ------- | --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | F11     | `/dashboard/{org}/projects/{projectId}/tasks/board` | high                         | A plain-member account's task modal is completely read-only — no comment box, no assign/status/due-date controls — even on a task where that member is the **assignee**. Members cannot comment on tasks at all, which blocks collaboration (and the F11 scripted direction). | defect-f11-teammate-task-modal-readonly-no-comment-composer.png |

## Test summary

```
Area: Notifications & inbox
Functional: ___/13   Boundary: ___/3   A11y: ___/3   Perf: ___/3
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
