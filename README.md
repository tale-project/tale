# @tale/ui

The Tale design system for the **app language** — the React components, hooks,
tokens, i18n glue and markdown pipeline the platform, the docs and every
Tale-project repository build on. The marketing language lives next door in
`@tale/marketing-ui`.

```bash
bun run --filter @tale/ui typecheck
bun run --filter @tale/ui lint
bun run --filter @tale/ui test          # jsdom component tests + the catalog gates
bun run --filter @tale/ui test:browser  # real-Chromium component tests
bun run --filter @tale/ui storybook     # http://localhost:6006
```

## What is inside

Source-consumed — no build step; consumers import `@tale/ui/<subpath>` straight
from `src/` (the `exports` map in `package.json` is the public surface, one
subpath per module).

| Area                       | Subpaths (examples)                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Primitives & typography    | `button`, `icon-button`, `image`, `heading`, `text`, `badge`                                                              |
| Forms                      | `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `date-range-picker`, `file-upload`, `use-form`, `field-shell` |
| Data display & tables      | `data-table/data-table`, `data-table/column-builders`, `copyable-field`, `json-viewer`, `document-icon`, `labeled-value`  |
| Layout & navigation        | `layout`, `card`, `adaptive-header`, `page-layout`, `sticky-header`, `sub-panel`, `header-breadcrumbs`, `tab-navigation`  |
| Overlays & dialogs         | `tooltip`, `popover`, `dropdown-menu`, `sheet`, `dialog/dialog`, `dialog/form-dialog`, `dialog/delete-dialog`             |
| Feedback                   | `toaster` + `use-toast`, `skeleton`, `spinner`, `alert`, `query-state`, `error-boundaries/*`                              |
| Editors & flows            | `editor` (save/cancel controllers, dirty blocker), `wizard/*`, `filters/*`, `catalog/*`, `metrics/*`, `flow/*`            |
| Foundations                | `globals.css` (tokens + base), `cn`, `format`, `date`, `theme`, `accent-color`, `icons/*`                                 |
| i18n                       | `i18n/init-service`, `i18n/messages` (the catalog every component reads), `i18n/client` (`useT`), `i18n/tests`            |
| Markdown, SEO, server, PWA | `markdown/*`, `seo/*`, `server`, `monitoring/*`, `pwa/*`, `vite/yaml`, `storybook/*`                                      |

Rules of the house — [`design/docs/`](../../design/docs/) is the contract:

- **Tokens only.** Every colour resolves through a semantic utility mapped in
  `src/globals.css` (`bg-bg-base`, `text-fg-muted`, `border-border-base`, the
  HSL `bg-background` / `text-foreground` family); never a raw hex or grey.
- **One control height** (`h-9`; `sm` is `h-8`), Inter only, Lucide only,
  `Card` is the one bordered surface, skeletons mask in place.
- **Strings ship in the catalog.** A component calls `useT('<namespace>')`
  and the key lives in `src/i18n/messages/{en,de,fr}.yml` (+ `de-CH.yml`
  overrides). `src/i18n/messages.test.ts` fails on a missing or orphan key.
- **Business logic stays in the service.** A component takes what it needs
  through props or a small context (`ErrorScopeProvider`, `AccentColorProvider`)
  — never an org id, an ability or a backend query of its own.

## Using it inside this monorepo

Every workspace already depends on it (`"@tale/ui": "workspace:*"`):

```tsx
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
```

and mounts the shared providers once:

```tsx
import { AppShell } from '@tale/ui/app-shell';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';

const i18n = initServiceI18n({ bundles, regional, global, packages: [uiMessages] });

<AppShell i18n={i18n} locale={{ mode: 'client' }} theme>
  <RouterProvider router={router} />
</AppShell>;
```

Stylesheet: the service's `globals.css` is one line, `@import '@tale/ui/globals.css';`.

## Using it from another repository

The package is published as a root-level snapshot branch and tag of this
repository (Bun cannot install a git subdirectory), so a consumer pins it with
a GitHub URL:

```json
{
  "dependencies": {
    "@tale/ui": "github:tale-project/tale#dist/ui",
    "react": "19.2.5",
    "react-dom": "19.2.5",
    "tailwindcss": "4.2.2"
  }
}
```

Pin a release instead of the moving branch with `#ui-v<version>` (the tags the
`publish-packages` workflow cuts on every Tale release) — Bun caches a git
dependency by ref, so a moving branch only advances after
`bun install --force` (or `bun pm cache rm`), while a tag is reproducible.
Requirements on the consumer side:

- **Vite + Tailwind v4, run through Bun** (the package ships TypeScript
  source, not a build — Node refuses to strip types under `node_modules`, so
  `vite.config.ts` must load under Bun: `bun --bun vite build`, exactly the
  scripts every Tale service uses). Register the YAML catalog loader and the
  package's stylesheet:

  ```ts
  // vite.config.ts
  import { yamlImports } from '@tale/ui/vite/yaml';
  export default defineConfig({ plugins: [yamlImports(), react()] });
  ```

  ```css
  /* globals.css */
  @import '@tale/ui/globals.css';
  ```

- **TypeScript** with `moduleResolution: "bundler"` and `jsx: "react-jsx"` —
  the same `tsconfig` family every Tale-project repository extends.
- **Peers**: `react`, `react-dom`, `tailwindcss`; `vite`/`vite-plugin-pwa`
  only for the PWA plugin, the `storybook` family only for the shared Storybook
  config.

The package's own `dependencies` are complete (a guard test fails when a source
import is undeclared), so nothing else needs installing.

## Layout

```
src/
  components/<family>/   one folder per component family (+ tests + stories)
  hooks/                 use-toast, use-copy, use-is-mobile, use-resize-observer, …
  lib/                   cn, format, date, structural-equal, string, …
  i18n/                  init glue, the catalog (messages/*.yml), the test framework
  markdown/  seo/  server/  monitoring/  pwa/  theme/  icons/  storybook/  vite/
  testing/               helpers consumers' tests may import (@tale/ui/testing/*)
tests/                   vitest setup + the render / a11y utilities of this package
```
