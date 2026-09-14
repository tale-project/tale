# @tale/ui

Shared React components, hooks, tokens, translations, and Markdown rendering for Tale’s app
interfaces. Consumers import explicit `@tale/ui/<subpath>` exports; their application build
compiles the TypeScript source. Marketing pages use the additional
[`@tale/marketing-ui`](../marketing-ui/README.md) layer.

## Find an existing component

Start with the [design contract](../../design/docs/README.md) and the
[design-system guides](../../services/ui-docs/content/README.md). The
[`package.json` exports map](package.json) defines the public imports; component sources, tests,
and stories live together under `src/components/<family>/`.

| Need | Example imports |
| --- | --- |
| Controls and forms | `button`, `icon-button`, `input`, `select`, `checkbox`, `use-form`, `field-shell` |
| Tables and values | `data-table/data-table`, `data-table/column-builders`, `copyable-field`, `json-viewer` |
| Layout and navigation | `page-layout`, `adaptive-header`, `sub-panel`, `header-breadcrumbs`, `tab-navigation` |
| Dialogs and feedback | `dialog/form-dialog`, `dialog/delete-dialog`, `toaster`, `use-toast`, `query-state` |
| Editing and diagrams | `editor`, `wizard/*`, `catalog/*`, `filters/*`, `flow/*` |
| Shared infrastructure | `i18n/*`, `markdown/*`, `seo/*`, `server`, `monitoring/*`, `theme`, `testing/*` |

Browse interactive stories locally:

```bash
bun run --filter @tale/ui storybook # http://localhost:6006
```

Reusable components take state and events through props or a small context. Organization
branding, permissions, backend queries, and other business behavior belong in the consuming
service’s wrappers. Use the shared tokens, control sizes, and interaction patterns instead of
copying a service component into a second location.

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
web and docs omit it and mount `LocaleSync` with the route’s locale. `theme` enables the shared
provider with its system preference default. Routing, authentication, and query providers
remain the host’s responsibility.

## Install from another repository

The [package publishing workflow](../../.github/workflows/publish-packages.yml) exports each
package as a repository-root snapshot. Install the `dist/ui` branch with
`github:tale-project/tale#dist/ui`, or select a published `ui-v<version>` tag for a reproducible
release. These are Git dependencies, not npm registry releases. Install the required peers
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
[translation skill](../../.agents/skills/write-translations/SKILL.md).

The [Markdown registry](src/markdown/components/registry.tsx) defines the common docs components.
Product documentation follows the [product docs contract](../../docs/AGENTS.md); component
examples follow the [design-system docs contract](../../services/ui-docs/content/README.md).
Keep prop names, defaults, imports, and keyboard behavior aligned with the actual component.

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
error recovery. Follow the [repository contract](../../.agents/repo.md) for the remaining gates.
