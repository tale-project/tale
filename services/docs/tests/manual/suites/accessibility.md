# Accessibility (cross-cutting)

> **Prefix** `A11Y-` · **Reset** none · **Cost** 15 boxes

A WCAG 2.1 **Level AA** sweep across the docs site, including the theme
switcher and the phone drawer. Tale's standard (root
[`AGENTS.md`](../../../../../AGENTS.md) → Accessibility) is mandatory.
Per-area guides carry their own `A#` rows; this guide is the holistic pass and
the place to log _systemic_ findings.

## Scope & routes

Run each check on: `{base}/` (landing), one long content page
(`{base}/self-hosted/install/quickstart`), one screenshot page
(`{base}/platform/chat/basics` for A11Y-A9), one video page
(`{base}/tutorials/videos/welcome-to-tale` for A11Y-A10), the search dialog,
and the 404 page. Add a ≤ 767 px viewport pass for the mobile drawer rows.

## Preconditions

Bring the site up per [SETUP.md](../setup.md). Drive the keyboard checks with
the keyboard only; a screen reader helps the announce checks. There is **no
axe layer in this service's e2e suite** — full-page audits are manual/assisted
here; shared `@tale/ui` components carry `vitest-axe` coverage.

> **Agent note**: assert structure via DOM scans. Skip link and page actions
> are i18n-wired (`nav.skipToMain`, `docs.pageActions.*`). Remaining
> hard-coded English in shared `@tale/ui` (code-copy, heading link) is logged
> once via [locale.md](locale.md).

## Functional / structural tests

- [ ] `A11Y-A1` · **Skip link** — On each surface, Tab once from page top →
  First focusable is the skip link (`nav.skipToMain`; EN **Skip to main
  content**); it becomes visible on focus; Enter moves focus into the main
  content.
- [ ] `A11Y-A2` · **Landmarks** — Query `main, header, footer, nav, aside` →
  Exactly one `<main>`; rail `<nav aria-label>` = `nav.sidebarAriaLabel`
  (EN **Documentation**); breadcrumbs `<nav>` labelled **Breadcrumbs**;
  outline `<aside>` labelled **On this page** (a `<nav>` of the same name below
  `xl`, never both exposed); prev/next `<nav>` labelled **Page navigation**;
  one `<header>` (the phone bar, hidden from `md` up), one `<footer>`
- [ ] `A11Y-A3` · **Rendered headings** — Walk headings top→bottom on landing
  + content page → Exactly one `<h1>` (the page title); rendered levels never
  skip. Caveat: `<Step title>` injects an `<h3>` regardless of context
  (`@tale/ui` `steps.tsx`) — on a page whose Steps sit directly under an H2
  that's fine, but flag any page where a Step h3 follows the H1 with no H2
  between.
- [ ] `A11Y-A4` · **Keyboard reach** — Tab through: skip link, rail (logo,
  search field, tree), header-strip page actions, body links, prev/next, footer
  switchers — and on a phone the bar (menu, logo, search) → Everything is
  focusable and operable by keyboard in a sensible order; no keyboard trap;
  hover-revealed copy buttons appear on focus.
- [ ] `A11Y-A5` · **Visible focus** — Repeat A11Y-A4 watching the focus
  indicator — in **both** themes → A visible focus ring on every stop
  (`focus-visible:ring` styles); never invisible against its background.
- [ ] `A11Y-A6` · **Theme switch** — Footer theme switcher: **Switch theme**
  (`themeSwitcher.ariaLabel`) → **Dark**, reload → Semantics: labelled control
  with **Light**/**Dark**/**System** options (`themeSwitcher.*`), current
  option programmatically marked; the choice persists
  (`localStorage['tale-theme']`); contrast spot-checks (body ≥ 4.5:1, muted
  text ≥ 4.5:1, code tokens ≥ 4.5:1) pass in **both** themes.
- [ ] `A11Y-A7` · **Phone drawer** — ≤ 767 px: the bar's **Open navigation
  menu** (`nav.openMenu`) carries `aria-expanded` and opens a modal drawer
  holding its own **Close navigation menu** (`nav.closeMenu`) button, the
  search field and the full tree → Focus moves into the drawer and stays
  trapped there; **one** Esc closes it and focus returns to the menu button;
  choosing a page closes it and navigates; body scroll locks while open.
- [ ] `A11Y-A8` · **Reduced motion** — With `prefers-reduced-motion: reduce`,
  expand rail groups, open the drawer, open search, use back-to-top →
  Collapse/expand, drawer and scroll behaviours present without animation
  (`motion-reduce:` paths; instant scroll)
- [ ] `A11Y-A9` · **Image zoom** — On `{base}/platform/chat/basics`, Tab to a
  screenshot, Enter, then Esc → The zoom trigger is a button named by the
  image alt; the lightbox traps focus (Tab cycles inside), Esc closes it, and
  focus **returns to the trigger**; the close button carries an accessible
  name (**Close**, `@tale/ui` `markdownImage` namespace)
- [ ] `A11Y-A10` · **Video player** — On
  `{base}/tutorials/videos/welcome-to-tale`, drive the player by keyboard only
  → The native `<video controls>` is reachable by Tab; play/pause operates by
  keyboard; the captions track (`kind="captions"`) can be toggled on from the
  player without a pointer; the episode caption is a real `<figcaption>`
- [ ] `A11Y-A11` · **PWA update banner** — When the update banner / offline
  toast fires ([navigation.md](navigation.md) NAV-F11–NAV-F12), inspect it →
  The container is `role="status"` with `aria-live="polite"` — announced
  without stealing focus; **Reload** / **Dismiss** are real buttons reachable
  by Tab; the one-shot offline toast (self-removes ~4 s) never traps focus.
- [ ] `A11Y-A12` · **One page title** — On a content page and on the 404, walk
  the accessibility tree → Exactly one `<h1>`, and it is the article title; the
  header strip's breadcrumb leaf is a plain `aria-current="page"` marker, not a
  heading, so the outline never gains a second title.

## Boundary & error tests

- [ ] `A11Y-B1` · **Zoom 200 %** — Browser zoom 200 % on a content page → No
  loss of content/function; body column reflows; sticky chrome doesn't swallow
  the viewport.
- [ ] `A11Y-B2` · **404 page** — Open `{base}/nope` with a screen reader → The
  **Page not found** heading is the page `<h1>`; the suggestions list is a
  labelled `<nav>` (**Did you mean**) with real links.

## Performance

- [ ] `A11Y-P1` · **CLS** → No visible layout shift while a content page loads
  (fonts/highlighting swap without reflowing the column)
