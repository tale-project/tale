# Navigation & pages — Manual Test Plan

> **Purpose**: Exercise the whole page inventory and every way to move between
> pages — the header nav, the footer columns, the legal-document pages (tabs,
> print), in-page hash links, browser history, and the 404 paths. The mobile
> hamburger drawer lives in [responsive.md](responsive.md); the footer's
> language/theme switchers live in [locale.md](locale.md) / [theme.md](theme.md).

## Scope & routes

| Surface          | Route                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Home             | `/` (also `/{lang}`)                                                                                                       |
| Pricing          | `/pricing`                                                                                                                 |
| Hardware pricing | `/hardware-pricing`                                                                                                        |
| Contact          | `/contact`                                                                                                                 |
| Request demo     | `/request-demo`                                                                                                            |
| Legal documents  | `/legal/{privacy-policy\|terms-of-service\|data-processing-agreement\|technical-organizational-measures\|personalization}` |
| Locale trees     | `/{lang}/…` for `de` and `fr` (see [locale.md](locale.md))                                                                 |
| Redirect         | `/en` and any unknown `/{lang}` prefix → `/` (`app/routes/$lang.tsx`)                                                      |
| Unknown route    | `/nope-not-a-route` → redirects to `/` (B1); `/legal/bad-slug` → bare not-found fallback (B2)                              |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — any mode; no sign-in. All routes
render without a backend.

> **Agent note**: header/footer render on every route, so nav checks can chain
> page-to-page. Hash-scroll (F7) is smooth by default and instant under
> `prefers-reduced-motion` — wait on the target section's position, not on an
> animation. External links open new tabs; assert `target`/`rel` attributes
> instead of following them.

## Automated coverage

| Case(s)        | Status         | e2e spec                                                     |
| -------------- | -------------- | ------------------------------------------------------------ |
| F1             | 🔶 partial     | `smoke.spec.ts` (home renders, **Pricing** nav link visible) |
| F9             | 🔶 partial     | `smoke.spec.ts` (`/pricing` renders — no interaction)        |
| F2–F8, F10–F11 | ⛔ manual-only | —                                                            |
| B1–B4          | ⛔ manual-only | —                                                            |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                     | Steps (route + control)                                                                                                                                                                                                                                                                       | Expected (verifiable)                                                                                                                                                                                                                                                               |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Header nav               | On `/`, click **Platform** (`nav.platform`), **Pricing** (`nav.pricing`), **Hardware** (`nav.hardware`) in the header                                                                                                                                                                         | URL commits `/`, `/pricing`, `/hardware-pricing` respectively; each page's heading renders ([SETUP.md](SETUP.md) smoke table)                                                                                                                                                       |
| F2  | Read docs                | Header → **Read docs** (`nav.readDocs`)                                                                                                                                                                                                                                                       | An external link to `https://tale.dev/docs` with `target="_blank"` and `rel="noopener noreferrer"`; following it lands on the docs site                                                                                                                                             |
| F3  | Request demo CTA         | Header → **Request demo** (`nav.requestDemo`); also the hero CTAs **Request demo** (`home.hero.ctaPrimary`) and **Get started** (`home.hero.ctaSecondary`)                                                                                                                                    | Header CTA and hero primary CTA navigate to `/request-demo`; **Get started** is an external link to the docs quickstart (`{docs}/self-hosted/install/quickstart`)                                                                                                                   |
| F4  | Logo home link           | On `/pricing`, click the Tale logo (aria-label **Tale home**, `nav.homeAriaLabel`)                                                                                                                                                                                                            | URL commits `/` (or `/{lang}` when on a locale tree); hero renders                                                                                                                                                                                                                  |
| F5  | Footer Product column    | Footer **Product** (`footer.product`): **Features** (`footer.features`), **Pricing** (`footer.pricing`), **Hardware Pricing** (`footer.hardwarePricing`), **Contact** (`footer.contact`)                                                                                                      | **Features** navigates to `/#features` and scrolls the features section into view; the others commit `/pricing`, `/hardware-pricing`, `/contact`                                                                                                                                    |
| F6  | Footer Legal column      | Footer **Legal** (`footer.legal`): the four legal links + **Service Agreement** (`footer.serviceAgreement`) + **Hardware Agreement** (`footer.hardwareAgreement`)                                                                                                                             | Legal links commit `/legal/{slug}` and the document renders; the two agreement links download/serve PDFs from `/files/Service_Agreement_Template.pdf` and `/files/Hardware_Agreement_Template.pdf` (HTTP 200, `content-type` PDF)                                                   |
| F7  | Footer Resources + brand | Footer **Resources** (`footer.resources`) → **AI Training Courses** (`footer.aiTraining`); brand column: address block, VAT id link, GitHub icon (aria-label **GitHub**, `footer.githubAriaLabel`)                                                                                            | **AI Training Courses** is an external link (edoobox) opening in a new tab; the VAT id links to `uid.admin.ch`; the GitHub icon links to `https://github.com/tale-project/tale`                                                                                                     |
| F8  | Legal tabs + print       | Open `/legal/data-processing-agreement`; use the tabs **DPA** / **TOM** (`legal.tabs.data-processing-agreement` / `legal.tabs.technical-organizational-measures`, `<nav aria-label>` = **Document sections**, `legal.documentTabsAria`); click **Print or save as PDF** (`legal.downloadPdf`) | Tabs switch between the two sibling documents (URL commits the sibling slug); the active tab is marked; the print button opens the browser print dialog (`window.print`)                                                                                                            |
| F9  | Pricing controls         | On `/pricing`, toggle **Billing period** (`pricing.billing.ariaLabel`): **Monthly** / **Yearly (2 months free)**; toggle **Currency** (`pricing.region.ariaLabel`): **CHF** / **EUR**; move the **Number of users** slider (`pricing.users.label`)                                            | Prices update; the state is reflected in URL search params (`?billing=`, `?region=`, `?users=`) and survives a reload; the **Community** plan shows **Free**, the **Enterprise** plan a computed per-user price; users below 25 clamp with the tooltip (`pricing.users.minTooltip`) |
| F10 | Hardware controls        | On `/hardware-pricing`, switch **Deployment mode** (`hardwarePricing.modesAriaLabel`), **Payment option** (`hardwarePricing.billing.ariaLabel`): **Leasing** / **Buying**, and the leasing **term**                                                                                           | Tier cards swap per mode; leasing shows `/month` suffixes, buying a one-off price; state lands in `?mode=`, `?billing=`, `?term=` and survives a reload                                                                                                                             |
| F11 | FAQ + history            | On `/`, expand two FAQ items (`home.faq.*.q`, accordion allows multiple open); click **Contact our team** (`home.faq.contactTeam`); then browser Back                                                                                                                                         | Both items stay open simultaneously; the link commits `/contact`; Back returns to `/` with the page intact (no blank view)                                                                                                                                                          |

## Boundary & error tests

| ID  | Test               | Input                                            | Expected                                                                                                                                                                                                                                  |
| --- | ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Unknown route      | Open `/nope-not-a-route`, then `/nope/deep-page` | No crash — but observed live: **both silently redirect to `/`** (the `$lang` route captures the first segment, fails locale validation, and redirects home). There is no 404 page and no signal to the visitor — see Issues #1            |
| B2  | Unknown legal slug | Open `/legal/not-a-document`                     | The route throws `notFound()`; observed live: no custom `notFoundComponent` is registered, so TanStack's **unstyled default** renders — plain **"Not Found"** text inside `<main>`, document title stays the home default — see Issues #1 |
| B3  | `/en` prefix       | Open `/en`, then `/en/pricing`                   | Both redirect to `/` (the `$lang` route only accepts `de`/`fr`); note the sub-path is **dropped**, not remapped to `/pricing`                                                                                                             |
| B4  | Bad search params  | Open `/pricing?billing=zzz&region=XX&users=abc`  | The page renders with defaults (no crash, no NaN price); the invalid params are ignored or normalized                                                                                                                                     |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                           |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Skip link      | First focusable element is the **Skip to main content** link (`nav.skipToMain`) targeting `#main`; activating it moves focus into `<main>`         |
| A2  | Landmarks      | Exactly one `<main id="main">` per page; footer link columns are `<nav>` elements labelled by their column heading; one `<header>`, one `<footer>` |
| A3  | Legal tabs nav | The DPA/TOM tab strip is a `<nav aria-label>` = **Document sections** (`legal.documentTabsAria`); the active tab is programmatically marked        |
| A4  | Focus visible  | Tabbing through header links, footer links, and the pricing segmented controls shows a visible focus ring on each                                  |

## Performance

| ID  | Metric            | Target                                                                                           |
| --- | ----------------- | ------------------------------------------------------------------------------------------------ |
| P1  | In-app navigation | A header-nav route commit settles in **< 1 s** on a warm local build (SPA transition, no reload) |
| P2  | Hash scroll       | `/#features` from the footer scrolls the section into view in **< 1 s**                          |

## Issues Found

| #   | Test ID | Route / URL                                                                     | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                                                                  | Screenshot |
| --- | ------- | ------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | B1/B2   | `https://tale.dev/nope-not-a-route`, `/nope/deep-page`, `/legal/not-a-document` | med                          | No branded 404 anywhere (2026-07-06 live pass): unknown single- and multi-segment routes silently redirect to `/`; an unknown legal slug renders TanStack's bare "Not Found" text with the home document title. Also HTTP 200 in every case — see [seo.md](seo.md) Issues #1 | —          |

## Test summary

```
Area: Navigation & pages (web)
Functional: ___/11   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
