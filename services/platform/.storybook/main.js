/** @type {import('@storybook/react-vite').StorybookConfig} */
const config = {
  stories: [
    '../components/ui/**/*.stories.@(ts|tsx)',
    '../components/ui/**/*.mdx',
    '../components/icons/**/*.stories.@(ts|tsx)',
    '../components/skeletons/**/*.stories.@(ts|tsx)',
    '../components/layout/**/*.stories.@(ts|tsx)',
    '../components/theme/**/*.stories.@(ts|tsx)',
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
