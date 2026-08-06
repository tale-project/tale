# Navigation — Manual Test Plan

> **Purpose**: Exercise every way a reader moves through the docs — the
> sidebar tree (`docs/nav.json`), collapsible sub-groups, breadcrumbs,
> previous/next links, the on-page TOC with scroll-spy, the back-to-top
> button, the mobile drawer, the styled 404 with did-you-mean suggestions,
> the moved-page redirects (`docs/redirects.json`), and the PWA layer
> (offline shell + service-worker update banner). Search has its own guide
> ([search.md](search.md)).

## Scope & routes

| Surface        | Route                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Landing        | `{base}/`                                                                                                                                 |
| Content page   | any slug, e.g. `{base}/self-hosted/install/quickstart`                                                                                    |
| Nested group   | `{base}/platform/chat/…` (sub-groups inside **Platform**)                                                                                 |
| Unknown URL    | `{base}/nope-not-a-page` → styled 404                                                                                                     |
| Sidebar source | [`docs/nav.json`](../../../../docs/nav.json) → `lib/content/nav.ts`                                                                       |
| Redirects      | [`docs/redirects.json`](../../../../docs/redirects.json) → `lib/redirects.ts` (server 301s) + `scripts/prerender.ts` (meta-refresh stubs) |
| PWA            | `public/offline.html` + `app/components/docs/sw-update-banner.tsx` (`pwa.*` keys)                                                         |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — either mode for F1–F8/B1–B3.
The redirect rows (F9/F10) and the PWA rows (F11/F12) need the **built**
server (mode A, or `build` + `start` per SETUP.md) — the vite dev server
serves no 301s, no prerendered stubs, and registers no service worker. The
sidebar tree is build-time static; `navigation.test.ts` already guarantees
every entry resolves to a page, so this guide focuses on **behaviour**, not
link rot.

> **Agent note**: the sidebar is a `<nav>` whose `aria-label` comes from
> `nav.sidebarAriaLabel` (EN **Documentation**); the active link carries
> `aria-current="page"`. Group toggles are buttons with `aria-expanded`. The
> TOC is the `<aside>` labelled **On this page** (`docs.onThisPage`) and only
> renders at the `xl` breakpoint — use a ≥ 1280 px viewport for F5/F6.
> Scroll-spy marks the active TOC item with `aria-current="true"`.

## Automated coverage

| Case(s)               | Status         | Where                                                                                                                                                |
| --------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1                    | 🔶 partial     | `smoke.spec.ts` (sidebar shows links) + vitest `navigation.test.ts` (entries resolve)                                                                |
| F9–F10 (source map)   | 🔶 partial     | vitest `redirects.test.ts` (slug shape, every target exists in every locale, no source shadows a page, no chains) — the **served** 301s/stubs manual |
| F2–F8, F11–F12, B1–B3 | ⛔ manual-only | —                                                                                                                                                    |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test               | Steps (route + control)                                                                                                                                                 | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Sidebar tree       | On `{base}/`, read the sidebar                                                                                                                                          | The six top groups render in `nav.json` order: **Start here**, **Cloud**, **Self-hosted**, **Platform**, **Tutorials**, **Development** (`nav.groups.*`); clicking a page link commits its slug URL and renders that page                                                                                                                                                                       |
| F2  | Sub-group collapse | In **Platform**, click a sub-group header (e.g. **Chat**, `nav.groups.chat`)                                                                                            | The button toggles `aria-expanded` and the child links show/hide; collapsing does **not** navigate                                                                                                                                                                                                                                                                                              |
| F3  | Active state       | Open `{base}/platform/chat/basics` directly (deep link)                                                                                                                 | The sidebar auto-expands every ancestor group of the active page; the active link has `aria-current="page"` and is scrolled into view within the sidebar                                                                                                                                                                                                                                        |
| F4  | Breadcrumbs        | On a nested page, read the `<nav aria-label>` = **Breadcrumbs** (`docs.breadcrumbs`)                                                                                    | Trail = **Home** (`docs.home`, links to `{base}/`) → group labels → current page (marked `aria-current="page"`, not a link); the landing page (`index`) shows **no** breadcrumbs; clicking a crumb navigates there                                                                                                                                                                              |
| F5  | TOC + scroll-spy   | ≥ 1280 px viewport, on a long page (e.g. `{base}/self-hosted/install/quickstart`): scroll through the sections                                                          | The **On this page** aside lists the page's **markdown** H2/H3s only (`extract-toc.ts` reads the markdown source) — `<Step title>` headings render as h3s but carry no id and never appear here; as sections cross the viewport the matching item gains `aria-current="true"`; clicking an item smooth-scrolls to the heading and updates the URL hash without adding a history entry per click |
| F6  | Prev/next          | On a page in the middle of a group, scroll to the page bottom                                                                                                           | **Previous** (`docs.previous`) and **Next** (`docs.next`) cards link to the flattened-nav neighbours; the first page has no Previous, the last no Next; clicking navigates and scrolls to top                                                                                                                                                                                                   |
| F7  | Back to top        | Scroll a long page > 600 px down                                                                                                                                        | The **Back to top** button (`docs.backToTop`) fades in (fixed, bottom-right); clicking it returns to the top and it disappears again                                                                                                                                                                                                                                                            |
| F8  | Header + logo      | Click the header logo (aria-label **Tale documentation home**, `nav.homeAriaLabel`) from a deep page                                                                    | Returns to `{base}/` (locale-preserving: from `/de/…` it returns to `{base}/de`)                                                                                                                                                                                                                                                                                                                |
| F9  | Moved-page 301s    | Built server only — `curl -sI` three old slugs: `{base}/platform/integrations/overview`, `{base}/platform/workflows/triggers`, `{base}/platform/conversations/overview` | Each answers **HTTP 301** with `Location:` on the new slug — `…/platform/connectors/overview`, `…/platform/automations/triggers`, `…/platform/automations/builtin`; locale-preserving: `{base}/de/platform/integrations/overview` 301s to `{base}/de/platform/connectors/overview` (map: `docs/redirects.json`, served by `server.ts` before static files)                                      |
| F10 | Redirect stubs     | Inspect the prerender output for an old path — `dist/platform/integrations/overview/index.html` (or fetch that path from a plain static host, where no 301 runs)        | The stub carries `<meta http-equiv="refresh" content="0;url=…/platform/connectors/overview">`, a `canonical` link to the new URL, `robots` **noindex**, and a fallback anchor — old URLs keep working even without the Bun server's 301s                                                                                                                                                        |
| F11 | Offline shell      | Built server: load a page once (service worker installs), then set the browser offline (devtools → Network) and navigate to an unvisited docs URL                       | The offline shell (`public/offline.html`) renders — title **You are offline** — instead of a browser error page; going back online and reloading restores the real page                                                                                                                                                                                                                         |
| F12 | SW update banner   | With a tab open on an older build, serve a new build and trigger the waiting worker (devtools → Application → Service workers → Update)                                 | The fixed bottom-right banner renders **Update available** (`pwa.updateAvailableTitle`) + `pwa.updateAvailableDescription`; **Reload** (`pwa.updateNow`) activates the new worker and reloads; **Dismiss** (`pwa.dismiss`) hides it; the offline-ready toast (`pwa.offlineReady`) is one-shot and removes itself after ~4 s (`sw-update-banner.tsx`)                                            |

## Boundary & error tests

| ID  | Test             | Input                                                     | Expected                                                                                                                                                                                                                                                                                                               |
| --- | ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Unknown URL      | Open `{base}/platform/chat/basicz` (typo)                 | The styled 404 renders **inside the docs shell**: heading **Page not found** (`docs.notFoundTitle`), body `docs.notFoundBody`, a **Did you mean** list (`docs.notFoundSuggestions`) whose Levenshtein-closest suggestion includes `platform/chat/basics`, and a **Back to docs home** button (`docs.notFoundBackHome`) |
| B2  | Deep garbage URL | Open `{base}/x/y/z/deep/garbage`                          | Same 404 page; suggestions still render (fallback list); no crash, no blank screen                                                                                                                                                                                                                                     |
| B3  | Stale hash       | Open a page with a hash that matches no heading (`#nope`) | The page renders at the top; no scroll error, no console exception                                                                                                                                                                                                                                                     |

## Accessibility (WCAG 2.1 AA)

| ID  | Check           | Expected                                                                                                                                                                                          |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Landmarks       | One `<main>`; the sidebar is `<nav aria-label>` = `nav.sidebarAriaLabel` (EN **Documentation**); breadcrumbs `<nav aria-label>` = **Breadcrumbs**; the TOC an `<aside>` labelled **On this page** |
| A2  | Keyboard        | The whole sidebar (group toggles + links) and the TOC operate by keyboard; Enter/Space toggles groups; focus visible throughout                                                                   |
| A3  | Current markers | Active sidebar link `aria-current="page"`; active TOC item `aria-current="true"`; breadcrumb leaf `aria-current="page"`                                                                           |

## Performance

| ID  | Metric       | Target                                                                                   |
| --- | ------------ | ---------------------------------------------------------------------------------------- |
| P1  | Page-to-page | A sidebar navigation settles (new body rendered) in **< 1 s** warm — content is prebuilt |

## Issues Found

| #   | Test ID | Route / URL                                  | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Screenshot |
| --- | ------- | -------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | B1      | `https://tale.dev/docs/platform/chat/basicz` | low                          | ~~The styled 404 works (suggestions correctly offer **Platform / Chat / Basics** — 2026-07-06 live pass), but the document title stays **Tale documentation** instead of reflecting **Page not found**; the HTTP status is also 200 (SPA fallback)~~ **RESOLVED (#2620):** `scripts/prerender.ts` now prerenders `/404` with the real `<title>` (**Page not found \| Tale**, `docs.notFoundTitle`) and `noindex`; the shared server (`@tale/ui/server`) serves it with a real HTTP 404 for any unknown path once `dist/404/index.html` exists (verified via `tests/prerender/seo.test.ts`). Re-verify live once the docs container probe (`services/platform/tests/integration/container-docs-test.ts`) asserts the HTTP status — not yet added. | —          |

## Test summary

```
Area: Navigation (docs)
Functional: ___/12   Boundary: ___/3   A11y: ___/3   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
