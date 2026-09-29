# Responsive (cross-cutting)

> **Prefix** `RESP-` · **Reset** none · **Cost** 28 boxes

Verify the app adapts across viewports — the mobile in-flow bottom tab bar,
the phone's Home list and its way back, the mobile floating Save cluster, and
that no key surface overflows horizontally at phone width. This is a
cross-cutting guide: it re-walks surfaces other guides own (chat, a DataTable
page, a settings form) at a narrow viewport rather than testing a single
feature.

## Scope & routes

The responsive split is the Tailwind **`md` breakpoint (768 px)**. Desktop
chrome is `hidden md:flex` (the side rail, the section panels, the desktop Save
slot); mobile chrome is `md:hidden` (the floating `BottomTabBar`, the
content-width floating Save dock bottom-right above it). **`< md` (≤ 767 px) is
the mobile layout; ≥ 768 px is the full desktop layout** — at exactly 768 px the
desktop chrome is already active (there is no separate "tablet" layout). There
is **no hamburger drawer and no overflow sheet**: primary nav is the bottom tab
bar with the rail's four sections, and its **Home** tab opens the Home list —
on a phone the list of chats, tasks and conversations is a screen of its own,
where a desktop keeps it as the panel beside the page.

Test at three widths — **390×844** (mobile, matches `responsive.spec.ts`),
**767×1024** (just below the breakpoint — still mobile), **1280×800**
(desktop). Drive the width with the Playwright MCP `browser_resize` (or a
context `viewport`).

From 768 px the desktop chrome is on, but the rail and a section panel leave
the page column far narrower than the window — ~400 px at 768, ~660 px at
1024. What lives in that column (settings field rows, list toolbars, stat
strips, card and chart grids) answers to the column's own width, not the
window's; `RESP-F15` walks that band. Pages outside the app shell (sign-in,
onboarding, 2FA, the root 404) scroll themselves, because the platform clips
the document (`RESP-B4`).

| Surface (re-walked at mobile width)   | Route                               |
| ------------------------------------- | ----------------------------------- |
| Chat (chat input)                     | `/dashboard/{org}/chat`             |
| Home list (the Home tab)              | `/dashboard/{org}/home`             |
| Projects (from the Home list)         | `/dashboard/{org}/projects`         |
| Inbox (gated; list when none is open) | `/dashboard/{org}/conversations`    |
| Knowledge / Documents (its own tab)   | `/dashboard/{org}/documents`        |
| Settings → Account (floating Save)    | `/dashboard/{org}/settings/account` |
| Contacts (DataTable page)             | `/dashboard/{org}/contacts`         |
| Products (DataTable page)             | `/dashboard/{org}/products`         |

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Any seeded org
works (read-only for nav/overflow/no-overflow checks). The mobile
floating-Save case (RESP-F3) makes a **throwaway dirty edit and discards it
via reload** — nothing persists — so a shared org is safe; mint your own only
if you want to keep a write.

> **Agent note**: set the viewport to **390×844** _before_ the first `goto`,
> so the shell mounts at mobile width. The mobile primary-nav landmark is the
> `navigation` role named `navigation.aria.primaryNavigation` ("Primary
> navigation"); the desktop side rail is the `navigation` role named
> `common.aria.mainNavigation` ("Main navigation") and is `display:none`
> (hidden) at `< md`. The tabs are buttons named by their section (the Home
> tab's name also carries the unread count, so match it by its leading word).
> The Home list is anchored by its **Show** radiogroup (`home.views.label`).
> To prove "no horizontal overflow", assert
> `document.documentElement.scrollWidth === clientWidth`.
> Chat turns are not needed here — the chat input just has to render and be
> enabled.

## Functional tests

- [ ] `RESP-F1` · **Bottom tab bar** — At 390 px, open `/dashboard/{org}/chat`
  → The `navigation` "Primary navigation"
  (`navigation.aria.primaryNavigation`) is **visible**; the "Main navigation"
  rail (`common.aria.mainNavigation`) is **hidden**. The bar shows exactly four
  tabs, in the rail's order: **Home** (`navigation.home`), **Knowledge**
  (`navigation.knowledge`), **Automations** (`navigation.automations`),
  **Settings** (`navigation.userSettings`) — no **More** tab, no overflow
  sheet, no separate Projects or Inbox tab. **Home** is the active tab on the
  chat, and on a project, a task page and the inbox too; each other tab opens
  its section's first page.
- [ ] `RESP-F2` · **~~More sheet~~ (retired)** → The **More** tab and its
  overflow sheet are gone: Knowledge, Automations and Settings are tabs of
  their own (`RESP-F1`).
- [ ] `RESP-F3` · **Floating Save** — At 390 px, open
  `/dashboard/{org}/settings/account`; edit **Display name**
  (`settings.account.profile.name`) → Exactly **one** visible **Save** button
  (`common.actions.save`) exists (the content-width floating dock bottom-right
  above the bottom tab bar; the desktop header slot is unmounted). It is
  **disabled while clean**, becomes **enabled after the edit**. Reload → the
  field rehydrates to the **original value** (the probe edit did not persist).
- [ ] `RESP-F4` · **Chat input** — At 390 px, open `/dashboard/{org}/chat` →
  The chat input textbox **Message input** (`chat.aria.chatInput`) is
  **visible and enabled**. (Optional manual extension: type `hello`, click
  **Send message** (`chat.send`), assert it re-enables; attach a file via the
  chat input.)
- [ ] `RESP-F5` · **DataTable page** — At 390 px, open
  `/dashboard/{org}/contacts` → The page settles into either the **Add** menu
  button (`contacts.addButton`; its menu holds **From your device** / **Manual
  entry**, `contacts.importMenu.fromDevice` /
  `contacts.importMenu.manualEntry`) **or** the empty state **No contacts yet**
  (`emptyStates.contacts.title`) — both prove the table chrome rendered. No
  action is clipped off-screen.
- [ ] `RESP-F6` · **Dialog / sheet** — At 390 px, open a create dialog (e.g.
  **New project** on `/dashboard/{org}/projects`) → The dialog/sheet renders
  within the viewport; its primary action button is visible and reachable
  without horizontal scroll.
- [ ] `RESP-F7` · **No overflow** — At 390 px, on chat, settings/account, and
  contacts, read `documentElement.scrollWidth` → `scrollWidth === clientWidth`
  (== 390) on each page — no horizontal scrollbar, nothing off-canvas.
- [ ] `RESP-F9` · **~~Workspace panel~~ (retired)** → The chat side panel /
  canvas strip was removed in #2857/#2877; no mobile canvas surface exists to
  test.
- [ ] `RESP-F10` · **Home list** — At 390 px tap **Home** (`navigation.home`)
  in the tab bar → The URL is `/dashboard/{org}/home` and the tab stays active;
  the header reads **Home** (`home.title`) with **Search**
  (`navigation.sidebar.search`), which opens the search palette the desktop
  rail opens, and no **New chat** button; below it the list the desktop
  panel holds — the **Show** switcher (`home.views.label`), the **Projects**
  section (`home.projects.title`) with **All projects**
  (`home.projects.allProjects`) as a text link and no **New project** button,
  the banded list and the **Archived** drawer
  (`chat.archived.title`) — fills the screen above the tab bar and scrolls on
  its own. Tapping a chat, a task or a conversation opens it full-screen; the
  browser tab's title starts with **Home** (`metadata.home.title`). Widen the
  window to ≥ 768 px while on `/home` → it replaces itself with
  `/dashboard/{org}/chat`, the Home panel beside it.
- [ ] `RESP-F11` · **Back to the Home list** — At 390 px open a chat, a task
  page and a conversation from the Home list → Each header starts with a back
  arrow named **Back** (`common.aria.back`) that returns to
  `/dashboard/{org}/home`; none of them shows the desktop **Hide sidebar**
  toggle (`home.panel.hide`). At ≥ 768 px the back arrow is gone and the toggle
  takes its place.
- [ ] `RESP-F12` · **A thread page has one header** — At 390 px open a chat, a
  fresh composer, a task page and a conversation from the Home list; then the
  Home list itself, a project and `/dashboard/{org}/settings/account`; last,
  hard-reload a chat with the network throttled → Each of the first four shows
  ONE header row — the back arrow (`common.aria.back`), the title, its
  actions (the fresh composer: the back arrow alone) — with no shell bar
  above it and no account button (**Manage account**,
  `auth.userButton.manageAccount`); on a notched iPhone that header still
  clears the notch. The task's line under its title reads key ·
  status (no project name), the conversation's contact's full name, then the
  time where it fits (no email, no source). The Home list, the project and
  Settings keep the shell bar with the account button. The throttled reload's
  loading screen draws no bar stand-in either (`<html>` carries the class
  `boot-thread-page`).
- [ ] `RESP-F13` · **List tables scroll inside their card on a phone** — At
  390 px open `/dashboard/{org}/documents` (with at least one file) and
  `/dashboard/{org}/knowledge-entries` (with one entry) → read
  `documentElement.scrollWidth` → it equals `clientWidth` (390) on both; the
  table scrolls sideways inside its own frame (the frame's `scrollWidth` >
  `clientWidth`), and swiping right never shows a blank page. Copy a
  timestamp from the Updated/Modified cell → the "Copied" announcement is
  read out and the page still does not widen.
- [ ] `RESP-F14` · **Documents fits a 1440 px window** — At 1440×900 with the
  sidebar expanded, open `/dashboard/{org}/documents` with a file whose
  uploader is a long e-mail, a synced file, and a team-scoped file → The
  **Modified** header is fully visible (no "Modi…"), the table's frame has no
  horizontal scrollbar, and opening a row's **Open menu** or a dialog does not
  scroll the **Document** column out of view. Size, Source, RAG status and
  Modified cells show their full content; Uploaded by truncates the e-mail
  with the full value on hover.
- [ ] `RESP-F15` · **The column, not the window** — At **768×1024** (desktop
  chrome, a ~400 px page column) open `/dashboard/{org}/settings/organization`,
  `/dashboard/{org}/projects`, `/dashboard/{org}/settings/metrics/chat-health`
  and an automation's editor → The settings fields stack, each label above a
  full-width control (at 1024 px they read label-left/control-right, labels on
  one or two lines — never a word per line); the list toolbar keeps search and
  **Filter** on one line and moves **Create project**
  (`projects.list.createButton`) to a line of its own on the right, fully
  visible; the four stat cards sit two by two and the breakdown names are
  readable beside their bars; the editor's tab strip shows **Editor**,
  **General** and **Runs**, with **Version** at the right and its verbs
  wrapping onto a second row.
  `scrollWidth === clientWidth` on each.
- [ ] `RESP-F16` · **Thread headers in the tablet column** — At **768×1024**
  open a task page and an email conversation whose contact has a name, in
  English and again in German; then widen to 1280 px → At 768 px the task's
  **Board** (`tasks.detail.openBoard`) and the conversation's **Assign**
  (`conversations.header.assign`) are icons, the task's line reads key ·
  status, and the conversation's line starts with the contact's full name —
  never cut to a letter — followed only by items that fit whole (no half
  e-mail, no lone "·"). At 1280 px the labels return, the task's line leads
  with its project, and the conversation's reads name · time · e-mail ·
  source.
- [ ] `RESP-F23` · **Narrow Home to a project** — At 390 px, in an
  organization with a project that holds a chat and a task assigned to you,
  and with at least one chat or task outside it, open the Home list and choose
  the project under **Projects** (`home.projects.title`) → The row reads as
  pressed and the URL stays `/dashboard/{org}/home`. A bar above the list
  reads **Showing {project} only** (`home.scope.showing`); **All**, **Chats**
  and **Tasks** list only that project's chats and your open tasks in it, and
  the **Archived** drawer is hidden. A narrowed view with nothing in it reads
  **Nothing in this project yet** (`home.scope.emptyTitle`). **Open project**
  (`home.scope.open`) opens the project's page. **Show all**
  (`home.scope.clear`), or choosing the row again, brings everything back.
  Open a chat and go back → the narrowing is still on. Delete the project in
  another browser tab and reload → the list shows everything, with no bar.
  **Inbox** lists the same conversations narrowed or not, and carries no
  **Projects** section.
- [ ] `RESP-F24` · **New chat starts from the Chats view** — At 390 px open the
  Home list → There is no **New chat** (`home.newChat`) in the header, in
  **All**, **Tasks** or **Inbox**, and an empty **All** offers none. Choose
  **Chats** → a **New chat** button leads the list and opens the fresh
  composer at `/chat?new=true`. Narrow to a project first → it opens that
  project's fresh composer at `/chat?projectId={id}`. A project's menu
  (`home.projects.actions`) offers **Pin project** and nothing else.

## Boundary & error tests

- [ ] `RESP-B1` · **Breakpoint crossing** — Resize 767 px → 768 px on
  `/dashboard/{org}/chat` → At **767 px** the bottom tab bar ("Primary
  navigation") is visible and the rail is hidden; at **768 px** the bottom tab
  bar is **hidden** and the "Main navigation" rail is **visible** — a clean
  swap, no half-mounted hybrid.
- [ ] `RESP-B2` · **Width reflow** — Resize 1280 px → 390 px on
  `/dashboard/{org}/settings/account` with an active dirty edit → After the
  resize the Save state is preserved (Save still **enabled**); content reflows
  to one column; no horizontal scrollbar.
- [ ] `RESP-B3` · **Long content** — A very long display name / agent name →
  The text **wraps or truncates** (`truncate` / `line-clamp`) within its
  container; `scrollWidth === clientWidth` still holds (no overflow).
- [ ] `RESP-B4` · **A short viewport** — Signed out, at **844×390** (a phone
  held sideways) open `/log-in`, then `/sign-up` → The page scrolls (swipe or
  wheel) until **Log in** (`auth.login.loginButton`) and **Sign in with a
  passkey** (`auth.login.continueWithPasskey`) — and the sign-up submit — are
  fully in view and work; nothing is cut off below the fold. The same holds at
  1280×720 with the browser zoomed to 200 %.
- [ ] `RESP-B5` · **Whole settings text on a phone** — At **320** px open
  `/dashboard/{org}/settings/notifications` → Every toggle's label and
  description read in full (no ellipsis, no two-line clamp), the switch
  still beside them.
- [ ] `RESP-B6` · **Collection screens on a short viewport** — At **844×390**
  (a phone held sideways), then at 1280×720 zoomed to 200 %, open
  `/dashboard/{org}/knowledge-entries`, `/dashboard/{org}/automations` and
  `/dashboard/{org}/settings/governance/logs` (more than 30 entries) → The
  rows are in view under the toolbar — never a table a few pixels tall; the
  page scrolls as a whole, its header and tab strip scrolling away, and the
  table does not scroll inside a frame of its own. Scrolling the logs page to
  its end loads the next entries (the count footer grows), and nothing loads
  before you scroll. With the embedding banner up it reads one line, its
  title and **Choose an embedding model**
  (`settings.dataResidency.orgEmbedding.banner.link`).
- [ ] `RESP-B7` · **Composers on a short viewport** — At **844×390**, then
  at 1280×720 zoomed to 200 %, open a conversation and click into its reply
  box; then open a chat → The reply box grows to about a third of the
  window and no further: its **Send** and its attachment controls stay in
  view with the conversation's header above, and a long reply scrolls
  inside the box. The chat's empty composer is two lines tall and the
  thread shows above it.

## Accessibility (WCAG 2.1 AA)

- [ ] `RESP-A1` · **Touch targets** → Bottom-tab buttons are ≥ 44×44 CSS px. Other controls meet the app design
  contract’s **24×24 CSS px** minimum hit target; the standard 32/36 px
  buttons are valid on mobile. Measure the clickable area, not the icon.
  The 44 px value is a stronger bottom-navigation target, not a WCAG 2.1 AA
  requirement for every control.
- [ ] `RESP-A2` · **Reflow** → Content reflows to a single column at **320
  px** without loss of information or function (WCAG 1.4.10); `scrollWidth ===
  clientWidth`.
- [ ] `RESP-A3` · **Bottom nav** → The tab bar is a `navigation` landmark with
  an accessible name ("Primary navigation"); the active tab carries
  `aria-current="page"`.

## Performance

- [ ] `RESP-P1` · **Resize settle** → After a `browser_resize` across the `md`
  breakpoint, the layout settles (final chrome painted, no flicker) in **< 500
  ms** (mock mode A, local backend).
- [ ] `RESP-P2` · **~~More-sheet open~~ (retired)** → The **More** sheet is
  gone (`RESP-F2`); every tab opens a page.
- [ ] `RESP-P3` · **Mobile composer holds its place while the shell loads**
  — At 390 px, hard-reload `/dashboard/{org}/chat`, once in a fresh tab
  (access resolves after the skeleton) and once again in the same tab → The
  masked tab bar at the bottom of the loading screen is as tall as the live
  one, so neither the masked composer nor the live composer that replaces it
  moves; on iPhone Safari in a browser tab the masked bar already carries the
  toolbar clearance the live bar adds.


## Floating navigation capsule

- [ ] `RESP-F20` · **Scroll Home and a settings page at 320 and 390 px in both themes** → One rounded capsule encloses icons and labels, content can pass behind it, and the final item scrolls clear; Save and message composers remain above the capsule.
- [ ] `RESP-F21` · **On iPhone Safari and an installed PWA, open and dismiss the software keyboard in a chat and a settings field** → Navigation hides while typing and returns without a lingering gap; the field and any Save action remain reachable. Focusing with a hardware keyboard leaves navigation visible.
- [ ] `RESP-A4` · **Enable reduced transparency, increased contrast, and reduced motion** → The capsule stays legible with an opaque background where requested, keyboard focus is visible, and selection changes without sliding under reduced motion.

- [ ] `RESP-F22` · **Scroll down and then up in Home and a long settings page on iPhone Safari and an installed PWA** → The 60px labelled capsule becomes a narrower 52px icon-only capsule slightly lower on downward travel, restores on upward travel, and does not flicker at scroll boundaries. All destinations and badges remain available; selecting a destination or focusing navigation with a hardware keyboard restores labels.
