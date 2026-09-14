---
title: Installation
description: Wire the packages up inside the Tale monorepo, or install them from GitHub into a repository of your own.
---

There are two ways to consume the design system, and which one you need depends
on where your code lives. Inside the Tale monorepo the packages are workspace
dependencies and everything is already connected. Outside it, you pin a GitHub
snapshot and satisfy a short list of requirements — the packages ship
TypeScript source rather than a build, so the toolchain has to be able to read
it.

By the end of this page you will have `@tale/ui` rendering a real button, with
its stylesheet, its message catalog and its providers mounted.

## Inside the Tale monorepo

Every workspace already depends on the packages:

```json
{
  "dependencies": {
    "@tale/ui": "workspace:*",
    "@tale/marketing-ui": "workspace:*"
  }
}
```

Import through a subpath and you are done:

```tsx
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
```

## In another repository

Bun cannot install a git subdirectory, so each package is published as a
**root-level snapshot branch and tag** of the Tale repository. Pin it with a
GitHub URL:

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

`@tale/marketing-ui` is a separate branch, and it takes `@tale/ui` as a peer —
install both:

```json
{
  "dependencies": {
    "@tale/marketing-ui": "github:tale-project/tale#dist/marketing-ui",
    "@tale/ui": "github:tale-project/tale#dist/ui"
  }
}
```

> [!IMPORTANT]
> Bun caches a git dependency **by ref**. A moving branch like `dist/ui` only
> advances after `bun install --force` (or `bun pm cache rm`). Pin a release
> tag — `#ui-v<version>` and `#marketing-ui-v<version>`, cut by the
> `publish-packages` workflow on every Tale release — when you want a
> reproducible install.

### Requirements on the consumer side

**Vite plus Tailwind v4, run through Bun.** The package ships TypeScript
source, and Node refuses to strip types under `node_modules`, so `vite.config.ts`
must load under Bun — `bun --bun vite`, `bun --bun vite build`, exactly the
scripts every Tale service uses.

Register the YAML catalog loader in your Vite config:

```ts
// vite.config.ts
import { yamlImports } from '@tale/ui/vite/yaml';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [yamlImports(), react()] });
```

`yamlImports` is what makes `import enMessages from '@/messages/en.yml'`
resolve. Without it the i18n catalogs fail to load and every string renders as
its raw dotted key.

**One stylesheet import.** Your `globals.css` is one line:

```css
@import '@tale/ui/globals.css';
```

Use `@import '@tale/marketing-ui/globals.css';` instead if you need the
marketing vocabulary — it pulls the app one in.

**TypeScript** with `moduleResolution: "bundler"` and `jsx: "react-jsx"`. In a
Tale-project repository that means extending the shared `tsconfig` family; a
workspace `tsconfig.json` carries exactly one key, `extends`.

**Peers**: `react`, `react-dom`, `tailwindcss` for `@tale/ui`, plus `@tale/ui`
itself for `@tale/marketing-ui`. `vite` and `vite-plugin-pwa` are only needed
for the PWA plugin, and the `storybook` family only for the shared Storybook
config. The packages' own `dependencies` are complete — a guard test fails when
a source import is undeclared — so nothing else needs installing.

## Mount the providers once

`AppShell` is the standard provider stack: theme, tooltips, locale and i18n, in
the order that matters. Mount it once, above your router:

```tsx
import { AppShell } from '@tale/ui/app-shell';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';
import { RouterProvider } from '@tanstack/react-router';

const i18n = initServiceI18n({ bundles, regional, global, packages: [uiMessages] });

<AppShell i18n={i18n} locale={{ mode: 'client' }} theme>
  <RouterProvider router={router} />
</AppShell>;
```

Two details are load-bearing:

- **`packages: [uiMessages]`** merges the package's own catalog under your
  service's keys. Skip it and every `@tale/ui` component renders raw keys where
  its labels should be. Add `marketingUiMessages` from
  `@tale/marketing-ui/i18n/messages` when you use the marketing package too.
- **`theme`** mounts `ThemeProvider` with the canonical `'system'` default.
  Omit it only when your service deliberately never toggles the `.dark` class.

## Check that it worked

Render a button and a field. If the button is the right height (`h-9`), the
field has a visible border, and neither shows a raw `common.actions.save`-style
key, all four pieces — source resolution, stylesheet, Tailwind scan and
catalog — are connected.

<Demo name="button/variants" />

## Where to go next

Read [Theming](/docs/getting-started/theming) for the token vocabularies and
dark mode, then [i18n](/docs/getting-started/i18n) for how a component finds
its strings. If something renders unstyled, the stylesheet import is the usual
culprit — `@tale/ui/globals.css` carries the `@source` directive that scans the
package's own source, so a consumer never lists it by hand; import the file
once, from the stylesheet Vite loads.
