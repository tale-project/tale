# Accessibility — Manual Test Plan (cross-cutting)

> **Purpose**: A WCAG 2.1 **Level AA** sweep across the marketing site. Tale's
> standard (root [`AGENTS.md`](../../../../AGENTS.md) → Accessibility) is
> mandatory, not aspirational. Per-area guides carry their own `A#` rows
> (forms wiring in [forms.md](forms.md), switcher semantics in
> [locale.md](locale.md)/[theme.md](theme.md), touch targets in
> [responsive.md](responsive.md)); this guide is the holistic pass and the
> place to log _systemic_ findings.

## Scope & routes

Run each check on a representative set: `/` (long marketing page with
animations), `/pricing` (segmented controls + slider + compare table),
`/contact` (form), `/legal/data-processing-agreement` (long document + tabs).

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md). Drive the keyboard checks with
the keyboard only. A screen reader (VoiceOver, `Cmd+F5`) helps the announce
checks. There is **no axe layer in this service's e2e suite** — full-page
audits are manual/assisted here; shared `@tale/ui` components carry their own
`vitest-axe` coverage.

> **Agent note**: assert structure against the live DOM (`page.evaluate` DOM
> scans), not screenshots. The site animates on scroll (framer-motion) — for
> A7 set `prefers-reduced-motion: reduce` in the browser context **before**
> loading.

## Automated coverage

| Layer                           | Status         | Where                                                                                       |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| Per-component axe (WCAG 2.1 AA) | ✅ automated   | `@tale/ui` component tests (`checkAccessibility()` via `vitest-axe`) + Storybook a11y addon |
| Full-page audits (A1–A8)        | ⛔ manual-only | — this guide                                                                                |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only.

## Functional / structural tests

| ID  | Test           | Steps (route + control)                                                                                                    | Expected (verifiable)                                                                                                                                                                                                                                                          |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Skip link      | On each surface, press Tab once from page top                                                                              | First focusable is **Skip to main content** (`nav.skipToMain`, `href="#main"`); it becomes visible on focus (`sr-only focus:not-sr-only`); Enter moves focus into `<main id="main">`                                                                                           |
| A2  | Landmarks      | Query `main, header, footer, nav` on each surface                                                                          | Exactly one `<main>`, one `<header>`, one `<footer>`; every `<nav>` exposes an accessible name (footer columns are labelled by their headings; the legal tab strip is labelled **Document sections**). Verified live: the **header primary nav is unlabelled** — see Issues #1 |
| A3  | Heading order  | Walk headings top→bottom on `/` and `/pricing`                                                                             | One `<h1>` per page (the hero / page title); levels never skip (no `h1`→`h3`)                                                                                                                                                                                                  |
| A4  | Keyboard reach | Tab through `/pricing`: billing radiogroup, currency radiogroup, users slider, FAQ accordions, compare-table info triggers | Every interactive control receives focus and operates by keyboard (radios switch, the slider arrows, accordions toggle with Enter/Space); nothing is mouse-only                                                                                                                |
| A5  | Contrast       | Sample body text, muted text (`text-fg-muted`), primary/secondary buttons — in **both** themes                             | Body ≥ 4.5:1, large text ≥ 3:1, non-text UI ≥ 3:1; colour is never the only signal (e.g. compare-table cells pair icon + `sr-only`/label text: **Included** / **Not included**, `pricing.compare.cellLabels.*`)                                                                |
| A6  | Visible focus  | Tab through header, hero CTAs, footer links, switchers — both themes                                                       | A focus ring is visible on every focused control (the shared controls use `focus-visible:ring-2`); no `outline: none` without a replacement                                                                                                                                    |
| A7  | Reduced motion | With `prefers-reduced-motion: reduce`, load `/` and scroll through it                                                      | Sections present without fade/slide (framer-motion `useReducedMotion` paths); the hash scroll (`/#features`) jumps instantly; no parallax/marquee keeps moving                                                                                                                 |
| A8  | Images + icons | Query `img` and icon-only controls on `/`                                                                                  | Every meaningful `<img>` has a descriptive `alt` (hero/product mocks); decorative icons are `aria-hidden`; icon-only buttons/links (GitHub, hamburger) expose labels (`footer.githubAriaLabel`, `nav.openMenu`)                                                                |

## Boundary & error tests

| ID  | Test                | Input                                    | Expected                                                                                        |
| --- | ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| B1  | Form error announce | Submit an empty `/contact` form          | Errors are announced (see [forms.md](forms.md) A2) and focus is **not** thrown to the page top  |
| B2  | Zoom 200 %          | Browser zoom 200 % on `/` and `/contact` | No loss of content or function; no overlapping text; sticky header doesn't swallow the viewport |

## Performance

| ID  | Metric      | Target                                                                    |
| --- | ----------- | ------------------------------------------------------------------------- |
| P1  | CLS on load | No visible layout shift while `/` loads (hero images have reserved space) |

## Issues Found

| #   | Test ID | Route / URL                     | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                       | Screenshot |
| --- | ------- | ------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | A2      | `https://tale.dev/` (all pages) | low                          | The header's primary `<nav>` has no accessible name while the three footer navs are labelled (2026-07-06 live DOM scan: `navs: [unlabelled, Product, Resources, Legal]`) — screen-reader users can't tell the nav landmarks apart | —          |

## Test summary

```
Area: Accessibility (web)
Structural: ___/8   Boundary: ___/2   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
