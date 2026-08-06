# Navigation & pages — Manual Test Plan

> **Purpose**: Exercise the page inventory and every way to move between pages —
> the header nav, the footer columns, the legal-document pages (tabs, print),
> in-page hash links, browser history, and the 404 paths. The mobile hamburger
> drawer lives in [responsive.md](responsive.md); the footer's language/theme
> switchers live in [locale.md](locale.md) / [theme.md](theme.md).

## Scope & routes

| Surface          | Route                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Home             | `/` (also `/{lang}`)                                                                                                        |
| Platform hub     | `/platform`                                                                                                                 |
| Platform modules | `/platform/{chat\|projects\|knowledge\|agents\|automations\|governance}`                                                    |
| Pricing          | `/pricing`                                                                                                                  |
| Hardware pricing | `/hardware-pricing`                                                                                                         |
| Changelog        | `/changelog`                                                                                                                |
| Contact          | `/contact`                                                                                                                  |
| Request demo     | `/request-demo`                                                                                                             |
| Legal documents  | `/legal/{privacy-policy\|terms-of-service\|data-processing-agreement\|technical-organizational-measures\|personalization}`  |
| Locale trees     | `/{lang}/…` for `de` and `fr` (see [locale.md](locale.md))                                                                  |
| Redirect         | `/en` → `/` — the **only** prefix redirect; any other unknown `/{lang}` prefix throws `notFound()` (`app/routes/$lang.tsx`) |
| Unknown route    | `/nope-not-a-route` → not-found page                                                                                        |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — any mode; no sign-in. All routes
render without a backend.

> **Agent note**: header/footer render on every route, so nav checks can chain
> page-to-page. External links open new tabs; assert `target`/`rel` attributes
> instead of following them.

## Automated coverage

| Case(s)        | Status         | e2e spec                                                                                                                    |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| F1             | 🔶 partial     | `smoke.spec.ts` (home renders; Platform / Resources triggers + Pricing link; Platform menu opens and lists **Chat**)        |
| F2             | 🔶 partial     | `smoke.spec.ts` (header **Get started** visible; no header **Request a demo** — no click-through)                           |
| F9             | 🔶 partial     | `smoke.spec.ts` (`/pricing` renders + heading-order check — no control interaction)                                         |
| F12            | 🔶 partial     | `changelog.spec.ts` (sticky timeline reachability + `aria-current` on click)                                                |
| B1             | 🔶 partial     | `smoke.spec.ts` (`/nope-not-a-route` shows the not-found heading + **Back to the homepage** — SPA nav, not the HTTP status) |
| F3–F8, F10–F11 | ⛔ manual-only | —                                                                                                                           |
| B2–B4          | ⛔ manual-only | —                                                                                                                           |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                          | Steps (route + control)                                                                                                                                                                                                   | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Header nav                    | On `/`, open **Platform** (`nav.platform`) and **Resources** (`nav.resources`); click **Pricing** (`nav.pricing`)                                                                                                         | Platform lists the six modules **Chat → Projects → Knowledge → Agents → Automations → Governance** (labels under `nav.product.*` — the hub `/platform` is **not** a row, `NAV_DROPDOWN_PAGES`); Resources lists **Docs** (external) → **Changelog** → **Hardware** (labels under `nav.resource.*`, `buildResourcesNavItems()`); **Pricing** commits `/pricing`                             |
| F2  | Get started                   | Header → **Get started** (`nav.getStarted`)                                                                                                                                                                               | Get started opens the docs quickstart (`https://tale.dev/docs/get-started/quickstart`, `GET_STARTED_URL`) — the primary header CTA; Request a demo is not in the header                                                                                                                                                                                                                    |
| F3  | GitHub                        | Header trailing GitHub icon (`footer.githubAriaLabel`)                                                                                                                                                                    | External link to `https://github.com/tale-project/tale` with `target="_blank"` and `rel="noopener noreferrer"`                                                                                                                                                                                                                                                                             |
| F4  | Logo home link                | On `/pricing`, click the Tale logo (aria-label **Tale home**, `nav.homeAriaLabel`)                                                                                                                                        | URL commits `/` (or `/{lang}`); hero renders                                                                                                                                                                                                                                                                                                                                               |
| F5  | Footer Platform + Company     | Footer **Platform** (`footer.platform`); **Company** (`footer.company`): Contact us + Request a demo; address column under Platform                                                                                       | Platform links commit the hub `/platform` (**Platform overview**, `nav.product.hub.label`) + the six `/platform/{module}` pages; company links commit `/contact` and `/request-demo`; address shows Ruler GmbH + VAT link                                                                                                                                                                  |
| F6  | Footer Legal column           | Footer **Legal** (`footer.legal`), top to bottom                                                                                                                                                                          | Order is **Service Agreement** (`footer.serviceAgreement`), **Hardware Agreement** (`footer.hardwareAgreement`) — both external PDF links — then the four legal-document links: **Privacy Policy**, **Terms of Service**, DPA, TOM (`footer.privacyPolicy`, `footer.termsOfService`, `footer.processingAgreement`, `footer.technicalOrganizationalMeasures`), which commit `/legal/{slug}` |
| F7  | Footer Resources + bottom bar | Footer **Resources**: Docs / Changelog / Hardware / Pricing; bottom bar: **llms.txt** + **llms-full.txt** links (`footer.llmsTxtLabel`, `footer.llmsFullTxtLabel`), then the language/theme switchers and the GitHub icon | Docs is external; Changelog / Hardware / Pricing commit internal routes; `llms.txt` / `llms-full.txt` fetch plaintext (HTTP 200 — see [seo.md](seo.md) F6); GitHub links to the repo                                                                                                                                                                                                       |
| F8  | Legal tabs + print            | Open `/legal/data-processing-agreement`; use the DPA/TOM tabs; click **Print or save as PDF**                                                                                                                             | Tabs switch sibling documents; print opens `window.print`                                                                                                                                                                                                                                                                                                                                  |
| F9  | Pricing controls              | On `/pricing`, toggle billing / currency / users                                                                                                                                                                          | Prices update; state in URL search params survives reload                                                                                                                                                                                                                                                                                                                                  |
| F10 | Hardware controls             | On `/hardware-pricing`, switch mode / billing / term                                                                                                                                                                      | Tier cards swap; state in `?mode=` / `?billing=` / `?term=`                                                                                                                                                                                                                                                                                                                                |
| F11 | FAQ + history                 | On `/`, expand two FAQ items; click **Contact our team**; then browser Back                                                                                                                                               | Both items stay open; link commits `/contact`; Back returns to `/`                                                                                                                                                                                                                                                                                                                         |
| F12 | Changelog timeline            | Open `/changelog`; click a mid-timeline version link in the sticky **All releases** nav (`changelogPage.allReleases`); scroll the release stream                                                                          | The release stream (newest first, from GitHub Releases) scrolls to that release and the URL gains its `#v…` hash; the clicked link carries `aria-current="true"` and the sticky nav keeps the active row visible; each release offers **View on GitHub** (`changelogPage.viewOnGithub`)                                                                                                    |

## Boundary & error tests

| ID  | Test                           | Input                                            | Expected                                                                                                                                                                                                                    |
| --- | ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Unknown route                  | Open `/nope-not-a-route`, then `/nope/deep-page` | Built dist: HTTP **404** + localized not-found page (`notFoundComponent` on root). Dev SPA may differ — prove with `start` / container probe `/nope`                                                                        |
| B2  | Unknown legal slug             | Open `/legal/not-a-document`                     | Throws `notFound()` → same not-found page as B1 (styled, with recovery CTA)                                                                                                                                                 |
| B3  | `/en` prefix vs unknown prefix | Open `/en`, then `/en/pricing`; then `/es`       | `/en` and `/en/pricing` both redirect to `/` (the sub-path is **dropped**, not remapped to `/pricing`) — `/en` is the **only** redirecting prefix; `/es` renders the not-found page instead (see [locale.md](locale.md) B2) |
| B4  | Bad search params              | Open `/pricing?billing=zzz&region=XX&users=abc`  | The page renders with defaults (no crash, no NaN price); the invalid params are ignored or normalized                                                                                                                       |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                           |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Skip link      | First focusable element is the **Skip to main content** link (`nav.skipToMain`) targeting `#main`; activating it moves focus into `<main>`         |
| A2  | Landmarks      | Exactly one `<main id="main">` per page; footer link columns are `<nav>` elements labelled by their column heading; one `<header>`, one `<footer>` |
| A3  | Legal tabs nav | The DPA/TOM tab strip is a `<nav aria-label>` = **Document sections** (`legal.documentTabsAria`); the active tab is programmatically marked        |
| A4  | Focus visible  | Tabbing through header links, footer links, and the pricing segmented controls shows a visible focus ring on each                                  |

## Performance

See [SETUP.md](SETUP.md) for budgets. Nav chrome must not introduce layout shift on sticky scroll.

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Navigation & pages (web)
Functional: ___/12   Boundary: ___/4   A11y: ___/4
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
