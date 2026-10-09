---
title: Marketing UI overview
description: Build public-facing page sections with host-owned copy, routing, and clearly labelled product illustrations.
---

`@tale/marketing-ui` supplies the public website's visual language on top of `@tale/ui`: site navigation, section headings, calls to action, content panels, and product-demo frames. Use it for discovery and explanation pages; use application components for repeated work inside the product.

## Compare the primitives

<Demo name="marketing-ui/primitives" />

The example combines `SectionHeading`, `MarketingButton`, `MarketingPanel`, and `MarketingCard`. The buttons demonstrate styling only. The cards have no `to` destination, so they are static content rather than links.

Marketing surfaces use near-white paper in light mode and charcoal in dark mode, with fine dividers and distinct illustration palettes: mint projects, coral agents, violet chat, gold automations, and sky knowledge. Fluid Inter headings and rounded rectangular calls to action share one scale across the public sites. The application package supplies the underlying controls and utilities; use the marketing `surface-site` tokens for the surrounding page.

Compose the page around the content: a split introduction can pair a large heading with a shorter description, while an asymmetric guide grid can give the starting point more space. Use `SiteContainer` to keep their edges aligned. Let columns stack on narrow screens, preserve readable controls, and simplify a decorative illustration before shrinking its text.

## Install the layer

Install both packages and follow [Installation](/docs/getting-started/installation) for source-consuming Vite setup. Load one stylesheet:

```css
@import '@tale/marketing-ui/globals.css';
```

That file imports `@tale/ui/globals.css` and adds the marketing vocabulary. Include both `uiMessages` and `marketingUiMessages` in `initServiceI18n.packages` so shared controls and demo-window labels resolve.

If only the front page uses marketing components, keep `@tale/ui/globals.css` and add `@tale/marketing-ui/landing.css` after it. Put `className="marketing-surface"` on the front page's wrapper. The marketing foreground, border, and action palette then stays inside that wrapper; documentation articles and application screens retain their own theme.

## Choose a building block

| Area | Exported subpaths |
| --- | --- |
| Site navigation and frame | `site-header`, `site-footer`, `site-container` |
| Core page composition | `button`, `link`, `external-link`, `cta-group`, `card`, `panel`, `stack`, `page-section`, `section-heading`, `reveal` |
| Feature sections | `feature-hero`, `feature-capability`, `feature-steps`, `feature-faq`, `feature-cta`, `related-pages`, `docs-links` |
| Comparison and discovery | `marketing-section`, `tier-card`, `compare-table`, `segmented-radio`, `logo-cloud-section`, `progress-bar` |
| Product illustrations | `demo-shell`, `demo-chrome`, `demo-stage`, `demo-tour-row`, `demo-tour-section`, `demo-typing-text`, `demo-stream-text`, `use-demo-timeline` |
| Setup | `globals.css`, `landing.css`, `routing`, `entrance`, `i18n/messages`, `tailwind-preset` |

Import from the named package subpaths. Keep page-specific claims, translated titles, destinations, and scenarios in the host. A reusable feature section should not learn your service's pricing or permissions.

## Make headings and cards semantic

`SectionHeading` takes a required `title` plus optional description and eyebrow. `size` chooses `display`, `section`, or `subsection`; `align` is `center` by default or `start`. Display defaults to `h1`, while section and subsection default to `h2`. Use `as` for the correct nested heading level; visual size does not determine the document outline.

`MarketingButton` offers `tone="primary"` or `secondary` and `size="default"` or `lg`. Use `asChild` around an appropriate link when the action navigates.

`MarketingCard` is static without `to` and becomes an internal link with it. Its surface is `plain` by default, with `raised` and `inset` alternatives. Do not put nested competing links inside a card that is itself a link.

Use `surface="featured"` for the main destination in a section and `surface="quiet"` for supporting links in a list. These variants use the shared `Card` surface and keep the complete card a single link. Keep the destination's action clear in its title.

## Compose an introduction and section rhythm

`FeatureHero` accepts a title, description, optional eyebrow, actions, visual, and `proof` content. Its default `layout="stacked"` places the heading and supporting copy above the visual. Choose `layout="split"` to put the introduction and actions beside the visual on desktop; phones keep that same reading order vertically. Use the proof slot for established facts or a short explanation of the next step.

The visual receives a `DemoStage` by default. Set `visualTreatment="plain"` when it already owns its frame or is an interactive composition. If a plain visual uses `@lg/demo:` and other container variants, provide its own `@container/demo` ancestor. Keep required actions outside inert illustrations.

Use `SectionHeading layout="editorial"` when a section's description should sit beside its heading on desktop. `PageSection pad="compact"` provides shorter spacing for a proof strip or a small group of destinations. `surface="contrast"` creates an ink band with locally scoped foreground and action colors; neighboring sections keep their original palette. Reserve that change of pace for an important section rather than alternating every band.

`MarketingSection` also accepts a `visual` slot beside the lead heading and controls. Use it for a
page-specific pricing or hardware illustration; the host keeps the content, and existing sections
without a visual retain their centered layout.

## Connect host routing

Internal marketing links use the link component supplied by `MarketingRouterProvider`. Without that provider, the fallback is TanStack Router's Link, which still requires router context.

```tsx
import {
  MarketingRouterProvider,
  type MarketingLinkComponentProps,
} from '@tale/marketing-ui/routing';

function SiteLink({ to, activeProps: _activeProps, activeOptions: _activeOptions, ...props }: MarketingLinkComponentProps) {
  return <a href={to} {...props} />;
}

export function MarketingRoot({ children }: { children: React.ReactNode }) {
  return <MarketingRouterProvider link={SiteLink}>{children}</MarketingRouterProvider>;
}
```

This plain-anchor adapter works without a client router and deliberately does not apply active-route styling. A localized router adapter should resolve locale prefixes and active styles in the host. Keep the package's `to` value a site path; do not duplicate locale routing inside each card or call to action.

Pass `active` to `MarketingLink` for current-route styling. Use `activeOptions={{ exact: true, includeSearch: false }}` when a navigation link should match only its own page and remain current while query parameters change. The routing adapter forwards these options to the host router.

## Present product windows as illustrations

`DemoShell` places content inside the product window frame; `DemoStage` supplies the surrounding presentation. Its `domain` prop defaults to the depicted navigation and coordinates the illustration palette with the stage. Use an explicit override when the story differs from the navigation, such as an agent workspace inside chat or a governance approval inside Automations. The stage has no decorative accent line and stays still; the scene owns meaningful motion. The window is one labelled illustration: `role="img"` with an accessible description, and an `aria-hidden`, `inert` payload. Its demo copy is excluded from search snippets with `data-nosnippet`.

That treatment lets a marketing page show real components without exposing a second application navigation or a misleading form to keyboard users. Supply a description of what the illustration demonstrates, and keep the explanation outside it complete. If the reader must interact, build an explicitly interactive example instead of placing required controls inside an inert frame.

`Reveal` coordinates entrances and section reveals. Keep scroll reveals opacity-only so they do not move the page; reserve small vertical entrances for content appearing on the initial load. Hover and press feedback should reinforce an action without shifting neighboring content.

`useDemoTimeline` coordinates a product illustration's beats, plays once, and pauses while the tab is hidden. Server rendering, reduced motion and navigation revisits show the completed state. Build a complete static composition first, then reveal its parts without changing the space the frame reserves. Inspect both themes at phone and desktop widths, and repeat with reduced motion enabled.

To inspect the broader frame catalog locally, run `bun run --filter @tale/marketing-ui storybook`. For working application controls, continue with [Button](/docs/components/button), [Dialog](/docs/components/dialog), or [Data table](/docs/components/data-table).
