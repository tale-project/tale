---
title: Marketing UI overview
description: The other design language — site chrome, page sections, feature frames and animated product demos, layered on @tale/ui.
---

`@tale/marketing-ui` is the language tale.dev is written in. It is a layer on
`@tale/ui`, not a replacement: tokens, `cn`, `Button`, `Tooltip`, the logo and
the i18n glue all come from there, and this package adds only what a marketing
page needs.

By the end of this page you will know what the package contains, how its
routing seam works, and why an app screen should not import from it.

## It looks different on purpose

<Demo name="marketing-ui/primitives" />

The marketing surface is cool stone paper (`bg-surface-site`) rather than the
app's flat `bg-background`; display type runs at weight 400 up to 80px; buttons
are pills; sections are bands with atmosphere behind them. None of that belongs
on a screen someone uses forty times a day, which is exactly why the two
languages are separate packages.

## What is inside

| Area | Subpaths |
| --- | --- |
| Site chrome | `site-header`, `site-footer`, `site-container` |
| Primitives | `button`, `link`, `external-link`, `cta-group`, `card`, `panel`, `stack`, `page-section`, `section-heading`, `reveal` |
| Feature frames | `feature-hero`, `feature-capability`, `feature-steps`, `feature-faq`, `feature-cta`, `related-pages`, `docs-links` |
| Blocks | `marketing-section`, `tier-card`, `compare-table`, `segmented-radio`, `logo-cloud-section`, `progress-bar` |
| Demo frames | `demo-shell`, `demo-chrome`, `demo-stage`, `demo-tour-row`, `demo-tour-section`, `demo-typing-text`, `demo-stream-text`, `use-demo-timeline` |
| Foundations | `globals.css`, `entrance`, `routing`, `i18n/messages`, `tailwind-preset` |

## Frames, not copy

A marketing component renders what it is given. Titles, labels, paths and demo
scenarios arrive as props from the host, and the only strings the package
renders on its own are the demo window's chrome — which live in its own
catalog, gated by its own test.

That is what makes the same `FeatureHero` usable on six pages in three
languages without the package learning anything about any of them.

## Routing is the host's

Every internal link renders through the component the host injects:

```tsx
import { MarketingRouterProvider } from '@tale/marketing-ui/routing';

<MarketingRouterProvider link={MyLocalizedLink}>
  {children}
</MarketingRouterProvider>;
```

`to` is a plain site path. Without a provider the links fall back to TanStack
Router's `Link`, which is what this site uses — it has no locale prefixes, so
there is nothing to adapt.

The seam covers `MarketingLink`, a linked `MarketingCard`, `CtaPair` and
`DemoTourRow`.

## The demo frames

`DemoShell` draws a 1:1 frame of the Tale app — browser chrome, the icon nav
rail, the correct page header for the active section — around whatever you put
inside it. `DemoStage` is the atmospheric band underneath.

The frame is treated as **one illustration**: `role="img"` with a
one-sentence `aria-label`, its payload `aria-hidden` and `inert`, and
`data-nosnippet` so a crawler does not lift demo copy into a search snippet.
That contract is why the [front page](/) can render real, live `@tale/ui`
components inside the window without adding a second unlabelled interface to
the page's accessibility tree.

`useDemoTimeline` is the one timing driver behind every animated demo, and
`useSkipEntrance` makes SSR, reduced motion and SPA revisits skip entrance
animations.

## Stylesheet and catalog

One import pulls both languages in:

```css
@import '@tale/marketing-ui/globals.css';
```

And the catalog registers next to the app one:

```ts
initServiceI18n({
  bundles,
  regional,
  global,
  packages: [uiMessages, marketingUiMessages],
});
```

## When not to use it

An app screen should not import from this package. The marketing surface
tokens, the pill buttons and the display type are page furniture; inside the
product they read as a different application. If you need a bordered surface in
an app screen, that is [`Card`](/docs/foundations/spacing-and-layout); if you
need a heading, that is `Heading`.

The one legitimate crossing is the other direction, and it is already built in:
marketing components import `@tale/ui` primitives freely.

## Where to go next

The marketing package has its own Storybook —
`bun run --filter @tale/marketing-ui storybook` — which is the fastest way to
see every frame with its knobs. For the app language, start at
[Button](/docs/components/button).
