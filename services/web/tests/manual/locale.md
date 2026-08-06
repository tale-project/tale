# Locale switching — Manual Test Plan

> **Purpose**: Exercise the three-locale model — English at the canonical root
> path, German and French URL-prefixed (`/de/…`, `/fr/…`), plus the
> region-resolved `de-CH` message overlay that never appears in URLs. Covers
> the footer language switcher, direct locale-URL entry, `<html lang>` sync,
> and translated content. Prerendered per-locale head tags live in
> [seo.md](seo.md).

## Scope & routes

| Surface      | Route                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| English tree | `/`, `/pricing`, `/contact`, … (no prefix)                                                                  |
| German tree  | `/de`, `/de/pricing`, `/de/platform`, `/de/legal/{slug}`, …                                                 |
| French tree  | `/fr`, `/fr/pricing`, `/fr/changelog`, `/fr/legal/{slug}`, …                                                |
| Redirect     | `/en` → `/` only; any non-`de`/`fr` prefix → **localized 404** (`app/routes/$lang.tsx` throws `notFound()`) |
| Switcher     | footer, every page (`packages/ui/src/components/site/language-switcher.tsx`)                                |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — any mode. Messages live in
`services/web/messages/{en,de,de-CH,fr}.yml` (+ untranslated shared terms in
`global.yml`); the switcher's own labels come from
`packages/ui/src/i18n/messages/global.yml`.

> **Agent note**: the switcher is a custom `menu` popover, not a native
> `<select>` — open it (button aria-label **Switch language**,
> `languageSwitcher.ariaLabel`), then click a `menuitem` (**English**,
> **Deutsch**, **Français**, `languageSwitcher.locales.*`). The de-CH row (F6)
> depends on `window.navigator.language` — launch the browser with `--lang=de-CH` (or
> a `de-CH` context locale).

## Automated coverage

| Case(s)          | Status         | e2e spec / test                                                       |
| ---------------- | -------------- | --------------------------------------------------------------------- |
| F2 (render only) | 🔶 partial     | `smoke.spec.ts` (`/de`, `/de/platform`, `/de/pricing` render)         |
| F3 (render only) | 🔶 partial     | `smoke.spec.ts` (`/fr/changelog`, `/fr/contact` render)               |
| —                | ✅ automated   | vitest `lib/i18n/messages.test.ts` (locale files stay key-compatible) |
| F1, F4–F8, B1–B2 | ⛔ manual-only | —                                                                     |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                   | Steps (route + control)                                                                                                     | Expected (verifiable)                                                                                                                                                                                                                   |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Switch preserves path  | On `/pricing?billing=monthly`, open the footer **Switch language** menu (`languageSwitcher.ariaLabel`) and pick **Deutsch** | URL commits `/de/pricing?billing=monthly` — same page, same search params; picking **English** from there returns to `/pricing?billing=monthly` (prefix dropped, not remapped elsewhere)                                                |
| F2  | German content         | Open `/de`                                                                                                                  | Hero renders the German title (`home.hero.title` from `messages/de.yml` — **Orchestriere jeden KI-Agent auf deinem Stack**); header nav labels are German; no untranslated English leaks in the shell                                   |
| F3  | French content         | Open `/fr` and `/fr/contact`                                                                                                | French hero (**Orchestre chaque agent IA de ta stack**, `messages/fr.yml`) and a fully French contact form (labels from `messages/fr.yml`)                                                                                              |
| F4  | `<html lang>` sync     | On `/`, read `document.documentElement.lang`; switch to **Deutsch**; read again                                             | `en` → `de` without a full page reload (`LocaleSync` in `app/routes/__root.tsx`); on `/fr` it reads `fr`                                                                                                                                |
| F5  | Localized legal docs   | Open `/de/legal/privacy-policy` and `/fr/legal/privacy-policy`                                                              | Each renders the document in that locale (per-locale content under `app/content/legal/`); the DPA/TOM tab labels stay the abbreviations **DPA**/**TOM**                                                                                 |
| F6  | de-CH regional overlay | Browser locale `de-CH`: open `/de`                                                                                          | URL stays `/de` (regional variants never URL-prefix); strings present in `messages/de-CH.yml` render the Swiss variant over the `de` base (`resolveRegionalLocale`); `<html lang>` reflects the base `de` route                         |
| F7  | Switcher current mark  | Open the switcher on `/de/pricing`                                                                                          | The trigger shows **Deutsch**; in the menu the **Deutsch** item is marked current (`aria-current="true"` + check icon); choosing the current locale is a no-op (menu closes, URL unchanged)                                             |
| F8  | Locale cookie          | Visit `/de`; then request `/` again (fresh tab or `curl -H 'Cookie: tale_locale=de' {base}/`)                               | Visiting a locale tree sets the `tale_locale` cookie (`packages/ui/src/i18n/cookie.ts`); the server then 302-redirects `/` to `/de` (verified live) — and the docs site honours the **same** cookie, keeping both sites in one language |

## Boundary & error tests

| ID  | Test           | Input                          | Expected                                                                                                                                                                                                                                  |
| --- | -------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `/en` prefix   | Open `/en`, then `/en/pricing` | Redirects to `/` — English never carries a prefix; note the dropped sub-path (see [navigation.md](navigation.md) B3)                                                                                                                      |
| B2  | Unknown prefix | Open `/es`, `/it/pricing`      | **Localized 404** — the `$lang` route throws `notFound()` for anything but `de`/`fr` (no silent redirect to `/` anymore); the styled not-found page renders with a recovery CTA (`notFound.title`, `notFound.backHome`); no crash, no 500 |

## Accessibility (WCAG 2.1 AA)

| ID  | Check             | Expected                                                                                                                                                                                                                                                           |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Switcher keyboard | Trigger is a labelled button (`aria-haspopup="menu"`, `aria-expanded`); open menu focuses the current locale; **ArrowUp/ArrowDown** cycle items, **Esc** closes and returns focus to the trigger                                                                   |
| A2  | Menu semantics    | The popover is `role="menu"` with `role="menuitem"` children; the active locale carries `aria-current="true"`; **no flag icons render** — the web footer passes `languageSwitcherShowFlag={false}` (`site-footer.tsx`), so the text labels alone carry the meaning |
| A3  | Lang attribute    | `<html lang>` always matches the rendered language (F4) — screen readers pick the right pronunciation                                                                                                                                                              |

## Performance

| ID  | Metric        | Target                                                                             |
| --- | ------------- | ---------------------------------------------------------------------------------- |
| P1  | Locale switch | The SPA navigation to the sibling locale page settles in **< 1 s** on a warm build |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Locale switching (web)
Functional: ___/8   Boundary: ___/2   A11y: ___/3   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
