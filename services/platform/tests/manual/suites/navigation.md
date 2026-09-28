# Navigation & shell

> **Prefix** `NAV-` · **Reset** none · **Cost** 64 boxes

Exercise cross-app navigation — the primary side-nav rail and the section
panels beside the page (the Home panel with its projects and its one stream of
chats, tasks and inbox conversations; the Knowledge panel), the breadcrumb
trail, browser back/forward, the command palette (Cmd/Ctrl+K), the org
switcher and team filter, the changelog viewer, the embedded Swagger page, and
the shared DataTable behaviours (search-filter, pagination, bulk select). No
provider needed — every route here renders offline in the deterministic stack.
Shell/PWA/connectivity behaviours (changelog release toast, install sheet,
service-worker update, offline gate, the boot shell) live HERE;
[responsive.md](responsive.md) keeps viewport-layout rows only. Chat-row verbs
live in [chat.md](chat.md), the Inbox view in
[conversations.md](conversations.md), the task page in [tasks.md](tasks.md).

## Scope & routes

| Surface              | Route                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary nav sections | `/dashboard/{org}/{chat\|documents\|automations\|settings}` — the rail's **Home**, **Knowledge**, **Automations** and (at its foot) **Settings**                                      |
| Home routes          | `/dashboard/{org}/{chat\|projects\|conversations}/…` and `/dashboard/{org}/tasks/{taskId}` — the Home panel stands beside every one                                               |
| Home list (phone)    | `/dashboard/{org}/home` — a desktop visit redirects to `/dashboard/{org}/chat`                                                                                                      |
| Knowledge            | `/dashboard/{org}/documents` (the "Knowledge" rail item)                                                                                                                             |
| Settings landing     | `/dashboard/{org}/settings` → redirects by role (`getDefaultSettingsRoute`): `…/settings/organization` (owner/admin), `…/settings/connectors` (developer), else `…/settings/account` |
| Governance group     | `/dashboard/{org}/settings/governance` → redirects to `…/governance/content-models`                                                                                                  |
| Governance sub-page  | `/dashboard/{org}/settings/governance/policies-limits`                                                                                                                               |
| Org-switch staging   | `/dashboard/switching?to={otherOrg}` → redirects to `/dashboard/{otherOrg}`                                                                                                          |
| Changelog            | `/dashboard/changelog` (`?from=…&to=…`)                                                                                                                                              |
| Swagger              | `/docs`                                                                                                                                                                              |

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). For NAV-F4
(command palette) have at least one chat thread with searchable content.
NAV-F5 (org switcher) needs the signed-in account to belong to **two or more**
orgs — a freshly-seeded single-org account cannot switch. NAV-F6 (teams row)
needs the signed-in account to be a member of **at least one team** (Settings
→ Teams → add yourself); the row is always present once the teams have
loaded, and reads **No teams** for an account in none.

> **Agent note**: smoke every route once (navigate + check it renders), then
> drive NAV-F4/NAV-F8/NAV-A1 by hand. The palette (Cmd/Ctrl+K, or the rail's
> **Search** tile `navigation.sidebar.search`) is mounted on every dashboard
> route. The Home panel is the `navigation` landmark named **Home**
> (`home.aria.panel`) and exists at ≥ 768 px only; scope row lookups to it,
> because a chat's title also appears in the chat header. The changelog
> fetches GitHub releases; offline it lands on the "up to date" state, not a
> crash.

## Functional tests

- [ ] `NAV-F1` · **Side nav** — In the rail (`<nav aria-label>` = **Main
  navigation**, `common.aria.mainNavigation`) click each tile in order:
  **Home** (`navigation.home`), **Knowledge** (`navigation.knowledge`),
  **Automations** (`navigation.automations`); then **Settings**
  (`navigation.userSettings`), which sits at the rail's foot with the
  **Notifications** bell (`navigation.notifications`) and the account menu
  (`auth.userButton.manageAccount`) → Each click commits that section's
  DEFAULT entry: Home opens `/chat` (the chat you last read, else a blank
  composer) with the Home panel (`home.aria.panel`) beside it; Knowledge
  `/documents` (its pages — Documents, Knowledge entries, Websites, Products
  and Contacts — sit as tabs under its header, NAV-F32); Automations
  `/automations`; Settings the role's
  default landing
  (`/settings/organization` for the seeded **owner** — see Scope & routes).
  The main nav holds exactly those three tiles in that order — no Chat,
  Projects or Inbox tile; one highlight pill glides from the tile you left to
  the one you chose; Home stays lit on every Home route (a chat, a project, a
  task page, the inbox); the rail persists across navigations.
- [ ] `NAV-F2` · **Breadcrumbs** — Open `/dashboard/{org}/projects`, click a
  project row to open it (`/dashboard/{org}/projects/{projectId}`) → The
  adaptive header shows a breadcrumb trail (e.g. **Projects** → project name);
  the leaf is a switcher button (`projects.switcher.ariaLabel`) opening a
  searchable menu of sibling projects — an automation's page carries the same
  switcher on its name (`automations.switcher.ariaLabel`); clicking the parent
  **Projects** crumb returns to `/dashboard/{org}/projects`
- [ ] `NAV-F3` · **Back/forward** — Visit chat → projects → agents, then
  browser Back twice, then Forward once → The URL and the visible section
  content track each history entry; no error boundary; no blank view.
- [ ] `NAV-F4` · **Command palette** — On `/dashboard/{org}/chat` press
  **Cmd/Ctrl+K**; type thread content into the **Search** field
  (`dialogs.search.placeholder`) → A `role="dialog"` palette opens on
  **Everything** (`dialogs.search.scopeEverything`) with the **Search** input;
  typing matches a thread; selecting it navigates to that thread; **Esc**
  closes the dialog. ⌘K toggles this palette, and the rail's **Search** tile
  (`navigation.sidebar.search`) opens the same dialog; its **Chats** scope
  (`dialogs.search.scopeChats`) narrows it to chats without closing
  (`CHAT-F30`).
- [ ] `NAV-F5` · **Org switcher** — Open the **Organization** switcher
  (`navigation.orgSwitcher.label`) in the org button; pick a second org (needs
  ≥2 orgs) → URL passes through `/dashboard/switching?to={otherOrg}` (shows
  the switching spinner), then lands on `/dashboard/{otherOrg}/…`; data is
  scoped to the new org.
- [ ] `NAV-F6` · **Teams row** — In the user/avatar menu (bottom-left), read
  the **Teams** row (`navigation.myTeams.label`), then click it → The row is a
  plain item, not a picker: its badge COUNTS the caller's teams
  (`navigation.myTeams.count`; `navigation.myTeams.none` for an account in no
  team), and the **Teams** label reads in full — never clipped to an ellipsis,
  at any team count or locale; clicking it closes the menu and lands on
  `/dashboard/{org}/settings/account#teams` with the **Your teams** section
  (`settings.account.teams.title`) in view, which is where the names live; no
  list anywhere changes — a team is an audience label on work, never a context
  to switch into.
- [ ] `NAV-F7` · **Governance disclosure** — **Settings** → in the settings
  rail (`<nav aria-label>` = **Settings**, `navigation.userSettings`) expand
  **Governance** (`navigation.governance`) → click **Policies & Limits**
  (`governance.groups.policiesAndLimits`) → The Governance group expands; URL
  commits `/dashboard/{org}/settings/governance/policies-limits` and the page
  renders.
- [ ] `NAV-F8` · **Changelog** — Open `/dashboard/changelog` → Heading
  **What's new** (`changelog.viewer.heading`) is visible. Offline/up-to-date
  stack: shows **You're up to date.** (`changelog.viewer.upToDate`) + **View
  older releases on GitHub ↗** link (`changelog.viewer.viewAllOnGitHub`).
  Online with newer releases: release entries render and the range filters
  (`?from=&to=`) narrow them.
- [ ] `NAV-F9` · **API reference and developer links** — Visit `/docs` → The
  Swagger reference renders the running instance’s contract. Above it,
  **Developer guides** (`settings.apiDocs.guides`) opens the public API guide
  in a new tab; **OpenAPI document (JSON)** (`settings.apiDocs.openapiDocument`)
  opens the same instance’s raw contract in the current tab. Tab through both
  links and repeat at phone width → Both labels remain readable and keyboard
  reachable; no page error.
- [ ] `NAV-F10` · **DataTable behaviours** — On a list with a DataTable (e.g.
  Knowledge → Documents), use the search/filter; paginate
  (`common.aria.previousPage` / `common.aria.nextPage`); **Select all**
  (`common.aria.selectAll`) → **Delete selected**
  (`common.actions.deleteSelected`) → Filter narrows the rows; page controls
  change the visible page; the bulk action affects only the selected rows;
  **reload** to confirm the delete persisted.
- [ ] `NAV-F11` · **User-menu Documentation link** — Open the user/avatar menu
  and find **Documentation** (`auth.userButton.documentation`) → It links to
  the public documentation at `https://docs.tale.dev` in a new tab with
  `target="_blank"` and `rel="noopener noreferrer"`. The API reference is a
  separate surface, reached from the API settings.
- [ ] `NAV-F12` · **Changelog release toast** — Env-gated (the forcing
  mechanism is unverified — check live): sign in on a deployment whose version
  is **newer** than the account's last-toasted version (e.g. first session
  after a version bump) → A **one-shot** toast **Upgraded to v{version}**
  (`changelog.toast.title`, description `changelog.toast.description`) appears
  with a **View** action (`changelog.toast.action`); clicking **View**
  navigates to `/dashboard/changelog?from=…&to=…`. The toast **never re-fires
  for the same version** — reload and re-sign-in show no repeat (the client
  records the toasted version)
- [ ] `NAV-F13` · **Get app / iOS install sheet** — Env-gated (emulate an iOS
  Safari UA, or a browser that offers PWA install): open the user/avatar menu
  (bottom-left) → The menu shows **Get app** (`auth.userButton.getApp`) only
  when the app is installable or the UA is iOS. On iOS, choosing it opens the
  sheet **Install Tale** (`auth.userButton.iosInstall.title`) with the steps
  **"Tap the Share button in your browser's toolbar."**
  (`auth.userButton.iosInstall.step1`) and **'Choose "Add to Home Screen",
  then tap "Add".'** (`auth.userButton.iosInstall.step2`), closed by **OK**
  (`auth.userButton.iosInstall.done`)
- [ ] `NAV-F14` · **Service-worker update toast** — Env-gated (production
  build with a **waiting** service worker — a dev stack registers no SW): load
  the app while a newer SW is waiting → Toast **Update available**
  (`pwa.updateAvailableTitle`) with **A new version of Tale is ready.**
  (`pwa.updateAvailableDescription`) and an **Update now** action
  (`pwa.updateNow`); clicking it reloads the page onto the new version.
  Separately, the benign one-off toast **"Tale is ready to work offline."**
  (`pwa.offlineReady`) fires on first SW install — expected, do **not** file
  it (it can photobomb unrelated screenshots)
- [ ] `NAV-F15` · **Archived work in the palette** — Needs a project with one
  archived task and one live task, plus a second project that is itself
  archived and still holds a live task. Press **Cmd/Ctrl+K** on **Everything**
  (`dialogs.search.scopeEverything`) and search a term all four share → Every
  row appears. The archived task carries the **Archived** badge
  (`dialogs.search.badgeArchived`); the live task in the archived project
  carries **Archived project** (`dialogs.search.badgeProjectArchived`); the
  live task in the live project carries neither. Live rows list above archived
  ones. The badge reads as a quiet chip beside the title, not a second
  heading, and stays legible in dark mode and at 400px width.

- [ ] `NAV-F16` · **A rail click is not a history replay** — Open
  **Knowledge** and switch to **Websites**; click **Home**, then **Knowledge**
  again → You land on `/documents`, not Websites. Repeat for **Automations**
  (open one automation's **Runs** tab → `/automations`) and **Settings** (open
  **Teams** → the role's default landing): each opens the section's own first
  page, never the tab or record you left. Only **Home** resumes, because its
  entry point reopens the last chat you read (`NAV-F18`): open a project's
  board with a task open (`?task=…`), click **Knowledge**, then **Home** → you
  land on that chat, not on the board.
- [ ] `NAV-F17` · **Re-entry resets the section** — While sitting on a
  project's board (inside Home), click the **Home** tile you are already on →
  A fresh composer opens (`/chat?new=true`) and the Home panel's list gains
  the draft row **New chat** (`home.newChat`) at the top, marked current. Same
  gesture in **Knowledge** (from **Websites**) lands on `/documents`; in
  **Settings** on the role's default landing.
- [ ] `NAV-F18` · **Home resumes the last chat** — From **Knowledge**, click
  **Home** → It opens the chat you last READ (not merely the one with the
  newest activity: have a second account post into an older chat first, then
  confirm the tile still reopens yours). Now click **Home** again while
  already in Home — on a chat, a project, a task page or the inbox → A fresh
  composer opens (`?new=true`), not a chat. ⌥⌘N (Alt+Ctrl+N off a Mac), shown
  in the tile's tooltip, does the same from any page.
- [ ] `NAV-F20` · **A pasted key stays in page memory** — Open `/docs`, click
  **Authorize**, paste an API key, run one request, then reload the page →
  The request went out authorized; after the reload the lock is open again
  and DevTools → Application → Local storage for the origin holds no
  `authorized` entry.
- [ ] `NAV-F21` · **Every overview list is one fixed frame** — At a viewport
  short enough that the rows overflow (1280×720 is enough with ~25 rows), visit
  `/dashboard/{org}/automations`, `/dashboard/{org}/projects` and
  `/dashboard/{org}/knowledge-entries` in turn and scroll each with the wheel →
  On all three the rows move INSIDE the bordered table while the search field,
  the create button, the column header row and the "Showing all N …" footer
  stay put; the page itself never scrolls. In the console,
  `[...document.querySelectorAll('*')].filter(el => el.scrollHeight >
  el.clientHeight + 4 && ['auto','scroll'].includes(getComputedStyle(el).overflowY))`
  returns exactly ONE element per page, and it is
  `[data-testid="data-table-scrollport"]` — never the page shell
  (`[scrollbar-gutter:stable]`). Filter a list down to two rows: the frame
  hugs those rows instead of stretching. Repeat at 390×740: the frame ends
  above the bottom tab bar, same three pages, same behaviour.

- [ ] `NAV-F22` · **Every overview list ends on the same footer** — With ~25
  rows seeded in each, visit `/dashboard/{org}/documents`,
  `/dashboard/{org}/knowledge-entries`, `/dashboard/{org}/websites`,
  `/dashboard/{org}/products` and `/dashboard/{org}/contacts` in turn → Each
  ends on ONE sticky line inside the bordered frame reading "Showing all N
  <entity>" (`common.pagination.showingAll`, the noun from the list's own
  `entityLabel` — "products", "contacts"); none of them renders a page
  selector or Previous/Next buttons (`common.aria.previousPage` /
  `common.aria.nextPage`) below the frame. On Contacts, click the **Name**
  column header → the list re-orders across ALL contacts (row 1 is the
  alphabetically first contact in the org, not the first of the loaded page)
  and the footer still reads "Showing all N contacts".
- [ ] `NAV-F23` · **Inbox unread chip** — Needs an account whose Inbox shows at
  least one OPEN conversation with unread messages (send one to a connected
  mailbox, or leave a seeded one unopened). Look at the **Home** tile in the
  left rail → It carries a small count chip on the icon, reading the number of
  OPEN conversations with unread messages, never the total Open count. Open one
  of those conversations, then look at the rail again → the chip drops by one
  (reading it clears `unread_count`); clear them all and the chip disappears
  rather than showing **0**. With a screen reader (or the accessibility
  inspector), focus the tile → it announces "Home, N unread conversations"
  (`navigation.home` + `navigation.aria.unreadConversations`), NOT a bare
  "Home" and NOT a stray "N". Past 99 unread the chip reads **99+** while the
  announced name still carries the true number. Now narrow the window below
  **768 px** → the **Home** tab in the bottom tab bar carries the SAME count,
  and announces the same name; the two navs never disagree, because both read
  one `/conversations/counts` body.
- [ ] `NAV-F24` · **The chip counts only what the viewer may open** — Sign in
  as a NON-admin member. In a second session as an admin, leave an OPEN unread
  conversation assigned to nobody, and a second one assigned to the member (or
  to one of their teams) → The member's Home chip counts ONLY the second one:
  the unassigned triage row is invisible to them, in the chip exactly as in the
  Home panel's Inbox view. The admin's own chip counts both.
- [ ] `NAV-F25` · **The offline shell is real and a first visit is not an
  update** — Needs a production build (`bun run build` — it runs
  `scripts/check-sw-manifest.ts`, which refuses a precache manifest with a
  URL listed twice or an un-revisioned entry). Open the app in a browser
  profile that has never visited it → no **Update available**
  (`pwa.updateAvailableTitle`) toast (only the one-off
  **"Tale is ready to work offline."**, `pwa.offlineReady`); DevTools →
  Application → Cache Storage holds the workbox precache with
  `offline.html` and the icons; go offline and reload → Tale's own offline
  page, not the browser's error page. After a second deploy, load the app
  again → the **Update available** toast appears with **Update now**
  (`pwa.updateNow`) and **Later** (`pwa.updateLater`); **Later** closes it,
  and it dismisses on its own within ~15 s either way.
- [ ] `NAV-F41` · **The Home panel stands beside every Home route** — At ≥ 768
  px open `/dashboard/{org}/chat`, scroll the panel's list down a little, then
  open a project, a task (`/dashboard/{org}/tasks/{taskId}`) and a
  conversation through the panel's own rows, and finally
  `/dashboard/{org}/conversations/open` → A 280 px panel, the `navigation`
  landmark **Home** (`home.aria.panel`), stays beside every one of those
  pages without reloading — its scroll position and the Projects section's
  open state survive each move; it has no header naming it — it opens on the
  view switcher (NAV-F26) with a **New chat** icon link (`home.newChat`,
  tooltip shortcut ⌥⌘N) beside it that opens `/chat?new=true`, and the
  switcher keeps every option's full label beside it in German and French
  (**Aufgaben**, **Réception**). Knowledge, Automations, Settings, a shared
  chat (`/dashboard/{org}/chat/shared/{shareToken}`) and a project's
  automation workbench
  (`/dashboard/{org}/projects/{projectId}/automations/{slug}/…`, full width
  like an automation outside a project, the rail still on **Home**) show no
  Home panel.
- [ ] `NAV-F42` · **The Settings panel's header and the page header end on one line** —
  At ≥ 768 px open `/dashboard/{org}/settings/account` and two more settings
  pages, then zoom the browser to 200 % over the place where the panel meets
  the page → The line under the panel's header (**Settings**) and the line
  under the page header (e.g. **Account**) are ONE continuous rule: no
  one-pixel step where they meet, in light and dark. In the console, both headers'
  `getBoundingClientRect().bottom` are equal.
- [ ] `NAV-F26` · **View switcher** — In the panel's **Show** radiogroup
  (`home.views.label`) pick **All**, **Chats**, **Tasks** and **Inbox**
  (`home.views.all` / `.chats` / `.tasks` / `.inbox`), then move with ←/→;
  reload; switch to another organization and back → Each view narrows the list
  to its kind — All holds your chats, your open tasks and the OPEN inbox
  conversations; **Inbox** is offered only while the org has an inbox — and
  the new list fades in; the selected pill glides between options; the arrow
  keys move the selection and focus together; the choice survives the reload
  and is remembered per organization. **All** keeps listing the OPEN
  conversations whichever status the Inbox view was last left on (pick
  **Closed** in the Inbox view's status menu, then **All** again). A view
  holding something that needs you (an unread chat, a task waiting for your
  review, an unread conversation) carries a small accent dot announced as
  `home.aria.attention`.
- [ ] `NAV-F27` · **Time bands and ages** — With chats, a task assigned to you
  and an open conversation whose last activity is today, yesterday, three days
  ago and two weeks ago, plus one pinned chat, read the **All** view → Rows sort
  newest first under **Pinned**, **Today**, **Yesterday**, **Previous 7 days**
  and **Earlier** (`home.groups.*`); empty bands are left out; pinned chats
  lead above every band; band headings stay pinned while the list scrolls.
  Each row ends on a short age — "now", "5m", "3h", "2d", then a date once a
  week has passed — abbreviated in the locale's own short form, from the
  browser's locale data (German in Chrome reads "3 Std."), and the ages move
  on without a reload.
- [ ] `NAV-F28` · **One row anatomy** — Read a chat, a task and a conversation
  row side by side → A chat row: a speech-bubble glyph, its title (**Untitled
  chat**, `home.row.untitledChat`, when it has none), then its project (or
  **Chat**, `home.row.chat`), with pin and **Shared** marks where they apply;
  while a reply streams it reads **Writing a reply…** (`home.row.generating`)
  with a spinner instead of the age. A task row: its status glyph and title,
  then its key (when the project has one) and status — or **Waiting for your
  review**
  (`home.row.awaitingReview`) — and it opens `/dashboard/{org}/tasks/{taskId}`.
  A conversation row: the contact's initials, the subject, then contact ·
  last-message preview, and it opens
  `/dashboard/{org}/conversations/{status}?conversation={id}`. Whatever needs
  you (a chat with a reply you have not read, a task waiting for your review,
  an unread conversation) shows a bold title and an accent dot named **Unread**
  (`home.row.unread`) in the same place on every kind. A title too long for
  the panel ends in an ellipsis, and hovering it shows the whole title.
- [ ] `NAV-F29` · **The open item stays in sight** — Paste the URL of a chat, a
  task page and a conversation that sit far down the list, one after another;
  then press **New chat** (`home.newChat`) → Each time the panel scrolls the
  open item's row into view and highlights it (`aria-current="page"`); the
  fresh composer adds a draft row **New chat** (context **Draft**,
  `home.row.draft`) at the top of the list, marked current, which gives way to
  the real chat row under **Today** once the first message is sent.
- [ ] `NAV-F30` · **Empty views** — In a fresh org with no chats, no task
  assigned to you and an inbox with no conversations, open
  `/dashboard/{org}/conversations/open` (a fresh composer fills **All** and
  **Chats** with its draft row instead), pick each view and press the button
  it offers → **All** reads **Nothing here yet** (`home.empty.all.title`)
  with its hint (`home.empty.all.hint`); **Chats**, **Tasks** and **Inbox**
  read their own title and hint (`home.empty.chats.*`, `home.empty.tasks.*`,
  `home.empty.inbox.*`) under an icon. **All** and **Chats** offer **New
  chat** (`home.newChat`, with the pencil), which opens
  `/dashboard/{org}/chat?new=true`; **Tasks** offers **All projects**
  (`home.projects.allProjects`), which opens `/dashboard/{org}/projects`;
  **Inbox** offers none. No view is left blank or on an endless skeleton.
- [ ] `NAV-F31` · **Hide and show the panel** — On a chat, a task page and an
  open conversation, press **Hide sidebar** (`home.panel.hide`), the first
  control of the header; reload; open another chat; press **Show sidebar**
  (`home.panel.show`) → The panel slides shut — its rows clip at a fixed width
  rather than rewrapping — and the page takes the room; the toggle flips its
  name and `aria-expanded`; the fold
  survives the reload and holds on all three kinds of page in this
  organization (local storage key `chat-history-panel-open-{orgId}`). On a
  project page and on the inbox with no conversation open
  (`/dashboard/{org}/conversations/open`) the panel shows even while folded,
  and no toggle is offered. Phones never show the toggle.
- [ ] `NAV-F32` · **Knowledge tabs** — At a desktop width and at phone width
  open `/dashboard/{org}/documents`, then click each tab of the Knowledge tab
  strip (the `navigation` landmark **Knowledge navigation**,
  `common.aria.knowledgeNavigation`) → The header reads **Knowledge**
  (`knowledge.title`) and draws no divider of its own; under it the strip's
  tabs **Documents**, **Knowledge entries**, **Websites**, **Products** and
  **Contacts** (`knowledge.documents` … `knowledge.contacts`) carry the
  header's one line; the open page's tab is underlined and
  `aria-current="page"`, and each page fades in under the strip. No panel
  stands beside the page at any width.
- [ ] `NAV-F33` · **One highlight glides through Home's lists** — At ≥ 768 px
  open a chat from the Home panel, then another chat, a task and a
  conversation from the stream; open a project from **Projects**; go back to
  a chat; in the **Inbox** view open two conversations in turn; last, drag a
  chat row a little and drop it back → The open row's fill is ONE highlight
  that glides from the row you left to the row you opened, across bands too,
  as the rail's pill and the Knowledge panel's highlight do. Opening the
  project fades the stream's highlight out where it stood and fades one in on
  the project row; going back to the chat does the same in reverse — no
  highlight ever slides in from a corner of its list. While the chat is
  dragged the highlight steps away, and it lands back on the open row after
  the drop.
- [ ] `NAV-F34` · **New rows drop into place** — On the **All** view, send the
  first message of a fresh chat; from a second session assign you a task;
  let a conversation arrive (or seed one, conversations.md Preconditions);
  then reload, and switch to
  **Chats** and back → Each row that joins the list while it is on screen
  drops into its band with a short slide and fade while the rows around it
  make room; the reload and each switch of view paint the whole list with a
  fade only — no row slides in.
- [ ] `NAV-F35` · **Opening in place fades** — Open a chat, then another chat
  from the panel; a task page, then another task; a conversation, then
  another; then move chat → task → project → another project → conversation;
  last, send the first message of a fresh composer → Each item opening where
  the last one stood fades in from faint (opacity only: nothing slides, the
  header and composer stay put, the transcript lands where it would without
  the fade); each change of kind of page, and each change of project, fades
  the page beside the panel while the panel stays still; the chat born from
  its first message does NOT fade — the composer and the sent message stay as
  they are while the URL gains the chat's id.
- [ ] `NAV-F36` · **Fold the panel from the keyboard** — On a chat, a task
  page and an open conversation press ⌘\ (Ctrl+\ off a Mac) twice and hover
  the **Hide sidebar** toggle (`home.panel.hide`); then press it on a project
  page and on `/dashboard/{org}/conversations/open` → The first press folds
  the panel exactly as the toggle does (NAV-F31: its name flips to **Show
  sidebar**, `home.panel.show`, and the fold survives a reload), the second
  brings it back; the toggle's tooltip names the shortcut (⌘ \ on a Mac,
  Ctrl + \ elsewhere); on the project page and the inbox list the keys do
  nothing and the panel stays.
- [ ] `NAV-F37` · **Step through your work with ⌥↓ / ⌥↑** — With a chat open
  midway down the **All** view, click the transcript (so no text field holds
  focus) and press ⌥↓ (Alt+↓) a few times, then ⌥↑; repeat with the panel
  folded (NAV-F36), and in the **Inbox** view with a conversation open; then
  press ⌥↓ and ⌥↑ on a project page; last, press ⌥↓ with the caret in the
  composer → Each press
  opens the next (or previous) chat, task or conversation of the list on
  screen — the stream, or the Inbox view's conversations — in its order,
  marked current, also while the panel is folded; at the list's last row ⌥↓
  does nothing; on the project page, where nothing of the list is open, ⌥↓
  opens its first item and ⌥↑ its last — never a project row; in the composer
  the keys keep their text-editing meaning and open nothing.
- [ ] `NAV-F38` · **Unsent work is marked** — Type a message into a chat's
  composer, a comment into a task page's composer (TASK-F27) and a reply into
  a conversation, leaving each unsent and opening something else after each;
  reload; then go back to one, send it, and open something else → Each of the
  three rows reads **Draft** (`home.row.draft`) with a pencil at the start of
  its second line, also after the reload; the row of the item you have open
  never shows it, even while its composer holds text; once sent (or emptied)
  the mark is gone when you move on.
- [ ] `NAV-F39` · **Palette rows wear their Home glyphs** — Press ⌘K on
  **Everything** (`dialogs.search.scopeEverything`) and search in turn for a
  task without a description, a task by words of its description, a chat, a
  project with a key and a description, a contact and a document →
  Each task row carries its status glyph, the same one its Home row wears;
  the chat a speech bubble, the project a folder, the contact a person, the
  document the file glyph. The task without a description reads its status
  under its title (e.g. **In review**, `tasks.status.in_review`), never its
  title a second time; the other task reads the matching text. The project's
  title leads with its key and the line under it holds only the description.
- [ ] `NAV-F40` · **The tab names what is open** — Open a chat, a task page
  and a conversation from Home, rename the chat, open Settings, go Back
  twice and start a new chat; last, with a chat open, go offline, open
  Settings, go Back to the chat and come back online (NAV-B5) → The browser
  tab reads the open item's own title, then the organization's name
  ("Review the launch checklist - {org}"), and follows each item opened in
  place and the rename; Settings and the fresh composer read their page's
  title (`metadata.settings.title`, `metadata.chat.title`), never the last
  item's; Back brings each item's title back. While the offline notice is up
  the tab reads **Reconnecting** (`connectivity.tabTitle`), also once you are
  back on the chat, and the chat's title returns with the connection.

## Boundary & error tests

- [ ] `NAV-B1` · **Bad deep link** — Open
  `/dashboard/{org}/automations/does-not-exist` → Inside the shell, renders
  the graceful **Automation not found** EmptyState
  (`automations.notFound.title` + `automations.notFound.description`) — no
  crash, no error boundary.
- [ ] `NAV-B2` · **Unknown route** — Open `/dashboard/{org}/` with a made-up
  trailing segment (nope-not-a-route — deliberately no such route)
  → A styled 404 renders inside the dashboard layout (rail still present):
  heading **Page not found** (`common.notFound.title`), the message **The page
  you're looking for doesn't exist or may have been moved.**
  (`common.notFound.description`), and a **Back to Home** link
  (`common.notFound.backToDashboard`) to `/dashboard/{org}`. Document title is
  **Page not found** (`metadata.notFound.title`), not the marketing default.
  No white-screen crash.
- [ ] `NAV-B3` · **Back after delete** — Delete a list row, press browser Back
  → No stale/ghost row reappears; the list stays consistent with the persisted
  state.
- [ ] `NAV-B4` · **Bad version range** — Open
  `/dashboard/changelog?from=zzz&to=000` → Handled gracefully — heading
  **What's new** still renders; no blank screen, no console/page error.
- [ ] `NAV-B5` · **Offline gate** — Mode A via network emulation: on any
  dashboard page, set the browser **offline** and open another page (the gate
  answers a request that fails, not the switch itself); later, restore the
  network. Backend-stale variant: keep the device online but **stop the local
  backend** → After the backend stays unreachable past a **~3 s grace** (both
  variants — a brief blip does not trigger it), a full-screen overlay
  (`role="alertdialog"`) shows **You're offline** (`connectivity.deviceTitle`)
  + its description (`connectivity.deviceDescription`). Restoring the network
  clears the overlay **without a reload** — the page underneath stays mounted
  (children keep rendering below the overlay). With the backend stopped
  instead, the overlay reads **Can't reach Tale**
  (`connectivity.backendTitle`) with a **Try again** button
  (`connectivity.retry`). Press **Try again** with the backend still stopped →
  the document performs a FULL reload (the browser's load indicator runs, the
  tab re-navigates), and the service worker's precached offline shell keeps
  the user inside Tale — never the browser's own "site can't be reached" page.
  Start the backend, press **Try again** → the reloaded page comes back
  signed in on the same URL.

- [ ] `NAV-B7` · **A project that is gone** — Open a project, then in a
  second session **delete it**. Back in the first session, reload that
  project's URL → The page explains it cannot find the project and offers a
  **Projects** link out, rather than a bare dead end.
- [ ] `NAV-B8` · **Knowledge entries lights the rail** — Navigate to
  `/dashboard/{org}/knowledge-entries` → The **Knowledge** rail item shows
  active styling (it previously did not), and clicking it returns you to
  `/documents`, the section's first tab.
- [ ] `NAV-B10` · **Unknown route outside the dashboard** — Signed in, open a
  made-up top-level path (such as login without the hyphen — deliberately no
  such route); then repeat in a private window, signed out → Both show the
  standalone 404: the logo home link in the top corner over a centred **Page
  not found** (`common.notFound.title`), its message
  (`common.notFound.description`) and a **Back to Home** button
  (`common.notFound.backToDashboard`), never the bare framework "Not Found"
  text. The tab reads **Page not found** (`metadata.notFound.title`). The
  button opens the organization's dashboard when signed in, and **Log in**
  (continuing to the dashboard) when signed out. Signed out, a path beneath a
  sign-in page (such as log-in/typo) shows the same state inside the sign-in
  frame: one logo, no second page nested in it. Both themes render.
- [ ] `NAV-B11` · **Offline gate, idle tab** — Open Projects (or any list)
  and let it load, then drop the network completely (DevTools **Offline**, or
  disconnect the machine) and **touch nothing** for 45 s → Within about 10 s
  of the drop — with no click, reload or navigation — the full-screen
  **You're offline** overlay (`role="alertdialog"`, `connectivity.deviceTitle`)
  covers the cached list; it never sits silently on stale data. The Network
  panel shows a `/api/health` probe every ~5 s while offline. Restore the
  network → the overlay clears within ~5 s on its own, no reload, and the
  list underneath is still mounted.
- [ ] `NAV-B12` · **Leaving pages on a slow network is not an outage** — With
  `SENTRY_DSN` pointing at an error-reporting project you can read, throttle
  DevTools to **Slow 3G** and, about one click a second, go **Knowledge** →
  **Contacts** → **Home** → a chat in its list, five rounds; then wait 15 s →
  The Network panel lists the left pages' reads as `(canceled)`, yet neither
  **Can't reach Tale** (`connectivity.backendTitle`) nor **You're offline**
  (`connectivity.deviceTitle`) appears at any point, and the project receives
  no `AbortError` event.
- [ ] `NAV-B13` · **A tab kept open across a deploy** — Needs a production
  build (mode C, or a real instance; a dev server has no content-hashed
  chunks). Open `/dashboard/{org}/documents` and open no preview; deploy a
  new build (rebuild mode C, or `tale deploy`) and leave the tab alone. Then,
  in that same tab, click a previewable document (PDF or DOCX) → The tab
  reloads **once** by itself: the Network panel shows the old
  `assets/document-preview-…` chunk answered with HTML, then one document
  load whose entry `assets/index-….js` has a new name. It comes back with the
  preview open (the URL keeps its `?doc=`), and no toast shows. Now block one
  preview chunk (DevTools → Network → **Block request URL**
  `*document-preview-docx-*`) and click a DOCX document → After exactly one
  automatic reload the page stops, and a destructive toast **A new version
  is available** (`connectivity.newVersion.title`) offers **Reload**
  (`connectivity.newVersion.reload`) and **Later**
  (`connectivity.newVersion.later`). It stays until one is pressed, and
  nothing reloads again on its own; **Reload** reloads once, and the toast
  comes back while the block is on.
- [ ] `NAV-B14` · **Contact support goes to the operator's page** — Start
  the platform with
  `TALE_CONTACT_SUPPORT_URL=https://support.example.com/help?source=tale`
  (mode A already does; a deployment: its `.env`, then recreate the
  `platform` service). In DevTools, block
  `GET /api/app/projects/overview` and open `/dashboard/{org}/projects` →
  After the retries the error state's **contact support** link
  (`common.errors.contactSupport`) points at
  `https://support.example.com/help?source=tale&organizationId={orgId}` and
  opens in a new tab. Restart with
  `TALE_CONTACT_SUPPORT_URL=mailto:help@example.com` → the platform's log
  warns once that it ignored `TALE_CONTACT_SUPPORT_URL`, and the same link
  points at `https://tale.dev/contact?organizationId={orgId}`.

- [ ] `NAV-B15` · **Recover the header after typing in an iPhone Safari overlay** → On a real iPhone or iOS Simulator, test both the software keyboard and hardware-keyboard accessory bar. Open an automation node, focus a field, then dismiss the keyboard and close the panel; repeat by closing while the keyboard is still open, with Safari's toolbar expanded and collapsed, and with another form dialog. The title/profile row returns fully into view after dismissal and stays visible when navigating away; panel content remains scrollable. Repeat in the installed home-screen app and with pinch zoom: neither regresses.

## Accessibility (WCAG 2.1 AA)

- [ ] `NAV-A1` · **Landmarks** → Exactly one `role="main"` and one `<nav
  aria-label="Main navigation">` (`common.aria.mainNavigation`) per dashboard
  page.
- [ ] `NAV-A2` · **Skip link** → A focusable **Skip to main content** link
  (`common.aria.skipToContent`) is present as an early focus target.
- [ ] `NAV-A3` · **Palette** → The Cmd/Ctrl+K palette is a `role="dialog"`;
  **Esc** closes it and focus returns to the page.
- [ ] `NAV-A4` · **Breadcrumb** → The breadcrumb is an ordered, labelled
  navigation; the current page is marked (`aria-current`)
- [ ] `NAV-A5` · **Home panel by keyboard** → The panel is a `nav` named
  **Home** (`home.aria.panel`); the switcher is a `radiogroup` named **Show**
  (`home.views.label`) with one tab stop and a `radio` per view
  (`aria-checked`); the **Projects** section is a `region`
  (`home.projects.title`) whose header toggle exposes `aria-expanded`; the
  list is named `home.aria.stream` (the Inbox view's `home.aria.inbox`) with
  band headings; every row is a link, the open one `aria-current="page"`.
  Tabbing through a chat row and a project row reaches their menus
  (**More actions** `chat.moreActions`, **Actions for {project}**
  `home.projects.actions`) and each menu button is visible, with a focus ring,
  while it holds focus — not only on hover. Folded (NAV-F31), the panel leaves
  the tab order entirely.
- [ ] `NAV-A6` · **Home holds still under reduced motion** — Emulate
  `prefers-reduced-motion: reduce` (DevTools → Rendering) and walk NAV-F33,
  NAV-F34, NAV-F35 and NAV-F36 again → Nothing moves: the highlight appears on
  the open row without gliding, new rows appear in place without dropping in,
  a switched view and an item opening in place repaint without a fade, and
  the panel folds without sliding; the open row is still the marked one.
- [ ] `NAV-A7` · **Arrow keys between rows** — Tab onto a row of the stream
  and press ↓, ↑, End and Home, then Enter; do the same in **Projects** and in
  the **Inbox** view → Focus moves one row at a time with its focus ring,
  across bands; End and Home jump to the last and first row of that list; the
  arrows never carry focus out of the list they started in (Projects stays in
  Projects); Enter opens the focused row; Tab still reaches a row's menu
  (NAV-A5).

## Performance

- [ ] `NAV-P1` · **Warm in-app nav** → A rail-click route commit
  (`waitForURL`) settles in **< 1 s** on the warm deterministic stack; hovered
  targets prefetch so they feel near-instant.
- [ ] `NAV-P2` · **Palette open** → Cmd/Ctrl+K → the **Search chat** input is
  visible in **< 0.5 s** on the warm deterministic stack.
- [ ] `NAV-P3` · **The Home panel holds its place on a cold load** —
  Hard-reload `/dashboard/{org}/chat`, a project page, a task page and
  `/dashboard/{org}/conversations/open` at desktop width, with the network
  throttled enough to watch the boot shell → Before the app has loaded, the
  boot shell already draws the Home panel's skeleton (a header, the switcher
  and masked rows) in the panel's slot, and `<html>` carries the class
  `boot-home-panel-open`; the live panel replaces it without the page moving
  sideways. With the panel folded (NAV-F31) a chat, a task page and an open
  conversation boot without it, while a project page and the inbox index
  still boot with it. `/dashboard/{org}/documents`,
  `/dashboard/{org}/automations`, `/dashboard/{org}/settings/account` and a
  shared chat boot with no panel skeleton.
