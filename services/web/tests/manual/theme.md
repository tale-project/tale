# Theme (dark mode) — Manual Test Plan

> **Purpose**: Exercise light/dark/system theming — the footer's segmented
> theme switcher, persistence (`localStorage['tale-theme']`), the
> pre-hydration no-flash script in `index.html`, system-preference tracking,
> and the theme-dependent imagery. Contrast in both themes lives in
> [accessibility.md](accessibility.md) A5.

## Scope & routes

Theme is global — test on `/` and spot-check `/pricing`, `/contact`, and one
legal page. The switcher renders in the footer on every page
(`packages/ui/src/components/site/theme-switcher.tsx`, `variant="segmented"`;
provider `packages/ui/src/theme/theme-provider.tsx`).

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — any mode. To drive the system
row (F3) toggle the OS appearance, or emulate `prefers-color-scheme` in
DevTools / the browser context.

> **Agent note**: the resolved theme is the `dark` class on
> `document.documentElement` (plus `style.colorScheme`) — assert that, not
> pixel colours. The switcher is a `role="radiogroup"` labelled **Switch
> theme** (`themeSwitcher.ariaLabel`) with three `role="radio"` buttons
> **Light** / **Dark** / **System** (`themeSwitcher.light|dark|system`).

## Automated coverage

| Case(s)          | Status         | e2e spec |
| ---------------- | -------------- | -------- |
| F1–F6, B1, A1–A3 | ⛔ manual-only | —        |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test             | Steps (route + control)                                                              | Expected (verifiable)                                                                                                                                                                                                           |
| --- | ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Explicit switch  | Footer → **Switch theme** radiogroup: click **Dark**, then **Light**                 | `document.documentElement.classList.contains('dark')` flips true/false; the page palette follows; `localStorage['tale-theme']` reads `dark` / `light`                                                                           |
| F2  | Persistence      | Set **Dark**; reload; navigate to `/pricing`                                         | The dark theme survives the reload and the navigation; the **Dark** radio stays `aria-checked="true"`                                                                                                                           |
| F3  | System mode      | Click **System**; flip the OS/emulated `prefers-color-scheme` between light and dark | The page follows the OS **live** (no reload needed); `localStorage['tale-theme']` reads `system`                                                                                                                                |
| F4  | No flash on load | With **Dark** stored, hard-reload `/` (disable cache)                                | No white flash before first paint — the inline `index.html` script applies the `dark` class pre-hydration; same check with system-dark + no stored value                                                                        |
| F5  | Themed imagery   | On `/`, toggle Light ↔ Dark and inspect the hero image                               | The hero swaps between `/marketing/hero-light.png` and `/marketing/hero-dark.png` (only one visible per theme); feature-section screenshots follow the same pattern; the favicon/`theme-color` metas are media-gated per scheme |
| F6  | Default          | Fresh profile (no `tale-theme` key), OS light                                        | Site renders light and the **System** radio is checked — system is the default; no key is written until the user picks one                                                                                                      |

## Boundary & error tests

| ID  | Test              | Input                                                 | Expected                                                   |
| --- | ----------------- | ----------------------------------------------------- | ---------------------------------------------------------- | ---- | --------------------------------- |
| B1  | Corrupted storage | `localStorage.setItem('tale-theme','banana')`; reload | Falls back to **system** (the provider only accepts `light | dark | system`); no crash, no flash loop |

## Accessibility (WCAG 2.1 AA)

| ID  | Check           | Expected                                                                                                                                        |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Radiogroup      | The control is `role="radiogroup"` aria-labelled **Switch theme**; each option is `role="radio"` with `aria-checked` and a text-resolvable name |
| A2  | Keyboard        | The radios are reachable by Tab and switchable by keyboard; focus ring visible in **both** themes                                               |
| A3  | No content loss | Toggling theme changes no layout/content — only colours/imagery; text remains readable during the flip (transitions suppressed by the provider) |

## Performance

| ID  | Metric     | Target                                                                                                                       |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| P1  | Theme flip | The palette swap paints in **< 200 ms** with no partial-transition flicker (provider suppresses transitions during the flip) |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Theme (web)
Functional: ___/6   Boundary: ___/1   A11y: ___/3   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
