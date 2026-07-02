# Conversations (inbox) — Manual Test Plan

> **Purpose**: Exercise the conversation inbox — status lanes
> (Open / Closed / Spam / Archived), the read-status filter, client-side search,
> opening a conversation into the reading pane, single + bulk status
> transitions, and the not-yet-activated empty state. Conversations are created
> by inbound email/integration ingestion, which the **mock stack cannot drive**;
> see Prerequisites for how to populate an inbox for the transition/bulk cases.

## Scope & routes

| Surface          | Route                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Inbox (default)  | `/dashboard/{org}/conversations` → redirects to `…/open`                                  |
| By status        | `/dashboard/{org}/conversations/{open\|closed\|spam\|archived}`                           |
| Search (in-page) | search is **client-side local state** — it does **not** put `?search=` in the URL         |
| Priority (param) | `…/{status}?priority=high` is a read by the route, but **no UI control sets it** (see F4) |

Route files: `app/routes/dashboard/$id/conversations.tsx` (layout + redirect) and
`app/routes/dashboard/$id/conversations/$status.tsx` (the `$status` segment).
Valid statuses are `open`, `closed`, `spam`, `archived`; any other `$status`
throws `notFound()` (see B2).

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). A fresh org has **zero**
conversations, so the default body is the **Activate conversations** CTA
(`conversations.activate.title`) and every list control (search box, select-all)
is **disabled** — F1/F2/B3 are testable as-is, but F3–F8/B1 need a populated
inbox.

There is **no UI path and no public mutation** to create a conversation in the
mock stack (creation happens via inbound email/integration ingestion, which the
mock gateway does not deliver). To exercise the populated cases, seed rows
directly into **your own bootstrapped org** via the internal mutation (the local
self-hosted backend lets `convex run` call internal functions with the admin key
from `.convex/local/default/config.json`):

```bash
cd services/platform
bunx convex run conversations/internal_mutations:createConversationWithMessage \
  '{"organizationId":"<ORG>","subject":"QA conv","status":"open","priority":"high","channel":"email","direction":"inbound","type":"service-request","integrationName":"outlook","initialMessage":{"sender":"qa@example.com","content":"hello","isCustomer":true,"status":"delivered"}}'
```

Seed 3+ rows (vary `priority`/`subject`) so search and bulk-select have material.
A seeded conversation has **no linked customer**, so its row title renders as
**"Unknown Customer"** with the `subject` on the secondary line.

> **Agent note**: status-transition and bulk mutations are RLS-wrapped
> (`mutationWithRLS`) and each writes an audit row. On the current build that
> write is **denied** and the mutation rolls back — see **Issue in Issues Found
> (status transitions blocked)**. Verify a transition by **reload + read-back of
> the persisted status** (export the snapshot or re-query the row), never by the
> toast: the success toast can show even when the row did not move. Row select
> targets are `<button aria-label="Unknown Customer">`; disambiguate rows by the
> `subject` text in the row body.

## Automated coverage

| Case(s)                           | Status         | e2e spec                                                               |
| --------------------------------- | -------------- | ---------------------------------------------------------------------- |
| F1 (redirect)                     | ✅ automated   | `conversations.spec.ts` (`/conversations` → `…/open`)                  |
| F2 (status tabs)                  | ✅ automated   | `conversations.spec.ts` (routes all 4 tabs, asserts each link)         |
| B3 (activate/empty body)          | ✅ automated   | `conversations.spec.ts` (asserts `activate.title` **or** `list.empty`) |
| F1 (rail lands on open)           | 🔶 partial     | `navigation.spec.ts` (rail link → `/conversations/open` only)          |
| F3, F4, B1, B2                    | ⛔ manual-only | —                                                                      |
| F5–F8 (open / transitions / bulk) | ⛔ manual-only | — (no spec seeds conversations; blocked, see Issues)                   |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                       | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                                              | Expected (verifiable)                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Inbox redirect             | Open `/dashboard/{org}/conversations`                                                                                                                                                                                                                                                                                                                                                                | URL becomes `/dashboard/{org}/conversations/open`; `<main>` shows an `<h1>` "Conversations" (`conversations.title`)                                                                                                                                                                                                          |
| F2  | Status lanes               | Click each tab **Open** (`conversations.status.open`), **Closed** (`conversations.status.closed`), **Spam** (`conversations.status.spam`), **Archived** (`conversations.status.archived`) — they render as `getByRole('link')` in that left-to-right order                                                                                                                                           | URL becomes `…/{open\|closed\|spam\|archived}`; the clicked tab's link stays visible after nav                                                                                                                                                                                                                               |
| F3  | Search (client-side)       | In a **populated** lane, type in the **Search conversations** box (`chat.searchConversations`)                                                                                                                                                                                                                                                                                                       | The visible row list narrows to title/subject/description matches; the **URL gains no `?search=` param** (search is local state, cleared on lane switch)                                                                                                                                                                     |
| F4  | Read-status filter         | Click the filter chevron (aria `conversations.filter.label` = "Filter by read status") next to select-all; choose **All** / **Read** / **Unread** (`conversations.filter.all` / `.read` / `.unread`)                                                                                                                                                                                                 | Rows scope to that read state (Unread keeps only rows with the unread dot). **There is no priority filter control**; priority shows only as a row **Badge** (High/Low; medium is intentionally hidden) on **open** rows (`conversations.priority.high` / `.low`)                                                             |
| F5  | Open conversation          | In a populated lane, click a row (`getByRole('button', { name: 'Unknown Customer' })`)                                                                                                                                                                                                                                                                                                               | Right reading pane replaces "No conversation selected" with the conversation header + its message text; the URL does not change (selection is local state)                                                                                                                                                                   |
| F6  | Status transition (single) | Open a conversation → **More actions** (`conversations.header.moreActions`) → **Close conversation** (`conversations.header.closeConversation`)                                                                                                                                                                                                                                                      | On success: the row leaves **open** and appears in **closed** **after reload** (read-back persisted `status`). Reopen via **Reopen conversation** (`conversations.header.reopenConversation`); spam via **Mark as spam** (`conversations.header.markAsSpam`). **Currently fails — see Issues (status transitions blocked).** |
| F7  | Bulk select                | In a populated open lane, click the **Select all** checkbox (aria `common.aria.selectAll`)                                                                                                                                                                                                                                                                                                           | A "**N selected**" label appears (`conversations.bulk.selectedCount`); the search box is replaced by the bulk action row                                                                                                                                                                                                     |
| F8  | Bulk transition            | With rows selected on **open**, click **Close** (aria `conversations.bulk.close`); on **closed/spam** use **Reopen** (`conversations.bulk.reopen`); on **archived** **Unarchive** (`conversations.bulk.unarchive`); otherwise **Archive** (`conversations.bulk.archive`). **Send messages** (`conversations.bulk.sendMessages`) + **Mark as spam** (`conversations.bulk.markSpam`) also show on open | Selected rows leave the source lane and appear in the target **after reload** (read-back persisted `status`); selection clears. **Currently fails — see Issues (status transitions blocked).**                                                                                                                               |

## Boundary & error tests

| ID  | Test                      | Input                                                                           | Expected                                                                                                                                                                                                                                             |
| --- | ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Search with no matches    | Type a term matching nothing in a populated lane's **Search conversations** box | The list shows the empty message **"No conversations in this tab"** (`conversations.list.empty`); no crash, no console error                                                                                                                         |
| B2  | Invalid status            | Open `/dashboard/{org}/conversations/bogus`                                     | The `$status` route throws `notFound()`; the page renders the **"Not Found"** boundary inside the conversations chrome (HTTP stays 200, no 500, no console error)                                                                                    |
| B3  | Activate-empty lane       | A lane on an org with **zero** conversations                                    | Reading pane shows **Activate conversations** (`conversations.activate.title`) + **Connect email** button (`conversations.activate.connectEmail`); the list panel shows **"No conversations in this tab"**; search box + select-all are **disabled** |
| B4  | Lane switch resets search | Type in Search on `open`, then click the **Closed** tab                         | The closed lane renders with an empty (reset) search box; no leftover `?search=` in the URL                                                                                                                                                          |

## Accessibility (WCAG 2.1 AA)

| ID  | Check       | Expected                                                                                                                                                                                                            |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Status tabs | Tabs are **navigation links** inside a labelled `<nav>` (role `link`, **not** an ARIA `tablist`); each link is keyboard-focusable and Enter-activates the lane                                                      |
| A2  | List rows   | Each row's full-row select target is a real `<button>` (`getByRole('button')`) with an accessible name; reachable and openable by keyboard                                                                          |
| A3  | Bulk select | The select-all control is a labelled checkbox (`common.aria.selectAll` = "Select all"); the read-filter trigger has aria `conversations.filter.label`; per-row checkboxes are labelled `dialogs.selectConversation` |

## Performance

| ID  | Metric                                                   | Target                                                                                                                                                     |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Inbox first paint (mock stack, local self-hosted Convex) | `/conversations/open` shows the header + list panel (or activate-empty CTA) within **2 s** of navigation (loader prefetches the status count + first page) |
| P2  | Lane switch (mock stack, warm)                           | Clicking another status tab commits the URL and repaints the body within **1 s**                                                                           |
| P3  | Search keystroke (populated, ≤30 rows)                   | Filtered rows update within **300 ms** of typing (client-side `filterByTextSearch`, no network round-trip)                                                 |

## Issues Found

| #   | Test ID | Route / URL                           | Severity | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Screenshot                                      |
| --- | ------- | ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | F6, F8  | `/dashboard/{org}/conversations/open` | crit     | **Status transitions blocked.** Single close (`conversations/mutations:closeConversation`) and bulk close (`…:bulkCloseConversations`) both throw `Uncaught Error: insert access not allowed` at `createAuditLog` (`audit_logs/helpers.ts:220`, the `auditLogChainGenesis` insert). Root cause: `auditLogChainGenesis` RLS rule is `{read:false, insert:false, modify:false}` for all roles (`lib/rls/helpers/rls_rules.ts:566`), so inside an RLS-wrapped user mutation the genesis read returns null and the follow-on insert is denied → mutation rolls back. Read-back of the snapshot confirmed all rows stayed `open`. Affects every audited conversation transition (close/reopen/spam/archive + bulk). | `scratchpad/shots/conversations/probe-open.png` |

## Test summary

```
Area: Conversations
Functional: ___/8   Boundary: ___/4   A11y: ___/3   Perf: ___/3
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
