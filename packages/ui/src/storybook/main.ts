// Shared Storybook framework + addon + core config for every Tale service
// that runs Storybook (platform, web, docs, and @tale/ui itself). Consumer
// `.storybook/main.ts` files defer to `defineStorybookMain({...})` and pass
// just the bits that vary between services: which globs to scan for stories,
// optional `staticDirs`, and an optional `viteFinal` hook for path aliases.

import type { StorybookConfig } from '@storybook/react-vite';
import type { UserConfig } from 'vite';

import { yamlImports } from '../vite/yaml';

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

  // Every Tale storybook imports the i18n catalogs (messages/*.yml) through
  // its story graph, so the yaml plugin has to be present for the real module
  // load — AND rolldown's PRODUCTION dependency scan doesn't run Vite
  // transforms, so it would parse the imported YAML as JS and die ("Invalid
  // Character —"). Discovery only warms the pre-bundle cache for a one-shot
  // build, so skip it there; dev keeps it. Centralized here so all four
  // storybooks (platform, web, docs, @tale/ui) inherit both, then the
  // consumer's own viteFinal (path aliases) runs on top.
  config.viteFinal = async (viteConfig, builderOptions) => {
    const { mergeConfig } = await import('vite');
    const merged = mergeConfig(viteConfig, {
      plugins: [yamlImports()],
      ...(builderOptions.configType === 'PRODUCTION'
        ? { optimizeDeps: { noDiscovery: true } }
        : {}),
    });
    return viteFinal ? viteFinal(merged) : merged;
  };

  return config;
}
