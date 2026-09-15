---
title: Installation
description: Connect source imports, styles, translations, and providers to render your first Tale control.
---

The packages ship React and TypeScript source. A working installation needs a compatible source-consuming build tool, the shared stylesheet, the package message catalog, and `AppShell`. The examples below use Tale's Bun, Vite, React 19, and Tailwind 4 setup.

## Add the package

Inside this monorepo, add the workspace dependency to the service that uses it and run `bun install` from the repository root:

```json
{
  "dependencies": {
    "@tale/ui": "workspace:*"
  }
}
```

Add `"@tale/marketing-ui": "workspace:*"` only if that service renders marketing components. Existing services may already have these dependencies; check their `package.json` before changing it.

### Consume it from another repository

The release workflow publishes each package as a root-level Git snapshot. For a trial installation:

```bash
bun add 'github:tale-project/tale#dist/ui' react@19 react-dom@19 tailwindcss@4
bun add --dev vite @vitejs/plugin-react @tailwindcss/vite typescript @types/react @types/react-dom
```

For marketing components, also install `github:tale-project/tale#dist/marketing-ui`. That package requires `@tale/ui` as a peer.

For a reproducible release, replace the moving branch with a published `ui-v<version>` tag and, when used, its matching `marketing-ui-v<version>` tag. `<version>` is a placeholder, not a tag to install literally. Commit the resulting lockfile. To deliberately refresh a moving Git dependency, use `bun install --force` and review the lockfile changes.

The packages' export maps point at TypeScript source. Run Vite through Bun (`bun --bun vite` and `bun --bun vite build`), as the Tale service scripts do. Use TypeScript's bundler module resolution and React JSX transform. Inside Tale-project repositories, select the appropriate shared `tsconfig` family rather than adding workspace-specific compiler options.

## Load Tailwind and YAML

This Vite configuration handles React, Tailwind, and the YAML files imported by the translation catalogs:

```ts
// vite.config.ts
import { yamlImports } from '@tale/ui/vite/yaml';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [yamlImports(), react(), tailwindcss()],
});
```

Load the application stylesheet from your entry module:

```css
/* src/globals.css */
@import '@tale/ui/globals.css';
```

For a marketing site, use `@import '@tale/marketing-ui/globals.css';` instead. Each stylesheet declares the package source that Tailwind must scan. Keep your own application source within Tailwind's scan as well.

## Render a first control

This complete client entry assumes `index.html` contains `<div id="root"></div>`. It uses the package's translations with empty service catalogs; replace those catalogs when you add application-specific copy.

```tsx
// src/main.tsx
import { AppShell } from '@tale/ui/app-shell';
import { Button } from '@tale/ui/button';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';
import { Input } from '@tale/ui/input';
import { createRoot } from 'react-dom/client';
import './globals.css';

const i18n = initServiceI18n({
  bundles: { en: {}, de: {}, fr: {} },
  regional: {},
  packages: [uiMessages],
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');

createRoot(root).render(
  <AppShell i18n={i18n} locale={{ mode: 'client' }} theme>
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <Input label="Preview name" defaultValue="First component" />
      <Button type="button" title="This is a local preview">
        Preview
      </Button>
    </main>
  </AppShell>,
);
```

`AppShell` mounts the translation and tooltip providers and imports Inter. `theme` enables light, dark, and system preferences. Client locale mode detects a saved or browser language. A URL-driven site should omit client locale mode and synchronize its route language instead; see [Internationalization](/docs/getting-started/i18n).

Start the development server with `bun --bun vite`. The input should have a visible outline, the button should be 36px high, and its tooltip should appear on keyboard focus or hover. The button deliberately has no save callback.

<Demo name="button/variants" />

## Troubleshoot setup

| Symptom | Check |
| --- | --- |
| Components render without styling | Import the stylesheet from the entry that Vite actually loads, and enable the Tailwind plugin. |
| YAML import or parse errors | Register `yamlImports()` before importing the service or package catalogs. |
| A label renders as a dotted key | Include `uiMessages` in `packages`; add `marketingUiMessages` when rendering marketing components. |
| Theme controls do nothing | Mount `AppShell` with `theme` and import the themed stylesheet. |
| A package import fails | Check its public export path and the installed snapshot; avoid private filesystem imports. |
| A router link fails outside routing context | Mount your router before using `LinkButton` or `TabNavigation`; the first-control example above needs no router. |

PWA and Storybook support have additional optional peers. Install them only when using those exported integrations, following the package's `peerDependencies` and `peerDependenciesMeta`.
