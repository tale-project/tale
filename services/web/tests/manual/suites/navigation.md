# Navigation & pages

> **Prefix** `NAV-` · **Reset** none · **Cost** 20 boxes

Exercise the page inventory and every way to move between pages — the header
nav, the footer columns, the legal-document pages (tabs, print), in-page hash
links, browser history, and the 404 paths. The mobile hamburger drawer lives
in [responsive.md](responsive.md); the footer's language/theme switchers live
in [locale.md](locale.md) / [theme.md](theme.md).

## Scope & routes

| Surface          | Route                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Home             | `/` (also `/{lang}`)                                                                                                        |
| Platform hub     | `/platform`                                                                                                                 |
| Platform modules | `/platform/{chat\|projects\|knowledge\|agents\|automations\|governance}`                                                    |
| Pricing          | `/pricing`                                                                                                                  |
| Hardware pricing | `/hardware-pricing`                                                                                                         |
| Changelog        | `/changelog`                                                                                                                |
| About            | `/about`                                                                                                                    |
| Contact          | `/contact`                                                                                                                  |
| Request demo     | `/request-demo`                                                                                                             |
| Legal documents  | `/legal/{privacy-policy\|terms-of-service\|data-processing-agreement\|technical-organizational-measures\|personalization}`  |
| Locale trees     | `/{lang}/…` for `de` and `fr` (see [locale.md](locale.md))                                                                  |
| Redirect         | `/en` → `/` — the **only** prefix redirect; any other unknown `/{lang}` prefix throws `notFound()` (`app/routes/$lang.tsx`) |
| Unknown route    | `/nope-not-a-route` → not-found page                                                                                        |

## Preconditions

Bring the site up per [SETUP.md](../setup.md) — any mode; no sign-in. All
routes render without a backend.

> **Agent note**: header/footer render on every route, so nav checks can chain
> page-to-page. External links open new tabs; assert `target`/`rel` attributes
> instead of following them.

## Functional tests

- [ ] `NAV-F1` · **Header nav** — On `/`, open **Platform** (`nav.platform`)
  and **Resources** (`nav.resources`); click **Pricing** (`nav.pricing`) →
  Platform lists the six modules **Chat → Projects → Knowledge → Agents →
  Automations → Governance** (labels under `nav.product.*` — the hub
  `/platform` is **not** a row, `NAV_DROPDOWN_PAGES`); Resources lists
  **Docs** (external) → **Changelog** → **Hardware** → **About us** (labels
  under `nav.resource.*`, `buildResourcesNavItems()`); **Pricing** commits
  `/pricing`
- [ ] `NAV-F2` · **Get started** — Header → **Get started** (`nav.getStarted`)
  → Get started opens the docs quickstart
  (`https://tale.dev/docs/get-started/quickstart`, `GET_STARTED_URL`) — the
  primary header CTA; Request a demo is not in the header.
- [ ] `NAV-F3` · **GitHub** — Header trailing GitHub icon
  (`footer.githubAriaLabel`) → External link to
  `https://github.com/tale-project/tale` with `target="_blank"` and
  `rel="noopener noreferrer"`
- [ ] `NAV-F4` · **Logo home link** — On `/pricing`, click the Tale logo
  (aria-label **Tale home**, `nav.homeAriaLabel`) → URL commits `/` (or
  `/{lang}`); hero renders.
- [ ] `NAV-F5` · **Footer Platform + Company** — Footer **Platform**
  (`footer.platform`); **Company** (`footer.company`): About us + Contact us +
  Request a demo; address column under Platform → Platform links commit the
  hub `/platform` (**Platform overview**, `nav.product.hub.label`) + the six
  `/platform/{module}` pages; company links commit `/about`, `/contact`, and
  `/request-demo`; address shows Ruler GmbH + VAT link.
- [ ] `NAV-F6` · **Footer Legal column** — Footer **Legal** (`footer.legal`),
  top to bottom → Order is **Service Agreement** (`footer.serviceAgreement`),
  **Hardware Agreement** (`footer.hardwareAgreement`) — both external PDF
  links — then the four legal-document links: **Privacy Policy**, **Terms of
  Service**, DPA, TOM (`footer.privacyPolicy`, `footer.termsOfService`,
  `footer.processingAgreement`, `footer.technicalOrganizationalMeasures`),
  which commit `/legal/{slug}`
- [ ] `NAV-F7` · **Footer Resources + bottom bar** — Footer **Resources**:
  Docs / Changelog / Hardware / Pricing; bottom bar: **llms.txt** +
  **llms-full.txt** links (`footer.llmsTxtLabel`, `footer.llmsFullTxtLabel`),
  then the language/theme switchers and the GitHub icon → Docs is external;
  Changelog / Hardware / Pricing commit internal routes; `llms.txt` /
  `llms-full.txt` fetch plaintext (HTTP 200 — see [seo.md](seo.md) SEO-F6);
  GitHub links to the repo.
- [ ] `NAV-F8` · **Legal tabs + print** — Open
  `/legal/data-processing-agreement`; use the DPA/TOM tabs; click **Print or
  save as PDF** → Tabs switch sibling documents; print opens `window.print`
- [ ] `NAV-F9` · **Pricing controls** — On `/pricing`, toggle billing /
  currency / users → Prices update; state in URL search params survives
  reload.
- [ ] `NAV-F10` · **Hardware controls** — On `/hardware-pricing`, switch mode
  / billing / term → Tier cards swap; state in `?mode=` / `?billing=` /
  `?term=`
- [ ] `NAV-F11` · **FAQ + history** — On `/`, expand two FAQ items; click
  **Contact our team**; then browser Back → Both items stay open; link commits
  `/contact`; Back returns to `/`
- [ ] `NAV-F12` · **Changelog timeline** — Open `/changelog`; click a
  mid-timeline version link in the sticky **All releases** nav
  (`changelogPage.allReleases`); scroll the release stream → The release
  stream (newest first, from GitHub Releases) scrolls to that release and the
  URL gains its `#v…` hash; the clicked link carries `aria-current="true"` and
  the sticky nav keeps the active row visible; each release offers **View on
  GitHub** (`changelogPage.viewOnGithub`)

## Boundary & error tests

- [ ] `NAV-B1` · **Unknown route** — Open `/nope-not-a-route`, then
  `/nope/deep-page` → Built dist: HTTP **404** + localized not-found page
  (`notFoundComponent` on root). Dev SPA may differ — prove with `start` /
  container probe `/nope`
- [ ] `NAV-B2` · **Unknown legal slug** — Open `/legal/not-a-document` →
  Throws `notFound()` → same not-found page as NAV-B1 (styled, with recovery
  CTA)
- [ ] `NAV-B3` · **`/en` prefix vs unknown prefix** — Open `/en`, then
  `/en/pricing`; then `/es` → `/en` and `/en/pricing` both redirect to `/`
  (the sub-path is **dropped**, not remapped to `/pricing`) — `/en` is the
  **only** redirecting prefix; `/es` renders the not-found page instead (see
  [locale.md](locale.md) LOC-B2)
- [ ] `NAV-B4` · **Bad search params** — Open
  `/pricing?billing=zzz&region=XX&users=abc` → The page renders with defaults
  (no crash, no NaN price); the invalid params are ignored or normalized.

## Accessibility (WCAG 2.1 AA)

- [ ] `NAV-A1` · **Skip link** → First focusable element is the **Skip to main
  content** link (`nav.skipToMain`) targeting `#main`; activating it moves
  focus into `<main>`
- [ ] `NAV-A2` · **Landmarks** → Exactly one `<main id="main">` per page;
  footer link columns are `<nav>` elements labelled by their column heading;
  one `<header>`, one `<footer>`
- [ ] `NAV-A3` · **Legal tabs nav** → The DPA/TOM tab strip is a `<nav
  aria-label>` = **Document sections** (`legal.documentTabsAria`); the active
  tab is programmatically marked.
- [ ] `NAV-A4` · **Focus visible** → Tabbing through header links, footer
  links, and the pricing segmented controls shows a visible focus ring on
  each.

## Performance

See [SETUP.md](../setup.md) for budgets. Nav chrome must not introduce layout
shift on sticky scroll.
