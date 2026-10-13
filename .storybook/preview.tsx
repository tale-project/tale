import type { Preview } from '@storybook/react';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';
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
  createRouter,
} from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { DecoratorFunction } from 'storybook/internal/types';

import { marketingUiMessages } from '../src/i18n/messages';

import '../src/globals.css';

// Bootstraps i18next with both design-system catalogs so any story whose
// component calls `useT(...)` resolves real translations instead of raw key
// names. Service consumers initialise the same way from their
// `lib/i18n/i18n.ts`; Storybook is the standalone harness.
initServiceI18n({
  bundles: { en: {}, de: {}, fr: {} },
  regional: {},
  packages: [uiMessages, marketingUiMessages],
});

const rootRoute = createRootRoute();

function createStoryRouter() {
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

/**
 * Bridges addon-themes' html-class toggle into the React `ThemeContext` and
 * provides a memory router: the marketing links render through TanStack's
 * `Link` unless a host mounts `MarketingRouterProvider`, so every story that
 * links somewhere needs a router in scope.
 */
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
      <RouterProvider router={router} defaultComponent={() => <Story />} />
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
