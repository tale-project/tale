# Inbox (org-level conversations) — Manual Test Plan

> **Purpose**: Exercise the org-level **Inbox** — the standalone
> `/dashboard/{org}/conversations` surface (user-visible name: **Inbox**,
> `conversations.title`) with its status lanes (Open / Closed / Spam /
> Archived), the read-status filter, the **channel filter**, client-side
> search, opening a conversation into the reading pane, reply + improve, and
> single + bulk status transitions. The Inbox is **gated**: its sidebar entry,
> mobile tab, and routes only render the inbox when at least one **deployed**
> automation declares the `inbox` builtin view — today the three org-scoped
> email automations (**Sync Outlook emails** / `outlook/sync-emails`,
> **Sync Gmail emails** / `gmail/sync-emails`, **Sync emails via SMTP/IMAP** /
> `imap-smtp/sync-emails`). Conversations are created by inbound
> email ingestion, which the **mock stack cannot drive**; see Prerequisites
> for the seeding pattern.

## Scope & routes

| Surface             | Route                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Inbox (default)     | `/dashboard/{org}/conversations` → redirects to `…/open`                          |
| By status           | `/dashboard/{org}/conversations/{open\|closed\|spam\|archived}`                   |
| Channel filter      | `…/{status}?channel={gmail\|outlook\|imap_smtp}` — set by the toolbar dropdown    |
| Search (in-page)    | search is **client-side local state** — it does **not** put `?search=` in the URL |
| Selection (in-page) | selecting a conversation is **local view state** — the URL never changes          |
| Automations (gate)  | `/dashboard/{org}/automations` — install/uninstall the email automations          |

Route files: `app/routes/dashboard/$id/conversations.tsx` (layout + redirect +
the availability guard) and `app/routes/dashboard/$id/conversations/$status.tsx`
(the `$status` segment + the channel filter's URL state). Valid statuses are
`open`, `closed`, `spam`, `archived`; any other `$status` throws `notFound()`
(see B2).

**Gating** (`useInboxAvailability`): an automation counts only when its
deployed presentation declares `builtinViews: [{ id: 'inbox' }]` — the
builtin packs are seeded into every org as drafts, so the seeded files alone
must NOT surface the Inbox until someone deploys a sync pack.
While the availability queries load, the nav entry and the route body stay
hidden (no flash). With no qualifying deploy, `/conversations*` renders a
localized empty state (`conversations.activate.noAutomationTitle` /
`.noAutomationDescription`) with a **Browse automations** link
(`conversations.activate.browseAutomations`) instead of the inbox.

> **i18n note**: all in-app copy lives in the platform `conversations.*`
> namespace (`services/platform/messages/<locale>.json`); the surface NAME is
> "Inbox" (`conversations.title` — de "Inbox", fr "Boîte de réception") while
> the noun in body copy stays "conversations". The former per-automation
> `automations.inbox.*` namespace is deleted.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Deploying an email
automation needs the developer-settings capability (Owner / Admin /
Developer).

**A pack the org was never seeded with is missing, not hidden.** Packs reach an
organization at two moments only: org creation, and `provisioning:provisionAll`
on deploy. An org created before a pack directory existed therefore lists
nothing for it — `convex dev` pushes code, it does not provision. Seed the
newly shipped packs into an existing org (create-if-absent per name, always as
drafts, an org's own edits and triggers untouched):

```bash
cd services/platform
bunx convex run provisioning/provision_default_automations:provisionDefaultAutomations \
  '{"organizationId":"<ORG-ID>","orgSlug":"<org-slug>"}'
```

The three sync packs then appear as **Not deployed** drafts
(`gmail-sync-emails`, `outlook-sync-emails`, `imap-smtp-sync-emails`); deploying
one is what opens the Inbox. A fresh org has **zero** conversations, so after installing an
email automation the default body is the **Activate conversations** CTA
(`conversations.activate.title`) and every list control (search box,
select-all, filters) is **disabled** — G1–G3/F1/F2/B3 are testable as-is, but
F3–F10/B1 need a populated inbox.

There is **no UI path and no public mutation** to create a conversation in the
mock stack (creation happens via inbound email/connector ingestion, which
the mock gateway does not deliver). To exercise the populated cases, seed rows
directly into **your own bootstrapped org** via the internal mutation (the
local self-hosted backend lets `convex run` call internal functions with the
admin key from `.convex/local/default/config.json`):

```bash
cd services/platform
bunx convex run conversations/internal_mutations:createConversationWithMessage \
  '{"organizationId":"<ORG>","subject":"QA conv","status":"open","priority":"high","channel":"email","direction":"inbound","type":"service-request","connectorName":"outlook","initialMessage":{"sender":"qa@example.com","content":"hello","isCustomer":true,"status":"delivered"}}'
```

Seed 3+ rows (vary `subject` and `connectorName`: `outlook` / `gmail` /
`imap_smtp`) so search, bulk-select, and the channel filter have material. The
org-level Inbox lists **every** conversation regardless of provider;
`connectorName` only matters to the channel filter (F5). A row's list title
is its `subject` — the full-row button's `aria-label` is the subject, falling
back to the contact name, then **Unknown contact**
(`conversations.unknownContact`). The CLI seed sets no `contactId`, so
seeded rows lead with the subject.

> **Agent note**: status-transition and bulk mutations are RLS-wrapped and
> each writes an audit row via the internal `createAuditLog` — the
> audit-genesis denial that blocked every transition on older builds is
> RESOLVED (see **Issues Found** #1). Verify a transition by **reload +
> read-back of the persisted status** (the row left its source lane and
> appears in the target lane after reload), never by the toast.

## Automated coverage

| Case(s)              | Status         | e2e spec                                                                                                                                         |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1–G3, F1–F10, B1–B4 | ⛔ manual-only | — (the `email-automation` spec, which automated the gate, redirect, channel filter, and reading pane, was retired in #2857 and has no successor) |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Gating tests

| ID  | Test                      | Steps (route + control)                                                                                                                                                                 | Expected (verifiable)                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Hidden without automation | On an org with **no** email automation installed, load any dashboard page                                                                                                               | The sidebar rail has **no Inbox link** (`getByRole('link', { name: 'Inbox' })` count 0) and the mobile bottom bar has no Inbox tab; the entry also never flashes in during load                                                                                                                                                           |
| G2  | Deep link guarded         | Open `/dashboard/{org}/conversations` directly (same org as G1)                                                                                                                         | Redirect to `…/open` still happens; the body is the localized empty state **Set up your Inbox** (`conversations.activate.noAutomationTitle`) + description + **Browse automations** link → `/dashboard/{org}/automations`; no crash, no console error                                                                                     |
| G3  | Appears after install     | Install **Sync Outlook emails** from `/dashboard/{org}/automations/outlook__reply-emails` (wizard: **Next** on Install, **I'll do this later** on the Outlook connect step, **Finish**) | The sidebar **Inbox** entry (icon `Inbox`, aria-label `conversations.title`) appears without a reload and routes to `/conversations/open`; the automation's own page shows only workflow-settings tabs (Configuration / Connectors) — **no Inbox tab**. Uninstalling the last email automation hides the entry again and G2 applies again |

## Functional tests

| ID  | Test                       | Steps (route + control)                                                                                                                                                                                                                                                                                                                               | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Inbox redirect             | Open `/dashboard/{org}/conversations` (email automation installed)                                                                                                                                                                                                                                                                                    | URL becomes `/dashboard/{org}/conversations/open`; `<main>` shows an `<h1>` **Inbox** (`conversations.title`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| F2  | Status lanes               | Click each tab **Open** / **Closed** / **Spam** / **Archived** (`conversations.status.*`) — they render as `getByRole('link')` in that order, with approximate-count badges                                                                                                                                                                           | URL becomes `…/{open\|closed\|spam\|archived}`; the clicked tab's link stays visible after nav                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F3  | Search (client-side)       | In a **populated** lane, type in the **Search conversations** box (`conversations.searchPlaceholder`)                                                                                                                                                                                                                                                 | The visible row list narrows to title/subject/description/contact-name matches; search state syncs to `?search=` and clears on lane switch                                                                                                                                                                                                                                                                                                                                                                        |
| F4  | Read-status filter         | Click the filter chevron (aria `conversations.filter.label` = "Filter by read status") next to select-all; choose **All** / **Read** / **Unread** (`conversations.filter.all` / `.read` / `.unread`)                                                                                                                                                  | Rows scope to that read state (Unread keeps only rows with the unread dot); the trigger highlights while a non-All filter is active                                                                                                                                                                                                                                                                                                                                                                               |
| F5  | Channel filter             | Click the **Channel** dropdown (aria `conversations.filter.channel`) in the toolbar; options are **All channels** (`conversations.filter.allChannels`) + one entry per **installed** inbox provider, labelled with the connector's display title (e.g. **Microsoft Outlook**); pick one                                                               | The URL gains `?channel={slug}` and the list re-queries server-side (`listConversationsPaginated` with `connectorName`) — only rows seeded with that `connectorName` remain; the trigger shows the selected title and highlights. **All channels** clears the param and restores the full list. Providers derive from installed inbox automations' `requires.connectors[0]`, so uninstalling a provider removes its option                                                                                        |
| F6  | Open conversation          | In a populated lane, click a row (`getByRole('button', { name: '<subject>' })`)                                                                                                                                                                                                                                                                       | Right reading pane replaces "No conversation selected" with the conversation header + message history; the row's unread dot clears (`markConversationAsRead`); the URL does not change (selection is local state)                                                                                                                                                                                                                                                                                                 |
| F7  | Reply                      | With a conversation selected on **Open**, type into the reply box (`conversations.messagePlaceholder` = "Type a message") → **Send message** (`conversations.editor.send`); Cmd/Ctrl+Enter also sends                                                                                                                                                 | **Precondition:** the reply needs a linked contact with a real email AND a non-empty `connectorName` — otherwise `replyToConversation` throws `customer_email_not_found` (the error code itself, a residual from the customer→contact rename in #2618) (or `conversation_connector_missing`); the CLI seed sets `connectorName` but links **no contact**, so link one first. With those in place the reply lands in the thread (read-back after reload); recipient / `Re:` subject / connector derive server-side |
| F8  | Improve with AI            | With a non-empty draft → **Improve with AI** (`conversations.editor.improveWithAi`), optionally add an instruction, then **Generate improvement** (`conversations.editor.generateImprovement`)                                                                                                                                                        | The **Message improvement preview** dialog (`conversations.improvement.title`) shows Original vs Improved; **Accept changes** replaces the draft, **Reject** keeps it (`conversations.improvement.accept` / `.reject`); failure toasts `conversations.editor.improveFailed`                                                                                                                                                                                                                                       |
| F9  | Status transition (single) | Open a conversation → **More actions** (`conversations.header.moreActions`) → **Close conversation** (`conversations.header.closeConversation`); reopen via **Reopen conversation**; spam via **Mark as spam** (`conversations.header.*`)                                                                                                             | The row leaves the source lane and appears in the target **after reload** (read-back persisted `status`)                                                                                                                                                                                                                                                                                                                                                                                                          |
| F10 | Bulk transitions           | **Select all** checkbox (aria `common.aria.selectAll`) → "**N selected**" (`conversations.bulk.selectedCount`) replaces the search box → per-lane icon actions (tooltips): Open → **Send messages** / **Close** / **Mark as spam** / **Archive**; Closed & Spam → **Reopen**; Archived → **Unarchive**; others → **Archive** (`conversations.bulk.*`) | Selected rows leave the source lane and appear in the target **after reload**; the selection clears; **Send messages** opens the bulk-send dialog (`conversations.bulkSend.*`)                                                                                                                                                                                                                                                                                                                                    |

## Boundary & error tests

| ID  | Test                   | Input                                                                          | Expected                                                                                                                                                                                                                                      |
| --- | ---------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Search with no matches | Type a term matching nothing in a populated lane's search box                  | The list shows **"No conversations in this tab"** (`conversations.list.empty`); no crash, no console error                                                                                                                                    |
| B2  | Invalid status         | Open `/dashboard/{org}/conversations/bogus`                                    | The `$status` route throws `notFound()`; the page renders the Not Found boundary inside the Inbox chrome (no 500, no console error)                                                                                                           |
| B3  | Activate-empty lane    | A lane on an org with an email automation installed but **zero** conversations | Reading pane shows **Activate conversations** (`conversations.activate.title`) + **Connect email** button (`conversations.activate.connectEmail`); the list panel shows the empty message; search box + select-all + filters are **disabled** |
| B4  | Unknown channel param  | Open `…/open?channel=bogus` by hand                                            | The list queries with `connectorName: "bogus"` and renders empty (no rows match); the channel dropdown falls back to its unselected label; clearing via **All channels** restores the list — no crash                                         |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                                                                              |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Status tabs    | Tabs are **navigation links** inside a labelled `<nav>` (role `link`, **not** an ARIA `tablist`); each link is keyboard-focusable and Enter-activates the lane                                        |
| A2  | List rows      | Each row's full-row select target is a real `<button>` with an accessible name (subject → contact name → Unknown contact); reachable and openable by keyboard                                         |
| A3  | Bulk select    | The select-all control is a labelled checkbox (`common.aria.selectAll`); the read-filter trigger has aria `conversations.filter.label`; per-row checkboxes are labelled `dialogs.selectConversation`  |
| A4  | Channel filter | The trigger is a real `<button>` with aria-label **Channel** (`conversations.filter.channel`); the menu options are `menuitemradio` entries reflecting the current selection; fully keyboard-operable |
| A5  | Nav entry      | The sidebar Inbox entry is a link whose accessible name is **Inbox** (`conversations.title`); the mobile bottom-bar tab carries the same label                                                        |

## Performance

| ID  | Metric                                                   | Target                                                                                                                                                     |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Inbox first paint (mock stack, local self-hosted Convex) | `/conversations/open` shows the header + list panel (or activate-empty CTA) within **2 s** of navigation (loader prefetches the status count + first page) |
| P2  | Lane switch (mock stack, warm)                           | Clicking another status tab commits the URL and repaints the body within **1 s**                                                                           |
| P3  | Search keystroke (populated, ≤30 rows)                   | Filtered rows update within **300 ms** of typing (client-side `filterByTextSearch`, no network round-trip)                                                 |
| P4  | Channel filter switch (warm)                             | Selecting a channel repaints the list within **1 s** (one server-side paginated re-query)                                                                  |

## Issues Found

| #   | Test ID | Route / URL                           | Severity | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Screenshot                                      |
| --- | ------- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | F9, F10 | `/dashboard/{org}/conversations/open` | resolved | **RESOLVED — status transitions persist.** The audit-genesis denial (the `auditLogChainGenesis` insert being RLS-denied inside a user mutation) is off the write path: close/reopen/spam/read and every `bulk_*` route their audit through the raw internal `createAuditLog` (`audit_logs/emit.ts` → an `internalMutation` with raw ctx in `internal_mutations.ts`), and `conversations/status_transitions_rls.test.ts` (#1972) is a green regression driving the REAL RLS + audit chain. Caveat: the regression proves an _editor_; a plain _member_'s permission is separate | `scratchpad/shots/conversations/probe-open.png` |

## Test summary

```
Area: Inbox (org-level conversations)
Gating: ___/3   Functional: ___/10   Boundary: ___/4   A11y: ___/5   Perf: ___/4
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
