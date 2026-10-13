import type { ColumnDef } from '@tanstack/react-table';
import { vi } from 'vitest';

import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { describeListReadFailure } from '@/tests/utils/list-read-failure';

import { ProductsTable } from './products-table';

// #3843: a Products list whose read failed said "No products yet", with no
// retry. The read lane runs for real; only `fetch` is answered.

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/mutations', () => ({
  useDeleteProduct: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./products-action-menu', () => ({
  ProductsActionMenu: () => null,
}));

const columns: ColumnDef<ProductDoc>[] = [
  { accessorKey: 'name', header: 'Name', size: 200 },
];

vi.mock('../hooks/use-products-table-config', () => ({
  useProductsTableConfig: () => ({
    columns,
    searchPlaceholder: 'Search products',
    pageSize: 20,
  }),
}));

const product = {
  id: 'product-lamp',
  organizationId: 'org-1',
  name: 'Synthetic desk lamp',
  description: null,
  price: 49,
  currency: 'CHF',
  stock: 3,
  status: 'active',
  category: null,
  source: 'manual_import',
  locale: 'en',
  createdAt: 1770000000000,
  updatedAt: 1770000000000,
};

describeListReadFailure('ProductsTable', {
  namespace: 'products',
  emptyTitleKey: 'products.title',
  path: '/dashboard/org-1/products',
  firstPage: /^GET \/api\/app\/products\?limit=20&orgId=org-1$/,
  anyPage: /^GET \/api\/app\/products\?limit=/,
  rows: () => Response.json({ items: [product], nextCursor: null }),
  empty: () => Response.json({ items: [], nextCursor: null }),
  rowText: product.name,
  routes: (backend) =>
    backend.on(/^GET \/api\/app\/products\/count\?/, () =>
      Response.json({ count: 1 }),
    ),
  render: () => <ProductsTable organizationId="org-1" />,
});
