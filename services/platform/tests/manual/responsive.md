# Responsive — Manual Test Plan (cross-cutting)

> **Purpose**: Verify the app adapts across viewports — the mobile in-flow
> bottom tab bar, the **More** overflow sheet, the mobile floating Save
> cluster, and that no key surface overflows horizontally at phone width. This
> is a cross-cutting guide: it re-walks surfaces other guides own (chat, a
> DataTable page, a settings form) at a narrow viewport rather than testing a
> single feature.

## Scope & routes

The responsive split is the Tailwind **`md` breakpoint (768 px)**. Desktop chrome
is `hidden md:flex` (the side rail, the desktop Save slot); mobile chrome is
`md:hidden` (the in-flow `BottomTabBar`, the content-width floating Save dock
bottom-right above it). **`< md` (≤ 767 px) is the mobile layout; ≥ 768 px is the full
desktop layout** — at exactly 768 px the desktop chrome is already active
(there is no separate "tablet" layout). There is **no hamburger drawer**:
primary nav is the bottom tab bar, and a trailing **More** tab opens a bottom
`Sheet` with the overflow destinations.

Test at three widths — **390×844** (mobile, matches `responsive.spec.ts`),
**767×1024** (just below the breakpoint — still mobile), **1280×800** (desktop).
Drive the width with the Playwright MCP `browser_resize` (or a context `viewport`).

| Surface (re-walked at mobile width)   | Route                               |
| ------------------------------------- | ----------------------------------- |
| Chat (chat input)                     | `/dashboard/{org}/chat`             |
| Projects (primary tab)                | `/dashboard/{org}/projects`         |
| Agents (primary tab, gated)           | `/dashboard/{org}/agents`           |
| Knowledge / Documents (More overflow) | `/dashboard/{org}/documents`        |
| Settings → Account (floating Save)    | `/dashboard/{org}/settings/account` |
| Contacts (DataTable page)             | `/dashboard/{org}/contacts`         |
| Products (DataTable page)             | `/dashboard/{org}/products`         |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Any seeded org works
(read-only for nav/overflow/no-overflow checks). The mobile floating-Save case
(F3) makes a **throwaway dirty edit and discards it via reload** — nothing
persists — so a shared org is safe; mint your own only if you want to keep a
write.

> **Agent note**: set the viewport to **390×844** _before_ the first `goto`, so
> the shell mounts at mobile width. The mobile primary-nav landmark is the
> `navigation` role named `navigation.aria.primaryNavigation` ("Primary
> navigation"); the desktop side rail is the `navigation` role named
> `common.aria.mainNavigation` ("Main navigation") and is `display:none` (hidden)
> at `< md`. The **More** sheet is a Radix `dialog` whose accessible name is its
> title, **More** (`navigation.more`). To prove "no horizontal overflow", assert
> `document.documentElement.scrollWidth === clientWidth`. Chat turns are not
> needed here — the chat input just has to render and be enabled.

## Automated coverage

| Case(s)          | Status         | e2e spec                                                                                 |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------- |
| F1, F2           | ✅ automated   | `responsive.spec.ts` (app-shell: rail hidden, tab bar + More sheet)                      |
| F3               | ✅ automated   | `responsive.spec.ts` (floating Save dock: 1 visible Save, dirty→enabled, reload-discard) |
| F4               | 🔶 partial     | `responsive.spec.ts` (chat input renders + enabled at mobile; **no send / no attach**)   |
| F5               | 🔶 partial     | `responsive.spec.ts` (contacts list usable at mobile; **no row/stack assertions**)       |
| F6, F7           | ⛔ manual-only | —                                                                                        |
| F9               | ⛔ manual-only | — (needs canvas content, mode B)                                                         |
| B1–B3, A1–A3, P1 | ⛔ manual-only | —                                                                                        |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).
`responsive.spec.ts` runs the worker owner at viewport `390×844` and has 4 tests
(app shell, floating Save, chat input, contacts list).

## Functional tests

| ID  | Test            | Steps (route + control)                                                                                                                   | Expected (verifiable)                                                                                                                                                                                                                                                                                                                               |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Bottom tab bar  | At 390 px, open `/dashboard/{org}/chat`                                                                                                   | The `navigation` "Primary navigation" (`navigation.aria.primaryNavigation`) is **visible**; the "Main navigation" rail (`common.aria.mainNavigation`) is **hidden**. The bar shows tabs **Projects** (`projects.title`), **Chat** (`navigation.chat`), **Agents** (`navigation.agents`), **More** (`navigation.more`).                              |
| F2  | More sheet      | Tap **More** (`navigation.more`) in the bottom bar                                                                                        | A `dialog` named **More** (`navigation.more`) opens with buttons **Knowledge** (`navigation.knowledge`), **Settings** (`navigation.userSettings`). Pressing **Escape** hides the dialog. Tapping an item navigates and closes the sheet.                                                                                                            |
| F3  | Floating Save   | At 390 px, open `/dashboard/{org}/settings/account`; edit **Display name** (`settings.account.profile.name`)                              | Exactly **one** visible **Save** button (`common.actions.save`) exists (the content-width floating dock bottom-right above the bottom tab bar; the desktop header slot is unmounted). It is **disabled while clean**, becomes **enabled after the edit**. Reload → the field rehydrates to the **original value** (the probe edit did not persist). |
| F4  | Chat input      | At 390 px, open `/dashboard/{org}/chat`                                                                                                   | The chat input textbox **Message input** (`chat.aria.chatInput`) is **visible and enabled**. (Optional manual extension: type `hello`, click **Send message** (`chat.send`), assert it re-enables; attach a file via the chat input.)                                                                                                               |
| F5  | DataTable page  | At 390 px, open `/dashboard/{org}/contacts`                                                                                               | The page settles into either the **Import contacts** button (`contacts.importMenu.importContacts`) **or** the empty state **No contacts yet** (`emptyStates.contacts.title`) — both prove the table chrome rendered. No action is clipped off-screen.                                                                                               |
| F6  | Dialog / sheet  | At 390 px, open a create dialog (e.g. **New project** on `/dashboard/{org}/projects`)                                                     | The dialog/sheet renders within the viewport; its primary action button is visible and reachable without horizontal scroll.                                                                                                                                                                                                                         |
| F7  | No overflow     | At 390 px, on chat, settings/account, and contacts, read `documentElement.scrollWidth`                                                    | `scrollWidth === clientWidth` (== 390) on each page — no horizontal scrollbar, nothing off-canvas.                                                                                                                                                                                                                                                  |
| F9  | Workspace panel | Mode B — canvas content needed: at 390×844, open a chat thread that produced canvas files → tap **Open canvas** (`chat.canvas.stripOpen`) | The **Canvas** panel (`chat.canvas.title`) opens **within the viewport** with a reachable close/back control; no horizontal overflow. Presentation at `< md` is unverified — **record whether it presents as a sheet or a split view** (check live).                                                                                                |

## Boundary & error tests

| ID  | Test                | Input                                                                                    | Expected                                                                                                                                                                                                                        |
| --- | ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Breakpoint crossing | Resize 767 px → 768 px on `/dashboard/{org}/chat`                                        | At **767 px** the bottom tab bar ("Primary navigation") is visible and the rail is hidden; at **768 px** the bottom tab bar is **hidden** and the "Main navigation" rail is **visible** — a clean swap, no half-mounted hybrid. |
| B2  | Width reflow        | Resize 1280 px → 390 px on `/dashboard/{org}/settings/account` with an active dirty edit | After the resize the Save state is preserved (Save still **enabled**); content reflows to one column; no horizontal scrollbar.                                                                                                  |
| B3  | Long content        | A very long display name / agent name                                                    | The text **wraps or truncates** (`truncate` / `line-clamp`) within its container; `scrollWidth === clientWidth` still holds (no overflow).                                                                                      |

## Accessibility (WCAG 2.1 AA)

| ID  | Check         | Expected                                                                                                                                                                                      |
| --- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Touch targets | Bottom-tab buttons are ≥ 44×44 CSS px (measured: **More** tab ≈ 78×57). **Note:** the mobile Save button measured **≈ 38×32 px** — below the 44×44 target (record as a finding if confirmed). |
| A2  | Reflow        | Content reflows to a single column at **320 px** without loss of information or function (WCAG 1.4.10); `scrollWidth === clientWidth`.                                                        |
| A3  | Bottom nav    | The tab bar is a `navigation` landmark with an accessible name ("Primary navigation"); the active tab carries `aria-current="page"`.                                                          |

## Performance

| ID  | Metric          | Target                                                                                                                                                   |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Resize settle   | After a `browser_resize` across the `md` breakpoint, the layout settles (final chrome painted, no flicker) in **< 500 ms** (mock mode A, local backend). |
| P2  | More-sheet open | Tapping **More** shows the dialog in **< 300 ms** (mock mode A, local backend).                                                                          |

## Issues Found

| #   | Test ID | Route / URL + width | Severity | Description | Screenshot |
| --- | ------- | ------------------- | -------- | ----------- | ---------- |
|     |         |                     |          |             |            |

## Test summary

```
Area: Responsive
Functional: ___/9   Boundary: ___/3   A11y: ___/3   Perf: ___/2
Widths: 390 ☐  767 ☐  768 ☐  1280 ☐
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
