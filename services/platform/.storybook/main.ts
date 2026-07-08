import { resolve } from 'node:path';

import { defineStorybookMain } from '@tale/ui/storybook/main';

process.env.SITE_URL ??= 'http://localhost:6006';

export default defineStorybookMain({
  stories: [
    '../app/components/catalog/**/*.stories.@(ts|tsx)',
    '../app/components/ui/**/*.stories.@(ts|tsx)',
    '../app/components/icons/**/*.stories.@(ts|tsx)',
    '../app/components/theme/**/*.stories.@(ts|tsx)',
    '../app/components/metrics/**/*.stories.@(ts|tsx)',
  ],
  staticDirs: ['../public'],
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import('vite');
    return mergeConfig(viteConfig, {
      resolve: {
        alias: {
          '@': resolve(import.meta.dirname, '..'),
        },
      },
      define: {
        'process.env': {},
      },
    });
  },
});
