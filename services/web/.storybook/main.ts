import { resolve } from 'node:path';

import { defineStorybookMain } from '@tale/ui/storybook/main';

export default defineStorybookMain({
  stories: ['../app/**/*.stories.@(ts|tsx)'],
  staticDirs: ['../public'],
  async viteFinal(viteConfig, { configType }) {
    const { mergeConfig } = await import('vite');
    return mergeConfig(viteConfig, {
      // The static build dies in rolldown's dependency SCAN: it walks the
      // story imports into the i18n catalogs (messages/*.yml) without running
      // the project's yamlImports transform (the plugin IS inherited and
      // handles the real module load fine). Discovery only warms the dep
      // cache, so skip it for the one-shot build; dev keeps it.
      ...(configType === 'PRODUCTION'
        ? { optimizeDeps: { noDiscovery: true } }
        : {}),
      resolve: {
        alias: {
          '@': resolve(import.meta.dirname, '..'),
        },
      },
    });
  },
});
