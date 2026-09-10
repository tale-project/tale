import type { Preview } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';
import {
  sharedStorybookInitialGlobals,
  sharedStorybookParameters,
  themeClassDecorator,
} from '@tale/ui/storybook/preview';
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
import { sb } from 'storybook/test';

import { i18n } from '../lib/i18n/i18n';

import '../app/globals.css';

// Connected settings stories supply their own data and mutations. Spy mode
// preserves the real implementations for stories that do not override them.
sb.mock(import('../app/features/settings/branding/hooks/mutations.ts'), {
  spy: true,
});
sb.mock(import('../app/features/settings/governance/hooks/mutations.ts'), {
  spy: true,
});
sb.mock(import('../app/features/settings/governance/hooks/queries.ts'), {
  spy: true,
});
sb.mock(import('../app/features/settings/organization/hooks/queries.ts'), {
  spy: true,
});
sb.mock(import('../app/features/settings/teams/hooks/queries.ts'), {
  spy: true,
});

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
  const resolvedTheme: 'dark' | 'light' =
    context.globals.theme === 'dark' ? 'dark' : 'light';

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
  parameters: sharedStorybookParameters,
  decorators: [
    (Story, context) => <WithProviders Story={Story} context={context} />,
    themeClassDecorator,
  ],
  initialGlobals: sharedStorybookInitialGlobals,
};

export default preview;
