# Web — the marketing design language

The **marketing site** ([`services/web`](../../services/web/)). The web is a **different design language**
from the app — bold, spacious, narrative pages that _show the product working_, not a dense product
surface. It is built from the same `@tale/ui` substrate, composed differently. Never port an app
(chat/dashboard/settings) pattern into the web, or vice versa.

## Design source

There is **no** Pencil `.pen` tree and **no** `design-system.md` for web. The living reference is:

- This doc — the surface rules and what not to import.
- The `Site*` component source under
  [`packages/ui/src/components/site/`](../../packages/ui/src/components/site/).
- The shipped pages and blocks in [`services/web/app/`](../../services/web/app/) — especially the
  homepage composition (`pages/home-page.tsx`) and the demo library
  (`components/blocks/demos/`).

When in doubt, read the component and the page that uses it.

## Build with the `Site*` family

Marketing chrome is a dedicated component set under
[`packages/ui/src/components/site/`](../../packages/ui/src/components/site/) — compose these, don't
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
[`services/web/app/globals.css`](../../services/web/app/globals.css) — cool stone paper in light,
soft charcoal (not espresso brown) in dark. Ink, borders, and accent are overridden here so chrome
matches the paper, not the app's true-neutral black:

| Utility                                                     | Use                                              |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `bg-surface-site`                                           | section backgrounds                              |
| `bg-surface-site-raised`                                    | cards and demo window frames on a section        |
| `bg-surface-site-inset`                                     | image/illustration wells, inner panels           |
| `bg-surface-site-deep`                                      | small logo/icon tiles                            |
| `bg-surface-site-active`                                    | active segmented-control state                   |
| `bg-surface-promo` / `text-fg-promo`                        | the pricing promo chip (muted stone)             |
| `bg-surface-wash`                                           | the quiet stage product windows sit on           |
| `--color-atmosphere-warm` / `--color-atmosphere-deep`       | desaturated stone blooms (hero / stage / CTA)    |
| `bg-gradient-site-hero`                                     | soft top wash behind hero copy                   |
| `bg-gradient-site-band`                                     | paper→wash section rhythm (`PageSection` `soft`) |
| `bg-gradient-site-cta`                                      | quiet radial bloom on closing CTAs               |
| `bg-brand-base` / `hover:bg-brand-strong` / `text-brand-fg` | product life accents (brand #056CFF)             |
| `bg-accent-base` / `text-accent-fg`                         | primary marketing CTAs (ink)                     |
| `bg-ink-terminal` / `text-ink-terminal-fg`                  | always-dark ink terminal (quickstart chrome)     |
| `shadow-demo` / `shadow-demo-hero`                          | layered elevation on `DemoShell`                 |
| `shadow-site-card` / `shadow-site-card-hover`               | quiet elevation on cards and logo tiles          |
| `shadow-site-inset`                                         | recessed icon wells / pillar panels              |
| `bg-demo-traffic-*`                                         | browser chrome traffic lights (demo only)        |
| `bg-demo-stage-*`                                           | `DemoStage` bloom / vignette / grid layers       |

New marketing surface values go into that `@theme` block (plus its `.dark` overrides), never inline.
Light marketing surfaces are cool stone paper (`#f4f4f4`), with raised cards at `#ffffff` and a quiet
wash (`#dddddd`) under product windows. Atmosphere blooms use cool gray
(`--color-atmosphere-warm` / `--color-atmosphere-deep`), never brand blue and never amber/umber.
Promo chips are muted stone, not sand. Primary marketing CTAs use the ink `accent-*` tokens
(pill shape, weight 400); brand blue is for _product life_ inside demos — connectors, step markers,
live rings, send buttons — never for body text or large fills.

## Animated product demos — the doctrine

The homepage's product visuals are **code-built animated mockups**, not screenshots and not video.
They live in [`services/web/app/components/blocks/demos/`](../../services/web/app/components/blocks/demos/)
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
- **Framed by `DemoShell` — a 1:1 depiction of the app.** The frame reproduces the product's real
  anatomy: browser chrome (marketing-only), icon nav rail matching
  `use-navigation-items.ts` (MessageCircle → Folder → BrainIcon → Bot → Workflow → Settings;
  Bell + avatar at bottom; `bg-muted` / `surface-site-inset` active, no left bar), and the
  **correct page header for the active nav** — chat demos use `chat-header.tsx`
  (`MessagesSquare`, `Search`, Share **with label**, `Ellipsis`, no thread title); list demos
  (Agents / Knowledge / Automations / Projects / Settings) use `AdaptiveHeaderTitle` (page title
  only). Pass `title` for list pages. Reference captures in
  `services/docs/public/images/platform/`. The frame is a labelled `role="img"` window (localized
  one-sentence `aria-label`; decorative DOM under `aria-hidden` + `inert`; `data-nosnippet` so
  crawlers don't lift demo copy into snippets) with a **fixed aspect ratio**
  (CLS 0). Elevation uses `shadow-demo` / `shadow-demo-hero`. Demos sit on `DemoStage`
  (atmospheric wash — never a photo). Demo _content_ must match product idioms (chat bubbles,
  RoutingStepRow, SourceCards, composer toolbar, Agents/Documents tables, workflow-step cards,
  Executions table, in-chat approval cards, project task boards, sandbox Files /
  Live panes) — not fictional hub diagrams. Give mobile a taller
  ratio than desktop; size wells against **German**.
- **Text primitives, not the markdown engine.** `demo-typing-text` / `demo-stream-text` reuse the
  globals.css `.stream-reveal`/`.animate-cursor-blink` primitives. Never pull `IncrementalMarkdown`
  (remark/rehype/katex/shiki) into the marketing bundle.
- **One window, many stories — the scenario split.** Every demo separates **chrome** (product
  vocabulary that never varies: column headers, status words, placeholders, step-kind labels —
  always `home.demos.*` keys read inside the component) from **scenario** (the story in the window:
  prompts, replies, rows, workflow labels, approval text). Each demo takes an optional typed
  `scenario` prop and defaults to the homepage story; pages build scenarios with the
  `use<Demo>Scenario(namespace)` hooks in `demo-scenarios.ts`, which read the same `demos.<demo>.*`
  key shape from the owning page namespace (e.g. `platformAutomations.demos.automation.*`). Row
  counts are **fixed per demo** — scenarios vary the story, never the layout (the frames have fixed
  aspect ratios). A platform page must not replay the homepage story in its own module's window.
- **Localized like any copy.** Every visible demo string — chrome and scenario — is a message key
  shipped in all locales; brand names stay unlocalized constants; demo file names and domains
  localize with the story (`help.nordwind.eu` → `hilfe.nordwind.eu`).
- **Budgets.** No images inside demos; keep each demo a few KB of JSX. framer-motion is the only
  animation dependency (plus the shared CSS keyframes).
- **Storybook + e2e.** Each demo gets a story (scenario variants in `tour-demos.stories.tsx`) and a
  reduced-motion e2e assertion of its end state — homepage demos and each platform page's scenario
  (`tests/e2e/specs/home-demos.spec.ts` — deterministic, no timing waits).

### Shared marketing primitives

Build new marketing pages from
[`services/web/app/components/marketing/`](../../services/web/app/components/marketing/)
instead of hand-rolling motion, CTAs, links, or section chrome. Variants use
`class-variance-authority` (`cva`) — never ad-hoc `TONE[tone]` maps.

| Primitive               | Use                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Reveal`                | Entrance wrapper. Scroll reveals are **opacity-only** (no `y`) so they never fight scroll.                                                                                                                            |
| `SectionHeading`        | Title + optional eyebrow/description at `display` / `section` / `subsection` type scale. Outline: `display`→h1, else h2 (pass `as` to nest).                                                                          |
| `MarketingButton`       | Ink primary / inset secondary pills (`tone` + `size` via cva).                                                                                                                                                        |
| `MarketingLink`         | Locale-aware link tones: `nav` / `navMobile` / `footer` / `inline` / `subtle` / `plain`.                                                                                                                              |
| `MarketingExternalLink` | Outbound link with the same tone scale.                                                                                                                                                                               |
| `CtaGroup` / `CtaPair`  | Horizontal CTA row; two-action pair (`to` or `href` per side).                                                                                                                                                        |
| `PageSection`           | Band chrome: `surface` (`site` / `wash` / `soft` / `plain` / `transparent`) / `pad` (`md`/`lg`/`xl`) / `border` + optional `SiteContainer`. Default `lg` (`py-24 md:py-32`); `xl` for heroes/CTAs (`py-28 md:py-40`). |
| `MarketingStack`        | Vertical content column (`gap` / `align` / `max`).                                                                                                                                                                    |
| `MarketingCard`         | Related-module / hub tile (optional `to`, optional `icon`). Default surface is `plain` (panel cell); use `raised` only for standalone tiles.                                                                          |
| `MarketingPanel`        | Framed surface for divider grids (`gap-px` hairlines). Matches ComplianceTrust's single-panel language.                                                                                                               |

Also reuse:

- `MarketingSection` — pricing/hardware lead + subsection shell (already on `Reveal`).
- Feature blocks under `components/blocks/feature/` — hero, capabilities, steps, FAQ, related, docs, CTA.
- `DemoStage` / `DemoShell` — product windows on atmospheric wash (no continuous float).
- `useSkipEntrance` — SSR, reduced-motion, and SPA revisits skip entrances.
- `app/content/platform-pages.ts` — nav dropdown, footer Platform column, related pages.
- `app/content/nav-menus.ts` — Resources header menu (desktop + mobile); Platform rows live in `platform-pages.ts`.
- `app/content/site-ctas.ts` — header primary CTA (Get started → docs) + footer company CTAs; Request a demo stays footer/page-only.
- Header menus: click + Esc + fine-pointer hover intent; mobile drawer is a flat list (no nested disclosures).

Motion rules:

- Scroll reveals: opacity-only via `Reveal` (ease `[0.22, 1, 0.36, 1]`,
  `viewport={{ once: true, margin: '-12%' }}`).
- Hero mount only may use a small `y` with `Reveal onMount` — never `whileInView` + `y` on
  long pages (that was the homepage scroll jitter).
- No infinite `translateY` / float on product windows.
- Demo chat threads grow **down** (`justify-start`) inside a fixed `aspect-*` shell — never
  `justify-end` (that pushed prior bubbles up and registered as CLS).
- Sticky `SiteHeader` is transparent with a light bottom border at the top of the page;
  scrolled adds the tinted blur surface + full border. The marketing root shell paints
  `bg-gradient-site-hero` behind the header so the wash is continuous — never leave the
  transparent nav over flat `surface-site` (that seam reads as a hairline). Lead sections
  stay transparent; re-painting `bg-gradient-site-hero` (or opaque `bg-surface-site`) under
  the nav restarts the wash and recreates the seam.

## Page templates

| Template        | When                                                         | Section order                                                                                                                                                          |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage        | `/`                                                          | Hero + demo → orchestration tour → tagline → connectors → compliance → FAQ → CTA                                                                                       |
| Feature         | `/platform/*`                                                | `FeaturePageLayout`: hero (+ demo) → product tour (copy + DemoShell rows, same as homepage) → capabilities (≥5 docs-traceable) → mini-FAQ → related → docs links → CTA |
| Platform hub    | `/platform`                                                  | Hero (+ demo) → product tour (6 DemoShell rows) → module grid → CTA                                                                                                    |
| Pricing / forms | `/pricing`, `/hardware-pricing`, `/contact`, `/request-demo` | Existing mechanics frozen; wrap with related cards + CTA / FormCard chrome                                                                                             |
| Changelog       | `/changelog`                                                 | Release list from GitHub manifest                                                                                                                                      |

New routes register in `lib/seo/route-paths.ts` **and** `lib/seo/marketing-routes.ts` (bijection test), plus paired `app/routes/` + `app/routes/$lang/` files and en/de/fr messages in the same change.

## SEO is a design constraint

Every marketing page declares its head once via
[`services/web/lib/seo/use-document-meta.ts`](../../services/web/lib/seo/use-document-meta.ts)
(adapter over shared [`@tale/ui/seo/tale-document-meta`](../../packages/ui/src/seo/tale-document-meta.ts);
URL join + hreflang maps from [`@tale/ui/seo/urls`](../../packages/ui/src/seo/urls.ts) /
[`@tale/ui/seo/alternates`](../../packages/ui/src/seo/alternates.ts))
with the **unlocalized `path`** — canonical, the hreflang cluster, `og:locale`, and the brand OG
card (`public/og.png`, 1200×630) all derive from it. On top of that:

- One `h1` per page; question-shaped titles (visible H1 and matching `seo.*.title`) where natural,
  with a standalone answer as the first sentence beneath them.
- JSON-LD only for **visible** content — the homepage FAQ schema is built from the same `FAQ_KEYS`
  the accordion renders; prices in `SoftwareApplication` come from `lib/pricing/tiers.ts`. Never
  aggregateRating/reviews, never schema for content the page doesn't show.
- Entity consistency everywhere: **Tale** · **Ruler GmbH** · **MIT** · **ISO 27001** ·
  **SOC 2 Type II** · agents named exactly (Claude Code, Codex, Cursor).
- New routes register in `lib/seo/route-paths.ts` **and** `lib/seo/marketing-routes.ts`
  (prerender + sitemap + llms.txt; bijection test) — a page is not done until both know it.

## Theme & rendering

- **Theme follows the system** (light + dark), via the same `@tale/ui` `ThemeProvider` + `.dark`
  class. No light-lock here (that's docs). Verify every change in both themes.
- **Page language** — editorial-technical: weight-400 display with tight tracking, product-first
  hero (demo on a full-bleed wash stage, no photo backdrop), ink pill CTAs, hairline borders,
  minimal chrome on cool stone paper. Brand blue stays inside product demos.
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
