# Inbox (org-level conversations)

> **Prefix** `CONV-` · **Reset** none · **Cost** 50 boxes

Exercise the org-level **Inbox** — the customer conversations of
`/dashboard/{org}/conversations` (user-visible name: **Inbox**,
`conversations.title`) with their statuses (Open / Closed / Spam /
Archived), the **Filter** panel behind the search box (Assignee / Read status /
Source), client-side search,
opening a conversation into the reading pane, reply + improve, and single +
bulk status transitions. **On desktop the list lives in the Home panel's
Inbox view** (`home.views.inbox`; the panel itself is
[navigation.md](navigation.md)'s) beside the reading pane — status switch,
search, facets and bulk verbs included; **a phone** keeps the Inbox page's own
list, with its status tabs, whenever no conversation is open. Both run on one
list model, so a facet or a bulk verb must behave the same in both. The Inbox
is **gated**: the Inbox view, the Home tile's unread chip and the routes only
render the inbox when at least one **deployed**
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
| By status           | `/dashboard/{org}/conversations/{open\|closed\|spam\|archived}` — desktop: the reading pane beside the Home panel; phone: the list |
| Open conversation   | `…/{status}?conversation={id}` — a Home-panel row links here; the phone list sets it too |
| Source facet        | `…/{status}?channel={gmail\|outlook\|imap_smtp}` — the phone list's Filter panel; the desktop panel remembers its facets per device instead |
| Assignee facet      | `…/{status}?assignee=` — comma-separated ids and sentinels (phone list; the desktop panel as above) |
| Read facet          | `…/{status}?read={read\|unread}` — absent means every state (phone list; the desktop panel as above) |
| Search (in-page)    | the phone list's typed search rides `?search=` (`validateSearch` on `$status`); the panel's search stays out of the URL |
| Compose (in-pane)   | `…/{status}?compose=new[&composeContact={id}]` — the reading pane composer (desktop **New email** `home.inbox.compose`, phone **Compose** `conversations.compose.compose`) |
| Automations (gate)  | `/dashboard/{org}/automations` — install/uninstall the email automations       |

Route files: `app/routes/dashboard/$id/conversations.tsx` (layout + redirect +
the availability guard) and
`app/routes/dashboard/$id/conversations/$status.tsx` (the `$status` segment +
the phone list's URL state). The desktop list is the Home panel's
`app/features/home/components/home-inbox-list.tsx`, on the same list model
(`useInboxList`). Valid statuses are `open`, `closed`, `spam`, `archived`; any
other `$status` throws `notFound()` (see CONV-B2).

**Gating** (`useInboxAvailability`): an automation counts only when its
deployed presentation declares `builtinViews: [{ id: 'inbox' }]` — the builtin
packs are seeded into every org as drafts, so the seeded files alone must NOT
surface the Inbox until someone deploys a sync pack. While the availability
queries load, the Inbox view and the route body stay hidden (no flash). With no
qualifying deploy or registered API source, `…/conversations*` renders a localized empty state
(`conversations.activate.noAutomationTitle` / `.noAutomationDescription`) with
a **Browse automations** link (`conversations.activate.browseAutomations`)
instead of the inbox.

A registered native API source (for example VAT plus) also opens the Inbox and
keeps its conversations in channel `api`. This requires no mail credentials. Use
an isolated integration fixture for CONV-F11; do not create correspondence in a
customer's live account as a manual test.

> **Gating verified live** (2026-08-04, mode A, fresh org with no deployed
> automation): the navigation offered **no Inbox** (CONV-G1 holds) and a
> direct `/conversations` hit redirects to `…/open` rendering **Set up your
> Inbox** with the **Browse automations** link (CONV-G2 holds). The observed
> behaviour is the designed gate; trust the runs over any code comment that
> claims otherwise.

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
so after installing an email automation the reading pane is the **Activate
conversations** CTA (`conversations.activate.title`), the Home panel's Inbox
view reads **No conversations** (`home.empty.inbox.title`), and every control
of the phone list (search box, select-all, filters) is **disabled** —
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
title is its `subject`. On the phone list the full-row button's `aria-label`
is the subject, falling back to the contact name, then **Unknown contact**
(`conversations.unknownContact`); in the Home panel each row is a link that
reads the subject, then contact · last-message preview (the same fallbacks for
the contact). The CLI seed sets no `contactId`, so seeded rows lead with the
subject.

> **Agent note**: on desktop, drive the list inside the Home panel
> (`navigation` landmark **Home**, `home.aria.panel`) with its **Inbox** view
> selected; at 390 px, drive the Inbox page's own list. Status-transition and
> bulk mutations are RLS-wrapped and each writes an audit row via the internal
> `createAuditLog` — the audit-genesis denial that blocked every transition on
> older builds is RESOLVED (see the carry-forward record
> [`R1`](../runs/r0001.md)). Verify a transition by **reload + read-back of the
> persisted status** (the row left its source status and appears in the
> target status after reload), never by the toast.

## Gating tests

- [ ] `CONV-G1` · **Hidden without automation** — On an org with **no** email
  automation installed, load any dashboard page, then the phone's Home list →
  The Home panel's **Show** switcher (`home.views.label`) offers **All**,
  **Chats** and **Tasks** only — no **Inbox** option (`home.views.inbox`;
  `getByRole('radio', { name: 'Inbox' })` count 0) — and neither does the
  phone's Home list; the **All** view lists no conversations; the Home tile
  carries no unread chip; the option also never flashes in during load.
- [ ] `CONV-G2` · **Deep link guarded** — Open
  `/dashboard/{org}/conversations` directly (same org as CONV-G1) → Redirect
  to `…/open` still happens; the body is the localized empty state **Set up
  your Inbox** (`conversations.activate.noAutomationTitle`) + description +
  **Browse automations** link → `/dashboard/{org}/automations`; no crash, no
  console error.
- [ ] `CONV-G3` · **Appears after install** — Install **Sync Outlook emails**
  from `/dashboard/{org}/automations/outlook__reply-emails` (wizard: **Next**
  on Install, **I'll do this later** on the Outlook connect step, **Finish**)
  → The **Inbox** option (`home.views.inbox`) appears in the Home panel's
  switcher without a reload, and choosing it lists the Open conversations;
  `/conversations/open` now shows the inbox, not the set-up state; the
  automation's own page shows only workflow-settings tabs (Configuration /
  Connectors) — **no Inbox tab**. Uninstalling the last email automation
  removes the option again (a remembered Inbox view falls back to **All**) and
  CONV-G2 applies again.

## Functional tests

- [ ] `CONV-F1` · **Inbox redirect** — Open `/dashboard/{org}/conversations`
  (email automation installed) → URL becomes
  `/dashboard/{org}/conversations/open`. Desktop: the Home panel stands beside
  it and the page is the reading pane alone, reading **No conversation
  selected** (`conversations.panel.noSelected`) until one opens — no list
  column and no status tabs of its own. At 390 px the page is the list, headed
  **Inbox** (`conversations.title`).
- [ ] `CONV-F2` · **Statuses** — Desktop: in the Home panel's **Inbox** view
  open the status menu (`home.inbox.statusLabel`) and pick **Open** /
  **Closed** / **Spam** / **Archived** (`home.inbox.status.*`), once while on a
  chat and once on `/dashboard/{org}/conversations/open` → The list switches to
  that status either way; away from the inbox the pick is remembered (it
  survives a reload); on an inbox route it also moves the URL to
  `…/{open\|closed\|spam\|archived}`, and there the URL's status wins over the
  remembered one. At 390 px the Inbox page shows the four statuses as links
  (`conversations.status.*`) in that order, with approximate-count badges; a
  click commits `…/{status}` and the clicked link stays visible after nav.
- [ ] `CONV-F3` · **Search (client-side)** — In a **populated** status, type in
  the **Search conversations** box (`conversations.searchPlaceholder`) — the
  Home panel's Inbox view on desktop, the Inbox list at 390 px → The visible
  rows narrow to title/subject/description/contact-name matches; in the panel
  a match beyond the first loaded page still turns up (it keeps loading pages
  while a search or facet is active) and the search stays out of the URL; on
  the phone list the search syncs to `?search=` and clears on a status switch.
- [ ] `CONV-F4` · **Read facet** — Open **Filter**
  (`common.labels.filter`) to the RIGHT of the search box; expand **Read
  status** (`conversations.filter.readStatus`); choose **All** / **Read** /
  **Unread** (`conversations.filter.all` / `.read` / `.unread`) → Rows scope to
  that read state (Unread keeps only rows with the unread dot); the section
  header carries a blue dot and the button a blue corner dot while a non-All
  value is set; the choice survives a reload — the desktop panel remembers it
  on this device (the URL carries no facet), the phone list carries it in the
  URL as `?read=` (**All** drops the param).
- [ ] `CONV-F5` · **Source facet** — **Precondition:** the org has at least one
  inbox source to offer (an installed email connector or an API-synced
  thread). Open **Filter**, expand **Channel**
  (`conversations.filter.channel`) → The options are **All channels**
  (`conversations.filter.allChannels`) + one entry per **installed** provider,
  labelled with the connector's display title (e.g. **Microsoft Outlook**);
  pick one → the list re-queries server-side (`listConversationsPaginated`
  with `connectorName`) and only rows seeded with that `connectorName` remain;
  the phone list's URL gains `?channel={slug}`, the desktop panel remembers
  the pick on this device. **All channels** clears it. With no source at all
  the facet is absent (CONV-F20).
- [ ] `CONV-F6` · **Open conversation** — In a populated status, click a row
  (desktop: a link in the Home panel's Inbox view; 390 px:
  `getByRole('button', { name: '<subject>' })` on the Inbox list) → The
  reading pane replaces "No conversation selected" with the conversation
  header + message history; the row's unread dot clears
  (`markConversationAsRead`); the URL gains `?conversation={id}`, so a reload
  or a shared link reopens it; in the panel the row stays highlighted
  (`aria-current="page"`).
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
- [ ] `CONV-F10` · **Bulk transitions** — Desktop: in the Home panel's Inbox
  view hover a row's initials and tick the checkbox that takes their place
  (`dialogs.selectConversation`); at 390 px use the list's **Select all**
  checkbox (aria `common.aria.selectAll`) → "**N selected**"
  (`conversations.bulk.selectedCount`) replaces the search box (in the panel,
  a toolbar with its own **Select all** checkbox, `common.aria.selectAll`) →
  per-status icon actions (tooltips): Open → **Send messages** / **Close** /
  **Mark as spam** / **Archive**; Closed & Spam → **Reopen** + **Archive**;
  Archived → **Unarchive** (`conversations.bulk.*`) → Selected rows leave the
  source status and appear in the target **after reload**; the selection
  clears, and a conversation open beside the list closes (the page returns
  to the status list, as on the inbox page); **Send messages** opens the
  bulk-send dialog (`conversations.bulkSend.*`) and stays disabled while
  another bulk action runs

- [ ] `CONV-F11` · **Reply through an API source** — In an isolated organization with a registered API source and no email automation, open Inbox and its synchronized customer thread, send a reply with a supported attachment, then let the source worker poll → The same reply and attachment appear once in the source app, native delivery becomes delivered, and an acknowledgement retry creates no extra message; keyboard focus remains usable after send.

- [ ] `CONV-F12` · **Queue chip and assignee facet** — With one conversation
  assigned to team A (routing rule or assignee picker), one to a person and one
  unassigned, as an owner, then as a member of team A only → On the phone
  list (390 px) each row queued to a team shows that team's NAME as a chip; a
  row assigned only to a PERSON shows no chip (the person is visible in the
  reading pane's assignee picker, not on the row); the Home panel's rows carry
  no chips on desktop. Open **Filter** → **Assignee**
  (`conversations.filter.assignee`) offers **Assigned to me**
  (`conversations.filter.assigneeMe`), **Unassigned**
  (`conversations.filter.assigneeUnassigned`, admins only), **My teams**
  (`conversations.filter.assigneeMyTeams`), then a **People**
  (`.assigneePeople`) group and a **Teams** (`.assigneeTeams`) group naming
  only the assignees present on the loaded rows. **My teams** keeps only the A
  row; the choice survives a reload (the phone list carries it as
  `?assignee=…`, the desktop panel remembers it on this device); the member of
  A sees no **Unassigned** option and no unassigned rows at all.

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
  an email automation deployed, open the composer — **New email**
  (`home.inbox.compose`) in the Home panel's Inbox view, or **Compose**
  (`conversations.compose.compose`) on the phone list — and type into **To**
  (`conversations.compose.to`) a full address no contact
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
  rows remain (on the phone list `?assignee=<userId>` lands in the URL; the
  desktop panel keeps the pick across a reload). Tick a second person
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
- [ ] `CONV-F19` · **The Inbox names the channel** — In an org with TWO email
  connectors installed and at least one API-synced thread, as an owner → On
  the phone list (390 px) each row carries a channel chip: the mailbox's name
  for an email thread, the source slug for an API one, and no chip at all on
  a thread that names neither. Open an email thread → The header's context
  line ends on **{mailbox} · {address}**,
  not the address alone. Open the API thread → The header reads
  `conversations.header.apiSource` with its source, where it previously showed
  nothing. The composer names the destination in both
  (`conversations.header.replyVia` / `replyViaApi`), and the reply lands on
  that same channel.

- [ ] `CONV-F20` · **The channel filter offers every lane** — Same org → Open
  **Filter** → **Channel** (`conversations.filter.channel`); it lists each
  installed email connector by title plus each distinct API source by slug, and
  never the same slug twice. Pick one → Only that channel's rows remain; reload
  and the choice survives (the phone list carries `?channel=<slug>` in the URL,
  the desktop panel remembers it on this device). In an org with no connector
  and no API thread, the Channel facet does not appear at all.

- [ ] `CONV-F21` · **Two mailboxes on one connector each name themselves** —
  With TWO credentials on one email connector (mailboxes A and B, B listed
  last), mail the organization at A's address → The phone list's row chip
  reads A's name, and the header reads **{A} · {A's address}**, never B's name beside
  A's address. The composer reads `conversations.header.replyVia` with A, and
  the reply leaves from A. Open a thread from before the mailboxes recorded
  where mail arrived, written to A's address → It is named A too. Open one
  written to an address neither mailbox has → The header shows the address
  alone, with no mailbox name.

- [ ] `CONV-F22` · **A reply on an API thread shows at once** — On an API-synced
  thread, send a reply from the Inbox → The bubble appears in the thread
  straight away with its undo countdown, before the source app has claimed or
  acknowledged it; **Undo** inside the window removes it. Send another and have
  the app fail it permanently → The bubble stays, marked not delivered, with
  **Retry** and **Discard**.

- [ ] `CONV-F23` · **Compose sends from the mailbox you pick** — With TWO
  mailboxes on one email connector (A the default, B not), open the composer
  (**New email** `home.inbox.compose` on desktop, **Compose** on a phone) →
  The **Inbox** field (`conversations.compose.inboxLabel`) lists both by name,
  each with its address. Pick B and send → The email arrives from B's address,
  the new thread's header names B, and a reply on that thread before the
  correspondent answers also leaves from B. Close and reopen Compose with a
  draft on B → B is still selected.
- [ ] `CONV-F24` · **A retry leaves from the same mailbox** — With the same two
  mailboxes, make a send through B fail (for example, stop B's SMTP host), then
  restore it and choose **Retry** on the failed bubble → The email arrives from
  B, not from the default A.
- [ ] `CONV-F25` · **The channel filter lists each mailbox** — With TWO
  mailboxes on one email connector, open **Filter** → **Channel**
  (`conversations.filter.channel`) → The connector appears as two entries, one
  per mailbox, each by its name; a disabled one reads
  `conversations.filter.mailboxInactive`. Pick one → Only the threads of that
  mailbox remain (on the phone list, the ones whose chip names it) and a
  reload keeps the choice — as `?mailbox=<id>` in the phone list's URL, on
  this device in the desktop panel. A connector with a single mailbox is
  still one entry that filters by its channel (`?channel=<slug>` on the phone
  list).

- [ ] `CONV-F26` · **An integration queues its conversation to a team** — With an
  owner's API key that mirrored an API conversation, call
  `POST /api/v1/conversations/assignment` with its `source`, `externalId` and a
  `teamId` from `GET /api/v1/teams` → 200; the Inbox header shows the team
  chip, the team's members get a notification and can open the thread. Call
  it again with `teamId: null` → the team chip is gone. The same call with an
  editor's key → 403 `ROLE_FORBIDDEN`, and nothing changes.

- [ ] `CONV-F27` · **The Inbox view in the Home panel** — Desktop, populated
  inbox: pick **Inbox** (`home.views.inbox`) in the Home panel's switcher →
  The projects and the mixed list give way to the inbox's own tools: the
  status menu (`home.inbox.statusLabel`) with **New email**
  (`home.inbox.compose`) beside it, the search box and the icon-only
  **Filter** button (`common.labels.filter`); below them that status's
  conversations in Home's time bands (`home.groups.*`), each row the
  contact's initials, the subject, contact · last-message preview and its age,
  bold with a blue **Unread** dot (`home.row.unread`) while unread. Scrolling
  to the end loads the next page on its own, with a small spinner and no
  "load more" button. **New email** opens the composer in the reading pane
  (`…/{status}?compose=new`); an empty status reads **No conversations**
  (`home.empty.inbox.title`) with `home.empty.inbox.hint`.
- [ ] `CONV-F28` · **Selecting in the panel** — In the Inbox view hover a row,
  tick the checkbox that takes the place of its initials, then Tab to another
  row → Once one row is ticked every row shows its checkbox and ticked rows are
  tinted; the toolbar names the count (**N selected**,
  `conversations.bulk.selectedCount`) and its select-all box reads
  indeterminate while only some rows are ticked; a row's checkbox also shows
  while the row holds keyboard focus; **Clear selection**
  (`home.inbox.clearSelection`) or a status switch drops the selection;
  clicking a row's text still opens the conversation rather than ticking it.
  At 390 px, where nothing hovers, every row of the Inbox view shows its
  checkbox from the start in place of the initials, so a tap on one begins a
  selection.
- [ ] `CONV-F29` · **The conversation header** — Open an email conversation
  with a named contact, at desktop width and at 390 px → One header row: the
  **Hide sidebar** toggle (`home.panel.hide`) on desktop, the back arrow
  (`common.aria.back`) to `/dashboard/{org}/home` on a phone; the contact's
  initials as a button (**Contact info**, `conversations.header.contactInfo`)
  that opens the contact card; the subject as the title; under it the
  contact's name (which opens the card too) · their email (desktop only) ·
  the last message's relative time · the source (**{mailbox} · {address}**,
  or the API source); then the assignee picker (**Assign**,
  `conversations.header.assign`, while unassigned) and **More actions**
  (`conversations.header.moreActions`). The reply box under the thread wears
  the chat composer's frame (placeholder `conversations.messagePlaceholder`).
- [ ] `CONV-F30` · **The phone's Inbox** — At 390 px, in an org with an inbox,
  open `/dashboard/{org}/conversations/open`; then go back and pick **Inbox**
  in the Home list's switcher → The Inbox page shows its own list while no
  conversation is open: the header **Inbox** (`conversations.title`), the
  status links with count badges (CONV-F2), **Compose**
  (`conversations.compose.compose`), the search box, **Filter** and the
  select-all checkbox; opening a conversation replaces the list with the
  thread, whose header starts with the back arrow (`common.aria.back`) to
  `/dashboard/{org}/home`. The Home list's Inbox view offers the same status
  menu, search and facets as the desktop panel (CONV-F27) and opens the same
  conversation pages.

## Boundary & error tests

- [ ] `CONV-B1` · **Search with no matches** — Type a term matching nothing in
  a populated status's search box → The Home panel's Inbox view reads **No
  conversations** (`home.empty.inbox.title`) with **No conversation matches
  the search or filters.** (`home.empty.inbox.filtered`) once every page has
  been searched; the phone list shows **"No conversations in this tab"**
  (`conversations.list.empty`); no crash, no console error.
- [ ] `CONV-B2` · **Invalid status** — Open
  `/dashboard/{org}/conversations/bogus` → The `$status` route throws
  `notFound()`; the page renders the Not Found boundary inside the Inbox
  chrome (no 500, no console error)
- [ ] `CONV-B3` · **Activate-empty status** — A status on an org with an email
  automation installed but **zero** conversations → Reading pane shows the
  empty state **No conversations yet** (`conversations.activate.title`) +
  **Incoming conversations from your connected channels will appear here.**
  (`conversations.activate.description`); the Home panel's Inbox view reads
  **No conversations** (`home.empty.inbox.title`); at 390 px the list's
  search box + select-all + filters are **disabled**.
- [ ] `CONV-B4` · **Unknown filter params** — At 390 px (the URL facets belong
  to the phone list), open `…/open?channel=bogus&assignee=nobody` by hand →
  The list queries with
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

- [ ] `CONV-A1` · **Status switch** → Desktop: the Home panel's status menu
  (`home.inbox.statusLabel`) opens from the keyboard (Enter/Space), its items
  are arrow-navigable with the current status marked, and the trigger's
  accessible name contains the status it shows (WCAG 2.5.3, label in name).
  At 390 px the status tabs are **navigation links** inside a labelled `<nav>`
  (role `link`, **not** an ARIA `tablist`); each link is keyboard-focusable
  and Enter-activates the status.
- [ ] `CONV-A2` · **List rows** → In the Home panel each row is a link named
  by its text (subject, then contact · preview), the open one
  `aria-current="page"`; on the phone list each row's full-row select target
  is a real `<button>` with an accessible name (subject → contact name →
  Unknown contact); both are reachable and openable by keyboard.
- [ ] `CONV-A3` · **Bulk select** → Per-row checkboxes are labelled
  `dialogs.selectConversation` and, in the Home panel, become visible when
  they (or their row) take keyboard focus; the select-all control is a
  labelled checkbox (`common.aria.selectAll`) that stands alone — no chevron
  hangs off it; the panel's selection bar is a `toolbar` named by its count
  (`conversations.bulk.selectedCount`) whose icon buttons are each named
  (`conversations.bulk.*`, `home.inbox.clearSelection`).
- [ ] `CONV-A4` · **Filter panel** → The trigger is a real `<button>` whose
  accessible name is **Filter** (`common.labels.filter`) even though no label
  is drawn; each facet header is a `button` with `aria-expanded`; multi-select
  options are labelled `checkbox`es, single-select options are `radio`s inside
  a labelled `radiogroup`, and a grouped facet labels each `radiogroup` by its
  group heading; the panel is NOT modal, so the list stays in the
  accessibility tree behind it; Escape closes it and returns focus to the
  button; fully keyboard-operable.
- [ ] `CONV-A5` · **Inbox entry** → The Inbox is reached through the Home
  panel's switcher: a `radio` named **Inbox** (`home.views.inbox`) in the
  **Show** radiogroup (`home.views.label`), reachable with the arrow keys; the
  phone's Home list offers the same radio. Neither the rail nor the tab bar
  carries an Inbox entry of its own; the Home tile and tab announce the
  unread count in their names (NAV-F23).
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
  → `/conversations/open` shows the reading pane beside the Home panel's
  Inbox view with its first rows (or the activate-empty CTA), and at 390 px
  the header + list, within **2 s** of navigation (loader prefetches the
  status count + first page)
- [ ] `CONV-P2` · **Status switch (mock stack, warm)** → Picking another status
  in the panel's status menu (a status link at 390 px) commits the URL and
  repaints the list within **1 s**.
- [ ] `CONV-P3` · **Search keystroke (populated, ≤30 rows)** → Filtered rows
  update within **300 ms** of typing (client-side `filterByTextSearch`, no
  network round-trip)
- [ ] `CONV-P4` · **Source facet switch (warm)** → Selecting a channel in the
  Filter panel repaints the list within **1 s** (one server-side paginated
  re-query). Needs the CONV-F5 precondition.
- [ ] `CONV-P5` · **Mailbox facet switch (warm, populated)** → With two
  mailboxes on one connector and a few thousand conversations, selecting one
  mailbox in the Channel filter repaints the list within **1 s**. Needs the
  CONV-F25 precondition.
