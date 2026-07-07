# Locale versions — Manual Test Plan

> **Purpose**: Exercise the localized docs — English unprefixed, German and
> French under `/de/…` and `/fr/…` (the vitest suite guarantees every English
> page has a DE/FR mirror), the footer language switcher, translated chrome
> vs. hard-coded strings, and `<html lang>`. The per-locale **search** index
> is covered in [search.md](search.md) F6.

## Scope & routes

| Surface        | Route                                                             |
| -------------- | ----------------------------------------------------------------- |
| English tree   | `{base}/`, `{base}/{slug}`                                        |
| German tree    | `{base}/de`, `{base}/de/{slug}`                                   |
| French tree    | `{base}/fr`, `{base}/fr/{slug}`                                   |
| Switcher       | footer (shared `LanguageSwitcher`, `@tale/ui`)                    |
| Content source | `docs/{en,de,fr}/**.md`; messages `services/docs/messages/*.json` |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — either mode.

> **Agent note**: the switcher trigger is the footer button aria-labelled
> **Switch language** (`languageSwitcher.ariaLabel`) showing the current
> locale name; items are `menuitem`s **English** / **Deutsch** / **Français**.
> Several docs-shell controls are hard-coded English (the skip link, the code
> **Copy code** button, the page-actions menu, heading **Copy link to this
> section**) — on `/de` they will read English; log them once as a
> localization finding, not per page.

## Automated coverage

| Case(s)            | Status         | Where                                                                                                                                         |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F2 (mirror exists) | ✅ automated   | vitest `locale-tree.test.ts` (every EN page has DE/FR mirrors) + `locale-outline.test.ts` (same outline) + `docs.test.ts` (voice/terminology) |
| F1, F3–F5, B1–B2   | ⛔ manual-only | — (no e2e drives the switcher or asserts rendered locale chrome)                                                                              |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                  | Steps (route + control)                                                                     | Expected (verifiable)                                                                                                                                                                   |
| --- | --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Switch preserves page | On `{base}/self-hosted/install/quickstart`, footer → **Switch language** → **Deutsch**      | URL commits `{base}/de/self-hosted/install/quickstart` — same page, German content; switching back to **English** drops the prefix                                                      |
| F2  | German tree           | Open `{base}/de` and one nested page                                                        | Landing + page render translated content from `docs/de/`; sidebar group labels are German (`messages/de.json` `nav.groups.*`); breadcrumbs/TOC/prev-next chrome is German (`docs.*`)    |
| F3  | French tree           | Open `{base}/fr` and one nested page                                                        | Same as F2 for French                                                                                                                                                                   |
| F4  | `<html lang>`         | Read `document.documentElement.lang` on `{base}/`, `{base}/de`, `{base}/fr`                 | `en` / `de` / `fr` respectively — stays correct after SPA navigation between locales                                                                                                    |
| F5  | Current-locale mark   | Open the switcher on `{base}/fr`                                                            | The trigger shows **Français**; the menu marks it `aria-current="true"`; picking the current locale is a no-op                                                                          |
| F6  | Locale cookie         | With the `tale_locale=de` cookie set (e.g. after visiting `tale.dev/de`), request `{base}/` | The server 302-redirects to `{base}/de` (verified live) — the docs and the marketing site share the `tale_locale` cookie (`packages/ui/src/i18n/cookie.ts`), so one language spans both |

## Boundary & error tests

| ID  | Test           | Input                            | Expected                                                                                                                |
| --- | -------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| B1  | Localized 404  | Open `{base}/de/nope-not-a-page` | The 404 renders in **German** (`messages/de.json` `docs.notFoundTitle` etc.); **Back to docs home** targets `{base}/de` |
| B2  | Unknown prefix | Open `{base}/es/quickstart`      | Not a locale — treated as an unknown English-tree slug: the styled 404 (with suggestions), no crash                     |

## Accessibility (WCAG 2.1 AA)

| ID  | Check             | Expected                                                                                                                    |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A1  | Switcher keyboard | Same contract as the marketing site: labelled trigger, `menu`/`menuitem` semantics, ArrowUp/Down cycling, Esc returns focus |
| A2  | Lang attribute    | `<html lang>` always matches the rendered language (F4)                                                                     |

## Performance

| ID  | Metric        | Target                                            |
| --- | ------------- | ------------------------------------------------- |
| P1  | Locale switch | The sibling-locale page settles in **< 1 s** warm |

## Issues Found

| #   | Test ID | Route / URL                                               | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Screenshot |
| --- | ------- | --------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | F2      | `https://tale.dev/docs/de/self-hosted/install/quickstart` | med                          | Hard-coded English chrome on localized pages (2026-07-06 live pass): the skip link **Skip to main content** (`app/routes/__root.tsx`), the sidebar landmark `aria-label="Documentation"` (`docs-sidebar.tsx`), the code **Copy code**/**Copied** button (`@tale/ui` `highlighted-code.tsx`), the page actions **Copy page**/**Open in …** (`page-actions.tsx`), and the heading **Copy link to this section** (`@tale/ui` `anchored-heading.tsx`). Breadcrumbs/TOC are correctly German (**Brotkrumennavigation**, **Auf dieser Seite**) | —          |

## Test summary

```
Area: Locale versions (docs)
Functional: ___/6   Boundary: ___/2   A11y: ___/2   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
