# Notifications & inbox — Manual Test Plan

> **Purpose**: Exercise the notification center (the header bell + panel) and the
> inbox of pending reviews (task approval/rejection). No automated spec covers
> this — treat every case as manual-only.

## Scope & routes

Notifications are a global header control on every dashboard route; the inbox
surfaces pending review items. There is no dedicated top-level URL — drive it
from any `/dashboard/{org}/…` page.

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). To generate review items, run a
flow that requests a review (e.g. a chat write-op approval, or a task review from
[projects.md](projects.md) F13), then return to the bell/inbox.

> **Agent note**: ⛔ no e2e spec. Notifications update in real time — assert the
> count/list changes without a manual reload. The memory-proposal audit trail is
> separately visible under Governance → Trash → **Memory audit**
> (`governance.trash.tab.memoryAudit`).

## Automated coverage

| Case(s) | Status         | e2e spec |
| ------- | -------------- | -------- |
| F1–F8   | ⛔ manual-only | —        |

## Functional tests

| ID  | Test              | Steps (control)                                                   | Expected                                                                        |
| --- | ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| F1  | Unread badge      | Generate a notification, observe the bell                         | Unread count exposed (`notifications.ariaUnread`)                               |
| F2  | Open panel        | Click the bell                                                    | Panel (`notifications.title`) lists notifications, newest first                 |
| F3  | Action button     | Click an actionable notification (e.g. a review)                  | Navigates to the relevant item (task / approval / conversation)                 |
| F4  | Mark read / clear | **Mark all as read** (`notifications.markAllAsRead`)              | Count clears; read state persists                                               |
| F5  | Load more         | With many notifications, **Load more** (`notifications.loadMore`) | Older notifications paginate in                                                 |
| F6  | Empty state       | With none, open the panel                                         | Empty state (`notifications.emptyAllTitle` — "No notifications yet")            |
| F7  | Inbox reviews     | Open the inbox of pending reviews; approve one, reject another    | The underlying task/write proceeds or is declined; item leaves the pending list |
| F8  | Real-time         | Trigger a notification in another tab/session                     | It appears in this session's bell without a reload                              |

## Boundary & error tests

| ID  | Test         | Input                                     | Expected                                     |
| --- | ------------ | ----------------------------------------- | -------------------------------------------- |
| B1  | Empty state  | No notifications / no pending reviews     | Real empty state, not a blank panel          |
| B2  | Stale action | Act on a review already handled elsewhere | Friendly "already handled" message, no error |

## Accessibility (WCAG 2.1 AA)

| ID  | Check        | Expected                                                                    |
| --- | ------------ | --------------------------------------------------------------------------- |
| A1  | Bell button  | Has an accessible name; unread count announced (`notifications.ariaUnread`) |
| A2  | Panel focus  | Opening moves focus into the panel; Esc closes and returns focus            |
| A3  | Live updates | New notifications announced via an `aria-live` region                       |

## Performance

| ID  | Metric     | Target                                                    |
| --- | ---------- | --------------------------------------------------------- |
| P1  | Panel open | < 0.5 s                                                   |
| P2  | Real-time  | New notification appears < 2 s after the triggering event |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Notifications & inbox
Functional: ___/8   Boundary: ___/2   A11y: ___/3   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
