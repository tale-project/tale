---
title: Marketing UI overview
description: Build public-facing page sections with host-owned copy, routing, and clearly labelled product illustrations.
---

`@tale/marketing-ui` supplies the public website's visual language on top of `@tale/ui`: site navigation, section headings, calls to action, content panels, and product-demo frames. Use it for discovery and explanation pages; use application components for repeated work inside the product.

## Compare the primitives

<Demo name="marketing-ui/primitives" />

The example combines `SectionHeading`, `MarketingButton`, `MarketingPanel`, and `MarketingCard`. The buttons demonstrate styling only. The cards have no `to` destination, so they are static content rather than links.

Marketing surfaces use `surface-site` tokens, normal-weight display text, and rounded calls to action. The application package still supplies shared tokens, utilities, and underlying controls.

## Install the layer

Install both packages and follow [Installation](/docs/getting-started/installation) for source-consuming Vite setup. Load one stylesheet:

```css
@import '@tale/marketing-ui/globals.css';
```

That file imports `@tale/ui/globals.css` and adds the marketing vocabulary. Include both `uiMessages` and `marketingUiMessages` in `initServiceI18n.packages` so shared controls and demo-window labels resolve.

## Choose a building block

| Area | Exported subpaths |
| --- | --- |
| Site navigation and frame | `site-header`, `site-footer`, `site-container` |
| Core page composition | `button`, `link`, `external-link`, `cta-group`, `card`, `panel`, `stack`, `page-section`, `section-heading`, `reveal` |
| Feature sections | `feature-hero`, `feature-capability`, `feature-steps`, `feature-faq`, `feature-cta`, `related-pages`, `docs-links` |
| Comparison and discovery | `marketing-section`, `tier-card`, `compare-table`, `segmented-radio`, `logo-cloud-section`, `progress-bar` |
| Product illustrations | `demo-shell`, `demo-chrome`, `demo-stage`, `demo-tour-row`, `demo-tour-section`, `demo-typing-text`, `demo-stream-text`, `use-demo-timeline` |
| Setup | `globals.css`, `routing`, `entrance`, `i18n/messages`, `tailwind-preset` |

Import from the named package subpaths. Keep page-specific claims, translated titles, destinations, and scenarios in the host. A reusable feature section should not learn your service's pricing or permissions.

## Make headings and cards semantic

`SectionHeading` takes a required `title` plus optional description and eyebrow. `size` chooses `display`, `section`, or `subsection`; `align` is `center` by default or `start`. Display defaults to `h1`, while section and subsection default to `h2`. Use `as` for the correct nested heading level; visual size does not determine the document outline.

`MarketingButton` offers `tone="primary"` or `secondary` and `size="default"` or `lg`. Use `asChild` around an appropriate link when the action navigates.

`MarketingCard` is static without `to` and becomes an internal link with it. Its surface is `plain` by default, with `raised` and `inset` alternatives. Do not put nested competing links inside a card that is itself a link.

## Connect host routing

Internal marketing links use the link component supplied by `MarketingRouterProvider`. Without that provider, the fallback is TanStack Router's Link, which still requires router context.

```tsx
import {
  MarketingRouterProvider,
  type MarketingLinkComponentProps,
} from '@tale/marketing-ui/routing';

function SiteLink({ to, activeProps: _activeProps, ...props }: MarketingLinkComponentProps) {
  return <a href={to} {...props} />;
}

export function MarketingRoot({ children }: { children: React.ReactNode }) {
  return <MarketingRouterProvider link={SiteLink}>{children}</MarketingRouterProvider>;
}
```

This plain-anchor adapter works without a client router and deliberately does not apply active-route styling. A localized router adapter should resolve locale prefixes and active styles in the host. Keep the package's `to` value a site path; do not duplicate locale routing inside each card or call to action.

## Present product windows as illustrations

`DemoShell` places content inside the product window frame; `DemoStage` supplies the surrounding presentation. The window is one labelled illustration: `role="img"` with an accessible description, and an `aria-hidden`, `inert` payload. Its demo copy is excluded from search snippets with `data-nosnippet`.

That treatment lets a marketing page show real components without exposing a second application navigation or a misleading form to keyboard users. Supply a description of what the illustration demonstrates, and keep the explanation outside it complete. If the reader must interact, build an explicitly interactive example instead of placing required controls inside an inert frame.

`useDemoTimeline` coordinates animated sequences. Use the shared entrance/reduced-motion utilities, then inspect the result with reduced motion enabled. A static, understandable result should remain when motion is skipped.

To inspect the broader frame catalog locally, run `bun run --filter @tale/marketing-ui storybook`. For working application controls, continue with [Button](/docs/components/button), [Dialog](/docs/components/dialog), or [Data table](/docs/components/data-table).
