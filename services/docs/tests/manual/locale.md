# Locale versions — Manual Test Plan

> **Purpose**: Exercise the localized docs — English unprefixed, German and
> French under `/de/…` and `/fr/…` (the vitest suite guarantees every English
> page has a DE/FR mirror), the footer language switcher, translated chrome
> vs. hard-coded strings, and `<html lang>`. The per-locale **search** index
> is covered in [search.md](search.md) F6.

## Scope & routes

| Surface        | Route                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| English tree   | `{base}/`, `{base}/{slug}`                                                                                |
| German tree    | `{base}/de`, `{base}/de/{slug}`                                                                           |
| French tree    | `{base}/fr`, `{base}/fr/{slug}`                                                                           |
| Switcher       | footer (shared `LanguageSwitcher`, `@tale/ui`)                                                            |
| Content source | `docs/{en,de,fr}/**.md`; messages `services/docs/messages/*.yml` (incl. the `de-CH.yml` regional overlay) |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — either mode.

> **Agent note**: the switcher trigger is the footer button aria-labelled
> **Switch language** (`languageSwitcher.ariaLabel`) showing the current
> locale name; items are `menuitem`s **English** / **Deutsch** / **Français**.
> Remaining hard-coded English chrome (shared `@tale/ui`): the code **Copy
> code** button and heading **Copy link to this section**. Skip link, sidebar
> landmark, and page actions are i18n-wired — on `/de` they should read German.
> Sweep the newer surfaces too: the video player (native controls are browser
> chrome; the captions `<track>` label comes from a hard-coded language-name
> map in `@tale/ui` `video.tsx` — **Deutsch**/**Français** on their own pages
> is correct) and the PWA update banner (`pwa.*` is translated in
> `de.yml`/`fr.yml` — an English banner on `/de` is a finding). The de-CH row
> (F7) depends on `window.navigator.language` — launch the browser with
> `--lang=de-CH` (or a `de-CH` context locale).

## Automated coverage

| Case(s)            | Status         | Where                                                                                                                                           |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| F2 (mirror exists) | ✅ automated   | vitest `locale-tree.test.ts` (every EN page has DE/FR mirrors) + `locale-outline.test.ts` (same outline) + `docs.test.ts` (voice/terminology)   |
| F5 (dialog parity) | 🔶 partial     | vitest `locale-components.test.ts` + `locale-translation.test.ts` (mirrors are real translations, same component tags) — rendered chrome manual |
| F1, F3–F7, B1–B2   | ⛔ manual-only | — (no e2e drives the switcher or asserts rendered locale chrome)                                                                                |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                   | Steps (route + control)                                                                              | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Switch preserves page  | On `{base}/self-hosted/install/quickstart`, footer → **Switch language** → **Deutsch**               | URL commits `{base}/de/self-hosted/install/quickstart` — same page, German content; switching back to **English** drops the prefix                                                                                                                                                                                                                                                                                                       |
| F2  | German tree            | Open `{base}/de` and one nested page                                                                 | Landing + page render translated content from `docs/de/`; sidebar group labels are German (`messages/de.yml` `nav.groups.*`); breadcrumbs/TOC/prev-next chrome is German (`docs.*`)                                                                                                                                                                                                                                                      |
| F3  | French tree            | Open `{base}/fr` and one nested page                                                                 | Same as F2 for French                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F4  | `<html lang>`          | Read `document.documentElement.lang` on `{base}/`, `{base}/de`, `{base}/fr`                          | `en` / `de` / `fr` respectively — stays correct after SPA navigation between locales                                                                                                                                                                                                                                                                                                                                                     |
| F5  | Current-locale mark    | Open the switcher on `{base}/fr`                                                                     | The trigger shows **Français**; the menu marks it `aria-current="true"`; picking the current locale is a no-op                                                                                                                                                                                                                                                                                                                           |
| F6  | Locale cookie          | With the `tale_locale=de` cookie set (e.g. after visiting `tale.dev/de`), request `{base}/`          | The server 302-redirects to `{base}/de` (verified live) — the docs and the marketing site share the `tale_locale` cookie (`packages/ui/src/i18n/cookie.ts`), so one language spans both                                                                                                                                                                                                                                                  |
| F7  | de-CH regional overlay | Browser locale `de-CH`: open `{base}/de`, open the search dialog; at ≤ 767 px open the mobile drawer | URL stays `/de` (regional variants never URL-prefix, `resolveRegionalLocale`); strings present in `messages/de-CH.yml` render the Swiss variant over the `de` base — search close reads **Suche schliessen** (`search.close`), the footer tip **zum Schliessen** (`search.tipClose`), the drawer close button **Navigationsmenü schliessen** (`nav.closeMenu`) — never the base-`de` ß forms; `<html lang>` reflects the base `de` route |

## Boundary & error tests

| ID  | Test           | Input                            | Expected                                                                                                               |
| --- | -------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| B1  | Localized 404  | Open `{base}/de/nope-not-a-page` | The 404 renders in **German** (`messages/de.yml` `docs.notFoundTitle` etc.); **Back to docs home** targets `{base}/de` |
| B2  | Unknown prefix | Open `{base}/es/quickstart`      | Not a locale — treated as an unknown English-tree slug: the styled 404 (with suggestions), no crash                    |

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

| #   | Test ID | Route / URL                                               | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Screenshot |
| --- | ------- | --------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | F2      | `https://tale.dev/docs/de/self-hosted/install/quickstart` | med                          | Remaining hard-coded English chrome on localized pages: the code **Copy code**/**Copied** button (`@tale/ui` `highlighted-code.tsx`) and the heading **Copy link to this section** (`@tale/ui` `anchored-heading.tsx`). Skip link, sidebar landmark, and page actions are i18n-wired. Breadcrumbs/TOC are correctly German (**Brotkrumennavigation**, **Auf dieser Seite**). Extend the audit to the newer chrome: the video player's captions `<track>` label (hard-coded language-name map in `@tale/ui` `video.tsx` — correct-by-construction per locale, but re-check if locales grow) and the PWA update banner/offline toast (`pwa.*` — translated in `de.yml`/`fr.yml`; verify it renders localized when it fires) | —          |

## Test summary

```
Area: Locale versions (docs)
Functional: ___/7   Boundary: ___/2   A11y: ___/2   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
