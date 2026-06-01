# Conversations Testing Guide (AI-Directed)

> **Purpose**: Exercise the Conversations (inbox) module — statuses, priority, bulk actions, AI reply assistance, and the archive — and collect defects in Issues Found. Note: this is the **inbox** module, distinct from AI **chat threads**; archived chat threads live in the chat history sidebar, not here.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) and sign in as `admin@admin.test` / `Admin@123`. Open `/dashboard/{id}/conversations/open`.

> **AI Instructions**: Run in order; record one finding per defect with a screenshot. If the inbox is empty, the status tabs and empty states are still testable — note "no data" where a test needs a seeded conversation.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/conversations
```

## Functional tests

| ID  | Test                | Steps                                        | Expected                                                      |
| --- | ------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| F1  | Inbox loads         | Open conversations                           | Status tabs (Open/Closed/Archived/Spam) + list or empty state |
| F2  | Status tabs filter  | Click each status tab                        | List filters to that status; URL reflects the tab             |
| F3  | Open a conversation | Click a row                                  | Thread view with message history + reply composer             |
| F4  | Set priority        | Change priority to Low/Medium/High/Urgent    | Priority persists; reflected in the list                      |
| F5  | Close / reopen      | Close a conversation, then reopen            | Moves between Open and Closed tabs accordingly                |
| F6  | AI improve reply    | Draft a reply, use the AI improvement action | Suggested rewrite returned; user can accept/edit before send  |
| F7  | Send reply          | Send a reply                                 | Appended to the thread; status/timestamps update              |
| F8  | Archive             | Archive a conversation                       | Appears under the Archived tab; removed from Open             |

## Bulk-action & boundary tests

| ID  | Test                     | Steps                                                                 | Expected                                                           |
| --- | ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| B1  | Multi-select bulk close  | Select several rows → Close                                           | All selected move to Closed; one undo/toast                        |
| B2  | Bulk reopen              | Select closed rows → Reopen                                           | All move back to Open                                              |
| B3  | Empty reply blocked      | Try to send an empty reply                                            | Send disabled / rejected                                           |
| B4  | Archived vs chat archive | Archive a chat thread (in Chat), then open Conversations Archived tab | The chat thread is NOT here — archives are separate stores (#1290) |
| B5  | Long thread render       | Open a conversation with many messages                                | Renders without freeze; scroll to latest works                     |

## API / integration tests

| ID  | Test            | Steps                                              | Expected                       |
| --- | --------------- | -------------------------------------------------- | ------------------------------ |
| A1  | List by status  | `GET /api/v1/conversations/...` filtered by status | Returns only that status       |
| A2  | Write a message | Post a message via the API                         | Appears in the thread; audited |

## Accessibility tests (WCAG 2.1 AA)

| ID  | Check           | Expected                                                        |
| --- | --------------- | --------------------------------------------------------------- |
| X1  | Tab navigation  | Status tabs reachable + operable by keyboard; active tab marked |
| X2  | Row semantics   | List rows have accessible names; selection state announced      |
| X3  | Composer labels | Reply field + actions labelled; focus visible                   |

## Performance tests

| ID  | Metric            | Target                              |
| --- | ----------------- | ----------------------------------- |
| P1  | Inbox list load   | < 1.5 s for the first page          |
| P2  | Bulk action (10+) | Completes < 2 s with one round-trip |

## Issues Found

| #   | Test ID | Page / URL | Severity | Description | Screenshot |
| --- | ------- | ---------- | -------- | ----------- | ---------- |
|     |         |            |          |             |            |

## Test summary

```
Module: Conversations
Functional: ___/8   Bulk+Boundary: ___/5   API: ___/2   A11y: ___/3   Perf: ___/2
Issues found: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
