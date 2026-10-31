import { AdaptiveHeaderProvider } from '@tale/ui/adaptive-header';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import { Route } from './_knowledge';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

// The real strip links to and preloads all five tabs; this tree holds two.
vi.mock('@/app/features/knowledge/components/knowledge-navigation', () => ({
  KnowledgeNavigation: () => <nav aria-label="Knowledge navigation" />,
}));

// The real router, so a navigation runs as it does in the app: the location
// names the next tab at once, and the outlet keeps the current page until
// the next tab's loader settles — here, only when the test opens it.
function renderKnowledge() {
  const productsLoaded = Promise.withResolvers<void>();
  const root = createRootRoute({
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
  const products = createRoute({
    getParentRoute: () => knowledge,
    path: 'products',
    loader: () => productsLoaded.promise,
    component: () => <p>Products page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      dashboard.addChildren([knowledge.addChildren([documents, products])]),
    ]),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-1/documents'],
    }),
  });
  render(<RouterProvider router={router} />);
  return { router, loadProducts: () => productsLoaded.resolve() };
}

describe('Knowledge tab switch', () => {
  it('leaves the open page as it is until the next tab has loaded', async () => {
    const { router, loadProducts } = renderKnowledge();
    const documents = await screen.findByText('Documents page');

    act(() => {
      void router.navigate({
        to: '/dashboard/$id/products',
        params: { id: 'org-1' },
      });
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/dashboard/org-1/products'),
    );

    // The same element: the page was neither built again nor replaced.
    expect(screen.getByText('Documents page')).toBe(documents);
    expect(screen.queryByText('Products page')).not.toBeInTheDocument();

    await act(async () => loadProducts());
    expect(await screen.findByText('Products page')).toBeInTheDocument();
    expect(documents).not.toBeInTheDocument();
  });

  it('shows the next tab in the same frame, with no fade', async () => {
    const { router, loadProducts } = renderKnowledge();
    const frame = (await screen.findByText('Documents page')).parentElement;
    loadProducts();

    await act(() =>
      router.navigate({
        to: '/dashboard/$id/products',
        params: { id: 'org-1' },
      }),
    );

    const products = await screen.findByText('Products page');
    expect(products.parentElement).toBe(frame);
    expect(frame?.className).not.toMatch(/animate-in|fade-in/);
  });
});
