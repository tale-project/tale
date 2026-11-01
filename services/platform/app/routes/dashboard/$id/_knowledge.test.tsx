import { AdaptiveHeaderProvider } from '@tale/ui/adaptive-header';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouteComponent,
} from '@tanstack/react-router';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useListContactsPaginated } from '@/app/features/contacts/hooks/queries';
import { useListKnowledgeEntriesPaginated } from '@/app/features/knowledge-entries/hooks/queries';
import { useListProductsPaginated } from '@/app/features/products/hooks/queries';
import { useListWebsitesPaginated } from '@/app/features/websites/hooks/queries';
import type { PaginatedStatus } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { enMessages } from '@/tests/utils/messages';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { Route } from './_knowledge';
import { Route as ContactsRoute } from './_knowledge/contacts';
import { Route as KnowledgeEntriesRoute } from './_knowledge/knowledge-entries';
import { Route as ProductsRoute } from './_knowledge/products';
import { Route as WebsitesRoute } from './_knowledge/websites';

// Only the transport is stubbed: the loaders, the cache and the listing hooks
// are the app's own.
const { read } = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: read,
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

const labels = enMessages.knowledge;

type Loader = (args: {
  context: { queryClient: QueryClient };
  params: { id: string };
}) => unknown;

interface TabPage {
  path: string;
  loader?: Loader;
  component: RouteComponent;
}

// The real router, the real layout and its real strip, so a switch runs as it
// does in the app: the strip preloads every tab as it renders, the location
// names the next tab at once, and the outlet keeps the current page until the
// next tab's loader settles. Documents is where Knowledge opens; `tabs` holds
// the other four.
function renderKnowledge(tabs: TabPage[]) {
  const queryClient = new QueryClient({
    // The app's stale window (`app/router.tsx`): a page that mounts on fresh
    // rows does not ask for them again.
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
  });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: () => (
      <AdaptiveHeaderProvider>
        <Outlet />
      </AdaptiveHeaderProvider>
    ),
  });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$id',
    component: Outlet,
  });
  const knowledge = createRoute({
    getParentRoute: () => dashboard,
    id: '_knowledge',
    component: Route.options.component,
  });
  const documents = createRoute({
    getParentRoute: () => knowledge,
    path: 'documents',
    component: () => <p>Documents page</p>,
  });
  const pages = tabs.map((tab) =>
    createRoute({
      getParentRoute: () => knowledge,
      path: tab.path,
      loader: tab.loader,
      component: tab.component,
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren([
      dashboard.addChildren([knowledge.addChildren([documents, ...pages])]),
    ]),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-1/documents'],
    }),
    context: { queryClient },
  });
  const { user } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, user };
}

const tab = (name: string) =>
  within(
    screen.getByRole('navigation', {
      name: enMessages.common.aria.knowledgeNavigation,
    }),
  ).getByRole('link', { name });

// The tab switch: Products waits on a loader the test settles.
function renderSwitch() {
  const productsLoaded = Promise.withResolvers<void>();
  const stub = (path: string, name: string): TabPage => ({
    path,
    component: () => <p>{name} page</p>,
  });
  const view = renderKnowledge([
    stub('knowledge-entries', 'Knowledge entries'),
    stub('websites', 'Websites'),
    {
      path: 'products',
      loader: () => productsLoaded.promise,
      component: () => <p>Products page</p>,
    },
    stub('contacts', 'Contacts'),
  ]);
  return { ...view, loadProducts: () => productsLoaded.resolve() };
}

describe('Knowledge tab switch', () => {
  it('leaves the open page and its tab as they are until the next tab has loaded', async () => {
    const { router, user, loadProducts } = renderSwitch();
    const documents = await screen.findByText('Documents page');
    const documentsTab = tab(labels.documents);
    const productsTab = tab(labels.products);
    expect(documentsTab).toHaveAttribute('aria-current', 'page');

    await user.click(productsTab);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/dashboard/org-1/products'),
    );

    // The same element: the page was neither built again nor replaced, and
    // the strip still marks its tab, not the one the location names.
    expect(screen.getByText('Documents page')).toBe(documents);
    expect(screen.queryByText('Products page')).not.toBeInTheDocument();
    expect(documentsTab).toHaveAttribute('aria-current', 'page');
    expect(productsTab).not.toHaveAttribute('aria-current');
    expect(productsTab).not.toHaveAttribute('data-status');

    loadProducts();
    expect(await screen.findByText('Products page')).toBeInTheDocument();
    expect(documents).not.toBeInTheDocument();
    expect(productsTab).toHaveAttribute('aria-current', 'page');
    expect(documentsTab).not.toHaveAttribute('aria-current');
  });

  it('shows the next tab in the same frame, with no fade', async () => {
    const { user, loadProducts } = renderSwitch();
    const frame = (await screen.findByText('Documents page')).parentElement;
    loadProducts();

    await user.click(tab(labels.products));

    const products = await screen.findByText('Products page');
    expect(products.parentElement).toBe(frame);
    expect(frame?.className).not.toMatch(/animate-in|fade-in/);
  });
});

interface ListRead {
  status: PaginatedStatus;
  results: unknown[];
}

// Each tab's page reads its list as its table does on a visit with no filter
// in the URL; its first render says what the table would paint first.
function listPage(useList: (organizationId: string) => ListRead) {
  return function ListPage() {
    const list = useList('org-1');
    const [firstPaint] = useState(() =>
      list.status === 'LoadingFirstPage'
        ? 'skeleton rows'
        : `${list.results.length} rows`,
    );
    return <p>First paint: {firstPaint}</p>;
  };
}

const loaderOf = (route: { options: object }) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a file route's loader takes the full router match; it reads only these two
  (route.options as { loader: Loader }).loader;

const twoRows = [{ id: 'row-1' }, { id: 'row-2' }];

const PRIMED_TABS = [
  {
    label: labels.knowledgeEntries,
    path: 'knowledge-entries',
    loader: loaderOf(KnowledgeEntriesRoute),
    useList: (organizationId: string) =>
      useListKnowledgeEntriesPaginated({
        organizationId,
        initialNumItems: DEFAULT_TABLE_PAGE_SIZE,
      }),
    firstPage: { rows: twoRows, nextCursor: null },
  },
  {
    label: labels.websites,
    path: 'websites',
    loader: loaderOf(WebsitesRoute),
    useList: (organizationId: string) =>
      useListWebsitesPaginated({
        organizationId,
        initialNumItems: DEFAULT_TABLE_PAGE_SIZE,
      }),
    firstPage: { page: twoRows, isDone: true, continueCursor: '' },
  },
  {
    label: labels.products,
    path: 'products',
    loader: loaderOf(ProductsRoute),
    useList: (organizationId: string) =>
      useListProductsPaginated({
        organizationId,
        initialNumItems: DEFAULT_TABLE_PAGE_SIZE,
      }),
    firstPage: { items: twoRows, nextCursor: null },
  },
  {
    label: labels.contacts,
    path: 'contacts',
    loader: loaderOf(ContactsRoute),
    useList: (organizationId: string) =>
      useListContactsPaginated({
        organizationId,
        initialNumItems: DEFAULT_TABLE_PAGE_SIZE,
      }),
    firstPage: { items: twoRows, nextCursor: null },
  },
];

describe('Knowledge first visit', () => {
  it.each(PRIMED_TABS)(
    'paints the first page of $label on its first visit, primed while Knowledge opened',
    async ({ label, path }) => {
      read.mockReset();
      read.mockImplementation((route: string) => {
        if (route.endsWith('/count')) return Promise.resolve({ count: 2 });
        const listed = PRIMED_TABS.find((entry) =>
          route.startsWith(`/${entry.path}?`),
        );
        if (listed !== undefined) return Promise.resolve(listed.firstPage);
        return Promise.reject(new Error(`unexpected read ${route}`));
      });
      const { user, queryClient } = renderKnowledge(
        PRIMED_TABS.map((entry) => ({
          path: entry.path,
          loader: entry.loader,
          component: listPage(entry.useList),
        })),
      );
      await screen.findByText('Documents page');

      // The strip preloads the tab as it renders, and its loader asks for
      // the first page the table reads.
      const firstPage = `/${path}?limit=${DEFAULT_TABLE_PAGE_SIZE}`;
      await waitFor(() =>
        expect(read).toHaveBeenCalledWith(firstPage, { orgId: 'org-1' }),
      );
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));

      await user.click(tab(label));

      expect(await screen.findByText(/^First paint:/)).toHaveTextContent(
        'First paint: 2 rows',
      );
      expect(read.mock.calls.filter(([route]) => route === firstPage)).toEqual([
        [firstPage, { orgId: 'org-1' }],
      ]);
    },
  );
});
