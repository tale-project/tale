# Accessibility — Manual Test Plan (cross-cutting)

> **Purpose**: A WCAG 2.1 **Level AA** sweep across the docs site, including
> the theme switcher and the mobile drawer. Tale's standard (root
> [`AGENTS.md`](../../../../AGENTS.md) → Accessibility) is mandatory. Per-area
> guides carry their own `A#` rows; this guide is the holistic pass and the
> place to log _systemic_ findings.

## Scope & routes

Run each check on: `{base}/` (landing), one long content page
(`{base}/self-hosted/install/quickstart`), one screenshot page
(`{base}/platform/chat/basics` for A9), one video page
(`{base}/tutorials/videos/welcome-to-tale` for A10), the search dialog, and
the 404 page. Add a ≤ 767 px viewport pass for the mobile drawer rows.

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md). Drive the keyboard checks with the
keyboard only; a screen reader helps the announce checks. There is **no axe
layer in this service's e2e suite** — full-page audits are manual/assisted
here; shared `@tale/ui` components carry `vitest-axe` coverage.

> **Agent note**: assert structure via DOM scans. Skip link and page actions
> are i18n-wired (`nav.skipToMain`, `docs.pageActions.*`). Remaining hard-coded
> English in shared `@tale/ui` (code-copy, heading link) is logged once via
> [locale.md](locale.md).

## Automated coverage

| Layer                           | Status         | Where                                                                                       |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| Per-component axe (WCAG 2.1 AA) | ✅ automated   | `@tale/ui` component tests (`checkAccessibility()` via `vitest-axe`) + Storybook a11y addon |
| Source heading hierarchy        | ✅ automated   | vitest `structure-headings.test.ts` (per-page heading rules in the corpus)                  |
| Full-page audits (A1–A11)       | ⛔ manual-only | — this guide (the shared `ImageZoom`/`Video` components carry `vitest-axe` in `@tale/ui`)   |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only.

## Functional / structural tests

| ID  | Test              | Steps (route + control)                                                                                  | Expected (verifiable)                                                                                                                                                                                                                                                                        |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Skip link         | On each surface, Tab once from page top                                                                  | First focusable is the skip link (`nav.skipToMain`; EN **Skip to main content**); it becomes visible on focus; Enter moves focus into the main content                                                                                                                                       |
| A2  | Landmarks         | Query `main, header, footer, nav, aside`                                                                 | Exactly one `<main>`; sidebar `<nav aria-label>` = `nav.sidebarAriaLabel` (EN **Documentation**); breadcrumbs `<nav>` labelled **Breadcrumbs**; TOC `<aside>` labelled **On this page**; one `<header>`, one `<footer>`                                                                      |
| A3  | Rendered headings | Walk headings top→bottom on landing + content page                                                       | Exactly one `<h1>` (the page title); rendered levels never skip. Caveat: `<Step title>` injects an `<h3>` regardless of context (`@tale/ui` `steps.tsx`) — on a page whose Steps sit directly under an H2 that's fine, but flag any page where a Step h3 follows the H1 with no H2 between   |
| A4  | Keyboard reach    | Tab through: header (logo, search, menu), sidebar, body links, page actions, prev/next, footer switchers | Everything is focusable and operable by keyboard in a sensible order; no keyboard trap; hover-revealed copy buttons appear on focus                                                                                                                                                          |
| A5  | Visible focus     | Repeat A4 watching the focus indicator — in **both** themes                                              | A visible focus ring on every stop (`focus-visible:ring` styles); never invisible against its background                                                                                                                                                                                     |
| A6  | Theme switch      | Footer theme switcher: **Switch theme** (`themeSwitcher.ariaLabel`) → **Dark**, reload                   | Semantics: labelled control with **Light**/**Dark**/**System** options (`themeSwitcher.*`), current option programmatically marked; the choice persists (`localStorage['tale-theme']`); contrast spot-checks (body ≥ 4.5:1, muted text ≥ 4.5:1, code tokens ≥ 4.5:1) pass in **both** themes |
| A7  | Mobile drawer     | ≤ 767 px: header **Open navigation menu** (`nav.openMenu`)                                               | Button toggles to **Close navigation menu** (`nav.closeMenu`) with `aria-expanded`; the drawer contains the search trigger + full nav tree; Esc closes it; choosing a page closes it and navigates; body scroll locks while open                                                             |
| A8  | Reduced motion    | With `prefers-reduced-motion: reduce`, expand sidebar groups, open search, use back-to-top               | Collapse/expand and scroll behaviours present without animation (framer-motion reduced paths; instant scroll)                                                                                                                                                                                |
| A9  | Image zoom        | On `{base}/platform/chat/basics`, Tab to a screenshot, Enter, then Esc                                   | The zoom trigger is a button named by the image alt; the lightbox traps focus (Tab cycles inside), Esc closes it, and focus **returns to the trigger**; the close button carries an accessible name (**Close**, `@tale/ui` `markdownImage` namespace)                                        |
| A10 | Video player      | On `{base}/tutorials/videos/welcome-to-tale`, drive the player by keyboard only                          | The native `<video controls>` is reachable by Tab; play/pause operates by keyboard; the captions track (`kind="captions"`) can be toggled on from the player without a pointer; the episode caption is a real `<figcaption>`                                                                 |
| A11 | PWA update banner | When the update banner / offline toast fires ([navigation.md](navigation.md) F11–F12), inspect it        | The container is `role="status"` with `aria-live="polite"` — announced without stealing focus; **Reload** / **Dismiss** are real buttons reachable by Tab; the one-shot offline toast (self-removes ~4 s) never traps focus                                                                  |

## Boundary & error tests

| ID  | Test       | Input                                   | Expected                                                                                                                         |
| --- | ---------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Zoom 200 % | Browser zoom 200 % on a content page    | No loss of content/function; body column reflows; sticky chrome doesn't swallow the viewport                                     |
| B2  | 404 page   | Open `{base}/nope` with a screen reader | The **Page not found** heading is the page `<h1>`; the suggestions list is a labelled `<nav>` (**Did you mean**) with real links |

## Performance

| ID  | Metric | Target                                                                                                    |
| --- | ------ | --------------------------------------------------------------------------------------------------------- |
| P1  | CLS    | No visible layout shift while a content page loads (fonts/highlighting swap without reflowing the column) |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Accessibility (docs)
Structural: ___/11   Boundary: ___/2   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
