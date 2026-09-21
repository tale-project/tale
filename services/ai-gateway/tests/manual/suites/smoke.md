# Smoke

> **Prefix** `SMOKE-` · **Reset** none · **Cost** ~10 min

The fast "is this build even drivable" pass over the panel. Green ⇒ go on to
[accounts](accounts.md); red ⇒ stop and fix, because everything after this
reads on top of it.

The boxes here are about the **shell** — a route that renders, a locale that
resolves, a control a keyboard can reach, a console with nothing in it. The
credential lifecycle is the other suite's.

## Preconditions

The dev server up on :3004 per [`../setup.md`](../setup.md), the panel password
from its startup banner, devtools open, a 1440×900 viewport.

> **Agent note**: wait on the route's own heading, never on a timeout — the
> panel renders `signIn.heading` only once i18n has initialized, so a heading
> assertion is the earliest honest ready signal.

## Boxes

- [ ] `SMOKE-1` · **Open `/` with the console open** → the sign-in card renders
  with its heading, its one password field and a disabled **Sign in**; no
  console message at `warn` or `error` level.
- [ ] `SMOKE-2` · **Sign in with the panel password** → the accounts screen
  replaces the card in place; no full reload, no flash of an empty shell.
- [ ] `SMOKE-3` · **Reload the signed-in page** → it comes back on the accounts
  screen, not on the sign-in card: the session survives a reload, and the
  session check resolves before anything is drawn.
- [ ] `SMOKE-4` · **Switch the panel through each language it ships** → every
  visible string changes with it, including the table's header row and its
  count footer; no key leaks through as its raw dotted path, and no sentence
  stays English. The `%` in a usage bar keeps its French nonbreaking space.
- [ ] `SMOKE-5` · **Switch the theme through light, dark and system** → the
  table, the status dots and the usage bars all follow; nothing keeps a
  light-mode surface on a dark page except a plan badge (`BL-1`).
- [ ] `SMOKE-6` · **Reach the whole toolbar with Tab alone — search, Add
  account, the first row's action menu** → focus is visible at every stop, the
  order matches the reading order, and Enter opens the menu.
- [ ] `SMOKE-7` · **Sign out** → the sign-in card returns, and a reload stays on
  it; the cookie is gone rather than merely hidden.
- [ ] `SMOKE-8` · **Open a route the panel does not define** → a real not-found
  renders; no white screen, no unhandled rejection in the console.
- [ ] `SMOKE-9` · **Narrow the viewport to 390×844** → the header wraps rather
  than overflowing, the table scrolls horizontally inside its own frame, and no
  control leaves the screen.
