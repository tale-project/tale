# @tale/marketing-ui

Reusable layouts and components for Tale’s marketing pages: site headers and footers, calls to
action, feature sections, and product-demo frames. This package layers its visual language on
[`@tale/ui`](../ui/README.md). The host supplies copy, routes, product data, and demo scenarios.

## Choose a component

Read the [marketing design contract](../../design/docs/web.md), then browse the
[`exports` map](package.json) and the stories before adding a new pattern.

| Need | Example imports |
| --- | --- |
| Site layout | `site-header`, `site-footer`, `site-container`, `page-section`, `section-heading` |
| Calls to action and surfaces | `button`, `link`, `external-link`, `cta-group`, `card`, `panel`, `stack` |
| Feature pages | `feature-hero`, `feature-capability`, `feature-steps`, `feature-faq`, `feature-cta`, `related-pages`, `docs-links` |
| Comparison and pricing blocks | `compare-table`, `tier-card`, `segmented-radio`, `logo-cloud-section` |
| Product illustrations | `demo-shell`, `demo-stage`, `demo-chrome`, `demo-tour-row`, `demo-tour-section` |
| Motion and host integration | `reveal`, `entrance`, `use-demo-timeline`, `routing`, `i18n/messages` |

```bash
bun run --filter @tale/marketing-ui storybook # http://localhost:6012
```

These are source exports: the consuming application compiles their TypeScript and JSX. Shared app
controls and utilities stay in `@tale/ui`; marketing tokens and compositions live here. Keep
organization permissions, backend calls, and product registries in the host service.

## Connect the host’s routes, styles, and labels

Import the package stylesheet once from the site’s stylesheet:

```css
@import '@tale/marketing-ui/globals.css';
```

It includes `@tale/ui/globals.css`, the marketing tokens, and Tailwind source paths for this
package. Use these tokens for surfaces, text, borders, and motion examples.

Internal links use TanStack Router by default. A host with typed or localized routes mounts
`MarketingRouterProvider` with its link adapter. The adapter receives a site-relative `to`
path and anchor props; it owns locale prefixes and route validation. Tale’s implementation is
[`MarketingRouterLink`](../../services/web/app/components/layout/localized-link.tsx).

Merge `marketingUiMessages` after `uiMessages` when initializing the service’s i18n instance.
This excerpt uses catalogs already loaded by the host:

```tsx
import { marketingUiMessages } from '@tale/marketing-ui/i18n/messages';
import { MarketingRouterProvider } from '@tale/marketing-ui/routing';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';

const i18n = initServiceI18n({
  bundles, regional, global,
  packages: [uiMessages, marketingUiMessages],
});

<MarketingRouterProvider link={MarketingRouterLink}>
  <Application />
</MarketingRouterProvider>;
```

The host supplies `MarketingRouterLink` and `Application`, and passes `i18n` to its `AppShell`.
Package catalogs own labels rendered by shared components, such as the demo window’s **Share**
action. Keep those labels in `src/i18n/messages/{en,de,fr}.yml`; page copy belongs to the host.
Service keys override package keys individually. Verify the resolved labels and links in each
supported locale.

## Install from another repository

Use the Git snapshot dependency `github:tale-project/tale#dist/marketing-ui`, or a published
`marketing-ui-v<version>` tag. Install the matching `@tale/ui` snapshot plus `react`, `react-dom`,
and `tailwindcss`, which are peers rather than bundled app dependencies.

Follow [`@tale/ui`’s consumer setup](../ui/README.md#install-from-another-repository) for the Bun,
Vite, TypeScript, and YAML configuration. Import the marketing stylesheet shown above. The
[publishing workflow](../../.github/workflows/publish-packages.yml) creates `dist/marketing-ui`
and `dist/ui` branches and versioned tags; these are Git dependencies, not npm registry releases.

## Build a demo that remains understandable

Use `DemoShell` and `DemoStage` for labelled product illustrations. Interactive component
examples belong in the [design-system documentation](../../services/ui-docs/content/README.md).
Keep the real information readable with animation disabled; `useDemoTimeline` and `Reveal` are
the shared motion entry points. Test reduced motion and the static rendered state as well as the
animated sequence.

## Verify a change

```bash
bun run --filter @tale/marketing-ui typecheck
bun run --filter @tale/marketing-ui lint
bun run --filter @tale/marketing-ui test
```

The unit project covers components, translations, and dependency boundaries. Use the relevant
stories, then test the consuming page in both themes and at a narrow width. Check links,
keyboard focus, headings, reduced motion, and the meaning of translated labels. For a content
or component example, follow the [writing skill](../../.agents/skills/write-docs/SKILL.md).
