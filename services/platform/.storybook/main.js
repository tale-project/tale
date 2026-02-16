process.env.SITE_URL ??= 'http://localhost:6006';

/** @type {import('@storybook/react-vite').StorybookConfig} */
const config = {
  stories: [
    '../app/components/ui/**/*.stories.@(ts|tsx)',
    '../app/components/icons/**/*.stories.@(ts|tsx)',
    '../app/components/theme/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-themes',
    '@storybook/addon-vitest',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  staticDirs: ['../public'],
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },
  features: {
    sidebarOnboardingChecklist: false,
  },
  docs: {
    autodocs: 'tag',
  },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    const path = await import('path');
    return mergeConfig(config, {
      resolve: {
        alias: {
          '@': path.resolve(import.meta.dirname, '..'),
        },
      },
      define: {
        'process.env': {},
      },
    });
  },
};

export default config;
