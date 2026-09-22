# Smoke

> **Prefix** `SMOKE-` · **Reset** none · **Cost** ~10 min

The fast "is this build even drivable" pass over the panel. Green ⇒ go on to
[accounts](accounts.md); red ⇒ stop and fix, because everything after this
reads on top of it.

The boxes here are about the **shell** — a route that renders, a locale that
resolves, a control a keyboard can reach, a console with nothing in it. The
credential lifecycle is the other suite's.

## Preconditions

The dev server up on :3004 per [`../setup.md`](../setup.md), devtools open, a
1440×900 viewport. Nothing to sign in with — the panel has no login.

> **Agent note**: wait on the route's own heading, never on a timeout — the
> panel renders `panel.title` only once i18n has initialized, so a heading
> assertion is the earliest honest ready signal.

## Boxes

- [ ] `SMOKE-1` · **Open `/` with the console open** → the accounts screen
  renders straight away, headed `panel.title`; nothing asks for a credential
  and the page carries no password field at all; no console message at `warn`
  or `error` level.
- [ ] `SMOKE-4` · **Switch the panel through each language it ships** → every
  visible string changes with it, including the table's header row and its
  count footer; no key leaks through as its raw dotted path, and no sentence
  stays English. The `%` in a usage bar keeps its French nonbreaking space.
- [ ] `SMOKE-5` · **Switch the theme through light, dark and system** → the
  table, the status dots, the plan badges and the usage bars all follow; no
  surface keeps a light tint on a dark page.
- [ ] `SMOKE-6` · **Reach the whole toolbar with Tab alone — search, Add
  account, the first row's action menu** → focus is visible at every stop, the
  order matches the reading order, and Enter opens the menu.
- [ ] `SMOKE-8` · **Open a route the panel does not define** → a real not-found
  renders; no white screen, no unhandled rejection in the console.
- [ ] `SMOKE-9` · **Narrow the viewport to 390×844** → the header stays one
  row: the Tale mark steps aside, the name truncates, and the language, theme
  and GitHub controls all stay on screen. The table scrolls horizontally
  inside its own frame; no control leaves the viewport.
- [ ] `SMOKE-10` · **Open `/` in a fresh private window, with no cookie and no
  storage for the origin** → the same accounts screen, immediately. The panel
  keeps no door of its own, so a first-time browser reaches everything a
  returning one does — and a deployment that wants a door puts one in front.
- [ ] `SMOKE-11` · **Read the header row** → one `h-13` strip, the same height
  as the documentation site's, carrying the Tale mark, the panel's name, and —
  on the right — the language picker, the theme picker and a GitHub button, in
  that order. Its bottom border is one line: nothing sits a pixel below it.
- [ ] `SMOKE-12` · **Follow the GitHub button** → the repository opens in a new
  tab; the panel is still where it was, with nothing reloaded.
- [ ] `SMOKE-13` · **Search until exactly one account matches** → the table
  frame keeps the full height it had, the count footer stays on the bottom
  edge, and the one row sits at the top of the frame. Clear the search and no
  control moves.
- [ ] `SMOKE-14` · **Tab from the address bar into the page** → the first stop
  is a skip link that reveals itself; activating it moves focus into the
  account list rather than only scrolling to it.
