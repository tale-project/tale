# @tale/ui

Shared React components, hooks, tokens, translations, and Markdown rendering for Tale’s app
interfaces. Consumers import explicit `@tale/ui/<subpath>` exports; their application build
compiles the TypeScript source. Marketing pages use the additional
[`@tale/marketing-ui`](https://github.com/tale-project/tale/blob/main/packages/marketing-ui/README.md) layer.

## Find an existing component

Start with the [design contract](https://github.com/tale-project/tale/blob/main/design/docs/README.md) and the
[design-system guides](https://ui.tale.dev/docs/getting-started/introduction). The
[`package.json` exports map](package.json) defines the public imports; component sources, tests,
and stories live together under `src/components/<family>/`.

| Need | Example imports |
| --- | --- |
| Controls and forms | `button`, `icon-button`, `input`, `select`, `checkbox`, `use-form`, `field-shell` |
| Tables and values | `data-table/data-table`, `data-table/column-builders`, `copyable-field`, `json-viewer` |
| Layout and navigation | `page-layout`, `adaptive-header`, `sub-panel`, `header-breadcrumbs`, `tab-navigation` |
| Dialogs and feedback | `dialog/form-dialog`, `dialog/delete-dialog`, `toaster`, `use-toast`, `use-retry-focus` |
| Editing and diagrams | `editor`, `wizard/*`, `catalog/*`, `filters/*`, `flow/*` |
| Documentation sites | `docs/docs-layout`, `docs/docs-header`, `docs/docs-article`, `docs/docs-not-found`, `docs/page-actions`, `search/static-index/*` |
| Shared infrastructure | `i18n/*`, `markdown/*`, `seo/*`, `server`, `monitoring/*`, `theme`, `testing/*` |
| Large custom collections | `use-virtual-list`; [windowing and focus guidance](https://ui.tale.dev/docs/patterns/list-page#bound-a-custom-collections-rendering) |

Browse interactive stories from a Tale source checkout:

```bash
bun run --filter @tale/ui storybook # http://localhost:6006
```

Reusable components take state and events through props or a small context. Organization
branding, permissions, backend queries, and other business behavior belong in the consuming
service’s wrappers. Use the shared tokens, control sizes, and interaction patterns instead of
copying a service component into a second location.

For long lists, `@tale/ui/use-virtual-list` exports TanStack Virtual's React hook as
`useVirtualList`. Keep the complete ordered data source, supply stable entity keys,
render `getVirtualItems()`, measure each `data-index` row with `measureElement`, and
reserve the scrollable height with `getTotalSize()`. Preserve native list semantics
and each row's position in the full list. Use `scrollToIndex` for keyboard navigation
to unmounted rows and `rangeExtractor` to keep focused or dragged rows mounted.
Enable `useAnimationFrameWithResizeObserver` when measured rows change height.
An omitted `initialOffset` adopts the scrollport's current position; an explicit
number or function restores the requested starting position instead.

`DropdownMenu` accepts an item array or a callback returning its groups, including
submenu items. Pass a callback for expensive menus: it runs when that menu opens,
using the current props. `@tale/ui/use-viewport-visibility` can defer expensive
decoration until content approaches the viewport; retain the readable content so
copying, browser find, and assistive technology still work. Shared Markdown uses
this hook to defer syntax highlighting while keeping the original code visible.

## Use it in an application

Frontend workspaces depend on `"@tale/ui": "workspace:*"`. Import the modules you need:

```tsx
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
```

Import `@tale/ui/globals.css` from the application stylesheet. It supplies Tailwind v4, the
shared tokens, and the package’s Tailwind source paths. The package also exports
`@tale/ui/tailwind-preset` for consumers that use a Tailwind configuration.

Merge `uiMessages` into the service’s i18n initialization, then mount `AppShell` around the app.
This excerpt assumes the service has loaded its own `bundles`, `regional`, and `global` catalogs:

```tsx
import { AppShell } from '@tale/ui/app-shell';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';

const i18n = initServiceI18n({ bundles, regional, global, packages: [uiMessages] });

<AppShell i18n={i18n} locale={{ mode: 'client' }} theme>
  <Application />
</AppShell>;
```

Use `locale={{ mode: 'client' }}` for a saved browser preference. URL-driven services such as
web and docs omit it and mount `LocaleSync` with the route’s locale.

A service with large catalogs can ship English alone and fetch German and French when a session
first needs them: list them in `lazyBundles` (`de: () => import('…/de.yml').then((m) => m.default)`)
instead of `bundles`. Or load every language per topic, as the platform does: keep the catalog one
file per topic and locale, register the `messageTopics` plugin (`@tale/ui/vite/message-topics`)
in the Vite and Vitest configurations, and pass the other locales' topic files as `topics`
(`topicLoaders` from `@tale/ui/i18n/topic-catalogs` over a lazy glob). Each module that names a
topic — `useT('tasks')`, `{ ns: 'tasks' }`, an `entityNamespace: 'tasks'` property, a
`'tasks:key'` literal — then carries its English, and each chunk loaded on demand waits for its
topics in the session’s language; a namespace computed at runtime is invisible to the plugin, so
name it literally where it is read. `LocaleSync` loads a language before switching to it. To start
in the person’s language from the first frame, load and switch to `detectPreferredLocale()` before
rendering, as the platform does (`services/platform/lib/i18n/i18n.ts`). A screen that reads
languages other than the session’s (`i18n.getFixedT(locale)`) waits for them with
`useLocalesLoaded` from `@tale/ui/i18n/load-locale`. `theme` enables the shared
provider with its system preference default. Routing, authentication, and query providers
remain the host’s responsibility.

## Install from another repository

The [package publishing workflow](https://github.com/tale-project/tale/blob/main/.github/workflows/publish-packages.yml) exports each
package as a repository-root snapshot. Install the `dist/ui` branch with
`github:tale-project/tale#dist/ui`, or select a published `ui-v<version>` tag for a reproducible
release. Each snapshot includes the [MIT license](https://github.com/tale-project/tale/blob/main/LICENSE). These are Git dependencies, not npm registry releases. Install the required peers
`react`, `react-dom`, and `tailwindcss` as well; see `peerDependencies` in `package.json`.

The consuming build must process TypeScript, React JSX, CSS, and YAML. Tale uses Vite and
Tailwind v4 under Bun, with TypeScript `moduleResolution: "bundler"` and `jsx: "react-jsx"`.
Register the YAML plugin in the consumer’s Vite configuration:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { yamlImports } from '@tale/ui/vite/yaml';

export default defineConfig({ plugins: [yamlImports(), react()] });
```

Run that build with `bun --bun vite build` and import `@tale/ui/globals.css` in the application
stylesheet. Optional PWA and Storybook imports need the corresponding optional peers listed in
`package.json`; a component consumer does not need to install the entire Storybook stack.

## Keep labels and documentation with their component

Shared labels belong in `src/i18n/messages/{en,de,fr}.yml`, with sparse Swiss German overrides
in `de-CH.yml`. The host merges package catalogs beneath its own keys, so a service override can
hide a shared correction. Check the rendered label as well as key and ICU parity, following the
[translation skill](https://github.com/tale-project/tale/blob/main/.agents/skills/write-translations/SKILL.md).
A service may keep its catalog one file per topic and locale (`messages/<locale>/<topic>.yml`, a
topic being one top-level namespace), as the platform does: `@tale/ui/i18n/topic-catalogs` turns
an `import.meta.glob` of those files into bundles or per-topic loaders, and the i18n test
framework reads either layout.

Both documentation sites — [docs.tale.dev](https://github.com/tale-project/tale/blob/main/services/docs/README.md) and
[ui.tale.dev](https://github.com/tale-project/tale/blob/main/services/ui-docs/README.md) — render the `docs/*` frame: the rail, the
phone drawer, the header strip, the article with its outline, the footer, the 404 and the
static-index search palette. A site resolves its navigation tree, search index and footer
copy, and passes them in; it does not fork the frame. The rail’s logo row and the header strip
are one `h-13` bar, border included, and `docs-layout.browser.test.tsx` holds them to the same
line.

The [Markdown registry](src/markdown/components/registry.tsx) defines the common docs components.
Pass that registry to `Markdown` when rendering documentation components. Keep `<Frame>` tags
on their own lines, separated from their contents by blank lines. The renderer protects the
tag from HTML’s obsolete `frame` element so the figure and caption survive parsing; code
examples remain literal.
Product documentation follows the [product docs contract](https://github.com/tale-project/tale/blob/main/docs/AGENTS.md); component
examples follow the [design-system docs contract](https://github.com/tale-project/tale/blob/main/services/ui-docs/content/README.md).
Keep prop names, defaults, imports, and keyboard behavior aligned with the actual component.

## Publish alternate page formats

Per-page downloads, page copies and `llms-full.txt` resolve Markdown links and HTML resource
attributes against each source page's URL, so navigation still works outside the site. Code
examples remain literal. Pass the canonical `pageUrl` to `pageAsMarkdown` when the body contains
page-relative destinations or section links; `siteUrl` remains the fallback for existing callers.
Root-relative destinations retain the configured `siteUrl` mount, such as `/docs`. When calling
`buildLlmsFullTxt` directly, pass that site URL as its optional second argument for mounted sites.
`PageActions` accepts a `markdown` callback as well as a string. Use the callback to prepare an
export only when the reader clicks **Copy page**, keeping parsing out of page rendering.

The shared `seo/*` compiler and artifact servers give each per-page Markdown export an
HTTP `Link` header pointing to its equivalent HTML page with `rel="canonical"`. The target
comes from the configured site URL and registered route, including its language and deployment
prefix. Cached and conditional responses preserve the same target. Aggregate `llms.txt` and
`llms-full.txt` files have no equivalent HTML page and receive no canonical header.

With caching enabled, the on-demand server shares route enumeration and coalesces concurrent
builds of the same artifact. `invalidate()` starts a fresh cache generation: older requests may
finish, but cannot replace fresh content or mark a newly available page missing. Failed builds
can retry; `cache: false` keeps development requests independent. The concurrency and invalidation
regressions live in [`on-demand-server.perf.test.ts`](src/seo/runtime/on-demand-server.perf.test.ts).

The optional `canonicalUrl` artifact metadata survives compilation in the v1 manifest; older
manifests still load without it. Only absolute HTTP(S) URLs without credentials, fragments or
control characters are accepted, and URLs are serialized before entering headers. The runtime
parity and validation cases are in [`canonical.test.ts`](src/seo/runtime/canonical.test.ts).
This declares a preferred representation; it does not guarantee indexing. See
[Google's HTTP canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls#rel-canonical-header).

## Validate a change

From the repository root:

```bash
bun run --filter @tale/ui typecheck
bun run --filter @tale/ui lint
bun run --filter @tale/ui test
bun run --filter @tale/ui test:browser
```

The unit project includes component, catalog, and dependency checks. The browser
project exercises controls in Chromium. Run relevant stories and then verify the consuming app’s
real workflow, including keyboard access, accessible names, focus, loading, disabled states, and
error recovery. Follow the [repository contract](https://github.com/tale-project/tale/blob/main/.agents/repo.md) for the remaining gates.
