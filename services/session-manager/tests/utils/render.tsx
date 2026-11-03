import { AdaptiveHeaderProvider } from '@tale/ui/adaptive-header';
import { AppShell } from '@tale/ui/app-shell';
import { Toaster } from '@tale/ui/toaster';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  renderHook,
  type RenderHookOptions,
  type RenderOptions,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';

import { i18n } from '@/lib/i18n/i18n';

/** A client for one test: no retries, no cache that outlives it. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createProviders(queryClient: QueryClient) {
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </AppShell>
    );
  };
}

interface RenderAppOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
}

/**
 * Renders a component the way the app mounts it: the shared providers (theme,
 * translations, tooltips) and a query client of its own. A component that
 * needs the router mocks `@tanstack/react-router` with `createRouterStub`.
 */
export function renderApp(
  ui: ReactElement,
  { queryClient = createTestQueryClient(), ...options }: RenderAppOptions = {},
) {
  return {
    user: userEvent.setup(),
    queryClient,
    ...render(ui, { wrapper: createProviders(queryClient), ...options }),
  };
}

interface RenderHookAppOptions<Props> extends Omit<
  RenderHookOptions<Props>,
  'wrapper'
> {
  queryClient?: QueryClient;
}

/** The same providers around a hook. */
export function renderHookApp<Result, Props = undefined>(
  hook: (props: Props) => Result,
  {
    queryClient = createTestQueryClient(),
    ...options
  }: RenderHookAppOptions<Props> = {},
) {
  return {
    queryClient,
    ...renderHook(hook, { wrapper: createProviders(queryClient), ...options }),
  };
}

/**
 * The same, as the shell mounts a page: its header registers with the adaptive
 * header's provider, and the toasts it raises have a viewport.
 */
export function renderInShell(ui: ReactElement) {
  return renderApp(
    <AdaptiveHeaderProvider>
      {ui}
      <Toaster />
    </AdaptiveHeaderProvider>,
  );
}
