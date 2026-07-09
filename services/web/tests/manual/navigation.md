# Navigation & pages — Manual Test Plan

> **Purpose**: Exercise the page inventory and every way to move between pages —
> the header nav, the footer columns, the legal-document pages (tabs, print),
> in-page hash links, browser history, and the 404 paths. The mobile hamburger
> drawer lives in [responsive.md](responsive.md); the footer's language/theme
> switchers live in [locale.md](locale.md) / [theme.md](theme.md).

## Scope & routes

| Surface          | Route                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Home             | `/` (also `/{lang}`)                                                                                                       |
| Platform hub     | `/platform`                                                                                                                |
| Platform modules | `/platform/{chat\|knowledge\|agents\|automations\|conversations\|governance}`                                              |
| Pricing          | `/pricing`                                                                                                                 |
| Hardware pricing | `/hardware-pricing`                                                                                                        |
| Changelog        | `/changelog`                                                                                                               |
| Contact          | `/contact`                                                                                                                 |
| Request demo     | `/request-demo`                                                                                                            |
| Legal documents  | `/legal/{privacy-policy\|terms-of-service\|data-processing-agreement\|technical-organizational-measures\|personalization}` |
| Locale trees     | `/{lang}/…` for `de` and `fr` (see [locale.md](locale.md))                                                                 |
| Redirect         | `/en` and any unknown `/{lang}` prefix → `/` (`app/routes/$lang.tsx`)                                                      |
| Unknown route    | `/nope-not-a-route` → not-found page                                                                                       |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — any mode; no sign-in. All routes
render without a backend.

> **Agent note**: header/footer render on every route, so nav checks can chain
> page-to-page. External links open new tabs; assert `target`/`rel` attributes
> instead of following them.

## Automated coverage

| Case(s)        | Status         | e2e spec                                                              |
| -------------- | -------------- | --------------------------------------------------------------------- |
| F1             | 🔶 partial     | `smoke.spec.ts` (home renders, Platform / Pricing / Resources / CTAs) |
| F9             | 🔶 partial     | `smoke.spec.ts` (`/pricing` renders — no interaction)                 |
| F2–F8, F10–F11 | ⛔ manual-only | —                                                                     |
| B1–B4          | ⛔ manual-only | —                                                                     |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                      | Steps (route + control)                                                                                                             | Expected (verifiable)                                                                                                         |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F1  | Header nav                | On `/`, open **Platform** (`nav.platform`) and **Resources** (`nav.resources`); click **Pricing** (`nav.pricing`)                   | Platform lists Chat → Governance; Resources lists Docs / Changelog / Hardware; **Pricing** commits `/pricing`                 |
| F2  | Get started               | Header → **Get started** (`nav.getStarted`)                                                                                         | Get started → docs `/get-started/quickstart` (primary header CTA; Request a demo is not in the header)                        |
| F3  | GitHub                    | Header trailing GitHub icon (`footer.githubAriaLabel`)                                                                              | External link to `https://github.com/tale-project/tale` with `target="_blank"` and `rel="noopener noreferrer"`                |
| F4  | Logo home link            | On `/pricing`, click the Tale logo (aria-label **Tale home**, `nav.homeAriaLabel`)                                                  | URL commits `/` (or `/{lang}`); hero renders                                                                                  |
| F5  | Footer Platform + Company | Footer **Platform** (`footer.platform`); **Company** (`footer.company`): Contact us + Request a demo; address column under Platform | Platform links commit `/platform/*`; company links commit `/contact` and `/request-demo`; address shows Ruler GmbH + VAT link |
| F6  | Footer Legal column       | Footer **Legal** (`footer.legal`): the four legal links + **Service Agreement** + **Hardware Agreement**                            | Legal links commit `/legal/{slug}`; agreement links serve PDFs                                                                |
| F7  | Footer Resources + GitHub | Footer **Resources**: Docs / Changelog / Hardware / Pricing; GitHub icon after the theme picker                                     | Docs is external; Changelog / Hardware / Pricing commit internal routes; GitHub links to the repo                             |
| F8  | Legal tabs + print        | Open `/legal/data-processing-agreement`; use the DPA/TOM tabs; click **Print or save as PDF**                                       | Tabs switch sibling documents; print opens `window.print`                                                                     |
| F9  | Pricing controls          | On `/pricing`, toggle billing / currency / users                                                                                    | Prices update; state in URL search params survives reload                                                                     |
| F10 | Hardware controls         | On `/hardware-pricing`, switch mode / billing / term                                                                                | Tier cards swap; state in `?mode=` / `?billing=` / `?term=`                                                                   |
| F11 | FAQ + history             | On `/`, expand two FAQ items; click **Contact our team**; then browser Back                                                         | Both items stay open; link commits `/contact`; Back returns to `/`                                                            |

## Boundary & error tests

| ID  | Test               | Input                                            | Expected                                                                                                                                             |
| --- | ------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Unknown route      | Open `/nope-not-a-route`, then `/nope/deep-page` | Built dist: HTTP **404** + localized not-found page (`notFoundComponent` on root). Dev SPA may differ — prove with `start` / container probe `/nope` |
| B2  | Unknown legal slug | Open `/legal/not-a-document`                     | Throws `notFound()` → same not-found page as B1 (styled, with recovery CTA)                                                                          |
| B3  | `/en` prefix       | Open `/en`, then `/en/pricing`                   | Both redirect to `/` (the `$lang` route only accepts `de`/`fr`); note the sub-path is **dropped**, not remapped to `/pricing`                        |
| B4  | Bad search params  | Open `/pricing?billing=zzz&region=XX&users=abc`  | The page renders with defaults (no crash, no NaN price); the invalid params are ignored or normalized                                                |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                           |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Skip link      | First focusable element is the **Skip to main content** link (`nav.skipToMain`) targeting `#main`; activating it moves focus into `<main>`         |
| A2  | Landmarks      | Exactly one `<main id="main">` per page; footer link columns are `<nav>` elements labelled by their column heading; one `<header>`, one `<footer>` |
| A3  | Legal tabs nav | The DPA/TOM tab strip is a `<nav aria-label>` = **Document sections** (`legal.documentTabsAria`); the active tab is programmatically marked        |
| A4  | Focus visible  | Tabbing through header links, footer links, and the pricing segmented controls shows a visible focus ring on each                                  |

## Performance

See [SETUP.md](SETUP.md) for budgets. Nav chrome must not introduce layout shift on sticky scroll.
