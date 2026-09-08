# Theme (dark mode)

> **Prefix** `THEME-` · **Reset** none · **Cost** 11 boxes

Exercise light/dark/system theming — the footer's segmented theme switcher,
persistence (`localStorage['tale-theme']`, `STORAGE_KEY` in
`packages/ui/src/theme/theme-provider.tsx`), the pre-hydration no-flash script
in `index.html`, system-preference tracking, and theming of the animated demo
scenes. Contrast in both themes lives in [accessibility.md](accessibility.md)
A5.

## Scope & routes

Theme is global — test on `/` and spot-check `/platform`, `/pricing`,
`/contact`, and one legal page. The switcher renders in the footer on every
page (`packages/ui/src/components/site/theme-switcher.tsx`,
`variant="segmented"`; provider `packages/ui/src/theme/theme-provider.tsx`).

## Preconditions

Bring the site up per [SETUP.md](../setup.md) — any mode. To drive the system
row (THEME-F3) toggle the OS appearance, or emulate `prefers-color-scheme` in
DevTools / the browser context.

> **Agent note**: the resolved theme is the `dark` class on
> `document.documentElement` (plus
> `document.documentElement.style.colorScheme`) — assert that, not pixel
> colours. The switcher is a `role="radiogroup"` labelled **Switch theme**
> (`themeSwitcher.ariaLabel`) with three `role="radio"` buttons **Light** /
> **Dark** / **System** (`themeSwitcher.light|dark|system`). There are **no**
> `<img>` elements on the marketing pages — every product visual is an
> animated DOM/SVG demo scene (`role="img"` + aria-label), so never assert
> image swaps.

## Functional tests

- [ ] `THEME-F1` · **Explicit switch** — Footer → **Switch theme** radiogroup:
  click **Dark**, then **Light** →
  `document.documentElement.classList.contains('dark')` flips true/false; the
  page palette follows; `localStorage['tale-theme']` reads `dark` / `light`
- [ ] `THEME-F2` · **Persistence** — Set **Dark**; reload; navigate to
  `/pricing` → The dark theme survives the reload and the navigation; the
  **Dark** radio stays `aria-checked="true"`
- [ ] `THEME-F3` · **System mode** — Click **System**; flip the OS/emulated
  `prefers-color-scheme` between light and dark → The page follows the OS
  **live** (no reload needed); `localStorage['tale-theme']` reads `system`
- [ ] `THEME-F4` · **No flash on load** — With **Dark** stored, hard-reload
  `/` (disable cache) → No white flash before first paint — the inline
  `index.html` script reads `localStorage['tale-theme']` and applies the
  `dark` class pre-hydration; same check with system-dark + no stored value.
- [ ] `THEME-F5` · **Demo scenes + head assets follow the theme** — On `/`,
  toggle Light ↔ Dark and inspect the hero demo (`home.demos.hero.label`) and
  one tour demo; read `document.head` → The demo windows restyle with the
  design tokens (dark surfaces/borders/text — no unreadable hardcoded colours
  inside `DemoShell` chrome or scene content; there is **no** light/dark image
  swap because no `<img>` exists); the favicon `<link>`s and `<meta
  name="theme-color">` are media-gated per `prefers-color-scheme` in
  `index.html`
- [ ] `THEME-F6` · **Default** — Fresh profile (no `tale-theme` key), OS light
  → Site renders light and the **System** radio is checked — system is the
  default; no key is written until the user picks one.

## Boundary & error tests

- [ ] `THEME-B1` · **Corrupted storage** —
  `localStorage.setItem('tale-theme','banana')`; reload → Falls back to
  **system** (the provider only accepts `light` / `dark` / `system`); no
  crash, no flash loop.

## Accessibility (WCAG 2.1 AA)

- [ ] `THEME-A1` · **Radiogroup** → The control is `role="radiogroup"`
  aria-labelled **Switch theme**; each option is `role="radio"` with
  `aria-checked` and a text-resolvable name.
- [ ] `THEME-A2` · **Keyboard** → The radios are reachable by Tab and
  switchable by keyboard; focus ring visible in **both** themes.
- [ ] `THEME-A3` · **No content loss** → Toggling theme changes no
  layout/content — only colours; text remains readable during the flip
  (transitions suppressed by the provider)

## Performance

- [ ] `THEME-P1` · **Theme flip** → The palette swap paints in **< 200 ms**
  with no partial-transition flicker (provider suppresses transitions during
  the flip)
