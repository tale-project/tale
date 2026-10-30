/**
 * The Products list's Category filter over its real reads (#3866): the
 * facet's values come through `useProductCategories`, its adapter row and
 * `backendFetch`, the rows through `useListProductsPaginated`, and only
 * `fetch` is answered here, by a small model of the products doors that
 * narrows by the facets its address names. The router, the abilities and the
 * column config are stubbed as in `products-table.read-failure.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  defaultParseSearch,
  defaultStringifySearch,
} from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { render, screen, waitFor, within } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { ProductsTable } from './products-table';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('../hooks/mutations', () => ({
  useDeleteProduct: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./products-action-menu', () => ({
  ProductsActionMenu: () => null,
}));

const columns: ColumnDef<ProductDoc>[] = [
  { accessorKey: 'name', header: 'Name', size: 200 },
  { accessorKey: 'category', header: 'Category', size: 120 },
];

vi.mock('../hooks/use-products-table-config', () => ({
  useProductsTableConfig: () => ({
    columns,
    searchPlaceholder: 'Search products',
    pageSize: 20,
  }),
}));

const ORG = 'org-1';

function wireProduct(name: string, category: string | null) {
  return {
    id: `product-${name.toLowerCase().replaceAll(' ', '-')}`,
    organizationId: ORG,
    name,
    description: null,
    imageUrl: null,
    stock: 3,
    price: 12.5,
    currency: 'CHF',
    category,
    tags: [],
    status: 'active',
    translations: null,
    externalId: null,
    metadata: null,
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
  };
}

const catalog = [
  wireProduct('Hammer', 'Tools'),
  wireProduct('Rake', 'Garden'),
  wireProduct('Wrench', 'Tools'),
  wireProduct('Gift card', null),
];

/** The products listing as the list reaches it: each facet its address names
 * narrows the rows, the category matched exactly as `listProducts` does. */
function productsDoor(url: URL): Response {
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const items = catalog.filter(
    (row) =>
      (status === null || row.status === status) &&
      (category === null || row.category === category),
  );
  return Response.json({ items, nextCursor: null });
}

const CATEGORIES_READ = /^GET \/api\/app\/products\/categories\?/;

let backend: SyntheticBackend;

beforeEach(() => {
  // The adapters resolve the active organization from the page's address.
  window.history.pushState({}, '', `/dashboard/${ORG}/products`);
  navigate.mockReset();
  backend = syntheticBackend();
  backend.on(/^GET \/api\/app\/products\/count\?/, () =>
    Response.json({ count: catalog.length }),
  );
  backend.on(CATEGORIES_READ, () =>
    Response.json({ categories: ['Garden', 'Tools'] }),
  );
  backend.on(/^GET \/api\/app\/products\?/, productsDoor);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface TableProps {
  status?: string;
  category?: string;
}

function renderTable(props: TableProps = {}) {
  // No backoff between a failed read's attempts; the attempt count is real.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const table = (next: TableProps) => (
    <QueryClientProvider client={client}>
      <ProductsTable organizationId={ORG} {...next} />
    </QueryClientProvider>
  );
  const view = render(table(props));
  return {
    client,
    user: view.user,
    unmount: view.unmount,
    rerender: (next: TableProps) => view.rerender(table(next)),
  };
}

/** The names of the data rows the table renders, in order: each row's first
 * cell with text (the selection checkbox has none, Name precedes Category). */
function listedNames(): string[] {
  return screen
    .getAllByRole('row')
    .map((row) =>
      within(row)
        .queryAllByRole('cell')
        .map((cell) => cell.textContent?.trim() ?? '')
        .find((text) => text !== ''),
    )
    .filter((name): name is string => name !== undefined);
}

const listReads = () =>
  backend.calls.filter((call) => call.startsWith('GET /api/app/products?'));

async function openFilters(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  return screen.findByRole('dialog', { name: 'Filters' });
}

/** The Category facet, expanded, once its options have arrived. */
async function openCategory(user: UserEvent): Promise<HTMLElement> {
  const panel = await openFilters(user);
  await user.click(
    await within(panel).findByRole('button', { name: 'Category' }),
  );
  return within(panel).getByRole('radiogroup', { name: 'Category' });
}

const optionsOf = (facet: HTMLElement) =>
  within(facet)
    .getAllByRole('radio')
    .map((radio) => radio.textContent);

describe('the Products Category filter over the real reads', () => {
  it('offers each category the products carry, beside Status', async () => {
    const { user } = renderTable();
    await waitFor(() => expect(listedNames()).toHaveLength(catalog.length));

    const facet = await openCategory(user);
    expect(optionsOf(facet)).toEqual(['Garden', 'Tools']);
    expect(within(facet).queryByRole('radio', { checked: true })).toBeNull();
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    expect(
      within(panel).getByRole('button', { name: 'Status' }),
    ).toBeInTheDocument();
    expect(backend.calls).toContain(
      `GET /api/app/products/categories?orgId=${ORG}`,
    );
  });

  it('narrows the list to the chosen category through the address', async () => {
    const view = renderTable({ status: 'active' });
    await waitFor(() => expect(listedNames()).toHaveLength(catalog.length));

    const facet = await openCategory(view.user);
    await view.user.click(within(facet).getByRole('radio', { name: 'Tools' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/products',
      params: { id: ORG },
      search: expect.any(Function),
    });
    const navigation = navigate.mock.lastCall?.[0];
    if (!navigation) throw new Error('Expected a category navigation');
    const nextSearch = navigation.search({ status: 'active', query: 'kept' });
    expect(nextSearch).toEqual({
      status: 'active',
      query: 'kept',
      category: 'Tools',
    });

    // The address carries the choice to the page the route renders.
    const url = `/dashboard/${ORG}/products${defaultStringifySearch(nextSearch)}`;
    window.history.pushState({}, '', url);
    const restored = z
      .object({ status: z.string(), category: z.string() })
      .parse(defaultParseSearch(window.location.search));
    view.unmount();
    renderTable(restored);
    await waitFor(() => expect(listedNames()).toEqual(['Hammer', 'Wrench']));
    expect(listReads().at(-1)).toBe(
      `GET /api/app/products?limit=20&status=active&category=Tools&orgId=${ORG}`,
    );
  });

  it('lists every product again once the filters are cleared', async () => {
    const view = renderTable({ category: 'Tools' });
    await waitFor(() => expect(listedNames()).toEqual(['Hammer', 'Wrench']));

    const panel = await openFilters(view.user);
    await view.user.click(
      within(panel).getByRole('button', { name: 'Clear all' }),
    );
    // Every navigation the clear made, applied in turn to the address it
    // started from, as the router applies them.
    const cleared = navigate.mock.calls.reduce<Record<string, unknown>>(
      (search, [navigation]) =>
        typeof navigation.search === 'function'
          ? navigation.search(search)
          : navigation.search,
      { category: 'Tools', status: 'active' },
    );
    expect(cleared).toEqual({});

    view.rerender({});
    await waitFor(() => expect(listedNames()).toHaveLength(catalog.length));
    expect(listReads().at(-1)).toBe(
      `GET /api/app/products?limit=20&orgId=${ORG}`,
    );
  });

  it('keeps a chosen category no product carries any longer, so it can be undone', async () => {
    const { user } = renderTable({ category: 'Seasonal' });
    await waitFor(() =>
      expect(listReads()).toEqual([
        `GET /api/app/products?limit=20&category=Seasonal&orgId=${ORG}`,
      ]),
    );

    const facet = await openCategory(user);
    await waitFor(() =>
      expect(optionsOf(facet)).toEqual(['Seasonal', 'Garden', 'Tools']),
    );
    expect(
      within(facet).getByRole('radio', { name: 'Seasonal' }),
    ).toBeChecked();

    // Pressing the chosen option again clears it.
    await user.click(within(facet).getByRole('radio', { name: 'Seasonal' }));
    const navigation = navigate.mock.lastCall?.[0];
    if (!navigation) throw new Error('Expected a category navigation');
    expect(navigation.search({ category: 'Seasonal' })).toEqual({
      category: undefined,
    });
  });

  it('offers no Category while no product carries one', async () => {
    backend.on(CATEGORIES_READ, () => Response.json({ categories: [] }));
    const { client, user } = renderTable();
    await waitFor(() => expect(listedNames()).toHaveLength(catalog.length));
    await waitFor(() => expect(backend.count(CATEGORIES_READ)).toBe(1));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    const panel = await openFilters(user);
    expect(
      within(panel).getByRole('button', { name: 'Status' }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: 'Category' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the list and Status when the categories cannot be read', async () => {
    backend.on(CATEGORIES_READ, () => serviceUnavailable());
    const { client, user } = renderTable();
    await waitFor(() => expect(listedNames()).toHaveLength(catalog.length));
    // The read policy's four attempts, then the read gives up.
    await waitFor(() => expect(backend.count(CATEGORIES_READ)).toBe(4));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    const panel = await openFilters(user);
    expect(
      within(panel).getByRole('button', { name: 'Status' }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: 'Category' }),
    ).not.toBeInTheDocument();
  });

  it('still offers the chosen category when the categories cannot be read', async () => {
    backend.on(CATEGORIES_READ, () => serviceUnavailable());
    const { client, user } = renderTable({ category: 'Tools' });
    await waitFor(() => expect(listedNames()).toEqual(['Hammer', 'Wrench']));
    await waitFor(() => expect(backend.count(CATEGORIES_READ)).toBe(4));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    const facet = await openCategory(user);
    expect(optionsOf(facet)).toEqual(['Tools']);
    expect(within(facet).getByRole('radio', { name: 'Tools' })).toBeChecked();
  });
});
