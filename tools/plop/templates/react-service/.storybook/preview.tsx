import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import type { DecoratorFunction } from 'storybook/internal/types';

import { i18n } from '../lib/i18n/i18n';

import '../app/globals.css';

const rootRoute = createRootRoute();

function createStoryRouter() {
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

/**
 * Wraps every story in the same provider stack `app/main.tsx` uses so
 * `useT(...)`, `useLocale()`, and any `<Link>`-based components resolve
 * the way they would in the running app.
 */
function WithProviders({
  Story,
}: {
  Story: Parameters<DecoratorFunction>[0];
}) {
  const router = createStoryRouter();
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      <RouterProvider router={router} defaultComponent={() => <Story />} />
    </AppShell>
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
    (Story) => <WithProviders Story={Story} />,
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
