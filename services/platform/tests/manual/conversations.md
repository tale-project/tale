# Conversations (inbox) — Manual Test Plan

> **Purpose**: Exercise the conversation inbox — status lanes (open / closed /
> archived / spam), search, priority filtering, opening a conversation, and
> status transitions. This area has **no automated spec**, so it is the highest
> manual-coverage priority.

## Scope & routes

| Surface         | Route                                                           |
| --------------- | --------------------------------------------------------------- |
| Inbox (default) | `/dashboard/{org}/conversations` → redirects to `…/open`        |
| By status       | `/dashboard/{org}/conversations/{open\|closed\|archived\|spam}` |
| Filtered        | `…/{status}?search=…&priority=…`                                |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). Conversations may be empty on a
fresh org — verify the empty state first. To exercise transitions, create one via
whatever ingestion path your build exposes (an inbound integration / email
connector), or note the empty-state-only result honestly.

> **Agent note**: ⛔ no e2e spec covers this beyond `navigation.spec.ts` visiting
> `/conversations/open`. The status tab labels resolve from `conversations.status.*`
> (e.g. `conversations.status.open` = "Open").

## Automated coverage

| Case(s)          | Status         | e2e spec                                            |
| ---------------- | -------------- | --------------------------------------------------- |
| F1 (route loads) | 🔶 partial     | `navigation.spec.ts` (visits `/conversations/open`) |
| F2–F8            | ⛔ manual-only | —                                                   |

## Functional tests

| ID  | Test              | Steps (route + control)                                                            | Expected                                                                  |
| --- | ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| F1  | Inbox loads       | Open `/dashboard/{org}/conversations`                                              | Redirects to `…/open`; list or a real empty state (`conversations.title`) |
| F2  | Status lanes      | Switch tabs **Open / Closed / Archived / Spam** (`conversations.status.open` etc.) | URL becomes `…/{status}`; the list scopes to that status                  |
| F3  | Search            | Type a query in the inbox search                                                   | URL gains `?search=…`; list filters to matches                            |
| F4  | Priority filter   | Apply a priority filter                                                            | URL gains `?priority=…`; list filters                                     |
| F5  | Open conversation | Click a conversation                                                               | Detail/thread opens with its history                                      |
| F6  | Status transition | Move a conversation Open → Closed (and Archived / Spam)                            | Conversation leaves the source lane, appears in the target                |
| F7  | AI reply assist   | If present, trigger the AI reply suggestion in a conversation                      | A drafted reply is offered, editable before send                          |
| F8  | Bulk actions      | Select multiple rows, apply a bulk status change                                   | All selected move; selection clears                                       |

## Boundary & error tests

| ID  | Test           | Input                         | Expected                                                 |
| --- | -------------- | ----------------------------- | -------------------------------------------------------- |
| B1  | Empty search   | Search a term with no matches | Empty result state, no crash                             |
| B2  | Invalid status | Open `…/conversations/bogus`  | Graceful handling (redirect to a valid lane or 404 view) |
| B3  | Empty lane     | A lane with no items          | Real empty state, not a blank page                       |

## Accessibility (WCAG 2.1 AA)

| ID  | Check       | Expected                                           |
| --- | ----------- | -------------------------------------------------- |
| A1  | Status tabs | Implemented as a real tablist; arrow-key navigable |
| A2  | List rows   | Each row reachable and openable by keyboard        |
| A3  | Bulk select | Select-all + per-row checkboxes labelled           |

## Performance

| ID  | Metric      | Target                     |
| --- | ----------- | -------------------------- |
| P1  | Inbox load  | First list paint < 1.5 s   |
| P2  | Lane switch | < 1 s between status lanes |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Conversations
Functional: ___/8   Boundary: ___/3   A11y: ___/3   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
