import type { Preview, ReactRenderer } from '@storybook/react';
import type { DecoratorFunction } from 'storybook/internal/types';

import {
  DocsContainer,
  type DocsContainerProps,
} from '@storybook/addon-docs/blocks';
import { withThemeByClassName } from '@storybook/addon-themes';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { ThemeContext } from '../app/components/theme/theme-provider';
import { I18nProvider } from '../lib/i18n/i18n-provider';
import { taleDarkTheme, taleLightTheme } from './theme';
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
  Story: Parameters<DecoratorFunction<ReactRenderer>>[0];
  context: Parameters<DecoratorFunction<ReactRenderer>>[1];
}) {
  const [router] = useState(createStoryRouter);
  const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';

  const themeValue = useMemo(
    () => ({
      theme: currentTheme,
      resolvedTheme: currentTheme,
      setTheme: () => {},
    }),
    [currentTheme],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <I18nProvider>
        <RouterProvider router={router} defaultComponent={() => <Story />} />
      </I18nProvider>
    </ThemeContext.Provider>
  );
}

function ThemedDocsContainer({
  children,
  ...props
}: React.PropsWithChildren<DocsContainerProps>) {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(el.classList.contains('dark'));
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <DocsContainer {...props} theme={isDark ? taleDarkTheme : taleLightTheme}>
      {children}
    </DocsContainer>
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
    docs: {
      container: ThemedDocsContainer,
    },
    layout: 'centered',
    backgrounds: { disable: true },
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: true },
          { id: 'label', enabled: true },
          { id: 'button-name', enabled: true },
        ],
      },
      options: {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21aa'],
        },
      },
    },
  },
  decorators: [
    (Story, context) => <WithProviders Story={Story} context={context} />,
    withThemeByClassName<ReactRenderer>({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
  ],
  initialGlobals: {
    theme: 'light',
  },
};

export default preview;
