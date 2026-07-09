# Web — the marketing design language

The **marketing site** ([`services/web`](../services/web/)). The web is a **different design language**
from the app — bold, spacious, narrative landing pages, not a dense product surface. It happens to be
built from the same `@tale/ui` substrate, but you compose it differently and you follow a different
design source. Never port an app (chat/dashboard/settings) pattern into the web, or vice versa.

## Design source

There is **no** Pencil `.pen` tree and **no** `design-system.md` for web. The living reference is:

- This doc — the surface rules and what not to import.
- The `Site*` component source under
  [`packages/ui/src/components/site/`](../packages/ui/src/components/site/).
- The shipped pages and assets in [`services/web`](../services/web/) — especially
  [`services/web/public/marketing/`](../services/web/public/marketing/) (hero + feature imagery,
  light and dark) and the home/pricing route composition.

When in doubt, read the component and the page that uses it.

## Build with the `Site*` family

Marketing chrome is a dedicated component set under
[`packages/ui/src/components/site/`](../packages/ui/src/components/site/) — compose these, don't
hand-roll page chrome:

- `SiteHeader` / `SiteFooter` — marketing nav + footer (distinct from the app shell).
- `SiteContainer` — the page width container / section rhythm.
- `SkipLink` — the keyboard skip-to-content link (a11y).
- `ExternalLink` — outbound links with the right `rel`/target.
- `LanguageSwitcher` / `ThemeSwitcher` — locale + theme controls in the marketing chrome.

Everything else (`Button`, `Card`, `Heading`, `Text`, `Badge`, markdown) is the same `@tale/ui` you'd
use in the app — same tokens, same `h-9`, same Inter/Lucide. The _composition_ is what differs.

## Theme & rendering

- **Theme follows the system** (light + dark), via the same `@tale/ui` `ThemeProvider` + `.dark` class.
  No light-lock here (that's docs).
- The site is **server-rendered + prerendered** (`vite build` + `--ssr` + a prerender step) for SEO and
  first-paint — use `@tale/ui/seo` builders for metadata; keep pages static-friendly.
- Themed imagery swaps with the theme (e.g. `/marketing/hero-light.png` ↔ `/marketing/hero-dark.png`,
  and the feature SVGs under `/marketing/feature-*.svg`).

## What the web must NOT pull in

- **No Convex, no auth, no SPA-shell complexity** — those are app-only. `services/web` has no
  `convex.json`; keep it that way.
- **No app product patterns** — no chat composer, no `DataTable` inboxes, no settings rails on a
  marketing page. If you reach for an app component that isn't in the `Site*`/primitive set, you're
  probably on the wrong surface.

## Accessibility (web)

Same WCAG 2.1 AA bar. Marketing pages live or die on it: real landmarks (`header`/`main`/`footer` via
`Site*`), the `SkipLink` wired up, headings in order (one `h1` per page), AA contrast on hero text over
imagery, visible focus on every CTA, and `prefers-reduced-motion` respected for animated illustrations.
