# Inbox (org-level conversations)

> **Prefix** `CONV-` · **Reset** none · **Cost** 36 boxes

Exercise the org-level **Inbox** — the standalone
`/dashboard/{org}/conversations` surface (user-visible name: **Inbox**,
`conversations.title`) with its status lanes (Open / Closed / Spam /
Archived), the **Filter** panel behind the search box (Assignee / Read status /
Source), client-side search,
opening a conversation into the reading pane, reply + improve, and single +
bulk status transitions. The Inbox is **gated**: its sidebar entry, mobile
tab, and routes only render the inbox when at least one **deployed**
automation declares the `inbox` builtin view — today the three org-scoped
email automations (**Sync Outlook emails** / `outlook/sync-emails`, **Sync
Gmail emails** / `gmail/sync-emails`, **Sync emails via SMTP/IMAP** /
`imap-smtp/sync-emails`). Conversations are created by inbound email
ingestion, which the **mock stack cannot drive**; see Prerequisites for the
seeding pattern.

## Scope & routes

| Surface             | Route                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Inbox (default)     | `/dashboard/{org}/conversations` → redirects to `…/open`                       |
| By status           | `/dashboard/{org}/conversations/{open\|closed\|spam\|archived}`                |
| Source facet        | `…/{status}?channel={gmail\|outlook\|imap_smtp}` — set in the Filter panel    |
| Assignee facet      | `…/{status}?assignee=` — comma-separated ids and sentinels, set in the panel  |
| Read facet          | `…/{status}?read={read\|unread}` — set in the panel; absent means every state |
| Search (in-page)    | typed search rides the `?search=` URL param (`validateSearch` on `$status`)    |
| Selection (in-page) | selecting a conversation is **local view state** — the URL never changes       |
| Compose (in-pane)   | `…/{status}?compose=new[&composeContact={id}]` — the reading pane composer     |
| Automations (gate)  | `/dashboard/{org}/automations` — install/uninstall the email automations       |

Route files: `app/routes/dashboard/$id/conversations.tsx` (layout + redirect +
the availability guard) and
`app/routes/dashboard/$id/conversations/$status.tsx` (the `$status` segment +
the channel filter's URL state). Valid statuses are `open`, `closed`, `spam`,
`archived`; any other `$status` throws `notFound()` (see CONV-B2).

**Gating** (`useInboxAvailability`): an automation counts only when its
deployed presentation declares `builtinViews: [{ id: 'inbox' }]` — the builtin
packs are seeded into every org as drafts, so the seeded files alone must NOT
surface the Inbox until someone deploys a sync pack. While the availability
queries load, the nav entry and the route body stay hidden (no flash). With no
qualifying deploy or registered API source, `…/conversations*` renders a localized empty state
(`conversations.activate.noAutomationTitle` / `.noAutomationDescription`) with
a **Browse automations** link (`conversations.activate.browseAutomations`)
instead of the inbox.

A registered native API source (for example VAT plus) also opens the Inbox and
keeps its conversations in channel `api`. This requires no mail credentials. Use
an isolated integration fixture for CONV-F11; do not create correspondence in a
customer's live account as a manual test.

> **Gating verified live** (2026-08-04, mode A, fresh org with no deployed
> automation): the sidebar shows **no Inbox entry** (CONV-G1 holds) and a
> direct `/conversations` hit redirects to `…/open` rendering **Set up your
> Inbox** with the **Browse automations** link (CONV-G2 holds). A stale code
> comment in `app/hooks/use-navigation-items.ts` claims the gate is stubbed
> always-on — the observed behaviour is the designed gate; trust the runs, and
> treat the comment as the defect if the two ever disagree.

> **i18n note**: all in-app copy lives in the platform `conversations.*`
> namespace (`services/platform/messages/<locale>.yml`); the surface NAME is
> "Inbox" (`conversations.title` — de "Inbox", fr "Boîte de réception") while
> the noun in body copy stays "conversations". The former per-automation
> automations-inbox i18n namespace was deleted with the old backend.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Deploying an email
automation needs the developer-settings capability (Owner / Admin /
Developer).

**A pack the org was never seeded with is missing, not hidden.** Packs reach
an organization at two moments only: org creation, and
`provisioning:provisionAll` on deploy. An org created before a pack directory
existed therefore lists nothing for it — `convex dev` pushes code, it does not
provision. Seed the newly shipped packs into an existing org (create-if-absent
per name, always as drafts, an org's own edits and triggers untouched):

```bash
cd services/platform
bunx convex run provisioning/provision_default_automations:provisionDefaultAutomations \
  '{"organizationId":"<ORG-ID>","orgSlug":"<org-slug>"}'
```

The three sync packs then appear as **Not deployed** drafts
(`gmail-sync-emails`, `outlook-sync-emails`, `imap-smtp-sync-emails`);
deploying one is what opens the Inbox. A fresh org has **zero** conversations,
so after installing an email automation the default body is the **Activate
conversations** CTA (`conversations.activate.title`) and every list control
(search box, select-all, filters) is **disabled** —
CONV-G1–CONV-G3/CONV-F1/CONV-F2/CONV-B3 are testable as-is, but
CONV-F3–CONV-F10/CONV-B1 need a populated inbox.

There is **no UI path and no public mutation** to create a conversation in the
mock stack (creation happens via inbound email/connector ingestion, which the
mock gateway does not deliver). To exercise the populated cases, seed rows
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
`connectorName` only matters to the channel filter (CONV-F5). A row's list
title is its `subject` — the full-row button's `aria-label` is the subject,
falling back to the contact name, then **Unknown contact**
(`conversations.unknownContact`). The CLI seed sets no `contactId`, so seeded
rows lead with the subject.

> **Agent note**: status-transition and bulk mutations are RLS-wrapped and
> each writes an audit row via the internal `createAuditLog` — the
> audit-genesis denial that blocked every transition on older builds is
> RESOLVED (see the carry-forward record [`R1`](../runs/r0001.md)). Verify a transition by **reload +
> read-back of the persisted status** (the row left its source lane and
> appears in the target lane after reload), never by the toast.

## Gating tests

- [ ] `CONV-G1` · **Hidden without automation** — On an org with **no** email
  automation installed, load any dashboard page → The sidebar rail has **no
  Inbox link** (`getByRole('link', { name: 'Inbox' })` count 0) and the mobile
  bottom bar has no Inbox tab; the entry also never flashes in during load.
- [ ] `CONV-G2` · **Deep link guarded** — Open
  `/dashboard/{org}/conversations` directly (same org as CONV-G1) → Redirect
  to `…/open` still happens; the body is the localized empty state **Set up
  your Inbox** (`conversations.activate.noAutomationTitle`) + description +
  **Browse automations** link → `/dashboard/{org}/automations`; no crash, no
  console error.
- [ ] `CONV-G3` · **Appears after install** — Install **Sync Outlook emails**
  from `/dashboard/{org}/automations/outlook__reply-emails` (wizard: **Next**
  on Install, **I'll do this later** on the Outlook connect step, **Finish**)
  → The sidebar **Inbox** entry (icon `Inbox`, aria-label
  `conversations.title`) appears without a reload and routes to
  `/conversations/open`; the automation's own page shows only
  workflow-settings tabs (Configuration / Connectors) — **no Inbox tab**.
  Uninstalling the last email automation hides the entry again and CONV-G2
  applies again.

## Functional tests

- [ ] `CONV-F1` · **Inbox redirect** — Open `/dashboard/{org}/conversations`
  (email automation installed) → URL becomes
  `/dashboard/{org}/conversations/open`; `<main>` shows an `<h1>` **Inbox**
  (`conversations.title`)
- [ ] `CONV-F2` · **Status lanes** — Click each tab **Open** / **Closed** /
  **Spam** / **Archived** (`conversations.status.*`) — they render as
  `getByRole('link')` in that order, with approximate-count badges · URL
  becomes `…/{open\ · closed\ · spam\ → archived}`; the clicked tab's link
  stays visible after nav.
- [ ] `CONV-F3` · **Search (client-side)** — In a **populated** lane, type in
  the **Search conversations** box (`conversations.searchPlaceholder`) → The
  visible row list narrows to title/subject/description/contact-name matches;
  search state syncs to `?search=` and clears on lane switch.
- [ ] `CONV-F4` · **Read facet** — Open **Filter**
  (`common.labels.filter`) to the RIGHT of the search box; expand **Read
  status** (`conversations.filter.readStatus`); choose **All** / **Read** /
  **Unread** (`conversations.filter.all` / `.read` / `.unread`) → Rows scope to
  that read state (Unread keeps only rows with the unread dot); the section
  header carries a blue dot and the button a blue corner dot while a non-All
  value is set; the choice lands in the URL as `?read=` (**All** drops the
  param) and survives a reload.
- [ ] `CONV-F5` · **Source facet** — **Precondition:** the org must have at
  least one inbox provider to offer. `useChannelOptions` in
  `app/routes/dashboard/$id/conversations/$status.tsx` returns a frozen empty
  array while the automations backend is rebuilt, so today the facet is absent
  by design and this box cannot run — record it skipped, not failed. With a
  provider source restored: open **Filter**, expand **Channel**
  (`conversations.filter.channel`); options are **All channels**
  (`conversations.filter.allChannels`) + one entry per **installed** provider,
  labelled with the connector's display title (e.g. **Microsoft Outlook**);
  pick one → The URL gains `?channel={slug}` and the list re-queries
  server-side (`listConversationsPaginated` with `connectorName`) — only rows
  seeded with that `connectorName` remain. **All channels** clears the param.
- [ ] `CONV-F6` · **Open conversation** — In a populated lane, click a row
  (`getByRole('button', { name: '<subject>' })`) → Right reading pane replaces
  "No conversation selected" with the conversation header + message history;
  the row's unread dot clears (`markConversationAsRead`); the URL does not
  change (selection is local state)
- [ ] `CONV-F7` · **Reply** — With a conversation selected on **Open**, type
  into the reply box (`conversations.messagePlaceholder` = "Type a message") →
  **Send message** (`conversations.editor.send`); Cmd/Ctrl+Enter also sends →
  **Precondition:** the reply needs a linked contact with a real email AND a
  non-empty `connectorName` — otherwise `replyToConversation` throws
  `customer_email_not_found` (the error code itself, a residual from the
  customer→contact rename in #2618) (or `conversation_connector_missing`); the
  CLI seed sets `connectorName` but links **no contact**, so link one first.
  With those in place the reply lands in the thread (read-back after reload);
  recipient / `Re:` subject / connector derive server-side.
- [ ] `CONV-F8` · **Improve with AI** — With a non-empty draft → **Improve
  with AI** (`conversations.editor.improveWithAi`), optionally add an
  instruction, then **Generate improvement**
  (`conversations.editor.generateImprovement`) → The **Message improvement
  preview** dialog (`conversations.improvement.title`) shows Original vs
  Improved; **Accept changes** replaces the draft, **Reject** keeps it
  (`conversations.improvement.accept` / `.reject`). The rewrite is a real
  bounded model call on the writer's chat model (or the first servable
  direct model) — check Usage books it under the `inbox-improve` agent. With
  no AI provider connected, the toast reads
  `conversations.editor.improveFailed` with
  `conversations.editor.improveUnavailable`; any other failure toasts
  `conversations.editor.improveFailed` with the door's reason.
- [ ] `CONV-F9` · **Status transition (single)** — Open a conversation →
  **More actions** (`conversations.header.moreActions`) → **Close
  conversation** (`conversations.header.closeConversation`); reopen via
  **Reopen conversation**; spam via **Mark as spam**
  (`conversations.header.*`) → The row leaves the source lane and appears in
  the target **after reload** (read-back persisted `status`)
- [ ] `CONV-F10` · **Bulk transitions** — **Select all** checkbox (aria
  `common.aria.selectAll`) → "**N selected**"
  (`conversations.bulk.selectedCount`) replaces the search box → per-lane icon
  actions (tooltips): Open → **Send messages** / **Close** / **Mark as spam**
  / **Archive**; Closed & Spam → **Reopen**; Archived → **Unarchive**; others
  → **Archive** (`conversations.bulk.*`) → Selected rows leave the source lane
  and appear in the target **after reload**; the selection clears; **Send
  messages** opens the bulk-send dialog (`conversations.bulkSend.*`)

- [ ] `CONV-F11` · **Reply through an API source** — In an isolated organization with a registered API source and no email automation, open Inbox and its synchronized customer thread, send a reply with a supported attachment, then let the source worker poll → The same reply and attachment appear once in the source app, native delivery becomes delivered, and an acknowledgement retry creates no extra message; keyboard focus remains usable after send.

- [ ] `CONV-F12` · **Queue chip and assignee facet** — With one conversation
  assigned to team A (routing rule or assignee picker), one to a person and one
  unassigned, as an owner, then as a member of team A only → Each row queued to
  a team shows that team's NAME as a chip; a row assigned only to a PERSON
  shows no chip (the person is visible in the reading pane's assignee picker,
  not on the row). Open **Filter** → **Assignee**
  (`conversations.filter.assignee`) offers **Assigned to me**
  (`conversations.filter.assigneeMe`), **Unassigned**
  (`conversations.filter.assigneeUnassigned`, admins only), **My teams**
  (`conversations.filter.assigneeMyTeams`), then a **People**
  (`.assigneePeople`) group and a **Teams** (`.assigneeTeams`) group naming
  only the assignees present on the loaded rows. **My teams** keeps only the A
  row; the choice lands in the URL as `?assignee=…` and survives a reload; the
  member of A sees no **Unassigned** option and no unassigned rows at all.

- [ ] `CONV-F13` · **A drafted reply waits for a person** — With a populated
  thread, have an automation call `conversation.draft_reply` on it (or seed one
  pending `conversations` approval carrying `metadata.emailBody`), then open the
  thread → The draft renders in the reading pane as a **pending message** below
  the thread; nothing has been sent and the customer's mailbox is untouched.
  Send from the composer → the pending message resolves into the sent reply and
  the draft does not reappear on reload — on an email conversation AND on a
  native API-source conversation (whose reply is queued for its source rather
  than handed to a mail connector). Draft twice on one conversation → the
  pane still shows exactly one pending message (migration 0108's partial unique
  index), and the second call reports the first card rather than minting a twin.

- [ ] `CONV-F14` · **Add an unknown recipient without leaving compose** — With
  an email automation deployed, open **Compose** (`conversations.compose.compose`)
  and type into **To** (`conversations.compose.to`) a full address no contact
  carries → The list reports **No contacts match** (`conversations.compose.noContactsFound`)
  and offers **Add "`<address>`" as a contact** (`conversations.compose.addContact`)
  under a divider; choosing it opens **Add contact** (`contacts.create.title`)
  with **Email** (`contacts.email`) already filled and **Save** live without
  further typing. Save → the dialog closes, **To** names the new contact, and
  the contact is on `/dashboard/{org}/contacts` after a reload. Fill Subject
  and a body → **Send** → the thread opens with that contact as correspondent.

- [ ] `CONV-F15` · **A contact past the listing's first page** — In an org with
  more than 200 contacts, type the full address of one created earliest into
  **To** → The contact appears as an option (the picker searches server-side)
  and **no** Add row is offered; selecting it puts its name on the To trigger,
  and the trigger keeps that name while the query is narrowed to other rows.

- [ ] `CONV-F16` · **Filter to one person** — With one conversation claimed by
  member X (the reading pane's assignee picker, or X composing an email, which
  self-assigns) and others assigned elsewhere, as an owner → Open **Filter** →
  **Assignee**; X appears under **People** by display name; tick it → only X's
  rows remain and `?assignee=<userId>` lands in the URL. Tick a second person
  as well → both people's rows show (the facet ORs, it does not intersect).
  Tick **Assigned to me** while some rows are queued to a team the viewer is
  in → team-queued rows the viewer has NOT claimed are excluded. **Clear all**
  empties every facet AND the search box.

- [ ] `CONV-F17` · **A reply leaves from the mailbox that received it** — With
  TWO credentials on one email connector (two mailboxes, A and B) and B NOT the
  connector's default, mail the organization at mailbox B, then reply from the
  Inbox → The reply arrives at the correspondent **from mailbox B**, not from
  the default A, and the sent row records B. Mail the same thread at A next and
  reply again → That reply leaves from A: the newest inbound message decides.
  Then remove mailbox B and open the thread → Its messages are all still there
  and the next reply falls back to the default connector credential rather than
  failing.

- [ ] `CONV-F18` · **Unassign by picking the assignee again** — On a
  conversation queued to a team AND claimed by a person, as an owner, open the
  reading pane's assignee picker and choose the claimed person's row again →
  The person clears and the team chip stays. Choose the team's row again → The
  team clears and the person stays. With both cleared the trigger reads
  **Assign** (`conversations.header.assign`), the footer **Unassign**
  (`conversations.header.unassign`) and **Remove team**
  (`conversations.header.unassignTeam`) still clear each dimension on their
  own, and the conversation leaves every non-administrator's Inbox. In
  **Compose**, re-picking the queued team clears it the same way; re-picking
  the draft's own person does NOT, because a draft always keeps an owner.

## Boundary & error tests

- [ ] `CONV-B1` · **Search with no matches** — Type a term matching nothing in
  a populated lane's search box → The list shows **"No conversations in this
  tab"** (`conversations.list.empty`); no crash, no console error.
- [ ] `CONV-B2` · **Invalid status** — Open
  `/dashboard/{org}/conversations/bogus` → The `$status` route throws
  `notFound()`; the page renders the Not Found boundary inside the Inbox
  chrome (no 500, no console error)
- [ ] `CONV-B3` · **Activate-empty lane** — A lane on an org with an email
  automation installed but **zero** conversations → Reading pane shows the
  empty state **No conversations yet** (`conversations.activate.title`) +
  **Incoming conversations from your connected channels will appear here.**
  (`conversations.activate.description`); the list panel shows the empty
  message; search box + select-all + filters are **disabled**.
- [ ] `CONV-B4` · **Unknown filter params** — Open
  `…/open?channel=bogus&assignee=nobody` by hand → The list queries with
  `connectorName: "bogus"` and renders empty (no rows match); the Assignee
  facet still lists `nobody` as an option so the selection is visible and
  undoable (named **Unknown person**, `conversations.filter.assigneeUnknownPerson`);
  **Clear all** restores the list — no crash. An unparseable `?read=` value is
  rejected by `validateSearch` before the page renders.
- [ ] `CONV-B5` · **The add offer is withheld where it would be wrong** — In
  **To**, in turn: type a partial name (`jan`) → no Add row, and the list reads
  **No contacts match … Type a full email address to add a new contact**
  (`conversations.compose.noContactsFoundAddHint`); type an existing contact's
  address in a different case (`JANE@Example.com` for a `jane@example.com`
  contact) → no Add row and that contact is listed; type `unknown@example.com`
  → no Add row; as a **member** who cannot write contacts, type any unknown
  address → no Add row and no hint, and the field still searches and selects
  normally. No console error in any case.

## Accessibility (WCAG 2.1 AA)

- [ ] `CONV-A1` · **Status tabs** → Tabs are **navigation links** inside a
  labelled `<nav>` (role `link`, **not** an ARIA `tablist`); each link is
  keyboard-focusable and Enter-activates the lane.
- [ ] `CONV-A2` · **List rows** → Each row's full-row select target is a real
  `<button>` with an accessible name (subject → contact name → Unknown
  contact); reachable and openable by keyboard.
- [ ] `CONV-A3` · **Bulk select** → The select-all control is a labelled
  checkbox (`common.aria.selectAll`) and stands alone — no chevron hangs off
  it; per-row checkboxes are labelled `dialogs.selectConversation`
- [ ] `CONV-A4` · **Filter panel** → The trigger is a real `<button>` whose
  accessible name is **Filter** (`common.labels.filter`) even though no label
  is drawn; each facet header is a `button` with `aria-expanded`; multi-select
  options are labelled `checkbox`es, single-select options are `radio`s inside
  a labelled `radiogroup`, and a grouped facet labels each `radiogroup` by its
  group heading; the panel is NOT modal, so the list stays in the
  accessibility tree behind it; Escape closes it and returns focus to the
  button; fully keyboard-operable.
- [ ] `CONV-A5` · **Nav entry** → The sidebar Inbox entry is a link whose
  accessible name is **Inbox** (`conversations.title`); the mobile bottom-bar
  tab carries the same label.
- [ ] `CONV-A6` · **Add-contact row** → The Add row is a real listbox option:
  reachable with ArrowDown from the search field, announced through
  `aria-activedescendant`, and Enter-activatable. The dialog it opens traps
  focus; closing it with **Save** or **Cancel** returns focus to the **To**
  trigger, never to `<body>`. The whole flow completes with no pointer.

- [ ] `CONV-A7` · **Assignee picker selection** → In the reading pane's
  assignee picker, the assigned person's row and the assigned team's row carry
  `aria-selected="true"` and every other row `"false"`, so a screen reader
  names the current assignment without relying on the check glyph. Each
  assigned row also announces `conversations.header.reclickToUnassign`.
  Arrowing to an assigned row and pressing Enter clears that dimension, and
  focus returns to the trigger, whose label has changed.

## Performance

- [ ] `CONV-P1` · **Inbox first paint (mock stack, local self-hosted Convex)**
  → `/conversations/open` shows the header + list panel (or activate-empty
  CTA) within **2 s** of navigation (loader prefetches the status count +
  first page)
- [ ] `CONV-P2` · **Lane switch (mock stack, warm)** → Clicking another status
  tab commits the URL and repaints the body within **1 s**.
- [ ] `CONV-P3` · **Search keystroke (populated, ≤30 rows)** → Filtered rows
  update within **300 ms** of typing (client-side `filterByTextSearch`, no
  network round-trip)
- [ ] `CONV-P4` · **Source facet switch (warm)** → Selecting a channel in the
  Filter panel repaints the list within **1 s** (one server-side paginated
  re-query). Needs the CONV-F5 precondition.
