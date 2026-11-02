import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import { TabNavigation, type TabNavigationItem } from './tab-navigation';

// A real router, so the strip's links are the router's own: the location
// names the next tab as soon as a navigation starts, while the outlet keeps
// the current page until the next tab's loader settles (here, only when the
// test lets it), and a link counts as active wherever the router matches it.
function renderTabs(initialPath: string, items: TabNavigationItem[]) {
  const ordersLoaded = Promise.withResolvers<void>();
  const root = createRootRoute({
    component: () => (
      <>
        <TabNavigation ariaLabel="Shop" items={items} />
        <Outlet />
      </>
    ),
  });
  const products = createRoute({
    getParentRoute: () => root,
    path: 'products',
    component: () => <p>Products page</p>,
  });
  const orders = createRoute({
    getParentRoute: () => root,
    path: 'orders',
    loader: () => ordersLoaded.promise,
    component: () => <p>Orders page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([products, orders]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { ...view, router, loadOrders: () => ordersLoaded.resolve() };
}

describe('TabNavigation current tab, under a real router', () => {
  it('marks the tab of the page it shows until the next page has loaded', async () => {
    const { user, router, loadOrders } = renderTabs('/products', [
      { label: 'Products', href: '/products' },
      { label: 'Orders', href: '/orders' },
    ]);
    await screen.findByText('Products page');
    const productsTab = screen.getByRole('link', { name: 'Products' });
    const ordersTab = screen.getByRole('link', { name: 'Orders' });

    await user.click(ordersTab);
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders'));

    // The location names Orders; the page, and so the strip, still Products.
    expect(screen.getByText('Products page')).toBeInTheDocument();
    expect(productsTab).toHaveAttribute('aria-current', 'page');
    expect(productsTab).toHaveClass('text-foreground');
    expect(ordersTab).not.toHaveAttribute('aria-current');
    expect(ordersTab).not.toHaveAttribute('data-status');
    expect(ordersTab).not.toHaveClass('text-foreground');

    await act(async () => loadOrders());
    expect(await screen.findByText('Orders page')).toBeInTheDocument();
    expect(ordersTab).toHaveAttribute('aria-current', 'page');
    expect(ordersTab).toHaveClass('text-foreground');
    expect(productsTab).not.toHaveAttribute('aria-current');
    expect(productsTab).not.toHaveClass('text-foreground');
  });

  it('marks the tab of a page whose address ends in a slash', async () => {
    // The router keeps a slash typed at the end of an address; an exact tab
    // still names the page it shows.
    renderTabs('/products/', [
      { label: 'Products', href: '/products', matchMode: 'exact' },
      { label: 'Orders', href: '/orders', matchMode: 'exact' },
    ]);
    await screen.findByText('Products page');

    const productsTab = screen.getByRole('link', { name: 'Products' });
    expect(productsTab).toHaveAttribute('aria-current', 'page');
    expect(productsTab).toHaveClass('text-foreground');
    expect(screen.getByRole('link', { name: 'Orders' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks only the tab its owner calls current, not every tab the router matches', async () => {
    // A search-param strip (the automation detail's `?tab=`): the router
    // counts a link active when the location's search includes the link's,
    // and every search includes the first tab's empty one.
    renderTabs('/products?tab=prices', [
      { label: 'Overview', href: '/products', search: {}, isActive: false },
      {
        label: 'Prices',
        href: '/products',
        search: { tab: 'prices' },
        isActive: true,
      },
    ]);
    await screen.findByText('Products page');

    expect(screen.getByRole('link', { name: 'Prices' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const overview = screen.getByRole('link', { name: 'Overview' });
    expect(overview).not.toHaveAttribute('aria-current');
    expect(overview).not.toHaveAttribute('data-status');
  });
});
