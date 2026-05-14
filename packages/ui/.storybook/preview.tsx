import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { DecoratorFunction } from 'storybook/internal/types';

import { initServiceI18n } from '../src/i18n/init-service';
import { uiMessages } from '../src/i18n/messages';
import { ThemeContext } from '../src/theme';

import '../src/globals.css';
import '../src/markdown/globals.css';

// Bootstraps i18next with the package's own bundles so any story whose
// component calls `useT(...)` resolves real translations instead of
// rendering raw key names. Service consumers initialise the same way
// from their `lib/i18n/i18n.ts`; Storybook is the standalone harness.
initServiceI18n({
  bundles: { en: {}, de: {}, fr: {} },
  regional: {},
  packages: [uiMessages],
});

const rootRoute = createRootRoute();

function createStoryRouter() {
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

/**
 * Bridges addon-themes' html-class toggle into the React `ThemeContext` so
 * components reading `useTheme()` (CodeBlock, Mermaid, etc.) see the same
 * state Storybook shows, and provides a memory router for Link-based stories.
 */
function WithProviders({
  Story,
  context,
}: {
  Story: Parameters<DecoratorFunction>[0];
  context: Parameters<DecoratorFunction>[1];
}) {
  const [router] = useState(createStoryRouter);
  const resolvedTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
  const themeValue = useMemo(
    () => ({
      theme: resolvedTheme,
      resolvedTheme,
      setTheme: () => {},
    }),
    [resolvedTheme],
  );
  return (
    <ThemeContext.Provider value={themeValue}>
      <RouterProvider router={router} defaultComponent={() => <Story />} />
    </ThemeContext.Provider>
  );
}

const preview: Preview = {
  parameters: {
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
  },
  decorators: [
    (Story, context) => <WithProviders Story={Story} context={context} />,
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
  ],
  initialGlobals: {
    theme: 'light',
  },
};

export default preview;
