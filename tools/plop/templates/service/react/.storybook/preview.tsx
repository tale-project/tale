import type { Preview } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';
import {
  sharedStorybookInitialGlobals,
  sharedStorybookParameters,
  themeClassDecorator,
} from '@tale/ui/storybook/preview';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { useState } from 'react';
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
  const [router] = useState(createStoryRouter);
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      <RouterProvider router={router} defaultComponent={() => <Story />} />
    </AppShell>
  );
}

const preview: Preview = {
  parameters: sharedStorybookParameters,
  decorators: [
    (Story) => <WithProviders Story={Story} />,
    themeClassDecorator,
  ],
  initialGlobals: sharedStorybookInitialGlobals,
};

export default preview;
