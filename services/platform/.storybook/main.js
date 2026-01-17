/** @type {import('@storybook/react-vite').StorybookConfig} */
const config = {
  stories: [
    '../app/components/ui/**/*.stories.@(ts|tsx)',
    '../app/components/ui/**/*.mdx',
    '../app/components/icons/**/*.stories.@(ts|tsx)',
    '../app/components/skeletons/**/*.stories.@(ts|tsx)',
    '../app/components/layout/**/*.stories.@(ts|tsx)',
    '../app/components/theme/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-interactions',
    '@storybook/addon-links',
    '@storybook/addon-themes',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  staticDirs: ['../public'],
  docs: {
    autodocs: 'tag',
  },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    const path = await import('path');
    return mergeConfig(config, {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '..'),
        },
      },
      define: {
        'process.env': {},
      },
    });
  },
};

export default config;
