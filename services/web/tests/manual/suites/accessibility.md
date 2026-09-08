# Accessibility (cross-cutting)

> **Prefix** `A11Y-` · **Reset** none · **Cost** 11 boxes

A WCAG 2.1 **Level AA** sweep across the marketing site. Tale's standard (root
[`AGENTS.md`](../../../../../AGENTS.md) → Accessibility) is mandatory, not
aspirational. Per-area guides carry their own `A#` rows (forms wiring in
[forms.md](forms.md), switcher semantics in
[locale.md](locale.md)/[theme.md](theme.md), touch targets in
[responsive.md](responsive.md), demo/tour semantics in
[platform-pages.md](platform-pages.md)); this guide is the holistic pass and
the place to log _systemic_ findings.

## Scope & routes

Run each check on a representative set: `/` (long marketing page with animated
demos), `/platform` (demo-stage tour), `/pricing` (segmented controls + slider
+ compare table), `/contact` (form), `/legal/data-processing-agreement` (long
document + tabs), `/changelog` (sticky timeline nav).

## Preconditions

Bring the site up per [SETUP.md](../setup.md). Drive the keyboard checks with
the keyboard only. A screen reader (VoiceOver, `Cmd+F5`) helps the
announce checks. There is **no axe layer in this service's e2e suite** —
full-page audits are manual/assisted here; shared `@tale/ui` components carry
their own `vitest-axe` coverage.

> **Agent note**: assert structure against the live DOM (`page.evaluate` DOM
> scans), not screenshots. The site animates on scroll (framer-motion) — for
> A11Y-A7 set `prefers-reduced-motion: reduce` in the browser context
> **before** loading. The product visuals are DOM/SVG demo scenes exposed as
> single illustrations: `role="img"` + aria-label (the labels under
> `home.demos.*`) — there are **zero `<img>` elements** on the marketing
> pages.

## Functional / structural tests

- [ ] `A11Y-A1` · **Skip link** — On each surface, press Tab once from page
  top → First focusable is **Skip to main content** (`nav.skipToMain`,
  `href="#main"`); it becomes visible on focus (`sr-only focus:not-sr-only`);
  Enter moves focus into `<main id="main">`
- [ ] `A11Y-A2` · **Landmarks** — Query `main, header, footer, nav` on each
  surface → Exactly one `<main>`, one `<header>`, one `<footer>`; every
  `<nav>` exposes an accessible name. Verified 2026-08: the **footer's five
  column navs are labelled** by their headings, but the **header primary
  nav**, the **mobile drawer nav**, and the linkless **address-column nav**
  fail this — see Issues #1/#2.
- [ ] `A11Y-A3` · **Heading order** — Walk headings top→bottom on `/`,
  `/platform`, and `/pricing` → One `<h1>` per page (the hero / page title);
  levels never skip (no `h1`→`h3`). `/platform` + `/pricing` are automated by
  `smoke.spec.ts`; walk `/` and spot-check the module pages manually.
- [ ] `A11Y-A4` · **Keyboard reach** — Tab through `/pricing`: billing
  radiogroup, currency radiogroup, users slider, FAQ accordions, compare-table
  info triggers → Every interactive control receives focus and operates by
  keyboard (radios switch, the slider arrows, accordions toggle with
  Enter/Space); nothing is mouse-only.
- [ ] `A11Y-A5` · **Contrast** — Sample body text, muted text
  (`text-fg-muted`), primary/secondary buttons — in **both** themes → Body ≥
  4.5:1, large text ≥ 3:1, non-text UI ≥ 3:1; colour is never the only signal
  (e.g. compare-table cells pair icon + `sr-only`/label text: **Included** /
  **Not included**, `pricing.compare.cellLabels.*`)
- [ ] `A11Y-A6` · **Visible focus** — Tab through header, hero CTAs, footer
  links, switchers — both themes → A focus ring is visible on every focused
  control (the shared controls use `focus-visible:ring-2`); no `outline: none`
  without a replacement.
- [ ] `A11Y-A7` · **Reduced motion** — With `prefers-reduced-motion: reduce`,
  load `/` and scroll through it → Sections present without fade/slide
  (framer-motion `useReducedMotion` paths); every animated demo is pinned to
  its **complete end state** (no typing/streaming loops — the state
  `home-demos.spec.ts` asserts); the hash scroll jumps instantly; nothing
  keeps moving.
- [ ] `A11Y-A8` · **Demo names + icon controls** — On `/`, query
  `[role="img"]` and icon-only controls → Every demo scene exposes a
  descriptive aria-label (`home.demos.hero.label`, `home.demos.connect.label`,
  …) that names what the animation shows; decorative icons inside are hidden
  from AT; icon-only buttons/links (GitHub, hamburger) expose labels
  (`footer.githubAriaLabel`, `nav.openMenu`). There are no `<img>` elements to
  alt-check.

## Boundary & error tests

- [ ] `A11Y-B1` · **Form error announce** — Submit an empty `/contact` form →
  Errors are announced (see [forms.md](forms.md) FORM-A2) and focus is **not**
  thrown to the page top.
- [ ] `A11Y-B2` · **Zoom 200 %** — Browser zoom 200 % on `/` and `/contact` →
  No loss of content or function; no overlapping text; sticky header doesn't
  swallow the viewport.

## Performance

- [ ] `A11Y-P1` · **CLS on load** → No visible layout shift while `/` loads
  (demo stages have reserved space)
