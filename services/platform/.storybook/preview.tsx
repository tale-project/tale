import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';
import { ThemeContext } from '@tale/ui/theme';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { DecoratorFunction } from 'storybook/internal/types';

import { i18n } from '../lib/i18n/i18n';

import '../app/globals.css';

const rootRoute = createRootRoute();
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
});
const orgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/$id',
});
rootRoute.addChildren([indexRoute, orgRoute]);

function createStoryRouter() {
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({
      initialEntries: ['/dashboard/storybook-org'],
    }),
  });
}

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
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <RouterProvider router={router} defaultComponent={() => <Story />} />
      </AppShell>
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
