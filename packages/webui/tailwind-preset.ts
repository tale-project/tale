import uiPreset from '@tale/ui/tailwind-preset';
import type { Config } from 'tailwindcss';

/**
 * Tailwind preset shared by `services/web` and `services/docs`. Layers the
 * marketing-site `--color-bg-*` / `--color-fg-*` / `--color-border-*` /
 * `--color-accent-*` token names on top of the base `@tale/ui` preset so
 * both apps can use utilities like `text-fg-base`, `bg-bg-elevated`, and
 * `border-border-base` without redeclaring them.
 */
const preset: Config = {
  presets: [uiPreset],
  content: [],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'var(--color-bg-base)',
          elevated: 'var(--color-bg-elevated)',
          muted: 'var(--color-bg-muted)',
        },
        fg: {
          base: 'var(--color-fg-base)',
          muted: 'var(--color-fg-muted)',
        },
        border: {
          base: 'var(--color-border-base)',
          strong: 'var(--color-border-strong)',
        },
        accent: {
          base: 'var(--color-accent-base)',
        },
      },
    },
  },
};

export default preset;
