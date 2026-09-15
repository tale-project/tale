# Navigation

> **Prefix** `NAV-` · **Reset** none · **Cost** 22 boxes

Exercise every way a reader moves through the docs — the navigation rail
(`docs/nav.json`), collapsible sub-groups, the header strip's breadcrumb trail,
previous/next cards, the on-page outline with scroll-spy, the back-to-top
button, the phone drawer, the styled 404 with did-you-mean suggestions, the
moved-page redirects (`docs/redirects.json`), and the PWA layer (offline shell
+ service-worker update banner). The frame is the shared `@tale/ui/docs/*`
family the design-system guide renders too; this site feeds it through
`app/routes/__root.tsx` and `lib/content/nav-sections.ts`. Search has its own
guide ([search.md](search.md)).

## Scope & routes

| Surface        | Route                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Landing        | `{base}/`                                                                                                                                 |
| Content page   | any slug, e.g. `{base}/self-hosted/install/quickstart`                                                                                    |
| Nested group   | `{base}/platform/chat/…` (sub-groups inside **Platform**)                                                                                 |
| Unknown URL    | `{base}/nope-not-a-page` → styled 404                                                                                                     |
| Rail source    | [`docs/nav.json`](../../../../../docs/nav.json) → `lib/content/nav.ts`                                                                       |
| Redirects      | [`docs/redirects.json`](../../../../../docs/redirects.json) → `lib/redirects.ts` (server 301s) + `scripts/prerender.ts` (meta-refresh stubs) |
| PWA            | `public/offline.html` + `app/components/docs/sw-update-banner.tsx` (`pwa.*` keys)                                                         |

## Preconditions

Bring the site up per [SETUP.md](../setup.md) — either mode for
NAV-F1–NAV-F8/NAV-B1–NAV-B3. The redirect rows (NAV-F9/NAV-F10) and the PWA
rows (NAV-F11/NAV-F12) need the **built** server (mode A, or `build` + `start`
per SETUP.md) — the vite dev server serves no 301s, no prerendered stubs, and
registers no service worker. The rail tree is build-time static;
`navigation.test.ts` already guarantees every entry resolves to a page, so
this guide focuses on **behaviour**, not link rot.

> **Agent note**: the rail is the app's `SubPanel` — a `<nav>` whose
> `aria-label` comes from `nav.sidebarAriaLabel` (EN **Documentation**),
> carrying the logo row, the search field and the tree, and hidden below
> `md` (768 px) where the phone bar's **Open navigation menu** opens the same
> tree in a left drawer. Exactly one row carries `aria-current="page"` —
> ancestors do not. Group toggles are buttons with `aria-expanded`. The
> outline is the `<aside>` labelled **On this page** (`docs.onThisPage`) from
> `xl` (1280 px) up — use a ≥ 1280 px viewport for NAV-F5 — and the same list
> inside a `<nav>` disclosure above the article below that width; the copy the
> stylesheet hides is `aria-hidden`, so only one is ever in the a11y tree.
> Scroll-spy marks the active outline item with `aria-current="true"`.

## Functional tests

- [ ] `NAV-F1` · **Rail tree** — On `{base}/`, read the rail → The six top
  groups render in `nav.json` order as uppercase section labels: **Start
  here**, **Cloud**, **Self-hosted**, **Platform**, **Tutorials**,
  **Development** (`nav.groups.*`); clicking a page row commits its slug URL
  and renders that page.
- [ ] `NAV-F2` · **Sub-group collapse** — In **Platform**, click a sub-group
  header (e.g. **Chat**, `nav.groups.chat`) → The button toggles
  `aria-expanded` and the child links show/hide; collapsing does **not**
  navigate.
- [ ] `NAV-F3` · **Active state** — Open `{base}/platform/chat/basics`
  directly (deep link) → The rail auto-expands every ancestor group of the
  active page; the active row is filled, carries `aria-current="page"` — the
  **only** row that does — and is scrolled into view within the rail.
- [ ] `NAV-F4` · **Breadcrumbs** — On a nested page, read the `<nav
  aria-label>` = **Breadcrumbs** (`docs.breadcrumbs`) in the header strip →
  Trail = **Home** (`docs.home`, links to `{base}/`) → group labels → current
  page (marked `aria-current="page"`, not a link, and **not** a heading — the
  page's only `<h1>` is the article title below); on the landing page the trail
  is **Home** alone, as its own current leaf; clicking a crumb navigates there.
- [ ] `NAV-F5` · **Outline + scroll-spy** — ≥ 1280 px viewport, on a long page
  (e.g. `{base}/self-hosted/install/quickstart`): scroll through the sections
  → The **On this page** aside lists the page's **markdown** H2/H3s only
  (`extract-toc.ts` reads the markdown source) — `<Step title>` headings
  render as h3s but carry no id and never appear here; as sections cross the
  viewport the matching item gains `aria-current="true"`; clicking an item
  smooth-scrolls to the heading and updates the URL hash without adding a
  history entry per click.
- [ ] `NAV-F6` · **Prev/next** — On a page in the middle of a group, scroll to
  the page bottom → **Previous** (`docs.previous`) and **Next** (`docs.next`)
  cards link to the flattened-nav neighbours, inside a `<nav>` named **Page
  navigation** (`docs.pagination`); the first page has no Previous, the last no
  Next, and the remaining card keeps its side of the row; clicking navigates
  and scrolls to top.
- [ ] `NAV-F7` · **Back to top** — Scroll a long page > 600 px down → The
  **Back to top** button (`docs.backToTop`) fades in (fixed, bottom-right);
  clicking it returns to the top and it disappears again.
- [ ] `NAV-F8` · **Logo home** — Click the logo at the top of the rail
  (aria-label **Tale documentation home**, `nav.homeAriaLabel`; on a phone the
  same logo sits in the header bar) from a deep page → Returns to `{base}/`
  (locale-preserving: from `/de/…` it returns to `{base}/de`)
- [ ] `NAV-F9` · **Moved-page 301s** — Built server only — `curl -sI` three
  old slugs: `{base}/platform/integrations/overview`,
  `{base}/platform/workflows/triggers`,
  `{base}/platform/conversations/overview` → Each answers **HTTP 301** with
  `Location:` on the new slug — `…/platform/connectors/overview`,
  `…/platform/automations/triggers`, `…/platform/automations/builtin`;
  locale-preserving: `{base}/de/platform/integrations/overview` 301s to
  `{base}/de/platform/connectors/overview` (map: `docs/redirects.json`, served
  by `server.ts` before static files)
- [ ] `NAV-F10` · **Redirect stubs** — Inspect the prerender output for an old
  path — `dist/platform/integrations/overview/index.html` (or fetch that path
  from a plain static host, where no 301 runs) → The stub carries `<meta
  http-equiv="refresh" content="0;url=…/platform/connectors/overview">`, a
  `canonical` link to the new URL, `robots` **noindex**, and a fallback anchor
  — old URLs keep working even without the Bun server's 301s.
- [ ] `NAV-F11` · **Offline shell** — Built server: load a page once (service
  worker installs), then set the browser offline (devtools → Network) and
  navigate to an unvisited docs URL → The offline shell
  (`public/offline.html`) renders — title **You are offline** — instead of a
  browser error page; going back online and reloading restores the real page.
- [ ] `NAV-F12` · **SW update banner** — With a tab open on an older build,
  serve a new build and trigger the waiting worker (devtools → Application →
  Service workers → Update) → The fixed bottom-right banner renders **Update
  available** (`pwa.updateAvailableTitle`) + `pwa.updateAvailableDescription`;
  **Reload** (`pwa.updateNow`) activates the new worker and reloads;
  **Dismiss** (`pwa.dismiss`) hides it; the offline-ready toast
  (`pwa.offlineReady`) is one-shot and removes itself after ~4 s
  (`sw-update-banner.tsx`)
- [ ] `NAV-F13` · **Header strip pinned** — ≥ 768 px, scroll a long page down →
  The breadcrumb + page-actions strip stays pinned at the top of the article
  column (one `h-13` row, translucent, content scrolling under it), the rail
  stays put beside it, and there is exactly **one** horizontal line under the
  strip — it meets the rail's logo-row line without a step or a double border.
- [ ] `NAV-F14` · **Phone drawer** — ≤ 767 px: tap **Open navigation menu**
  (`docs.openMenu`) → A left drawer slides in over a dimmed page carrying the
  logo, **Close navigation menu** (`docs.closeMenu`), the search field and the
  full tree; the page behind does not scroll; one **Esc** closes it and focus
  returns to the menu button; choosing a page closes it and navigates; growing
  the window past 768 px with it open leaves a clickable page, not a scrim.
- [ ] `NAV-F15` · **Outline below `xl`** — Between 768 px and 1279 px, open a
  long page → The right-hand outline rail is gone and **On this page**
  (`docs.onThisPage`) is a collapsed disclosure above the article; opening it
  reveals the same headings, and choosing one scrolls to that section.

## Boundary & error tests

- [ ] `NAV-B1` · **Unknown URL** — Open `{base}/platform/chat/basicz` (typo) →
  The styled 404 renders **inside the docs shell**: heading **Page not found**
  (`docs.notFound.title`), body `docs.notFound.body`, a **Did you mean** list
  (`docs.notFound.suggestions`) whose Levenshtein-closest suggestion includes
  `platform/chat/basics`, and a **Back to docs home** button
  (`docs.notFound.backHome`)
- [ ] `NAV-B2` · **Deep garbage URL** — Open `{base}/x/y/z/deep/garbage` →
  Same 404 page; suggestions still render (fallback list); no crash, no blank
  screen.
- [ ] `NAV-B3` · **Stale hash** — Open a page with a hash that matches no
  heading (`#nope`) → The page renders at the top; no scroll error, no console
  exception.

## Accessibility (WCAG 2.1 AA)

- [ ] `NAV-A1` · **Landmarks** → One `<main>`; the rail is `<nav aria-label>` =
  `nav.sidebarAriaLabel` (EN **Documentation**); breadcrumbs `<nav aria-label>`
  = **Breadcrumbs**; the outline an `<aside>` labelled **On this page** at
  `xl`, a `<nav>` of the same name below it — never both in the a11y tree.
- [ ] `NAV-A2` · **Keyboard** → The whole rail (logo, search field, group
  toggles, rows) and the outline operate by keyboard; Enter/Space toggles
  groups; focus visible throughout.
- [ ] `NAV-A3` · **Current markers** → Exactly one rail row carries
  `aria-current="page"` (ancestors of the open page do **not**); active outline
  item `aria-current="true"`; breadcrumb leaf `aria-current="page"`

## Performance

- [ ] `NAV-P1` · **Page-to-page** → A rail navigation settles (new body
  rendered) in **< 1 s** warm — content is prebuilt.
