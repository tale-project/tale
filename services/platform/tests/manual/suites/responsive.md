# Responsive (cross-cutting)

> **Prefix** `RESP-` · **Reset** none · **Cost** 19 boxes

Verify the app adapts across viewports — the mobile in-flow bottom tab bar,
the phone's Home list and its way back, the mobile floating Save cluster, and
that no key surface overflows horizontally at phone width. This is a
cross-cutting guide: it re-walks surfaces other guides own (chat, a DataTable
page, a settings form) at a narrow viewport rather than testing a single
feature.

## Scope & routes

The responsive split is the Tailwind **`md` breakpoint (768 px)**. Desktop
chrome is `hidden md:flex` (the side rail, the section panels, the desktop Save
slot); mobile chrome is `md:hidden` (the in-flow `BottomTabBar`, the
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
  button (`contacts.addButton`; its menu holds **Manual entry** / **From your
  device**, `contacts.importMenu.manualEntry` /
  `contacts.importMenu.fromDevice`) **or** the empty state **No contacts yet**
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
  rail opens, and a **New chat** button (`home.newChat`) that opens
  `/chat?new=true`; below it the list the desktop
  panel holds — the **Show** switcher (`home.views.label`), the **Projects**
  section (`home.projects.title`), the banded list and the **Archived** drawer
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
