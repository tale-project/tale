# Responsive — Manual Test Plan (cross-cutting)

> **Purpose**: Verify the marketing site adapts across viewports — the mobile
> hamburger drawer (the desktop nav is `hidden lg:flex`, so the split is the
> Tailwind **`lg` breakpoint, 1024 px**), single-column reflow, the wide
> pricing/hardware compare tables, and that no page overflows horizontally at
> phone width. Cross-cutting: it re-walks pages other guides own at narrow
> widths.

## Scope & routes

Test at three widths — **390×844** (phone), **1023×768** (just below the
breakpoint — still mobile chrome), **1280×800** (desktop). Drive the width with
`browser_resize` (or a context `viewport`).

| Surface (re-walked at mobile width)           | Route                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Home (hero demo, tour rows, FAQ)              | `/`                                                                                        |
| Platform hub (demo stages + module grid)      | `/platform`                                                                                |
| One module page (tour rows + capability grid) | `/platform/chat` (widest content: compare-style grids, alternating tour rows, demo stages) |
| Pricing (cards + compare table)               | `/pricing`                                                                                 |
| Hardware pricing (compare table)              | `/hardware-pricing`                                                                        |
| Changelog (sticky timeline + release stream)  | `/changelog`                                                                               |
| Contact form                                  | `/contact`                                                                                 |
| Request demo form                             | `/request-demo`                                                                            |
| Legal document (long prose + tabs)            | `/legal/data-processing-agreement`                                                         |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — any mode; everything here is
read-only (no form submits needed).

> **Agent note**: set the viewport **before** the first `goto`. The hamburger
> is the header button **Open menu** (`nav.openMenu`), `aria-expanded` +
> `aria-controls="mobile-nav"`; open, it becomes **Close menu**
> (`nav.closeMenu`) and the body scroll locks (`document.body.style.overflow ===
'hidden'`). To prove "no horizontal overflow", assert
> `document.documentElement.scrollWidth === clientWidth`.

## Automated coverage

| Case(s)                 | Status         | e2e spec                                       |
| ----------------------- | -------------- | ---------------------------------------------- |
| F1–F5, B1–B2, A1–A2, P1 | ⛔ manual-only | — (`smoke.spec.ts` runs desktop-viewport only) |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test              | Steps (route + control)                                                             | Expected (verifiable)                                                                                                                                                                                                                                           |
| --- | ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Hamburger drawer  | At 390 px on `/`, click **Open menu** (`nav.openMenu`)                              | The button flips to **Close menu** with `aria-expanded="true"`; the drawer (`#mobile-nav`) shows Platform + Resources as flat lists (not collapsed disclosures), Pricing, and **Get started**; body scroll locks; the desktop inline nav is hidden (`lg:` only) |
| F2  | Drawer navigation | In the open drawer, tap **Pricing**                                                 | URL commits `/pricing`, the drawer **closes itself**, scroll unlocks (`document.body.style.overflow` restored); **Esc** also closes it                                                                                                                          |
| F3  | No overflow       | At 390 px, on each scoped route, read `document.documentElement.scrollWidth`        | `scrollWidth === clientWidth (390)` on every page — no horizontal scrollbar, nothing off-canvas                                                                                                                                                                 |
| F4  | Compare tables    | At 390 px, on `/pricing` and `/hardware-pricing`, scroll to the **Compare** section | The wide comparison table is horizontally scrollable **inside its own container** (the page itself doesn't overflow — F3 still holds); segmented controls wrap or shrink without clipping                                                                       |
| F5  | Forms at 390 px   | `/contact`: focus each field, open the keyboard-sized viewport                      | Fields stack one column, labels visible, the submit button full-width and reachable; no field is clipped                                                                                                                                                        |

## Boundary & error tests

| ID  | Test                | Input                                        | Expected                                                                                                                                                                                                                                                                                   |
| --- | ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Breakpoint crossing | Resize 1023 px → 1024 px on `/`              | At **1023 px** the hamburger is visible and the inline nav hidden; at **1024 px** the inline nav + header CTAs appear and the hamburger disappears — clean swap                                                                                                                            |
| B2  | Resize with drawer  | Open the drawer at 390 px, resize to 1280 px | No stuck scroll-lock: the page scrolls again and the desktop header renders normally (record if the lock persists — that's a finding). While closed the drawer `<nav id="mobile-nav">` carries `aria-hidden="true"` **and** `inert` (its links are unfocusable); both toggle off when open |

## Accessibility (WCAG 2.1 AA)

| ID  | Check         | Expected                                                                                                                               |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Touch targets | The hamburger is ≥ 44×44 CSS px (rendered `h-11 w-11`); drawer links and footer controls are comfortably tappable (≥ 44 px height)     |
| A2  | Reflow        | At **320 px** width content reflows to one column with no loss of information or function (WCAG 1.4.10); `scrollWidth === clientWidth` |

## Performance

| ID  | Metric      | Target                                                                                                      |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| P1  | Drawer open | The drawer is fully visible **< 300 ms** after the tap (animation is skipped entirely under reduced motion) |

## Issues Found

| #   | Test ID | Route / URL + width | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ------------------- | ---------------------------- | ----------- | ---------- |
|     |         |                     |                              |             |            |

## Test summary

```
Area: Responsive (web)
Functional: ___/5   Boundary: ___/2   A11y: ___/2   Perf: ___/1
Widths: 320 ☐  390 ☐  1023 ☐  1024 ☐  1280 ☐
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
