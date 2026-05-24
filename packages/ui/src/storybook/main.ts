// Shared Storybook framework + addon + core config for every Tale service
// that runs Storybook (platform, web, docs, and @tale/ui itself). Consumer
// `.storybook/main.ts` files defer to `defineStorybookMain({...})` and pass
// just the bits that vary between services: which globs to scan for stories,
// optional `staticDirs`, and an optional `viteFinal` hook for path aliases.

import type { StorybookConfig } from '@storybook/react-vite';
import type { UserConfig } from 'vite';

export interface DefineStorybookMainOptions {
  /** Story glob patterns, resolved relative to the consumer's `.storybook/` dir. */
  stories: StorybookConfig['stories'];
  /** Public dirs served at the Storybook root (e.g. `['../public']`). */
  staticDirs?: StorybookConfig['staticDirs'];
  /**
   * Additional Vite config merged on top of the framework defaults — used by
   * services to declare the `@` path alias and any `define` shims.
   */
  viteFinal?: (config: UserConfig) => UserConfig | Promise<UserConfig>;
  /** Extra addons appended after the canonical set. */
  extraAddons?: StorybookConfig['addons'];
}

/**
 * Canonical Storybook config for the Tale monorepo. Locks down the framework
 * (react-vite), the addon set (a11y, docs, themes, vitest), telemetry / what's
 * new opt-outs, and the autodocs tag.
 */
export function defineStorybookMain(
  options: DefineStorybookMainOptions,
): StorybookConfig {
  const { stories, staticDirs, viteFinal, extraAddons = [] } = options;

  const config: StorybookConfig = {
    stories,
    addons: [
      '@storybook/addon-a11y',
      '@storybook/addon-docs',
      '@storybook/addon-themes',
      '@storybook/addon-vitest',
      ...extraAddons,
    ],
    framework: {
      name: '@storybook/react-vite',
      options: {},
    },
    core: {
      disableTelemetry: true,
      disableWhatsNewNotifications: true,
    },
    features: {
      sidebarOnboardingChecklist: false,
    },
  };

  if (staticDirs) config.staticDirs = staticDirs;
  if (viteFinal) config.viteFinal = viteFinal;

  return config;
}
