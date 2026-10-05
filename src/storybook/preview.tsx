// Shared Storybook preview defaults: controls matcher, layout, a11y rules,
// the canonical mobile/tablet/desktop viewports, and the addon-themes
// light/dark decorator. Each service's `.storybook/preview.tsx` spreads this
// into its own `Preview` so additional service-specific decorators (router,
// AppShell, etc.) can be layered on top.

import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';

export const sharedStorybookParameters: Preview['parameters'] = {
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/i,
    },
  },
  layout: 'centered',
  a11y: {
    options: {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
      },
    },
  },
  viewport: {
    viewports: {
      iphone14Pro: {
        name: 'iPhone 14 Pro',
        styles: { width: '393px', height: '852px' },
        type: 'mobile',
      },
      pixel7: {
        name: 'Pixel 7',
        styles: { width: '412px', height: '915px' },
        type: 'mobile',
      },
      ipadMini: {
        name: 'iPad Mini',
        styles: { width: '768px', height: '1024px' },
        type: 'tablet',
      },
      desktop: {
        name: 'Desktop',
        styles: { width: '1280px', height: '800px' },
        type: 'desktop',
      },
    },
  },
};

/**
 * The canonical light/dark decorator backed by addon-themes. Toggling the
 * theme in the Storybook toolbar swaps the `dark` class on `<html>`; services
 * with stateful theme contexts (e.g. the platform's `ThemeContext` provider)
 * layer their own decorator on top to bridge the global into provider state.
 */
export const themeClassDecorator = withThemeByClassName({
  themes: { light: '', dark: 'dark' },
  defaultTheme: 'light',
});

export const sharedStorybookInitialGlobals: Preview['initialGlobals'] = {
  theme: 'light',
};

/**
 * Drop-in `Preview` for services with no additional providers (the `@tale/ui`
 * package itself uses a richer one because its stories need a router + i18n
 * context). Web and docs use this directly.
 */
export const sharedStorybookPreview: Preview = {
  parameters: sharedStorybookParameters,
  decorators: [themeClassDecorator],
  initialGlobals: sharedStorybookInitialGlobals,
};
