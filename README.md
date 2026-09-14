# @tale/marketing-ui

The Tale design system for the **marketing language** — the site chrome, the
marketing primitives, the feature-page frames and the animated product-demo
frames that `services/web` (and any other Tale-project site) composes its
pages from. It is a layer on `@tale/ui` (the app language): tokens, `cn`,
`Button`, `Accordion`, `Tooltip`, the logo and the i18n glue all come from
there; this package owns only what a marketing page needs.

```bash
bun run --filter @tale/marketing-ui typecheck
bun run --filter @tale/marketing-ui lint
bun run --filter @tale/marketing-ui test       # jsdom component tests + the catalog gates
bun run --filter @tale/marketing-ui storybook  # http://localhost:6012
```

## What is inside

Source-consumed — no build step; consumers import
`@tale/marketing-ui/<subpath>` straight from `src/` (the `exports` map in
`package.json` is the public surface, one subpath per module).

| Area                 | Subpaths                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Site chrome          | `site-header`, `site-footer`, `site-container`                                                                                                  |
| Marketing primitives | `button`, `link`, `external-link`, `cta-group`, `card`, `panel`, `stack`, `page-section`, `section-heading`, `reveal` (+ `marketing`, the sub-barrel) |
| Feature-page frames  | `feature-hero`, `feature-capability`, `feature-steps`, `feature-faq`, `feature-cta`, `related-pages`, `docs-links`                              |
| Blocks               | `marketing-section`, `tier-card`, `compare-table`, `segmented-radio`, `logo-cloud-section`, `progress-bar`                                      |
| Product-demo frames  | `demo-shell`, `demo-chrome`, `demo-stage`, `demo-tour-row`, `demo-tour-section`, `demo-typing-text`, `demo-stream-text`, `use-demo-timeline`   |
| Foundations          | `globals.css` (marketing tokens + atmosphere, on top of `@tale/ui/globals.css`), `entrance`, `routing` (the link seam), `i18n/messages`, `tailwind-preset` |

Rules of the house — [`design/docs/web.md`](../../design/docs/web.md) is the
contract:

- **Frames, not copy.** A component renders what it is given — titles,
  labels, paths and demo scenarios all arrive through props from the host.
  The only strings the package renders on its own (the demo window's chrome)
  live in `src/i18n/messages/{en,de,fr}.yml`; `src/i18n/messages.test.ts`
  fails on a missing or orphan key.
- **Routing is the host's.** Every internal link renders through the
  component `MarketingRouterProvider` injects (`MarketingLink`, a linked
  `MarketingCard`, `CtaPair`, `DemoTourRow`); `to` is a plain site path.
  Without a provider the links are TanStack Router's `Link`.
- **Tokens only.** The marketing surface family (`bg-surface-site*`,
  `bg-surface-wash`, `bg-gradient-site-*`, `shadow-demo*`,
  `bg-demo-stage-*`) is declared in `src/globals.css`; never a raw hex in a
  class.
- **Motion is code.** `Reveal` (opacity-only scroll reveals),
  `useSkipEntrance` (SSR, reduced motion and SPA revisits skip entrances) and
  `useDemoTimeline` (the one timing driver of every demo) are the animation
  entry points; framer-motion is the only animation dependency.

## Using it inside this monorepo

`services/web` depends on it (`"@tale/marketing-ui": "workspace:*"`):

```tsx
import { FeatureHero } from '@tale/marketing-ui/feature-hero';
import { MarketingRouterProvider } from '@tale/marketing-ui/routing';
```

Mount the link seam once at the root and merge the catalog next to
`@tale/ui`'s:

```tsx
// app/routes/__root.tsx
<MarketingRouterProvider link={MarketingRouterLink}>…</MarketingRouterProvider>;

// lib/i18n/i18n.ts
initServiceI18n({ bundles, regional, global, packages: [uiMessages, marketingUiMessages] });
```

Stylesheet: the site's `globals.css` is one line,
`@import '@tale/marketing-ui/globals.css';` — it pulls `@tale/ui/globals.css`
in and adds the marketing tokens plus this package's Tailwind sources.

## Using it from another repository

Published like `@tale/ui`: a root-level snapshot branch and tag of this
repository, pinned with a GitHub URL. `@tale/ui` is a **peer**, so install
both:

```json
{
  "dependencies": {
    "@tale/marketing-ui": "github:tale-project/tale#dist/marketing-ui",
    "@tale/ui": "github:tale-project/tale#dist/ui",
    "react": "19.2.5",
    "react-dom": "19.2.5",
    "tailwindcss": "4.2.2"
  }
}
```

Pin a release instead of the moving branches with `#marketing-ui-v<version>`
and `#ui-v<version>` (the tags the `publish-packages` workflow cuts on every
Tale release) — Bun caches a git dependency by ref, so a moving branch only
advances after `bun install --force` (or `bun pm cache rm`), while a tag is
reproducible. Requirements on the consumer side are `@tale/ui`'s:

- **Vite + Tailwind v4, run through Bun** (`bun --bun vite build` — the
  package ships TypeScript source, not a build, and Node refuses to strip
  types under `node_modules`). Register `@tale/ui`'s YAML catalog loader and
  this package's stylesheet:

  ```ts
  // vite.config.ts
  import { yamlImports } from '@tale/ui/vite/yaml';
  export default defineConfig({ plugins: [yamlImports(), react()] });
  ```

  ```css
  /* globals.css */
  @import '@tale/marketing-ui/globals.css';
  ```

- **TypeScript** with `moduleResolution: "bundler"` and `jsx: "react-jsx"` —
  the same `tsconfig` family every Tale-project repository extends.
- **Peers**: `@tale/ui`, `react`, `react-dom`, `tailwindcss`.

The package's own `dependencies` are complete (a guard test fails when a
source import is undeclared), so nothing else needs installing.

## Layout

```
src/
  components/site/       SiteHeader, SiteFooter, SiteContainer (+ tests)
  components/marketing/  the primitives, their sub-barrel and stories
  components/feature/    the feature-page frames (+ tests + stories)
  components/blocks/     MarketingSection, TierCard, CompareTable, SegmentedRadio, LogoCloudSection, ProgressBar
  components/demos/      DemoShell, DemoStage, DemoTourRow / DemoTourSection, the text primitives, useDemoTimeline
  lib/                   entrance (useSkipEntrance, withinEntranceWindow)
  i18n/                  the catalog (messages/*.yml) + its gate
  routing.tsx            MarketingRouterProvider / useMarketingLink — the link seam
  globals.css            marketing tokens + atmosphere, on top of @tale/ui/globals.css
tests/                   vitest setup + the render utility of this package
```
