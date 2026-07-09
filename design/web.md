# Web — the marketing design language

The **marketing site** ([`services/web`](../services/web/)). The web is a **different design language**
from the app — bold, spacious, narrative pages that _show the product working_, not a dense product
surface. It is built from the same `@tale/ui` substrate, composed differently. Never port an app
(chat/dashboard/settings) pattern into the web, or vice versa.

## Design source

There is **no** Pencil `.pen` tree and **no** `design-system.md` for web. The living reference is:

- This doc — the surface rules and what not to import.
- The `Site*` component source under
  [`packages/ui/src/components/site/`](../packages/ui/src/components/site/).
- The shipped pages and blocks in [`services/web/app/`](../services/web/app/) — especially the
  homepage composition (`pages/home-page.tsx`) and the demo library
  (`components/blocks/demos/`).

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

Everything else (`Button`, `Card`, `Heading`, `Text`, `Badge`, `Accordion`, markdown) is the same
`@tale/ui` you'd use in the app — same tokens, same Inter/Lucide. The _composition_ is what differs.

## Tokens — marketing surfaces

Semantic utilities only, **never a raw hex in a class**. On top of the canonical `@tale/ui` tokens,
the web defines a marketing-surface family in
[`services/web/app/globals.css`](../services/web/app/globals.css) — its dark values sit deliberately
above the app's `bg-base` for a warmer feel:

| Utility                              | Use                                       |
| ------------------------------------ | ----------------------------------------- |
| `bg-surface-site`                    | section backgrounds                       |
| `bg-surface-site-raised`             | cards and demo window frames on a section |
| `bg-surface-site-inset`              | image/illustration wells, inner panels    |
| `bg-surface-site-deep`               | small logo/icon tiles                     |
| `bg-surface-site-active`             | active segmented-control state            |
| `bg-surface-promo` / `text-fg-promo` | the pricing promo chip                    |

New marketing surface values go into that `@theme` block (plus its `.dark` overrides), never inline.

## Animated product demos — the doctrine

The homepage's product visuals are **code-built animated mockups**, not screenshots and not video.
They live in [`services/web/app/components/blocks/demos/`](../services/web/app/components/blocks/demos/)
and follow one contract:

- **Composed from the design system.** DOM + `@tale/ui` tokens/primitives only — fidelity comes from
  using the product's own vocabulary (real feature names, the step types from
  `services/platform/lib/shared/schemas/workflows.ts`, "Auto", agent · model chips). Pin borrowed
  vocabulary with a source comment. Never import app product components.
- **One timing driver.** Every demo schedules its beats through
  `use-demo-timeline.ts`. Motion policy lives there alone: **SSR and `prefers-reduced-motion`
  render the final beat** (prerendered HTML ships the complete, informative end state; reduced-motion
  users get a static illustration), playback starts on mount (hero) or first scroll-into-view, and
  pauses while the tab is hidden. Play once — no restarts; only subtle idle loops (a soft pulse) may
  repeat.
- **Framed by `DemoShell`.** A labelled `role="img"` window (localized one-sentence `aria-label`,
  everything inside `aria-hidden`) with a **fixed aspect ratio** so the box is reserved before mount
  (CLS 0). Give mobile a taller ratio than desktop and size fixed wells against the **German**
  strings — de is the layout stress test.
- **Text primitives, not the markdown engine.** `demo-typing-text` / `demo-stream-text` reuse the
  globals.css `.stream-reveal`/`.animate-cursor-blink` primitives. Never pull `IncrementalMarkdown`
  (remark/rehype/katex/shiki) into the marketing bundle.
- **Localized like any copy.** Every visible demo string is a `home.demos.*` key shipped in all
  locales; brand names stay unlocalized constants.
- **Budgets.** No images inside demos; keep each demo a few KB of JSX. framer-motion is the only
  animation dependency (plus the shared CSS keyframes).
- **Storybook + e2e.** Each demo gets a story and a reduced-motion e2e assertion of its end state
  (`tests/e2e/specs/home-demos.spec.ts` — deterministic, no timing waits).

Motion conventions for ordinary blocks stay the house pattern: `useReducedMotion` +
`whileInView` + ease `[0.22, 1, 0.36, 1]` + `viewport={{ once: true, margin: '-15%' }}`.

## SEO is a design constraint

Every marketing page declares its head once via
[`services/web/lib/seo/use-document-meta.ts`](../services/web/lib/seo/use-document-meta.ts) with the
**unlocalized `path`** — canonical, the hreflang cluster, `og:locale`, and the brand OG card
(`public/og.png`, 1200×630) all derive from it. On top of that:

- One `h1` per page; question-shaped `h2`s where natural, with a standalone answer as the first
  sentence beneath them.
- JSON-LD only for **visible** content — the homepage FAQ schema is built from the same `FAQ_KEYS`
  the accordion renders; prices in `SoftwareApplication` come from `lib/pricing/tiers.ts`. Never
  aggregateRating/reviews, never schema for content the page doesn't show.
- Entity consistency everywhere: **Tale** · **Ruler GmbH** · **MIT** · **ISO 27001** ·
  **SOC 2 Type II** · agents named exactly (Claude Code, Codex, Cursor).
- New routes register in `lib/seo/marketing-routes.ts` (prerender + sitemap + llms.txt) and
  `app/components/layout/localized-link.tsx` — a page is not done until both know it.

## Theme & rendering

- **Theme follows the system** (light + dark), via the same `@tale/ui` `ThemeProvider` + `.dark`
  class. No light-lock here (that's docs). Verify every change in both themes.
- The site is **server-rendered + prerendered** (`vite build` + `--ssr` + `scripts/prerender.ts`)
  for SEO and first-paint. Keep pages static-friendly: the prerendered HTML must carry the real
  content (the demo end states included) — the client mounts with `createRoot` and replays
  entrances, so initial-viewport animations hide behind the hero fade and reserve their space.

## What the web must NOT pull in

- **No Convex, no auth, no SPA-shell complexity** — those are app-only. `services/web` has no
  `convex.json`; keep it that way.
- **No app product patterns** — no chat composer, no `DataTable` inboxes, no settings rails on a
  marketing page. Demos _depict_ product moments with marketing components; they never import them.
- **No new animation/media dependencies** — no gsap/lottie/rive/video files; motion is code.

## Accessibility (web)

Same WCAG 2.1 AA bar. Marketing pages live or die on it: real landmarks (`header`/`main`/`footer`
via `Site*`), the `SkipLink` wired up, headings in order (one `h1` per page), AA contrast on hero
text, visible focus on every CTA, `prefers-reduced-motion` respected by every animation (the demo
timeline enforces it centrally), and every demo readable as a single labelled image.
