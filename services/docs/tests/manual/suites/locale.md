# Locale versions

> **Prefix** `LOC-` · **Reset** none · **Cost** 12 boxes

Exercise the localized docs — English unprefixed, German and French under
`/de/…` and `/fr/…` (the vitest suite guarantees every English page has a
DE/FR mirror), the footer language switcher, translated chrome vs. hard-coded
strings, and `<html lang>`. The per-locale **search** index is covered in
[search.md](search.md) F6.

## Scope & routes

| Surface        | Route                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| English tree   | `{base}/`, `{base}/{slug}`                                                                                |
| German tree    | `{base}/de`, `{base}/de/{slug}`                                                                           |
| French tree    | `{base}/fr`, `{base}/fr/{slug}`                                                                           |
| Switcher       | footer (shared `LanguageSwitcher`, `@tale/ui`)                                                            |
| Content source | `docs/{en,de,fr}/**.md`; messages `services/docs/messages/*.yml` (incl. the `de-CH.yml` regional overlay) |

## Preconditions

Bring the site up per [SETUP.md](../setup.md) — either mode.

> **Agent note**: the switcher trigger is the footer button aria-labelled
> **Switch language** (`languageSwitcher.ariaLabel`) showing the current
> locale name; items are `menuitem`s **English** / **Deutsch** / **Français**.
> Remaining hard-coded English chrome (shared `@tale/ui`): the code **Copy
> code** button and heading **Copy link to this section**. Skip link, sidebar
> landmark, and page actions are i18n-wired — on `/de` they should read
> German. Sweep the newer surfaces too: the video player (native controls are
> browser chrome; the captions `<track>` label comes from a hard-coded
> language-name map in `@tale/ui` `video.tsx` — **Deutsch**/**Français** on
> their own pages is correct) and the PWA update banner (`pwa.*` is translated
> in `de.yml`/`fr.yml` — an English banner on `/de` is a finding). The de-CH
> row (LOC-F7) depends on `window.navigator.language` — launch the browser
> with `--lang=de-CH` (or a `de-CH` context locale).

## Functional tests

- [ ] `LOC-F1` · **Switch preserves page** — On
  `{base}/self-hosted/install/quickstart`, footer → **Switch language** →
  **Deutsch** → URL commits `{base}/de/self-hosted/install/quickstart` — same
  page, German content; switching back to **English** drops the prefix.
- [ ] `LOC-F2` · **German tree** — Open `{base}/de` and one nested page →
  Landing + page render translated content from `docs/de/`; sidebar group
  labels are German (`messages/de.yml` `nav.groups.*`);
  breadcrumbs/TOC/prev-next chrome is German (`docs.*`)
- [ ] `LOC-F3` · **French tree** — Open `{base}/fr` and one nested page → Same
  as LOC-F2 for French.
- [ ] `LOC-F4` · **`<html lang>`** — Read `document.documentElement.lang` on
  `{base}/`, `{base}/de`, `{base}/fr` → `en` / `de` / `fr` respectively —
  stays correct after SPA navigation between locales.
- [ ] `LOC-F5` · **Current-locale mark** — Open the switcher on `{base}/fr` →
  The trigger shows **Français**; the menu marks it `aria-current="true"`;
  picking the current locale is a no-op.
- [ ] `LOC-F6` · **Locale cookie** — With the `tale_locale=de` cookie set
  (e.g. after visiting `tale.dev/de`), request `{base}/` → The server
  302-redirects to `{base}/de` (verified live) — the docs and the marketing
  site share the `tale_locale` cookie (`packages/ui/src/i18n/cookie.ts`), so
  one language spans both.
- [ ] `LOC-F7` · **de-CH regional overlay** — Browser locale `de-CH`: open
  `{base}/de`, open the search dialog; at ≤ 767 px open the mobile drawer →
  URL stays `/de` (regional variants never URL-prefix,
  `resolveRegionalLocale`); strings present in `messages/de-CH.yml` render the
  Swiss variant over the `de` base — search close reads **Suche schliessen**
  (`search.close`), the footer tip **zum Schliessen** (`search.tipClose`), the
  drawer close button **Navigationsmenü schliessen** (`nav.closeMenu`) — never
  the base-`de` ß forms; `<html lang>` reflects the base `de` route.

## Boundary & error tests

- [ ] `LOC-B1` · **Localized 404** — Open `{base}/de/nope-not-a-page` → The
  404 renders in **German** (`messages/de.yml` `docs.notFoundTitle` etc.);
  **Back to docs home** targets `{base}/de`
- [ ] `LOC-B2` · **Unknown prefix** — Open `{base}/es/quickstart` → Not a
  locale — treated as an unknown English-tree slug: the styled 404 (with
  suggestions), no crash.

## Accessibility (WCAG 2.1 AA)

- [ ] `LOC-A1` · **Switcher keyboard** → Same contract as the marketing site:
  labelled trigger, `menu`/`menuitem` semantics, ArrowUp/Down cycling, Esc
  returns focus.
- [ ] `LOC-A2` · **Lang attribute** → `<html lang>` always matches the
  rendered language (LOC-F4)

## Performance

- [ ] `LOC-P1` · **Locale switch** → The sibling-locale page settles in **< 1
  s** warm.
